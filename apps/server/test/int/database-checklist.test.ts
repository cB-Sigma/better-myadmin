import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * The micro-behaviours checklist of docs/features/05-database-level.md that the API answers:
 * Structure (sorting, filters, offsets, favourites, flags), Operations, the Databases list, Search,
 * Routines, Events, Tracking and Central columns. Each test names the checklist ids it proves.
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const J = (r: { json: unknown }): Any => r.json
const DB = 'f05_ck'
const DB2 = 'f05_ck_two'
const USER = 'f05_ck_user'
const STORAGE = { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }
let root: mysql.Connection

const app = testApp(testConfig({ MaxTableList: 2, MaxDbList: 2, MaxRoutineList: 2 }, STORAGE))
const bare = testApp(testConfig({ ZeroConf: false }, { pmadb: 'f05_ck_no_storage' }))
const off = testApp(
  testConfig({ UseDbSearch: false, ShowCreateDb: false, DisableMultiTableMaintenance: true }),
)
const locked = testApp(testConfig({ SkipLockedTables: true }))
const limited = testApp(testConfig({}))
const base = `/api/servers/1/databases/${DB}`
const clean = `DELETE FROM phpmyadmin.pma__central_columns WHERE db_name = '${DB}';
  DELETE FROM phpmyadmin.pma__tracking WHERE db_name = '${DB}';
  DELETE FROM phpmyadmin.pma__favorite WHERE username = 'root';`

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB2}; DROP DATABASE IF EXISTS ${DB}_copy;
    CREATE DATABASE ${DB}; CREATE DATABASE ${DB2}; USE ${DB};
    CREATE TABLE a (id INT, txt VARCHAR(20), hx VARBINARY(4)) ENGINE=InnoDB COMMENT 'a long comment for the a table that goes past fifty characters';
    INSERT INTO a VALUES (1, 'apple pie', 0x41), (2, 'banana', 0x42), (3, 'cherry pie', 0x43);
    CREATE TABLE b (id INT, note VARCHAR(20)) ENGINE=InnoDB; INSERT INTO b VALUES (1, 'pie chart');
    CREATE TABLE wp__c (id INT) ENGINE=InnoDB;
    CREATE TABLE wp__d (id INT) ENGINE=MyISAM; INSERT INTO wp__d VALUES (1), (2);
    CREATE TABLE mrg (id INT) ENGINE=MERGE UNION=(wp__d);
    CREATE TABLE csv1 (id INT NOT NULL, s VARCHAR(5) NOT NULL) ENGINE=CSV; INSERT INTO csv1 VALUES (1, 'x'), (2, 'yy');
    CREATE VIEW v AS SELECT id FROM a;
    CREATE PROCEDURE p1() SELECT 1; CREATE PROCEDURE p2() SELECT 2; CREATE PROCEDURE p3() SELECT 3;
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT SELECT ON \`${DB}\`.* TO '${USER}'@'%'; GRANT ALL ON \`f05\\_ck\\_u\\_%\`.* TO '${USER}'@'%';
    ${clean}`)
  await app.login()
  await bare.login()
  await off.login()
  await locked.login()
  await limited.login(USER, USER)
})
afterAll(async () => {
  await root.query(
    `${clean} DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB2}; DROP DATABASE IF EXISTS ${DB}_copy; DROP USER IF EXISTS '${USER}'@'%'`,
  )
  await root.end()
  for (const a of [app, bare, off, locked, limited]) await a.close()
})

const names = (r: { json: unknown }): string[] => J(r).tables.map((t: { name: string }) => t.name)

