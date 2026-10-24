import type { QueryResponse } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { compareLogs } from './lib/compare.ts'
import { GeneralLog } from './lib/general-log.ts'
import { PmaClient, isPmaUp, sqlBoxForm, visibleText } from './lib/pma.ts'
import { cardText, collapse, errorText } from './lib/render.ts'
import { PMA_STORAGE } from './lib/server-setup.ts'

/**
 * "Create JS code" as phpMyAdmin's "Create PHP code" (parity exception X57): our card shows the query
 * as JavaScript; it must evaluate back to the query, and the rest of the card is compared with
 * phpMyAdmin's after the message and the code are put back as phpMyAdmin renders them
 * (Generator::getMessage with `$sql = "…";`, addslashes and `. "` continuation lines).
 */
function asPmaCode(st: QueryResponse['statements'][number]): QueryResponse['statements'][number] {
  const card = st.card
  if (card === null || card === undefined || !card.php) return st
  expect(new Function(`${card.display}\nreturn sql`)()).toBe(card.sql)
  const php = `$sql = "${card.sql.replace(/[\\'"\0]/g, (c) => (c === '\0' ? '\\0' : `\\${c}`)).replace(/\r\n|\r|\n/g, '\\n"\n    . "')}";`
  return {
    ...st,
    message: { ...st.message, text: st.message.text.replace('Showing as JS code', 'Showing as PHP code') },
    card: { ...card, display: php },
  }
}

/**
 * Golden parity for the SQL tab beyond plain execution: bind parameters, rollback, foreign key checks,
 * Show as PHP, profiling, import mode (>= 50 statements), CALL, the DROP DATABASE guard, the card's links,
 * error cards, reload hints; plus the editor endpoints (lint, format, autocomplete, simulate, FK default).
 */
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const U = { pma: 'm1sql_up', bma: 'm1sql_ub', pmaLow: 'm1sql_lp', bmaLow: 'm1sql_lb' }
const DB_PMA = 'm1sql_dbp'
const DB_BMA = 'm1sql_dbb'
const dbMap = {
  [DB_PMA]: 'par_db',
  [DB_BMA]: 'par_db',
  [U.pma]: 'parity_user',
  [U.bma]: 'parity_user',
  [U.pmaLow]: 'parity_user',
  [U.bmaLow]: 'parity_user',
}

const reachable = await isPmaUp(PMA_URL)

const SEED = (db: string) => `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}; USE ${db};
  CREATE TABLE t (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(20), qty INT) ENGINE=InnoDB;
  INSERT INTO t (name, qty) VALUES ${Array.from({ length: 40 }, (_, i) => `('item${i + 1}', ${i % 7})`).join(',')};
  CREATE TABLE my (id INT PRIMARY KEY, v INT) ENGINE=MyISAM;
  INSERT INTO my VALUES (1, 1), (2, 2);
  CREATE TABLE child (id INT PRIMARY KEY, t_id INT, FOREIGN KEY (t_id) REFERENCES t (id)) ENGINE=InnoDB;
  CREATE TABLE t2 (x INT);
  CREATE PROCEDURE p() BEGIN SELECT 1 AS a; SELECT id, name FROM t WHERE id < 4; END;
  CREATE PROCEDURE pe() BEGIN SELECT id FROM t WHERE 0; END;`

const maskTime = (s: string) => s.replace(/\d+\.\d{4} seconds/g, 'T seconds')
const maskDb = (s: string) => s.replaceAll(DB_PMA, 'par_db').replaceAll(DB_BMA, 'par_db')
const norm = (s: string) => maskDb(maskTime(collapse(s)))

interface Case {
  name: string
  sql: string
  db?: '' | 'db'
  table?: string
  delimiter?: string
  low?: boolean
  /** extra phpMyAdmin form fields (null removes a default one) */
  pma?: Record<string, string | null>
  /** extra POST /query body fields */
  bma?: Record<string, unknown>
  /** phpMyAdmin's visible text does not hold the result card (import mode puts it in sql_query). */
  importMode?: boolean
  /** requests sent to both tools after the case (e.g. switching profiling off again) */
  after?: { pma: Record<string, string | null>; bma: Record<string, unknown> }
  check?: (r: { pma: Record<string, unknown>; pmaText: string; pmaHtml: string; bma: QueryResponse }) => void
}

