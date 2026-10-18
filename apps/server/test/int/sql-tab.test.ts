import type { QueryResponse } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'
import { isMariaDb } from '../support/vendor.ts'

const DB = 'm1sql_it_tab'

let root: mysql.Connection
const apps: Array<ReturnType<typeof testApp>> = []

async function app(
  cfg: Parameters<typeof testConfig>[0] = {},
  server: Parameters<typeof testConfig>[1] = {},
) {
  const a = testApp(testConfig(cfg, server))
  apps.push(a)
  await a.login()
  return a
}

async function run(a: ReturnType<typeof testApp>, sql: string, extra: Record<string, unknown> = {}) {
  const r = await a.req('POST', '/api/servers/1/query', {
    sql,
    db: DB,
    fromQueryBox: true,
    fkChecks: true,
    ...extra,
  })
  return { status: r.status, body: r.json as unknown as QueryResponse & { error?: { message: string } } }
}

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(20) COMMENT 'the name', qty INT) ENGINE=InnoDB;
    INSERT INTO t (name, qty) VALUES ('a', 1), ('b', 2), ('c', 3);
    CREATE TABLE child (id INT PRIMARY KEY, t_id INT, FOREIGN KEY (t_id) REFERENCES t (id)) ENGINE=InnoDB;`)
})
afterAll(async () => {
  for (const a of apps) await a.close()
  await root?.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root?.end()
})

describe('SQL tab options', () => {
  it('IgnoreMultiSubmitErrors keeps going and shows the error in a card [p09-9a56f6]', async () => {
    const a = await app({ IgnoreMultiSubmitErrors: true })
    const { body } = await run(a, 'SELECT 1; SELECT * FROM nope; SELECT 2')
    expect(body.statements.map((s) => s.kind)).toEqual(['resultset', 'error', 'resultset'])
    const err = body.statements[1]!
    expect(err.error).toBeUndefined()
    expect(err.message).toEqual({ type: 'error', text: `#1146 - Table '${DB}.nope' doesn't exist` })
    expect(err.card?.sql).toBe('SELECT * FROM nope;')
  })

  it('MaxCharactersInDisplayedSQL truncates the card and hides Explain / PHP links [p02-40a8f8] [p09-16d3bb]', async () => {
    const a = await app({ MaxCharactersInDisplayedSQL: 20 })
    const { body } = await run(a, 'SELECT id, name, qty FROM t WHERE id = 1')
    const card = body.statements[0]!.card!
    expect(card.display).toBe('SELECT id, name, qty[...]')
    expect(card.links).toMatchObject({
      explain: null,
      php: null,
      editInline: false,
      edit: true,
      refresh: true,
    })
    // reloadQuerywindow omits a query that is not shorter than the limit
    expect(body.sqlQuery).toBe('')
  })

  it('ShowSQL=false renders only the message [p02-f22617] [p09-ac586d]', async () => {
    const a = await app({ ShowSQL: false })
    const { body } = await run(a, 'SELECT 1')
    expect(body.statements[0]!.card).toBeNull()
  })

  it('SQLQuery link toggles', async () => {
    const a = await app({ SQLQuery: { Edit: false, Explain: false, ShowAsPHP: false, Refresh: false } })
    const { body } = await run(a, 'SELECT 1')
    expect(body.statements[0]!.card!.links).toEqual({
      editInline: false,
      edit: false,
      explain: null,
      php: null,
      refresh: false,
      profiling: null,
    })
  })

  it('AllowUserDropDatabase lets a DROP DATABASE through the guard [p02-1f1ac2] [p09-15a63a]', async () => {
    await root.query('CREATE DATABASE IF NOT EXISTS m1sql_it_drop')
    const a = await app({ AllowUserDropDatabase: true })
    const { body } = await run(a, 'DROP DATABASE m1sql_it_drop')
    expect(body.statements[0]!.kind).toBe('affected')
    expect(body.ajaxReload).toEqual({ reload: true })
  })

  it('rollback when finished leaves the data unchanged and the pooled connection clean [p09-aa1339]', async () => {
    const a = await app()
    const { body } = await run(a, "UPDATE t SET name = 'changed' WHERE id = 1", { rollback: true })
    expect(body.statements[0]!.message.text).toMatch(
      /^1 row affected\. \(Query took .* seconds\.\) \[ROLLBACK occurred\.\]$/,
    )
    const [rows] = await root.query(`SELECT name FROM ${DB}.t WHERE id = 1`)
    expect((rows as Array<{ name: string }>)[0]!.name).toBe('a')
    // MariaDB evaluates @@foreign_key_checks as 0 in this INNODB_TRX probe even on a fresh
    // session: the probe means nothing there (the fk-checks test below covers the setting)
    if (isMariaDb) return
    const after = await run(
      a,
      'SELECT COUNT(*), @@foreign_key_checks FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id = CONNECTION_ID()',
    )
    expect(after.body.statements[0]!.result!.rows[0]).toEqual(['0', '1'])
  })

  it('an error with foreign key checks off does not leak the setting to the next request [p02-b10e84] [p09-1fc182]', async () => {
    const a = await app()
    const failed = await run(a, 'INSERT INTO nope VALUES (1)', { fkChecks: false })
    expect(failed.body.statements[0]!.kind).toBe('error')
    const after = await run(a, 'SELECT @@foreign_key_checks')
    expect(after.body.statements[0]!.result!.rows[0]).toEqual(['1'])
  })

  it('profiling switch: on, statistics, then off again [p02-2a54e4] [p09-280f8a] [p09-33158a]', async () => {
    const a = await app()
    const on = await run(a, 'SELECT * FROM t', { profiling: true })
    const st = on.body.statements[0]!
    expect(st.profiling!.profile.length).toBeGreaterThan(0)
    expect(st.profiling!.states[0]!.percent).toMatch(/^(<)?[\d.]+$/)
    expect(st.card!.links.profiling).toEqual({ checked: true })
    const stays = await run(a, 'SELECT 1')
    expect(stays.body.statements[0]!.profiling).toBeDefined()
    const off = await run(a, 'SELECT 1', { profiling: false })
    expect(off.body.statements[0]!.profiling).toBeUndefined()
    expect(off.body.statements[0]!.card!.links.profiling).toEqual({ checked: false })
  })

  it('a signed query runs only with a valid signature [p02-fae7cc] [p09-3ee67a]', async () => {
    const a = await app()
    const { body } = await run(a, 'SELECT 1')
    const sig = body.statements[0]!.sig
    expect((await run(a, 'SELECT 1;', { sig })).status).toBe(200)
    const bad = await run(a, 'SELECT 2;', { sig })
    expect(bad.status).toBe(400)
    expect(bad.body.error?.message).toBe('Missing parameter: sql_query')
  })

  it('cancel kills the running query [p09-11fdd7]', async () => {
    const a = await app()
    // a name of its own: other test runs on the same server may sleep too
    const probe = `m1sql_cancel_${process.pid}_${Date.now()}`
    const pending = run(a, `SELECT SLEEP(20) AS ${probe}`, { queryId: 'q1' })
    // cancel once the statement runs on the server (a cancel before it would keep it from being sent)
    const sleeping = async () => {
      const [rows] = await root.query(
        "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE INFO LIKE 'SELECT SLEEP(20)%' AND INFO LIKE ?",
        [`%${probe}%`],
      )
      return Number((rows as Array<{ n: number }>)[0]!.n)
    }
    await expect.poll(sleeping, { timeout: 15_000, interval: 50 }).toBe(1)
    expect((await a.req('POST', '/api/servers/1/query/cancel', { queryId: 'q1' })).json.killed).toBe(true)
    const { body } = await pending
    if (isMariaDb) {
      // MariaDB reports the interrupted SLEEP as an error
      expect(body.statements[0]!.message).toMatchObject({ type: 'error', errno: 1317 })
    } else {
      // SLEEP interrupted by KILL QUERY returns 1
      expect(body.statements[0]!.result!.rows[0]).toEqual(['1'])
    }
    expect((await a.req('POST', '/api/servers/1/query/cancel', { queryId: 'q1' })).json.killed).toBe(false)
  })

  it('records the session history (last statement, capped at QueryHistoryMax) [p09-45cd38]', async () => {
    // the history feature comes from the configuration storage (here the local store)
    const a = await app({ QueryHistoryMax: 2, DataDir: ':memory:' })
    await run(a, 'SELECT 1')
    await run(a, 'SELECT 2; SELECT * FROM t')
    await run(a, 'SELECT 3')
    await run(a, 'SELECT 4', { noHistory: true })
    const h = await a.req('GET', '/api/servers/1/sql/history')
    expect(h.json.history).toEqual([
      { db: DB, table: '', sqlquery: 'SELECT 3;' },
      { db: DB, table: 't', sqlquery: 'SELECT * FROM t;' },
    ])
  })
})

