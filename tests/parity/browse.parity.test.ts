import type { GridData, QueryResponse } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { classify, normalise } from './lib/compare.ts'
import { GeneralLog, type LogEntry } from './lib/general-log.ts'
import { PmaClient, visibleText } from './lib/pma.ts'
import { PMA_STORAGE, pmaReachable } from './lib/server-setup.ts'

/**
 * Golden parity of the Browse tab / results grid (docs/features/02-browse-results-grid.md): every
 * action is sent to the reference phpMyAdmin the way its links, forms and makegrid.ts post it
 * (/sql, /table/replace, /table/delete/rows, /sql/get-*-values) and to BetterMyAdmin's /browse API,
 * on identical databases. The data statements of both in MySQL's general log must be identical:
 * every write, and every read of the user's data (the browse query with its LIMIT, counts, FK display
 * lookups, full-value / SET re-reads, the grid-edit re-check). Metadata reads (information_schema,
 * SHOW …) differ by design and are not compared here.
 */
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const U = { pma: 'f02_up', bma: 'f02_ub' }
const DB = { pma: 'f02_dbp', bma: 'f02_dbb' }
const dbMap = { [DB.pma]: 'par_db', [DB.bma]: 'par_db' }

const reachable = pmaReachable

const SEED = (db: string) => `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}; USE ${db};
  CREATE TABLE t (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(80) COMMENT 'the name', qty INT, d DATE, KEY k_qty (qty)) ENGINE=InnoDB;
  INSERT INTO t (name, qty, d) VALUES ${Array.from({ length: 40 }, (_, i) => `('item${i + 1}', ${i % 7}, '2020-01-${String((i % 28) + 1).padStart(2, '0')}')`).join(',')};
  UPDATE t SET name = REPEAT('x', 70) WHERE id = 3;
  CREATE TABLE child (id INT PRIMARY KEY, t_id INT, FOREIGN KEY (t_id) REFERENCES t (id)) ENGINE=InnoDB;
  INSERT INTO child VALUES (1, 1), (2, 2), (3, NULL), (4, 2);
  CREATE TABLE nk (a INT, b VARCHAR(5));
  INSERT INTO nk VALUES (1, 'x'), (2, 'y');
  CREATE TABLE e (id INT PRIMARY KEY, c ENUM('a','b','c'), s SET('x','y','z'));
  INSERT INTO e VALUES (1, 'b', 'x,z'), (2, NULL, '');`

