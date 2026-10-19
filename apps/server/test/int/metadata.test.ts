import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCreateTableSqlQueries } from '@bettermyadmin/metadata'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * The configuration storage end to end: discovery through the control user, every repository
 * endpoint, the SQL-box history hook, ZeroConf creation and the local SQLite fallback.
 * Only `m1meta_int_*` databases and users are created (shared MySQL, see AGENTS notes).
 */
const PMADB = 'm1meta_int_pmadb'
const DATA = 'm1meta_int_d'
const CUR = 'm1meta_int_cur'
const USER = 'm1meta_int_u'
const CTL = 'm1meta_int_ctl'
const CTL2 = 'm1meta_int_ctl2'

let root: mysql.Connection
const dataDir = mkdtempSync(join(tmpdir(), 'bma-meta-int-'))

async function createStorage(db: string, only?: string[]) {
  await root.query(`DROP DATABASE IF EXISTS \`${db}\``)
  await root.query(`CREATE DATABASE \`${db}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`)
  await root.query(`USE \`${db}\``)
  for (const [name, sql] of Object.entries(getCreateTableSqlQueries({}))) {
    if (only === undefined || only.includes(name)) await root.query(sql)
  }
}

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await createStorage(PMADB)
  await root.query(`DROP DATABASE IF EXISTS ${DATA}; CREATE DATABASE ${DATA};
    CREATE TABLE ${DATA}.t (id INT PRIMARY KEY, name VARCHAR(20));
    CREATE TABLE ${DATA}.t2 (id INT PRIMARY KEY);
    CREATE TABLE ${DATA}.t3 (id INT PRIMARY KEY);
    INSERT INTO ${DATA}.t VALUES (1, 'a'), (2, 'b'), (3, 'c');
    ANALYZE TABLE ${DATA}.t;
    DROP DATABASE IF EXISTS ${CUR};`)
  for (const [u, grants] of [
    [USER, [`GRANT ALL ON \`${DATA}\`.* TO '${USER}'@'%'`, `GRANT ALL ON \`${CUR}\`.* TO '${USER}'@'%'`]],
    [CTL, [`GRANT SELECT, INSERT, UPDATE, DELETE, ALTER ON \`${PMADB}\`.* TO '${CTL}'@'%'`]],
    [CTL2, [`GRANT ALL ON \`${CUR}\`.* TO '${CTL2}'@'%'`]],
  ] as const) {
    await root.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'`)
    for (const g of grants) await root.query(g)
  }
})

afterAll(async () => {
  await root.query(
    `DROP DATABASE IF EXISTS ${PMADB}; DROP DATABASE IF EXISTS ${DATA}; DROP DATABASE IF EXISTS ${CUR};`,
  )
  for (const u of [USER, CTL, CTL2]) await root.query(`DROP USER IF EXISTS '${u}'@'%'`)
  await root.end()
  rmSync(dataDir, { recursive: true, force: true })
})

const rows = async (sql: string) => (await root.query(sql))[0] as Array<Record<string, unknown>>