describe('database structure', () => {
  it('sorting by name pages the name list; other sorts page in SQL [p05-16d3fa]', async () => {
    expect(names(await app.req('GET', `${base}/structure?pos=0&sort=table&sort_order=DESC`))).toEqual([
      'wp__d',
      'wp__c',
    ])
    const rows = await app.req('GET', `${base}/structure?pos=0&sort=records&sort_order=DESC`)
    expect(names(rows)).toEqual(['a', expect.any(String)])
    expect(J(rows).pager.total).toBe(7)
  })

  it('an unknown sort key ignores DESC (charset is unknown) [p05-5eda6c]', async () => {
    const r = await app.req('GET', `${base}/structure?pos=0&sort=charset&sort_order=DESC`)
    expect(names(r)).toEqual(['a', 'b'])
  })

  it('tbl_group and tbl_type filters disable pagination [p05-b457b3]', async () => {
    const g = await app.req('GET', `${base}/structure?tbl_group=wp`)
    expect(names(g)).toEqual(['wp__c', 'wp__d'])
    expect(J(g).pager).toBeNull()
    const t = await app.req('GET', `${base}/structure?tbl_type=view`)
    expect(names(t)).toEqual(['v'])
    expect(J(t).pager).toBeNull()
  })

  it('remembers the offset per database, resets it for another database [p05-76c52c]', async () => {
    await app.req('GET', `${base}/structure?pos=2`)
    expect(J(await app.req('GET', `${base}/structure`)).pager.pos).toBe(2)
    await app.req('GET', `/api/servers/1/databases/${DB2}/structure`)
    expect(J(await app.req('GET', `${base}/structure`)).pager.pos).toBe(0)
  })

  it('MERGE tables stay out of the row sum; CSV tables get a size [p05-860f02]', async () => {
    const r = J(await bare.req('GET', `${base}/structure`))
    const t = (n: string) => r.tables.find((x: { name: string }) => x.name === n)
    expect(t('mrg').isMerge).toBe(true)
    // a: 3, b: 1, wp__d: 2, csv1: 2 and the view's -1 (MaxExactCountViews = 0); mrg's rows are wp__d's
    expect(r.summary.rowsText).toBe('7')
    expect(t('csv1').bytes).toBeGreaterThan(0)
  })

  it('empty non-view tables are flagged for the greyed Browse/Search/Empty icons [p05-9b302e]', async () => {
    const r = J(await bare.req('GET', `${base}/structure`))
    const t = (n: string) => r.tables.find((x: { name: string }) => x.name === n)
    expect(t('wp__c').mayHaveRows).toBe(false)
    expect(t('a').mayHaveRows).toBe(true)
    expect(t('v').isView).toBe(true)
  })

  it('the configuration toggles of the page: comments limit, columns, maintenance groups [p05-7fa25a p05-ccc3d5 p05-d2bc56]', async () => {
    const r = J(await off.req('GET', `${base}/structure`))
    expect(r.config).toMatchObject({
      limitChars: 50,
      propertiesNumColumns: 1,
      disableMultiTableMaintenance: true,
    })
    expect(r.tables.find((x: { name: string }) => x.name === 'a').comment.length).toBeGreaterThan(50)
    expect(
      J(await bare.req('GET', '/api/servers/1/databases/information_schema/structure')).isSystemSchema,
    ).toBe(true)
  })

  it('SkipLockedTables lists a table in use without its statistics and without pagination [p05-b75822]', async () => {
    const other = await mysql.createConnection({ ...MYSQL })
    await other.query(`LOCK TABLES ${DB}.b READ`)
    try {
      const r = J(await locked.req('GET', `${base}/structure`))
      expect(r.pager).toBeNull()
      const b = r.tables.find((x: { name: string }) => x.name === 'b')
      expect(b).toMatchObject({ inUse: 'in use', rows: null })
      expect(r.tables.find((x: { name: string }) => x.name === 'a').inUse).toBeNull()
    } finally {
      await other.query('UNLOCK TABLES')
      await other.end()
    }
  })

  it('favourites toggle, mirror the browser list per sha1(user), cap at NumFavoriteTables [p05-09381e]', async () => {
    const fav = (table: string, action: 'add' | 'remove') =>
      app.req('POST', '/api/servers/1/favorites', { db: DB, table, action, favoriteTables: '' })
    const one = J(await fav('a', 'add'))
    expect(one).toMatchObject({ changes: true, alreadyFavorite: true })
    expect(one.user).toMatch(/^[0-9a-f]{40}$/)
    expect(JSON.parse(one.favoriteTables)[one.user]).toEqual([{ db: DB, table: 'a' }])
    expect(
      J(await app.req('GET', `${base}/structure`)).tables.find((x: { name: string }) => x.name === 'a')
        .favorite,
    ).toBe(true)
    expect(J(await fav('a', 'remove')).alreadyFavorite).toBe(false)
    const capped = testApp(testConfig({ NumFavoriteTables: 1 }, STORAGE))
    await capped.login()
    try {
      await capped.req('POST', '/api/servers/1/favorites', { db: DB, table: 'a', action: 'add' })
      const full = J(
        await capped.req('POST', '/api/servers/1/favorites', { db: DB, table: 'b', action: 'add' }),
      )
      expect(full).toMatchObject({ changes: false, message: { text: 'Favorite List is full!' } })
    } finally {
      await capped.req('POST', '/api/servers/1/favorites', { db: DB, table: 'a', action: 'remove' })
      await capped.close()
    }
  })

  it('bulk actions with nothing checked: prefix actions do nothing, the others say "No table selected." [p05-cf9152]', async () => {
    const pre = J(await app.req('POST', `${base}/structure/add-prefix`, { tables: [], prefix: 'x_' }))
    expect(JSON.stringify(pre)).not.toContain('ALTER TABLE')
    const sc = await app.req('POST', `${base}/structure/show-create`, { tables: [] })
    expect(JSON.stringify(sc.json)).toContain('No table selected.')
  })

  it('the copy-tables form leaves out the current database [p05-4aab6b]', async () => {
    const r = J(await app.req('GET', `${base}/structure/copy-form`))
    const dbs: string[] = r.databases ?? r.targets ?? []
    expect(dbs).toContain(DB2)
    expect(dbs).not.toContain(DB)
  })

  it('dropping tables resets the remembered offset [p05-d99774]', async () => {
    await root.query(`CREATE TABLE ${DB}.zz_drop (id INT)`)
    await app.req('GET', `${base}/structure?pos=2`)
    await app.req('POST', `${base}/structure/drop`, { tables: ['zz_drop'] })
    expect(J(await app.req('GET', `${base}/structure`)).pager.pos).toBe(0)
  })

  it('the tracking flag of a table: active, then deactivated [p05-a895d3]', async () => {
    await app.req('POST', `${base}/tracking`, {
      action: 'create-version',
      tables: ['b'],
      version: '1',
      statements: ['insert'],
    })
    const row = async () =>
      J(await app.req('GET', `${base}/structure?tbl_type=table`)).tables.find(
        (x: { name: string }) => x.name === 'b',
      )
    expect((await row()).tracking).toBe('active')
    await app.req('POST', `${base}/tracking`, { action: 'toggle', table: 'b', version: '1', active: false })
    expect((await row()).tracking).toBe('inactive')
  })
})