/** The statements on the user's data: writes and reads of the seeded tables. */
function dataStatements(log: LogEntry[]): string[] {
  return log
    .map((e) => normalise(e.sql, dbMap))
    .filter((s) => {
      if (/`pma__\w+`/.test(s)) return false
      const kind = classify(s)
      if (kind === 'write') return !/^SET /i.test(s)
      if (kind !== 'read' || !/^SELECT\b/i.test(s)) return false
      if (/information_schema/i.test(s)) return false
      return !/^SELECT (1 FROM|@@|DATABASE\(\)|CURRENT_USER|LAST_INSERT_ID|\*, `TABLE_SCHEMA`|`?COLUMN_NAME)/i.test(
        s,
      )
    })
}

interface Step {
  /** phpMyAdmin route and form, as its JS posts it ({db} is replaced) */
  pma: { route: string; form: Array<[string, string]> }
  /** BetterMyAdmin API path and JSON body ({db} is replaced) */
  bma: { path: string; body: Record<string, unknown> }
}

const sql = (route: string, form: Record<string, string>): Step['pma'] => ({
  route,
  form: Object.entries(form),
})

interface Case {
  name: string
  steps: Step[]
  check?: (pma: string[], bma: unknown[]) => void
}

const browse = (form: Record<string, string>, body: Record<string, unknown>): Step => ({
  pma: sql('/sql', { db: '{db}', ...form }),
  bma: { path: '/browse', body: { db: '{db}', ...body } },
})

const CASES: Case[] = [
  {
    name: 'default browse query with LIMIT and the exact count',
    steps: [browse({ table: 't', pos: '0' }, { table: 't' })],
  },
  {
    name: 'sort link, then the remembered sort on a plain browse, then discard_remembered_sort [p02-dafcf6 p02-440ff1 p02-17fc03] [p09-a6b162]',
    steps: [
      browse(
        { table: 't', sql_query: 'SELECT * FROM `t` ORDER BY `t`.`name` DESC', session_max_rows: '25' },
        { table: 't', sql: 'SELECT * FROM `t` ORDER BY `t`.`name` DESC', maxRows: 25 },
      ),
      browse({ table: 't', pos: '0' }, { table: 't' }),
      browse(
        { table: 't', sql_query: 'SELECT * FROM `t`', discard_remembered_sort: '1' },
        { table: 't', sql: 'SELECT * FROM `t`', discardRememberedSort: true },
      ),
      // a multi-column sort (Shift+click url-add-order)
      browse(
        { table: 't', sql_query: 'SELECT * FROM `t` ORDER BY `t`.`qty` ASC, `t`.`id` DESC' },
        { table: 't', sql: 'SELECT * FROM `t` ORDER BY `t`.`qty` ASC, `t`.`id` DESC' },
      ),
      // Sort by key: no remembered sort handling
      browse(
        { table: 't', sql_query: 'SELECT * FROM `t`  ORDER BY `qty` DESC', sort_by_key: '1' },
        { table: 't', sql: 'SELECT * FROM `t`  ORDER BY `qty` DESC', sortByKey: true },
      ),
      browse(
        { table: 't', sql_query: 'SELECT * FROM `t`', discard_remembered_sort: '1' },
        { table: 't', sql: 'SELECT * FROM `t`', discardRememberedSort: true },
      ),
    ],
  },
  {
    name: 'pagination, Number of rows and Show all [p02-284f7e p02-c722eb]',
    steps: [
      browse(
        { table: 't', sql_query: 'SELECT * FROM `t` WHERE qty > 1', pos: '25' },
        { table: 't', sql: 'SELECT * FROM `t` WHERE qty > 1', pos: 25 },
      ),
      browse(
        { table: 't', sql_query: 'SELECT * FROM `t` WHERE qty > 1', session_max_rows: '50', pos: '0' },
        { table: 't', sql: 'SELECT * FROM `t` WHERE qty > 1', maxRows: 50, pos: 0 },
      ),
      browse(
        { table: 't', sql_query: 'SELECT * FROM `t` WHERE qty > 1', session_max_rows: 'all', pos: '0' },
        { table: 't', sql: 'SELECT * FROM `t` WHERE qty > 1', maxRows: 'all', pos: 0 },
      ),
      // the position is remembered per query
      browse(
        { table: 't', sql_query: 'SELECT * FROM `t` WHERE qty > 1', session_max_rows: '25' },
        { table: 't', sql: 'SELECT * FROM `t` WHERE qty > 1', maxRows: 25 },
      ),
    ],
  },
  {
    name: 'a query with its own LIMIT runs verbatim [p02-9f5692 p02-290262]',
    steps: [
      browse(
        { table: 't', sql_query: 'SELECT id, name FROM `t` LIMIT 3' },
        { table: 't', sql: 'SELECT id, name FROM `t` LIMIT 3' },
      ),
    ],
  },
  {
    name: 'FK display values: relational key and display column [p02-1e062a]',
    steps: [
      browse({ table: 'child', pos: '0' }, { table: 'child' }),
      browse(
        { table: 'child', sql_query: 'SELECT * FROM `child`', relational_display: 'D' },
        { table: 'child', sql: 'SELECT * FROM `child`', relationalDisplay: 'D' },
      ),
    ],
  },
  {
    name: 'a table without a unique key [p02-c56862]',
    steps: [browse({ table: 'nk', pos: '0' }, { table: 'nk' })],
  },
  {
    name: 'EXPLAIN and SHOW results [p02-b790fa]',
    steps: [
      browse(
        { table: 't', sql_query: 'EXPLAIN SELECT * FROM `t`' },
        { table: 't', sql: 'EXPLAIN SELECT * FROM `t`' },
      ),
      browse({ sql_query: 'SHOW TABLES' }, { sql: 'SHOW TABLES' }),
    ],
  },
  {
    name: 'the row Delete link [p02-2b0c72]',
    steps: [
      browse(
        {
          table: 't',
          sql_query: 'DELETE FROM `t` WHERE `t`.`id` = 40',
          message_to_show: 'The row has been deleted.',
        },
        {
          table: 't',
          sql: 'DELETE FROM `t` WHERE `t`.`id` = 40',
          messageToShow: 'The row has been deleted.',
        },
      ),
      browse(
        {
          table: 'nk',
          sql_query: "DELETE FROM `nk` WHERE `nk`.`a` = 2 AND `nk`.`b` = 'y' LIMIT 1",
          message_to_show: 'The row has been deleted.',
        },
        {
          table: 'nk',
          sql: "DELETE FROM `nk` WHERE `nk`.`a` = 2 AND `nk`.`b` = 'y' LIMIT 1",
          messageToShow: 'The row has been deleted.',
        },
      ),
    ],
  },
  {
    name: 'grid edit: full value, save with the re-check, NULL [p02-85eff6 p03-995b4e p02-784009]',
    steps: [
      {
        pma: sql('/sql', {
          db: '{db}',
          sql_query: 'SELECT `name` FROM `t` WHERE `t`.`id` = 3',
          grid_edit: 'true',
        }),
        bma: {
          path: '/browse/grid-value',
          body: { db: '{db}', table: 't', column: 'name', where: '`t`.`id` = 3' },
        },
      },
      {
        pma: {
          route: '/table/replace',
          form: [
            ['db', '{db}'],
            ['table', 't'],
            ['clause_is_unique', '1'],
            ['where_clause[]', '`t`.`id` = 2'],
            ['fields[multi_edit][0][]', "it's"],
            ['fields_name[multi_edit][0][]', 'name'],
            ['fields_null[multi_edit][0][]', ''],
            ['rel_fields_list', ''],
            ['do_transformations', 'false'],
            ['transform_fields_list', ''],
            ['relational_display', 'K'],
            ['goto', 'index.php%3Froute%3D%2Fsql'],
            ['submit_type', 'save'],
            ['sql_query', ''],
          ],
        },
        bma: {
          path: '/browse/save',
          body: {
            db: '{db}',
            table: 't',
            clauseIsUnique: true,
            rows: [{ where: '`t`.`id` = 2', fields: [{ name: 'name', value: "it's", isNull: false }] }],
          },
        },
      },
      {
        pma: {
          route: '/table/replace',
          form: [
            ['db', '{db}'],
            ['table', 'nk'],
            ['clause_is_unique', '0'],
            ['where_clause[]', "`nk`.`a` = 1 AND `nk`.`b` = 'x'"],
            ['fields[multi_edit][0][]', ''],
            ['fields_name[multi_edit][0][]', 'b'],
            ['fields_null[multi_edit][0][]', 'on'],
            ['rel_fields_list', ''],
            ['do_transformations', 'false'],
            ['transform_fields_list', ''],
            ['relational_display', 'K'],
            ['goto', 'index.php%3Froute%3D%2Fsql'],
            ['submit_type', 'save'],
            ['sql_query', ''],
          ],
        },
        bma: {
          path: '/browse/save',
          body: {
            db: '{db}',
            table: 'nk',
            clauseIsUnique: false,
            rows: [
              { where: "`nk`.`a` = 1 AND `nk`.`b` = 'x'", fields: [{ name: 'b', value: '', isNull: true }] },
            ],
          },
        },
      },
    ],
  },
  {
    name: 'grid edit value lists: SET with the full value, relational dropdown [p02-10a94f]',
    steps: [
      {
        pma: sql('/sql/get-set-values', {
          db: '{db}',
          table: 'e',
          column: 's',
          curr_value: 'x',
          get_full_values: 'true',
          where_clause: '`e`.`id` = 1',
        }),
        bma: {
          path: '/browse/values',
          body: { kind: 'set', db: '{db}', table: 'e', column: 's', currValue: 'x', where: '`e`.`id` = 1' },
        },
      },
      {
        pma: sql('/sql/get-relational-values', {
          db: '{db}',
          table: 'child',
          column: 't_id',
          curr_value: '1',
          relation_key_or_display_column: 'item1',
        }),
        bma: {
          path: '/browse/values',
          body: {
            kind: 'relational',
            db: '{db}',
            table: 'child',
            column: 't_id',
            currValue: '1',
            keyOrDisplay: 'item1',
          },
        },
      },
    ],
  },
  {
    name: 'Delete with selected: every DELETE with LIMIT 1, then the browse query again [p02-a3dbd4 p02-9afb97]',
    steps: [
      {
        pma: {
          route: '/table/delete/rows',
          form: [
            ['db', '{db}'],
            ['table', 't'],
            ['selected[]', '`t`.`id` = 5'],
            ['selected[]', '`t`.`id` = 6'],
            ['original_sql_query', 'SELECT * FROM `t`'],
            ['fk_checks', '0'],
            ['fk_checks', '1'],
            ['mult_btn', 'Yes'],
          ],
        },
        bma: {
          path: '/browse/delete-rows',
          body: {
            db: '{db}',
            table: 't',
            where: ['`t`.`id` = 5', '`t`.`id` = 6'],
            fkChecks: true,
            originalSql: 'SELECT * FROM `t`',
          },
        },
      },
    ],
  },
]

describe.skipIf(!reachable)('parity: Browse / results grid (/sql) vs POST /browse', () => {
  let log: GeneralLog
  let root: mysql.Connection
  const pma = new PmaClient(PMA_URL)
  let bma: ReturnType<typeof testApp>

  const forgetUiPrefs = () =>
    root.query("DELETE FROM phpmyadmin.pma__table_uiprefs WHERE db_name LIKE 'f02\\_%'").catch(() => {})

  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    for (const u of [U.pma, U.bma]) {
      await root.query(
        `DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON *.* TO '${u}'@'%'`,
      )
    }
    await forgetUiPrefs()
    log = await GeneralLog.open(ROOT)
    await pma.login(U.pma, U.pma)
    bma = testApp(testConfig({}, PMA_STORAGE))
    await bma.login(U.bma, U.bma)
  })

  afterAll(async () => {
    await bma?.close()
    await log?.close()
    await forgetUiPrefs()
    await root?.query(
      `DROP DATABASE IF EXISTS ${DB.pma}; DROP DATABASE IF EXISTS ${DB.bma}; DROP USER IF EXISTS '${U.pma}'@'%'; DROP USER IF EXISTS '${U.bma}'@'%'`,
    )
    await root?.end()
  })

  for (const c of CASES) {
    it(c.name, async () => {
      await root.query(SEED(DB.pma))
      await root.query(SEED(DB.bma))
      const sub = (v: string, db: string) => v.replaceAll('{db}', db)
      const m1 = await log.marker()
      const pmaOut: string[] = []
      for (const s of c.steps) {
        const form = s.pma.form.map(([k, v]) => [k, sub(v, DB.pma)] as [string, string])
        pmaOut.push(JSON.stringify(await pma.postJson(s.pma.route, form)))
      }
      const pmaLog = await log.since(U.pma, m1)
      const m2 = await log.marker()
      const bmaOut: unknown[] = []
      for (const s of c.steps) {
        const body = JSON.parse(sub(JSON.stringify(s.bma.body), DB.bma)) as Record<string, unknown>
        const r = await bma.req('POST', `/api/servers/1${s.bma.path}`, body)
        expect(r.status, JSON.stringify(r.json).slice(0, 400)).toBe(200)
        bmaOut.push(r.json)
      }
      const bmaLog = await log.since(U.bma, m2)
      expect(dataStatements(bmaLog)).toEqual(dataStatements(pmaLog))
      c.check?.(pmaOut, bmaOut)
    })
  }

  it('header message, notices and grid texts match the rendered phpMyAdmin page [p02-356f71]', async () => {
    await root.query(SEED(DB.pma))
    await root.query(SEED(DB.bma))
    const cases: Array<{ form: Record<string, string>; body: Record<string, unknown> }> = [
      { form: { table: 't', pos: '0' }, body: { table: 't' } },
      { form: { table: 'nk', pos: '0' }, body: { table: 'nk' } },
      {
        form: { table: 't', sql_query: 'SELECT * FROM `t` ORDER BY `t`.`name` ASC' },
        body: { table: 't', sql: 'SELECT * FROM `t` ORDER BY `t`.`name` ASC' },
      },
    ]
    for (const k of cases) {
      const p = (await pma.postJson('/sql', [['db', DB.pma], ...Object.entries(k.form)])) as unknown as {
        message: string
      }
      const text = visibleText(p.message)
      const r = await bma.req('POST', '/api/servers/1/browse', { db: DB.bma, ...k.body })
      const st = (r.json as unknown as QueryResponse).statements[0]!
      const grid = st.grid as GridData
      const mask = (s: string) =>
        s
          .replace(/\d+\.\d{4} seconds/g, 'T seconds')
          .replace(/\s+/g, ' ')
          .replace(/ \]/g, ']')
      expect(mask(text)).toContain(mask(st.message.text))
      if (grid.missingUnique !== null) {
        expect(text).toContain('Current selection does not contain a unique column.')
      }
      for (const col of grid.columns) expect(p.message).toContain(`data-column="${col.name}"`)
      // the where clauses of the row checkboxes
      for (const row of grid.rows) {
        if (grid.displayParts.deleteLink === 'delete') {
          expect(p.message).toContain(`value="${row.where.replaceAll("'", '&#039;').replaceAll('`', '`')}"`)
        }
      }
      // the navigation bar's controls
      expect(text.includes('Number of rows:')).toBe(grid.navigation !== null)
    }
  })
})