describe('with a configuration storage and a control user', () => {
  let t: ReturnType<typeof testApp>
  beforeAll(async () => {
    t = testApp(
      testConfig(
        {
          QueryHistoryDB: true,
          QueryHistoryMax: 3,
          NumFavoriteTables: 2,
          NumRecentTables: 2,
          DataDir: dataDir,
        },
        { controluser: CTL, controlpass: CTL, pmadb: PMADB, MaxTableUiprefs: 2 },
      ),
    )
    const r = await t.login(USER, USER)
    expect(r.status).toBe(200)
  })
  afterAll(() => t?.close())

  it('reports every feature as working [p08-0c056a] [p08-ac345c]', async () => {
    const r = await t.req('GET', '/api/servers/1/metadata-storage/status')
    expect(r.status).toBe(200)
    const s = r.json as Record<string, unknown>
    expect((s.relationParameters as Record<string, unknown>).allworks).toBe(true)
    expect((s.relationParameters as Record<string, unknown>).db).toBe(PMADB)
    expect((s.relationParameters as Record<string, unknown>).user).toBe(USER)
    expect(s.homeNotice).toBeNull()
    expect(s.offer).toBeNull()
    expect(s.controlError).toBeNull()
    expect((s.features as Array<{ enabled: boolean }>).every((f) => f.enabled)).toBe(true)
    expect(s.stores).toEqual({
      bookmarks: 'pmadb',
      history: 'pmadb',
      recent: 'pmadb',
      favorite: 'pmadb',
      uiPrefs: 'pmadb',
      userConfig: 'pmadb',
    })
  })

  it('bookmarks: create, list, show, run with variables, console, delete [p02-62c852] [p09-714ea3] [p09-8e8a52]', async () => {
    let r = await t.req('POST', '/api/servers/1/bookmarks', {
      db: DATA,
      label: 'by id',
      query: 'SELECT name FROM t WHERE id = /*[VARIABLE1]*/',
    })
    expect(r.json).toEqual({
      success: true,
      message: { type: 'success', text: 'Bookmark by id has been created.' },
    })
    r = await t.req('POST', '/api/servers/1/bookmarks', {
      db: DATA,
      label: 'all',
      query: 'SELECT 1',
      shared: true,
    })
    expect(r.status).toBe(200)
    r = await t.req('POST', '/api/servers/1/bookmarks', { db: DATA, label: '', query: 'SELECT 1' })
    expect(r.json).toEqual({ success: false, message: { type: 'error', text: 'Bookmark not created!' } })

    r = await t.req('GET', `/api/servers/1/bookmarks?db=${DATA}`)
    const list = r.json.bookmarks as Array<{
      id: number
      label: string
      isShared: boolean
      variableCount: number
    }>
    expect(list.map((b) => [b.label, b.isShared, b.variableCount])).toEqual([
      ['all', true, 0],
      ['by id', false, 1],
    ])
    const byId = list.find((b) => b.label === 'by id')!.id
    expect(await rows(`SELECT dbase, user, label, query FROM ${PMADB}.pma__bookmark ORDER BY id`)).toEqual([
      { dbase: DATA, user: USER, label: 'by id', query: 'SELECT name FROM t WHERE id = /*[VARIABLE1]*/' },
      { dbase: DATA, user: '', label: 'all', query: 'SELECT 1' },
    ])

    r = await t.req('GET', `/api/servers/1/bookmarks/${byId}`)
    expect(r.json.message).toEqual({ type: 'success', text: 'Showing bookmark' })

    r = await t.req('POST', `/api/servers/1/bookmarks/${byId}/run`, { db: DATA, variables: { '1': '2' } })
    const st = (r.json.statements as Array<{ sql: string; result: { rows: unknown[][] } }>)[0]!
    expect(st.sql).toBe('SELECT name FROM t WHERE id = 2;')
    expect(st.result.rows).toEqual([['b']])

    r = await t.req('POST', '/api/servers/1/console/bookmarks', {
      db: DATA,
      label: 'console one',
      bookmark_query: 'SELECT 2',
    })
    expect(r.json).toEqual({
      message: 'Succeeded',
      data: { bkm_database: DATA, bkm_user: USER, bkm_sql_query: 'SELECT 2', bkm_label: 'console one' },
      isShared: false,
    })
    r = await t.req('GET', '/api/servers/1/console/bookmarks')
    expect(r.json.welcomeMessage).toBe('Showing 3 bookmarks (both private and shared)')

    r = await t.req('POST', `/api/servers/1/bookmarks/${byId}/delete`)
    expect(r.json).toEqual({
      success: true,
      message: { type: 'success', text: 'The bookmark has been deleted.' },
    })
    r = await t.req('POST', `/api/servers/1/bookmarks/${byId}/delete`)
    expect(r.status).toBe(404)

    // bkm_replace: own bookmarks with the same label in that database are replaced
    await t.req('POST', '/api/servers/1/bookmarks', {
      db: DATA,
      label: 'console one',
      query: 'SELECT 3',
      replace: true,
    })
    expect(await rows(`SELECT query FROM ${PMADB}.pma__bookmark WHERE label = 'console one'`)).toEqual([
      { query: 'SELECT 3' },
    ])
  })

  it('records SQL-box history in pmadb like StatementHistory, trimmed to QueryHistoryMax [p08-96d5e0] [p09-45cd38]', async () => {
    await root.query(`DELETE FROM ${PMADB}.pma__history`)
    const q = (sql: string, extra: Record<string, unknown> = {}) =>
      t.req('POST', '/api/servers/1/query', { sql, db: DATA, fromQueryBox: true, ...extra })
    await q('SELECT 1; SELECT * FROM t')
    expect(await rows(`SELECT username, db, \`table\`, sqlquery FROM ${PMADB}.pma__history`)).toEqual([
      { username: USER, db: DATA, table: 't', sqlquery: 'SELECT * FROM t;' },
    ])
    await q('SELECT 2', { noHistory: true })
    await q(`SELECT '${'x'.repeat(1001)}'`)
    expect(await rows(`SELECT COUNT(*) AS n FROM ${PMADB}.pma__history`)).toEqual([{ n: 1 }])
    for (const n of [3, 4, 5]) {
      // purge compares timevalue; keep the rows in distinct seconds
      await new Promise((r) => setTimeout(r, 1100))
      await q(`SELECT ${n}`)
    }
    const h = await t.req('GET', '/api/servers/1/sql/history')
    expect((h.json.history as Array<{ sqlquery: string }>).map((x) => x.sqlquery)).toEqual([
      'SELECT 5;',
      'SELECT 4;',
      'SELECT 3;',
    ])
  })

  it('recent tables from the SQL box and POST /recent; favorites with the cap [p01-56fa30]', async () => {
    await t.req('POST', '/api/servers/1/query', { sql: 'SELECT 1', db: DATA, table: 't', fromQueryBox: true })
    let r = await t.req('POST', '/api/servers/1/recent', { db: DATA, table: 't2' })
    expect(r.json.recent).toEqual([
      { db: DATA, table: 't2' },
      { db: DATA, table: 't' },
    ])
    r = await t.req('POST', '/api/servers/1/recent', { db: DATA, table: 'missing' })
    expect((r.json.recent as unknown[]).length).toBe(2)
    expect(await rows(`SELECT tables FROM ${PMADB}.pma__recent WHERE username = '${USER}'`)).toEqual([
      { tables: `[{"db":"${DATA}","table":"t2"},{"db":"${DATA}","table":"t"}]` },
    ])

    r = await t.req('POST', '/api/servers/1/favorites', {
      db: DATA,
      table: 't',
      action: 'add',
      favoriteTables: '{}',
    })
    expect(r.json.changes).toBe(true)
    expect(r.json.alreadyFavorite).toBe(true)
    await t.req('POST', '/api/servers/1/favorites', { db: DATA, table: 't2', action: 'add' })
    r = await t.req('POST', '/api/servers/1/favorites', { db: DATA, table: 't3', action: 'add' })
    expect(r.json).toEqual({ changes: false, message: { type: 'error', text: 'Favorite List is full!' } })
    r = await t.req('POST', '/api/servers/1/favorites', { db: DATA, table: 't2', action: 'remove' })
    expect(r.json.favorite).toEqual([{ db: DATA, table: 't' }])
    expect(JSON.parse(r.json.favoriteTables as string)).toEqual({
      [r.json.user as string]: { '1': { db: DATA, table: 't' } },
    })
    r = await t.req('GET', '/api/servers/1/recent-favorite')
    expect(r.json.favorite).toEqual([{ db: DATA, table: 't' }])
    expect(r.json.syncFavorites).toBe(true)
  })

  it('table UI preferences: column order/visibility tied to CREATE_TIME [p02-19721f p02-3b326e]', async () => {
    let r = await t.req('GET', `/api/servers/1/databases/${DATA}/tables/t/uiprefs`)
    const createTime = r.json.createTime as string
    expect(createTime).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
    r = await t.req('POST', `/api/servers/1/databases/${DATA}/tables/t/uiprefs`, {
      col_order: '1,0',
      col_visib: '1,0',
      table_create_time: createTime,
    })
    expect(r.json).toEqual({ success: true, message: null })
    expect(await rows(`SELECT prefs FROM ${PMADB}.pma__table_uiprefs WHERE table_name = 't'`)).toEqual([
      { prefs: `{"CREATE_TIME":"${createTime}","col_order":[1,0],"col_visib":[1,0]}` },
    ])
    r = await t.req('GET', `/api/servers/1/databases/${DATA}/tables/t/uiprefs`)
    expect(r.json).toMatchObject({ sorted_col: false, col_order: [1, 0], col_visib: [1, 0] })
    r = await t.req('POST', `/api/servers/1/databases/${DATA}/tables/t/uiprefs`, {
      col_order: '0,1',
      table_create_time: '1999-01-01 00:00:00',
    })
    expect(r.status).toBe(400)
    expect((r.json.message as { text: string }).text).toBe(
      'Cannot save UI property "col_order". The changes made will not be persistent after you refresh this page. Please check if the table structure has been changed.',
    )
  })

  it('user preferences: option, merged view with sources, reset keeps 2fa', async () => {
    let r = await t.req('POST', '/api/servers/1/prefs/option', { path: 'Console/Mode', value: 'collapse' })
    expect(r.json).toEqual({ success: true, message: null })
    r = await t.req('GET', '/api/servers/1/prefs')
    expect(r.json.storage).toBe('db')
    const values = r.json.values as Record<string, { value: unknown; source: string }>
    expect(values['Console/Mode']).toMatchObject({ value: 'collapse', source: 'user' })
    expect(values.QueryHistoryMax).toMatchObject({ value: 3, source: 'config' })
    expect(values.MaxRows).toMatchObject({ value: 25, source: 'default' })
    // back to the default removes the key
    await t.req('POST', '/api/servers/1/prefs/option', { path: 'Console/Mode', value: 'info' })
    await t.req('POST', '/api/servers/1/prefs', { configData: { MaxRows: 50, '2fa': { backend: 'x' } } })
    expect(await rows(`SELECT config_data FROM ${PMADB}.pma__userconfig WHERE username = '${USER}'`)).toEqual(
      [{ config_data: '{"MaxRows":50,"2fa":{"backend":"x"}}' }],
    )
    r = await t.req('POST', '/api/servers/1/prefs/reset')
    expect(r.json.success).toBe(true)
    expect(await rows(`SELECT config_data FROM ${PMADB}.pma__userconfig WHERE username = '${USER}'`)).toEqual(
      [{ config_data: '{"2fa":{"backend":"x"}}' }],
    )
  })

  it('navigation hiding [p01-f71193]', async () => {
    await t.req('POST', '/api/servers/1/navigation/hide', { itemName: 't', itemType: 'table', dbName: DATA })
    await t.req('POST', '/api/servers/1/navigation/hide', { itemName: 'v', itemType: 'view', dbName: DATA })
    let r = await t.req('GET', `/api/servers/1/navigation/hidden?db=${DATA}`)
    expect(r.json).toEqual({ available: true, hidden: { table: ['t'], view: ['v'] }, counts: { [DATA]: 2 } })
    await t.req('POST', '/api/servers/1/navigation/unhide', {
      itemName: 't',
      itemType: 'table',
      dbName: DATA,
    })
    r = await t.req('GET', `/api/servers/1/navigation/hidden?db=${DATA}`)
    expect(r.json.hidden).toEqual({ view: ['v'] })
  })

  it('caches the storage discovery per session: a later request does not re-probe the pmadb [p08-ac345c]', async () => {
    // warm the session so the storage discovery (SHOW TABLES FROM pmadb) is definitely cached before
    // the measured request, regardless of what earlier tests left in the per-session caches
    await t.req('GET', `/api/servers/1/bookmarks?db=${DATA}`)
    const [[mark]] = (await root.query({ sql: 'SELECT NOW(6)', rowsAsArray: true })) as unknown as [
      [[string]],
    ]
    const r = await t.req('GET', `/api/servers/1/bookmarks?db=${DATA}`)
    expect(r.status).toBe(200)
    await new Promise((res) => setTimeout(res, 200))
    const log = await root.query(
      `SELECT CONVERT(argument USING utf8mb4) AS a FROM mysql.general_log WHERE user_host LIKE ? AND event_time > ? AND command_type = 'Query'`,
      [`${CTL}[%`, mark[0]],
    )
    const stmts = (log[0] as Array<{ a: string }>).map((x) => x.a)
    // The point of the per-session cache: the storage discovery (`SHOW TABLES FROM <pmadb>`, and the
    // relation-parameter probing it drives) is NOT re-run on a later request. Assert that absence
    // rather than an exact ordered statement list — incidental per-page reads (a navigation
    // hidden-count, a repeated bookmark read) legitimately vary and must not fail the cache check.
    expect(
      stmts.filter((s) => /^SHOW TABLES FROM/i.test(s) || /`pma__relation`|`pma__column_info`/.test(s)),
    ).toEqual([])
    // the per-request tracking probe and the feature query the request actually needs are still sent
    expect(stmts).toContain(
      `/*NOTRACK*/ SELECT 1 FROM \`${PMADB}\`.\`pma__tracking\` WHERE tracking_active = 1 AND db_name = '${DATA}' LIMIT 1`,
    )
    expect(stmts).toContain(
      `SELECT * FROM \`${PMADB}\`.\`pma__bookmark\` WHERE (\`user\` = '${USER}' OR \`user\` = '') AND dbase = '${DATA}' ORDER BY label ASC`,
    )
  })
})