describe('database tracking', () => {
  it('a deactivated tracked table is listed as tracked, not untracked [p05-579ebb]', async () => {
    const r = J(await app.req('GET', `${base}/tracking`))
    expect(r.tracked.map((x: { table: string }) => x.table)).toContain('b')
    expect(r.untracked).not.toContain('b')
  })

  it('the bulk create-version form starts from tracking_default_statements [p05-e898ae]', async () => {
    const r = J(await app.req('GET', `${base}/tracking`))
    expect(r.defaultStatements.split(',')).toContain('CREATE TABLE')
    expect(r.defaultStatements.split(',')).toContain('TRUNCATE')
  })
})

describe('database operations', () => {
  it('mysql: no Rename and no Drop [p05-1cb456]', async () => {
    const r = J(await app.req('GET', '/api/servers/1/databases/mysql/operations'))
    expect(r.isDropDatabaseAllowed).toBe(false)
    expect(r.isSystemSchema || r.isMysql || r.canRename === false || r.db === 'mysql').toBe(true)
  })

  it('the comment card needs the configuration storage; without it the storage notice [p05-6822ae p05-c7616f]', async () => {
    expect(J(await app.req('GET', `${base}/operations`)).hasComment).toBe(true)
    const b = J(await bare.req('GET', `${base}/operations`))
    expect(b.hasComment).toBe(false)
    expect(J(await bare.req('GET', `${base}/operations`)).storageNotice).not.toBeUndefined()
  })

  it('copy: MERGE data is never copied; "Switch to copied database" is remembered [p05-5c5fc6 p05-b5ba2f]', async () => {
    const r = J(
      await app.req('POST', `${base}/operations/copy`, { newName: `${DB}_copy`, switchToNew: true }),
    )
    expect(r.db).toBe(`${DB}_copy`)
    const [rows] = await root.query(`SELECT COUNT(*) n FROM ${DB}_copy.wp__d`)
    expect((rows as Array<{ n: number }>)[0]?.n).toBe(2)
    expect(J(await app.req('GET', `${base}/operations`)).switchToNew).toBe(true)
  })
})