const many = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n')

const CASES: Case[] = [
  {
    name: 'bind parameters: values substituted, non-numeric quoted [p09-ec9fe2]',
    sql: 'SELECT * FROM t WHERE id = :id OR name = :name OR id = :id2',
    pma: {
      parameterized: 'on',
      'parameters[:id]': '3',
      'parameters[:name]': "it'em5",
      'parameters[:id2]': '1e1',
    },
    bma: { params: { ':id': '3', ':name': "it'em5", ':id2': '1e1' } },
  },
  {
    name: 'rollback when finished: START TRANSACTION, message, nothing kept [p09-aa1339]',
    sql: 'UPDATE t SET qty = 99 WHERE id < 3; DELETE FROM t WHERE id = 40',
    pma: { rollback_query: '1' },
    bma: { rollback: true },
  },
  {
    name: 'rollback refused for a non-transactional table [p02-b3ba1b] [p09-aa1339]',
    sql: 'UPDATE my SET v = 5',
    pma: { rollback_query: '1' },
    bma: { rollback: true },
  },
  {
    name: 'rollback refused for SELECT [p02-b3ba1b] [p09-aa1339]',
    sql: 'SELECT 1',
    pma: { rollback_query: '1' },
    bma: { rollback: true },
  },
  {
    name: 'rollback refused with the server error of the table check [p09-aa1339]',
    sql: 'UPDATE nope SET a = 1',
    pma: { rollback_query: '1' },
    bma: { rollback: true },
  },
  {
    name: 'foreign key checks disabled for the request [p02-b10e84] [p09-1fc182]',
    sql: 'INSERT INTO child VALUES (1, 999)',
    pma: { fk_checks: '0' },
    bma: { fkChecks: false },
  },
  {
    name: 'foreign key checks enabled: constraint error card',
    sql: 'INSERT INTO child VALUES (2, 999)',
    bma: { fkChecks: true },
  },
  {
    name: 'Create PHP code: not executed, one card for the whole text [p02-f4f624] [p09-550737]',
    sql: 'SELECT * FROM t;\nUPDATE t SET qty = 1 WHERE id = 1',
    pma: { show_as_php: '1' },
    bma: { showAsPhp: true },
  },
  {
    name: 'show_as_php=0: Showing SQL query [p02-f4f624] [p09-550737]',
    sql: 'SELECT 1',
    pma: { show_as_php: '0' },
    bma: { showAsPhp: false },
  },
  {
    name: 'Create PHP code of an UPDATE says rows affected',
    sql: 'UPDATE t SET qty = 0',
    pma: { show_as_php: '1' },
    bma: { showAsPhp: true },
  },
  {
    name: 'profiling: SET PROFILING=1 and SHOW PROFILE around the query [p02-2a54e4] [p09-33158a]',
    sql: 'SELECT * FROM t WHERE qty > 3',
    pma: { profiling: 'on' },
    bma: { profiling: true },
    after: { pma: { profiling_form: '1' }, bma: { profiling: false } },
    check: ({ pmaHtml, bma }) => {
      const st = bma.statements[0]!
      expect(st.profiling).toBeDefined()
      expect(pmaHtml).toContain('Detailed profile')
      expect(st.card?.links.profiling?.checked).toBe(true)
      expect(pmaHtml).toMatch(/id="profilingCheckbox"[^>]*checked/)
    },
  },
  {
    name: 'import mode: exactly 50 statements keep the transcript [p09-9a56f6]',
    sql: many(50, (i) => `SELECT ${i};`),
    importMode: true,
  },
  {
    name: 'import mode: more than 50 statements disable the SQL display [p09-9a56f6]',
    sql: `${many(52, (i) => `SELECT ${i};`)}\nUPDATE t SET qty = qty + 1 WHERE id < 3;\nDELETE FROM t WHERE id > 100;`,
    importMode: true,
  },
  {
    name: 'import mode: the first error stops and shows its card [p09-9a56f6]',
    sql: `${many(51, (i) => `SELECT ${i};`)}\nSELECT * FROM nope;\nSELECT 2;`,
    importMode: true,
  },
  {
    name: 'import mode: USE switches the database [p02-b19bd5] [p09-410573]',
    sql: `USE mysql;\n${many(50, () => 'SELECT DATABASE();')}`,
    importMode: true,
  },
  { name: 'CALL with several result sets [p09-c6af25]', sql: 'CALL p()' },
  { name: 'CALL with an empty result set [p09-c6af25]', sql: 'CALL pe()' },
  {
    name: 'DROP DATABASE is refused for a non-superuser [p02-1f1ac2] [p09-15a63a]',
    sql: 'DROP DATABASE IF EXISTS somedb',
    low: true,
  },
  {
    name: 'long query: truncated display, no Explain / PHP links [p02-40a8f8] [p09-16d3bb]',
    sql: `SELECT id /* ${'x'.repeat(1100)} */ FROM t WHERE id = 1`,
  },
  { name: 'Skip Explain SQL [p02-aa2107]', sql: 'EXPLAIN SELECT * FROM t WHERE id = 2' },
  {
    name: 'Skip Explain SQL with FORMAT [p02-aa2107]',
    sql: 'EXPLAIN FORMAT=JSON SELECT * FROM t WHERE id = 2',
  },
  {
    name: 'static analysis errors in the error card [p02-fa2d56] [p09-a25a57]',
    sql: "SELECT * FROM t WHERE name = 'abc",
  },
  {
    name: 'RENAME TABLE: ajax_reload with the new table name [p09-410573]',
    sql: 'RENAME TABLE t2 TO t2_renamed',
  },
  { name: 'CREATE TABLE: ajax_reload reload [p09-410573]', sql: 'CREATE TABLE t3 (a INT)' },
  { name: 'DROP TABLE: reload hints [p09-410573]', sql: 'DROP TABLE t2' },
  {
    name: 'table scope: edit links go to the table SQL tab [p02-88edc9]',
    sql: 'SELECT * FROM t WHERE id < 3',
    table: 't',
  },
  {
    name: 'server scope: a qualified table sets the scope',
    sql: `SELECT * FROM ${'%DB%'}.t LIMIT 2`,
    db: '',
  },
  { name: 'warnings are reported [p02-be287b] [p09-001dd4]', sql: 'SELECT 1/0' },
  { name: 'UPDATE without WHERE (no confirm server side)', sql: 'UPDATE t SET qty = qty' },
  { name: 'SHOW has Refresh and Profiling [p02-f44b2c]', sql: 'SHOW TABLES' },
  {
    name: 'multi-statement with USE keeps the page database [p09-410573]',
    sql: 'USE mysql; SELECT * FROM t LIMIT 1',
  },
  {
    name: 'SELECT from another database sets Current::$database',
    sql: 'SELECT 1; SELECT * FROM mysql.db LIMIT 1',
  },
]