describe('ZeroConf: storage in the current database', () => {
  it('offers fixall_pmadb, creates the tables, then finds them [p08-0c056a] [p08-19523b] [p08-c68812]', async () => {
    const t = testApp(testConfig({ DataDir: '' }, { controluser: CTL2, controlpass: CTL2 }))
    await t.login(USER, USER)
    await root.query(`CREATE DATABASE IF NOT EXISTS ${CUR}`)
    let r = await t.req('GET', `/api/servers/1/metadata-storage/status?db=${CUR}`)
    expect(r.json.offer).toBe('fixall_pmadb')
    expect((r.json.relationParameters as { db: unknown }).db).toBeNull()
    expect(r.json.homeNotice).toEqual({
      type: 'notice',
      text: 'The phpMyAdmin configuration storage is not completely configured, some extended features have been deactivated. %sFind out why%s. ',
      detail: "Or alternately go to 'Operations' tab of any database to set it up there.",
    })
    // without a database the only offer is a database named phpmyadmin
    r = await t.req('GET', '/api/servers/1/metadata-storage/status')
    expect(r.json.offer).toBe('create_pmadb')
    expect(r.json.configurationStorageDbName).toBe('phpmyadmin')
    r = await t.req('POST', '/api/servers/1/metadata-storage/create', { action: 'create_pmadb' })
    expect(r.json.message).toEqual({
      type: 'error',
      text: "You do not have necessary privileges to create a database named 'phpmyadmin'. You may go to 'Operations' tab of any database to set up the phpMyAdmin configuration storage there.",
    })

    r = await t.req('POST', '/api/servers/1/metadata-storage/create', { action: 'fixall_pmadb', db: CUR })
    expect(r.json.message).toBeNull()
    const status = r.json.status as { relationParameters: { db: string; allworks: boolean } }
    expect(status.relationParameters.db).toBe(CUR)
    expect(status.relationParameters.allworks).toBe(true)
    expect((await rows(`SHOW TABLES FROM ${CUR}`)).length).toBe(19)
    r = await t.req('GET', `/api/servers/1/metadata-storage/status?db=${CUR}`)
    expect((r.json.relationParameters as { allworks: boolean }).allworks).toBe(true)
    await t.close()
  })

  it('fix_pmadb creates only the missing tables when every name is configured [p08-19523b] [p08-c68812]', async () => {
    await createStorage(CUR, ['pma__bookmark', 'pma__relation'])
    const names = {
      bookmarktable: 'pma__bookmark',
      relation: 'pma__relation',
      table_info: 'pma__table_info',
      table_coords: 'pma__table_coords',
      pdf_pages: 'pma__pdf_pages',
      column_info: 'pma__column_info',
      history: 'my_history',
      recent: 'pma__recent',
      favorite: 'pma__favorite',
      table_uiprefs: 'pma__table_uiprefs',
      tracking: false as const,
      userconfig: 'pma__userconfig',
      users: 'pma__users',
      usergroups: 'pma__usergroups',
      navigationhiding: 'pma__navigationhiding',
      savedsearches: 'pma__savedsearches',
      central_columns: 'pma__central_columns',
      designer_settings: 'pma__designer_settings',
      export_templates: 'pma__export_templates',
    }
    const t = testApp(
      testConfig({ DataDir: '' }, { controluser: CTL2, controlpass: CTL2, pmadb: CUR, ...names }),
    )
    await t.login(USER, USER)
    let r = await t.req('GET', '/api/servers/1/metadata-storage/status')
    expect(r.json.offer).toBe(null) // tracking=false: not every table is defined
    expect(r.json.homeNotice).toMatchObject({ type: 'error' })
    r = await t.req('POST', '/api/servers/1/metadata-storage/create', { action: 'fix_pmadb' })
    expect(r.json.message).toBeNull()
    const tables = (await rows(`SHOW TABLES FROM ${CUR}`)).map((x) => Object.values(x)[0])
    expect(tables).toContain('my_history')
    expect(tables).not.toContain('pma__tracking')
    expect(tables).not.toContain('pma__history')
    expect(tables.length).toBe(18)
    await t.close()
    await root.query(`DROP DATABASE ${CUR}`)
  })
})