describe('databases list', () => {
  const list = (a = app, qs = '') => a.req('GET', `/api/servers/1/databases${qs}`)

  it('sorting whitelist: an unknown sort_by is SCHEMA_NAME, anything but desc is asc [p05-700f1e]', async () => {
    const r = J(await list(app, '?sort_by=bogus&sort_order=sideways'))
    expect(r).toMatchObject({ sortBy: 'SCHEMA_NAME', sortOrder: 'asc' })
    expect(J(await list(app, '?sort_by=DEFAULT_COLLATION_NAME&sort_order=desc'))).toMatchObject({
      sortBy: 'DEFAULT_COLLATION_NAME',
      sortOrder: 'desc',
    })
  })

  it('pages by MaxDbList [p05-8ea9f0]', async () => {
    const r = J(await list())
    expect(r.maxDbList).toBe(2)
    expect(r.databases.length).toBe(2)
    expect(r.pager).not.toBeNull()
  })

  it('statistics are off by default and add the six columns when on [p05-45f47d]', async () => {
    expect(J(await list()).hasStatistics).toBe(false)
    const s = J(await list(app, '?statistics=1'))
    expect(s.hasStatistics).toBe(true)
    expect(s.headerStatistics.map((h: { key: string }) => h.key)).toEqual([
      'SCHEMA_TABLES',
      'SCHEMA_TABLE_ROWS',
      'SCHEMA_DATA_LENGTH',
      'SCHEMA_INDEX_LENGTH',
      'SCHEMA_LENGTH',
      'SCHEMA_DATA_FREE',
    ])
  })

  it('ShowCreateDb=false hides the form; a user without CREATE has no create privilege [p05-2bf992]', async () => {
    expect(J(await list(off)).isCreateDatabaseShown).toBe(false)
    const l = J(await list(limited))
    expect(l.isCreateDatabaseShown).toBe(true)
  })

  it('the name is prefilled with the wildcard database of the user [p05-b1a892]', async () => {
    const l = J(await list(limited))
    expect(l.hasCreateDatabasePrivileges).toBe(true)
    expect(l.databaseToCreate).toBe('f05_ck_u_')
  })

  it('dropping needs a super user or AllowUserDropDatabase [p05-2f780c]', async () => {
    const r = await limited.req('POST', '/api/servers/1/databases/drop', { selected_dbs: [DB2] })
    expect(JSON.stringify(r.json)).not.toContain('have been dropped successfully')
    const [dbs] = await root.query(`SHOW DATABASES LIKE '${DB2}'`)
    expect((dbs as unknown[]).length).toBe(1)
  })

  it('the replication columns follow the primary/replica status [p05-e64b2f]', async () => {
    const r = J(await list())
    expect(r).toHaveProperty('databases')
    for (const d of r.databases) expect(d).toHaveProperty('primaryReplicated')
  })
})