describe.skipIf(!reachable)('parity: SQL tab features (/import) vs POST /query', () => {
  let log: GeneralLog
  const pma = { super: new PmaClient(PMA_URL), low: new PmaClient(PMA_URL) }
  let bma: { super: ReturnType<typeof testApp>; low: ReturnType<typeof testApp> }
  let root: mysql.Connection

  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    for (const u of [U.pma, U.bma]) {
      await root.query(
        `CREATE USER IF NOT EXISTS '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON *.* TO '${u}'@'%'`,
      )
    }
    for (const [u, db] of [
      [U.pmaLow, DB_PMA],
      [U.bmaLow, DB_BMA],
    ] as const) {
      await root.query(
        `CREATE USER IF NOT EXISTS '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON \`${db}\`.* TO '${u}'@'%'`,
      )
    }
    log = await GeneralLog.open(ROOT)
    await pma.super.login(U.pma, U.pma)
    await pma.low.login(U.pmaLow, U.pmaLow)
    bma = { super: testApp(testConfig({}, PMA_STORAGE)), low: testApp(testConfig({}, PMA_STORAGE)) }
    await bma.super.login(U.bma, U.bma)
    await bma.low.login(U.bmaLow, U.bmaLow)
  })

  afterAll(async () => {
    await root?.query(`DROP DATABASE IF EXISTS ${DB_PMA}; DROP DATABASE IF EXISTS ${DB_BMA}`)
    await root?.end()
    await log?.close()
    await bma?.super.close()
    await bma?.low.close()
  })

  for (const c of CASES) {
    it(c.name, async () => {
      await root.query(SEED(DB_PMA))
      await root.query(SEED(DB_BMA))
      const pdb = c.db === '' ? '' : DB_PMA
      const bdb = c.db === '' ? '' : DB_BMA
      const p = c.low === true ? pma.low : pma.super
      const b = c.low === true ? bma.low : bma.super
      const pUser = c.low === true ? U.pmaLow : U.pma
      const bUser = c.low === true ? U.bmaLow : U.bma

      const m1 = await log.marker()
      const pr = await p.postJson(
        '/import',
        sqlBoxForm(c.sql.replaceAll('%DB%', DB_PMA), pdb, c.table ?? '', {
          sql_delimiter: c.delimiter ?? ';',
          ...c.pma,
        }),
      )
      const pmaLog = await log.since(pUser, m1)

      const m2 = await log.marker()
      const br = await b.req('POST', '/api/servers/1/query', {
        sql: c.sql.replaceAll('%DB%', DB_BMA),
        db: bdb,
        ...(c.table !== undefined ? { table: c.table } : {}),
        delimiter: c.delimiter ?? ';',
        fromQueryBox: true,
        fkChecks: true,
        ...c.bma,
      })
      const bmaLog = await log.since(bUser, m2)
      expect(br.status, JSON.stringify(br.json)).toBe(200)
      const res = br.json as unknown as QueryResponse

      if (c.after !== undefined) {
        await p.postJson('/import', sqlBoxForm('SELECT 1', pdb, '', c.after.pma))
        await b.req('POST', '/api/servers/1/query', {
          sql: 'SELECT 1',
          db: bdb,
          fromQueryBox: true,
          ...c.after.bma,
        })
      }

      const pmaHtml = String(pr.message ?? pr.error ?? '')
      const pmaText = norm(visibleText(pmaHtml))
      const statements = res.statements

      // 1. success flag and texts
      // mysqlDie errors and a failed import are `success: false`; a refused rollback is a plain message
      const failed =
        statements.some((s) => s.error !== undefined) ||
        (c.importMode === true && statements[0]?.kind === 'error')
      expect(pr.success, `success for ${c.sql.slice(0, 80)}`).toBe(!failed)
      for (const st of statements) {
        if (c.importMode === true && st.error === undefined) {
          // the SQL tab shows only data.message; the card is in sql_query
          expect(pmaText).toBe(norm(st.message.text))
          if (st.card !== undefined && st.card !== null) {
            expect(norm(visibleText(String(pr.sql_query ?? '')))).toContain(norm(cardText(st)))
          }
          continue
        }
        const expected =
          st.kind === 'error' && st.error !== undefined ? errorText(st) : cardText(asPmaCode(st))
        expect(pmaText, `text for ${st.sql.slice(0, 80)}`).toContain(norm(expected))
        for (const more of st.moreResults ?? []) expect(pmaText).toContain(norm(more.message))
        for (const w of st.warnings) expect(pmaText).toContain(norm(`${w.level}: #${w.code} ${w.message}`))
        const card = st.card
        if (card?.links.edit) {
          const route = card.table !== '' ? '/table/sql' : card.db !== '' ? '/database/sql' : '/server/sql'
          expect(pmaHtml).toContain(`route=${route}&`)
        }
        if (st.profiling === undefined) expect(pmaHtml).not.toContain('Detailed profile')
      }

      // 2. response fields: ajax_reload, reloadNavigation, reloadQuerywindow
      if (pr.success === true && c.importMode !== true) {
        const ar = (pr.ajax_reload ?? undefined) as
          | { reload?: boolean; table_name?: string }
          | unknown[]
          | undefined
        const pmaReload = Array.isArray(ar) || ar === undefined ? {} : ar
        expect(res.ajaxReload ?? {}).toEqual({
          ...(pmaReload.reload !== undefined ? { reload: pmaReload.reload } : {}),
          ...(pmaReload.table_name !== undefined ? { tableName: pmaReload.table_name } : {}),
        })
      }
      if (pr.success === true) {
        expect(res.reloadNavigation).toBe(pr.reloadNavigation === 1)
        const rq = pr.reloadQuerywindow as { db: string; table: string; sql_query: string }
        expect(maskDb(res.db ?? '')).toBe(maskDb(rq.db))
        expect(res.table ?? '').toBe(rq.table)
        expect(maskDb(res.sqlQuery)).toBe(maskDb(rq.sql_query))
      }

      c.check?.({ pma: pr, pmaText, pmaHtml, bma: res })

      // 3. statements sent to MySQL. Configuration storage (pma__*) writes such as the transformation
      // cleanup after DROP and the recent tables, on both sides) belong to the pmadb features and are
      // compared there (whether a recent-table write happens depends on what the stored list holds).
      const cmp = compareLogs(
        pmaLog.filter((e) => !/`pma__\w+`/.test(e.sql)),
        bmaLog.filter((e) => !/`pma__\w+`/.test(e.sql)),
        dbMap,
      )
      expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    })
  }

  it('Refresh and Profiling repost the card to /sql: the query shows without the import ";"', async () => {
    await root.query(SEED(DB_PMA))
    await root.query(SEED(DB_BMA))
    const sql = 'SELECT id FROM t WHERE id < 3'
    // the SQL box (/import) appends ";"
    const boxed = (
      (await bma.super.req('POST', '/api/servers/1/query', { sql, db: DB_BMA, fromQueryBox: true }))
        .json as unknown as QueryResponse
    ).statements[0]!
    expect(boxed.card?.display).toBe(`${sql};`)
    // a card from /sql (browse, search results): its signed Refresh link goes to /sql again
    const first = (
      (await bma.super.req('POST', '/api/servers/1/query', { sql, db: DB_BMA, viaSql: true }))
        .json as unknown as QueryResponse
    ).statements[0]!
    expect(first.card?.display).toBe(sql)
    const toggles: Array<{ p: Record<string, string>; b: { profiling?: boolean } }> = [
      { p: {}, b: {} },
      { p: { profiling_form: '1', profiling: 'on' }, b: { profiling: true } },
      { p: { profiling_form: '1' }, b: { profiling: false } },
    ]
    for (const { p: pmaExtra, b: extra } of toggles) {
      const pr = await pma.super.postJson('/sql', { db: DB_PMA, sql_query: first.sql, ...pmaExtra })
      const br = (
        await bma.super.req('POST', '/api/servers/1/query', {
          sql: first.sql,
          db: DB_BMA,
          sig: first.sig,
          ...extra,
        })
      ).json as unknown as QueryResponse
      const st = br.statements[0]!
      expect(st.card?.display).toBe(sql)
      const pmaText = norm(visibleText(String(pr.message ?? '')))
      expect(pmaText).toContain(norm(cardText(st)))
      expect(pmaText).not.toContain(`${sql};`)
    }
  })

  describe('editor endpoints', () => {
    beforeAll(async () => {
      await root.query(SEED(DB_PMA))
      await root.query(SEED(DB_BMA))
    })

    const LINT = [
      { sql: 'SELECT * FROM t WHERE', editorType: undefined },
      { sql: "SELECT 'abc", editorType: undefined },
      { sql: 'SELECT 1;\nSELEC 2', editorType: undefined },
      { sql: 'BEGIN\n  SELECT 1 FROM;\nEND', editorType: 'routine' as const },
      { sql: 'INSERT INTO b VALUES (NEW.x', editorType: 'trigger' as const },
      { sql: 'DELETE FROM t WHERE', editorType: 'event' as const },
      { sql: `SELECT ${'1,'.repeat(5001)}1`, editorType: undefined },
    ]
    for (const l of LINT) {
      it(`lint ${l.editorType ?? 'sql'}: ${l.sql.slice(0, 30)}`, async () => {
        const pr = await pma.super.postJson('/lint', {
          sql_query: l.sql,
          no_history: 'true',
          ...(l.editorType !== undefined ? { 'options[editorType]': l.editorType } : {}),
        })
        const br = await bma.super.req('POST', '/api/servers/1/sql/lint', {
          sql: l.sql,
          editorType: l.editorType,
        })
        expect(br.json.lints).toEqual(pr)
      })
    }

    for (const sql of [
      'select a,b from t where x=1 and (y=2 or z=3) order by a desc limit 5',
      "INSERT INTO t (name, qty) VALUES ('a', 1), ('b', 2)",
      "CREATE TABLE x (id INT PRIMARY KEY, name VARCHAR(20) NOT NULL DEFAULT '') ENGINE=InnoDB",
      '-- c\nSELECT 1; /* d */ SELECT 2',
    ]) {
      for (const singleLine of [false, true]) {
        it(`format${singleLine ? ' single line' : ''}: ${sql.slice(0, 30)}`, async () => {
          const pr = await pma.super.postJson('/database/sql/format', {
            sql,
            formatSingleLine: String(singleLine),
          })
          const br = await bma.super.req('POST', '/api/servers/1/sql/format', { sql, singleLine })
          expect(br.json.sql).toBe(pr.sql)
        })
      }
    }

    it('autocomplete lists tables and columns with hints [p09-d9ff25]', async () => {
      const m1 = await log.marker()
      const pr = await pma.super.postJson('/database/sql/autocomplete', { db: DB_PMA, no_debug: 'true' })
      const pmaLog = await log.since(U.pma, m1)
      const m2 = await log.marker()
      const br = await bma.super.req('GET', `/api/servers/1/sql/autocomplete?db=${DB_BMA}`)
      const bmaLog = await log.since(U.bma, m2)
      expect(br.json.tables).toEqual(pr.tables)
      const cmp = compareLogs(pmaLog, bmaLog, dbMap)
      expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    })

    it('default foreign key check value [p09-1fc182]', async () => {
      const pr = await pma.super.getJson('/sql/get-default-fk-check-value')
      const br = await bma.super.req('GET', '/api/servers/1/sql/default-fk-check')
      expect(br.json.defaultFkCheckValue).toBe(pr.default_fk_check_value)
    })

    const SIMULATE = [
      'UPDATE t SET qty = 3 WHERE id < 10',
      'UPDATE t SET qty = qty, name = UPPER(name) WHERE id BETWEEN 3 AND 6 ORDER BY id LIMIT 2',
      'DELETE FROM t WHERE qty = 2',
      'DELETE FROM t ORDER BY id DESC LIMIT 3',
      'UPDATE t SET qty = 1; DELETE FROM t WHERE id = 1',
      'UPDATE t, my SET t.qty = my.v WHERE t.id = my.id',
      'SELECT 1',
      'UPDATE t SET qty = 1 WHERE (',
      'UPDATE t SET nope = 1',
    ]
    for (const sql of SIMULATE) {
      it(`simulate: ${sql} [p09-4e070d]`, async () => {
        const m1 = await log.marker()
        const pr = await pma.super.postJson('/import/simulate-dml', {
          db: DB_PMA,
          sql_query: sql,
          sql_delimiter: ';',
        })
        const pmaLog = await log.since(U.pma, m1)
        const m2 = await log.marker()
        const br = await bma.super.req('POST', '/api/servers/1/query/simulate', {
          sql,
          db: DB_BMA,
          delimiter: ';',
        })
        const bmaLog = await log.since(U.bma, m2)
        const data = br.json.sqlData as Array<{
          sqlQuery: string
          matchedRows: number
          matchedRowsSql: string
        }> | null
        const pdata = pr.sql_data as unknown as
          | Array<{ sql_query: string; matched_rows: number; matched_rows_url: string }>
          | false
        if (pdata === false) {
          expect(data).toBeNull()
          expect(norm(String(br.json.message))).toBe(norm(visibleText(String(pr.message))))
        } else {
          expect(data?.length).toBe(pdata.length)
          pdata.forEach((d, i) => {
            expect(norm(data![i]!.sqlQuery)).toBe(norm(visibleText(d.sql_query)))
            expect(data![i]!.matchedRows).toBe(d.matched_rows)
            const url = new URLSearchParams(d.matched_rows_url.split('?')[1]?.replaceAll('&amp;', '&'))
            expect(maskDb(data![i]!.matchedRowsSql)).toBe(maskDb(url.get('sql_query') ?? ''))
          })
        }
        const cmp = compareLogs(pmaLog, bmaLog, dbMap)
        expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
      })
    }
  })
})