describe('without configuration storage', () => {
  it('falls back to the user link when the control user cannot connect', async () => {
    const t = testApp(testConfig({ DataDir: '' }, { controluser: CTL, controlpass: 'wrong', pmadb: PMADB }))
    await t.login(USER, USER)
    const r = await t.req('GET', '/api/servers/1/metadata-storage/status')
    expect(r.json.controlError).toMatch(/Access denied for user/)
    // the user has no rights on the pmadb: storage off
    expect((r.json.relationParameters as { db: unknown }).db).toBeNull()
    await t.close()
  })

  it('keeps per-user metadata in the local SQLite store', async () => {
    const t = testApp(testConfig({ DataDir: dataDir, QueryHistoryDB: true }))
    await t.login(USER, USER)
    let r = await t.req('GET', '/api/servers/1/metadata-storage/status')
    expect(r.json.stores).toEqual({
      bookmarks: 'local',
      history: 'local',
      recent: 'local',
      favorite: 'local',
      uiPrefs: 'local',
      userConfig: 'local',
    })
    await t.req('POST', '/api/servers/1/bookmarks', { db: DATA, label: 'local one', query: 'SELECT 1' })
    r = await t.req('GET', `/api/servers/1/bookmarks?db=${DATA}`)
    expect((r.json.bookmarks as Array<{ label: string }>).map((b) => b.label)).toEqual(['local one'])
    await t.req('POST', '/api/servers/1/query', { sql: 'SELECT 42', db: DATA, fromQueryBox: true })
    r = await t.req('GET', '/api/servers/1/sql/history')
    expect((r.json.history as Array<{ sqlquery: string }>)[0]!.sqlquery).toBe('SELECT 42;')
    r = await t.req('GET', '/api/servers/1/prefs')
    expect(r.json.storage).toBe('local')
    r = await t.req('GET', '/api/servers/1/navigation/hidden')
    expect(r.json.available).toBe(false)
    await t.close()
  })

  it('session only when there is neither pmadb nor a data directory', async () => {
    const t = testApp(testConfig({ DataDir: '' }))
    await t.login(USER, USER)
    let r = await t.req('POST', '/api/servers/1/prefs/option', { path: 'MaxRows', value: 100 })
    r = await t.req('GET', '/api/servers/1/prefs')
    expect(r.json.storage).toBe('session')
    expect((r.json.values as Record<string, { value: unknown }>).MaxRows!.value).toBe(100)
    r = await t.req('GET', '/api/servers/1/bookmarks')
    expect(r.json).toEqual({ available: false, allowSharedBookmarks: true, bookmarks: [] })
    await t.close()
  })
})