describe('SQL form, autocomplete and console endpoints', () => {
  it('server, database and table scope forms [p09-50c42a] [p09-74590b]', async () => {
    const a = await app({
      DefaultQueryDatabase: 'SHOW TABLES FROM @DATABASE@',
      DefaultQueryTable: 'SELECT @COLUMNS@ FROM @TABLE@ WHERE 1',
    })
    const s = await a.req('GET', '/api/servers/1/sql/form')
    expect(s.json).toMatchObject({ scope: 'server', legendName: MYSQL.host, query: '', columns: [] })
    const d = await a.req('GET', `/api/servers/1/sql/form?db=${DB}`)
    expect(d.json).toMatchObject({ scope: 'database', legendName: DB, query: `SHOW TABLES FROM \`${DB}\`` })
    const t = await a.req('GET', `/api/servers/1/sql/form?db=${DB}&table=t`)
    expect(t.json).toMatchObject({
      scope: 'table',
      legendName: `${DB}.t`,
      query: 'SELECT `id`,`name`,`qty` FROM `t` WHERE 1',
      columns: [
        { field: 'id', comment: '' },
        { field: 'name', comment: 'the name' },
        { field: 'qty', comment: '' },
      ],
      fkChecks: true,
    })
    const q = await a.req(
      'GET',
      `/api/servers/1/sql/form?db=${DB}&table=t&sqlQuery=${encodeURIComponent('SELECT 42')}`,
    )
    expect(q.json.query).toBe('SELECT 42')
    expect((await a.req('GET', '/api/servers/1/sql/form?db=m1sql_missing')).json).toMatchObject({
      error: { message: 'No databases selected.' },
    })
    expect((await a.req('GET', `/api/servers/1/sql/form?db=${DB}&table=nope`)).json).toMatchObject({
      error: { message: 'No table selected.' },
    })
  })

  it('DefaultForeignKeyChecks enable/disable [p09-1fc182]', async () => {
    const off = await app({ DefaultForeignKeyChecks: 'disable' })
    expect((await off.req('GET', '/api/servers/1/sql/default-fk-check')).json.defaultFkCheckValue).toBe(false)
    const on = await app({ DefaultForeignKeyChecks: 'enable' })
    expect((await on.req('GET', '/api/servers/1/sql/form')).json.fkChecks).toBe(true)
  })

  it('EnableAutocompleteForTablesAndColumns=false returns no tables [p09-d9ff25]', async () => {
    const a = await app({ EnableAutocompleteForTablesAndColumns: false })
    expect((await a.req('GET', `/api/servers/1/sql/autocomplete?db=${DB}`)).json.tables).toEqual({})
  })

  it('name lists of the pickers: /tables and /columns', async () => {
    const a = await app()
    const t = await a.req('POST', '/api/servers/1/tables', { db: DB })
    expect(t.status).toBe(200)
    expect(t.json.success).toBe(true)
    const tables = t.json.tables as string[]
    expect(tables.length).toBeGreaterThan(0)
    const first = tables[0] as string
    const c = await a.req('POST', '/api/servers/1/columns', { db: DB, table: first })
    expect(c.json.success).toBe(true)
    expect((c.json.columns as string[]).length).toBeGreaterThan(0)
    expect((await a.req('POST', '/api/servers/1/tables', {})).json).toMatchObject({
      success: false,
      message: 'Error',
    })
    expect((await a.req('POST', '/api/servers/1/columns', { db: DB })).json.success).toBe(false)
  })

  it('console options: defaults, validation, persistence in the user preferences (session) [p09-f4e866]', async () => {
    // a configured storage that does not exist: no pmadb features, the preferences live in the session
    // (the shared MySQL's `phpmyadmin` storage is not touched, other test files run concurrently)
    const a = await app({}, { pmadb: 'm1sql_it_no_storage' })
    const g = await a.req('GET', '/api/servers/1/console/config')
    expect(g.json.settings).toEqual({
      StartHistory: false,
      AlwaysExpand: false,
      CurrentQuery: true,
      EnterExecutes: false,
      DarkTheme: false,
      Mode: 'info',
      Height: 92,
      GroupQueries: false,
      OrderBy: 'exec',
      Order: 'asc',
    })
    // the lint context of the console's inputs
    const server = g.json.server as { versionInt: number; sqlMode: string }
    expect(server.versionInt).toBeGreaterThan(50000)
    expect(typeof server.sqlMode).toBe('string')
    const ok = await a.req('POST', '/api/servers/1/console/config', { key: 'EnterExecutes', value: 'true' })
    expect(ok.json.message).toBe('Console settings has been updated successfully.')
    await a.req('POST', '/api/servers/1/console/config', { key: 'Height', value: '240' })
    for (const bad of [
      { key: 'Nope', value: 'true' },
      { key: 'Mode', value: 'full' },
      { key: 'Height', value: '0' },
      { key: 'DarkTheme', value: 'yes' },
    ]) {
      const r = await a.req('POST', '/api/servers/1/console/config', bad)
      expect(r.status).toBe(400)
      expect((r.json.error as { message: string }).message).toBe('Unexpected parameter value.')
    }
    const g2 = await a.req('GET', '/api/servers/1/console/config')
    expect(g2.json.settings).toMatchObject({ EnterExecutes: true, Height: 240 })
    // the default value removes the stored preference (UserPreferences::persistOption): the shared
    // MySQL's `phpmyadmin` storage (ZeroConf) is left as it was
    await a.req('POST', '/api/servers/1/console/config', { key: 'EnterExecutes', value: 'false' })
    await a.req('POST', '/api/servers/1/console/config', { key: 'Height', value: '92' })
    expect((await a.req('GET', '/api/servers/1/console/config')).json.settings).toMatchObject({
      EnterExecutes: false,
      Height: 92,
    })
  })
})

describe('Debug SQL [p09-b87d68]', () => {
  it('only with DBG.sql: every statement of the request with its time', async () => {
    const off = await run(await app(), 'SELECT 1')
    expect(off.body.executed).toEqual([])
    const on = await run(await app({ DBG: { sql: true } }), 'SELECT 1')
    const executed = on.body.executed as Array<{ sql: string; ms: number }>
    expect(executed.some((e) => /^SELECT 1\b/.test(e.sql))).toBe(true)
    // the internal ones (the page database, the count) are listed too
    expect(executed.length).toBeGreaterThan(1)
    for (const e of executed) expect(typeof e.ms).toBe('number')
  })
})