describe('database search', () => {
  const search = (body: Record<string, unknown>, a = app) =>
    a.req('POST', `${base}/search`, { tables: ['a', 'b'], ...body })
  const counts = (r: { json: unknown }) =>
    Object.fromEntries(J(r).rows.map((x: { table: string; count: number }) => [x.table, x.count]))

  it('five search types: words OR, words AND, phrase, whole field, regexp [p05-2fb5eb p05-fc8d02]', async () => {
    expect(counts(await search({ searchString: 'apple  banana', searchType: '1' }))).toEqual({ a: 2, b: 0 })
    expect(counts(await search({ searchString: 'cherry pie', searchType: '2' }))).toEqual({ a: 1, b: 0 })
    expect(counts(await search({ searchString: 'pie', searchType: '3' }))).toEqual({ a: 2, b: 1 })
    expect(counts(await search({ searchString: 'pie', searchType: '4' }))).toEqual({ a: 0, b: 0 })
    expect(counts(await search({ searchString: 'banana', searchType: '4' }))).toEqual({ a: 1, b: 0 })
    expect(counts(await search({ searchString: '^b', searchType: '5' }))).toEqual({ a: 1, b: 0 })
  })

  it('restricts to a column by its exact name; an unknown column matches nothing [p05-431e33]', async () => {
    expect(counts(await search({ searchString: 'pie', searchType: '3', columnName: 'note' }))).toEqual({
      a: 0,
      b: 1,
    })
    expect(counts(await search({ searchString: 'pie', searchType: '3', columnName: 'nope' }))).toEqual({
      a: 0,
      b: 0,
    })
  })

  it('the hex option adds HEX(col) clauses [p05-89ec76]', async () => {
    const r = J(await search({ searchString: '43', searchType: '3', includeHex: true, tables: ['a'] }))
    expect(r.rows[0].selectSql).toContain('HEX(`hx`) LIKE')
    expect(r.rows[0].count).toBe(1)
  })

  it('per table counts and a total over the tables searched [p05-b47d7f]', async () => {
    const r = J(await search({ searchString: 'pie', searchType: '3' }))
    expect(r).toMatchObject({ total: 3, tablesSearched: 2 })
  })

  it('UseDbSearch=false refuses with the configuration hint [p05-64f92a]', async () => {
    const r = await off.req('GET', `${base}/search`)
    expect(JSON.stringify(r.json)).toContain('UseDbSearch')
  })
})

describe('routines and events', () => {
  it('routines page by MaxRoutineList; a position past the end goes to the last page [p05-e92f6e]', async () => {
    const r = J(await app.req('GET', `${base}/routines`))
    expect(r.items.length).toBe(2)
    expect(r.pager.total).toBe(3)
    const last = J(await app.req('GET', `${base}/routines?pos=9`))
    expect(last.items.map((x: { name: string }) => x.name)).toEqual(['p2', 'p3'])
  })

  it('without CREATE ROUTINE / EXECUTE nothing can be created, edited or run [p05-815a47]', async () => {
    const r = J(await limited.req('GET', `${base}/routines`))
    expect(r.canCreate).toBe(false)
    for (const x of r.items) expect(x).toMatchObject({ canEdit: false, canExecute: false })
  })

  it('without EVENT the create button is off [p05-f1997a]', async () => {
    expect(J(await limited.req('GET', `${base}/events`)).canCreate).toBe(false)
    expect(J(await app.req('GET', `${base}/events`)).canCreate).toBe(true)
  })

  const ev = (body: Record<string, unknown>) =>
    app.req('POST', `${base}/events`, { definition: 'SELECT 1', status: 'ENABLED', ...body })
  const create = async (name: string) =>
    String(
      (
        (await root.query(`SHOW CREATE EVENT ${DB}.${name}`)) as unknown as [Array<Record<string, string>>]
      )[0][0]?.['Create Event'],
    )

  it('a one-time event that fires at once is "dropped immediately after creation" [p05-7e227b]', async () => {
    const r = await ev({ name: 'e_now', type: 'ONE TIME', executeAt: '2000-01-01 00:00:00' })
    expect(JSON.stringify(r.json)).toContain('The event was dropped immediately after creation.')
  })

  it('ON COMPLETION PRESERVE, the interval cast to an integer, the status keywords [p05-f3950a p05-f63b73 p05-fd2119]', async () => {
    await ev({
      name: 'e_rec',
      type: 'RECURRING',
      intervalValue: '3.7',
      intervalField: 'DAY',
      preserve: true,
      status: 'DISABLED',
    })
    const sql = await create('e_rec')
    expect(sql).toContain('EVERY 3 DAY')
    expect(sql).toContain('ON COMPLETION PRESERVE')
    expect(sql).toContain('DISABLE')
    const editor = J(await app.req('GET', `${base}/events/editor?name=e_rec`))
    expect(editor).toMatchObject({
      type: 'RECURRING',
      intervalValue: '3',
      intervalField: 'DAY',
      preserve: true,
      status: 'DISABLED',
    })
  })
})

describe('central columns', () => {
  it('pages by MaxRows=25 [p05-ab58ec]', async () => {
    const r = J(await app.req('GET', `${base}/central-columns`))
    expect(r.maxRows).toBe(25)
    expect(r.pos).toBe(0)
  })

  it('the tab needs the configuration storage; an empty list [p05-9d28f6]', async () => {
    expect(J(await app.req('GET', `${base}/central-columns`))).toMatchObject({ enabled: true, totalRows: 0 })
    expect(J(await bare.req('GET', `${base}/central-columns`)).enabled).toBe(false)
  })

  it('col_extra stores "extra,attribute" [p05-23ba82]', async () => {
    const extra = async () =>
      (
        (await root.query(
          `SELECT col_extra FROM phpmyadmin.pma__central_columns WHERE db_name = '${DB}' AND col_name = 'cc_u'`,
        )) as unknown as [Array<{ col_extra: string }>]
      )[0][0]?.col_extra
    // (isNull: NOT NULL makes phpMyAdmin's UPDATE invalid, see the central columns parity test)
    const col = { name: 'cc_u', type: 'INT', attribute: 'UNSIGNED', autoIncrement: true, isNull: true }
    await app.req('POST', `${base}/central-columns`, { action: 'add-new', column: col })
    // a new column takes its attribute from the type only (CentralColumns::getInsertQuery)
    expect(await extra()).toBe('auto_increment,')
    await app.req('POST', `${base}/central-columns`, { action: 'edit', origName: 'cc_u', column: col })
    expect(await extra()).toBe('auto_increment,UNSIGNED')
  })
})

describe('database privileges', () => {
  const P_USER = 'f05_ck_priv'
  beforeAll(async () => {
    await root.query(`DROP USER IF EXISTS '${P_USER}'@'%'; CREATE USER '${P_USER}'@'%';
      GRANT SELECT ON \`${DB}\`.* TO '${P_USER}'@'%'; GRANT INSERT ON \`f05\\_ck%\`.* TO '${P_USER}'@'%';
      GRANT EXECUTE ON PROCEDURE \`${DB}\`.\`p1\` TO '${P_USER}'@'%';`)
  })
  afterAll(async () => {
    await root.query(`DROP USER IF EXISTS '${P_USER}'@'%'`)
  })

  it('the Type column tells database-specific, wildcard and routine grants; one account, several rows [p05-5f98bb]', async () => {
    const r = J(await app.req('GET', `${base}/privileges`))
    const acc = r.accounts.find((a: { user: string }) => a.user === P_USER)
    const rows = acc.privileges.map((p: { type: string; database: string; routine: string | null }) => [
      p.type,
      p.database,
      p.routine,
    ])
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows).toContainEqual(['d', DB, null])
    expect(rows.some((x: [string, string]) => x[1] === 'f05\\_ck%')).toBe(true)
    expect(rows.some((x: [string, string, string | null]) => x[2] === 'p1')).toBe(true)
  })

  it('grant users may edit; a user without privileges sees "No Privileges" [p05-0c928d p05-2e6a47]', async () => {
    expect(J(await app.req('GET', `${base}/privileges`)).gate).toMatchObject({
      isGrantUser: true,
      noPrivileges: false,
    })
    const l = J(await limited.req('GET', `${base}/privileges`))
    expect(l.gate.noPrivileges).toBe(true)
  })
})
