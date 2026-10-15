import mysql from 'mysql2/promise'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/** Objects of this suite are all prefixed m1shell_. */
const DB = 'm1shell_db'
const EMPTY = 'm1shell_empty'
const PMADB = 'm1shell_pmadb'
const LIMITED = 'm1shell_limited'
const TRIG = 'm1shell_trig'
const GRANTOR = 'm1shell_grantor'
const GROUPED = 'm1shell_grouped'
const PW = 'm1shell_pw'

let root: mysql.Connection
let t: ReturnType<typeof testApp>
afterEach(async () => t?.close())

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`
    DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t1 (id INT PRIMARY KEY) COMMENT='Bookmarks; InnoDB free: 4096 kB';
    CREATE TABLE ${DB}.t2 (id INT) COMMENT='plain comment';
    CREATE VIEW ${DB}.v_upd AS SELECT id FROM ${DB}.t1;
    CREATE VIEW ${DB}.v_ro AS SELECT COUNT(*) AS n FROM ${DB}.t1;
    DROP DATABASE IF EXISTS ${EMPTY}; CREATE DATABASE ${EMPTY};
    DROP DATABASE IF EXISTS ${PMADB}; CREATE DATABASE ${PMADB};
    CREATE TABLE ${PMADB}.pma__users (username VARCHAR(64) NOT NULL, usergroup VARCHAR(64) NOT NULL, PRIMARY KEY (username, usergroup));
    CREATE TABLE ${PMADB}.pma__usergroups (usergroup VARCHAR(64) NOT NULL, tab VARCHAR(64) NOT NULL, allowed ENUM('Y','N') NOT NULL DEFAULT 'N', PRIMARY KEY (usergroup, tab));
    CREATE TABLE ${PMADB}.pma__column_info (id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, db_name VARCHAR(64) NOT NULL DEFAULT '', table_name VARCHAR(64) NOT NULL DEFAULT '', column_name VARCHAR(64) NOT NULL DEFAULT '', comment VARCHAR(255) NOT NULL DEFAULT '', mimetype VARCHAR(255) NOT NULL DEFAULT '', transformation VARCHAR(255) NOT NULL DEFAULT '', transformation_options VARCHAR(255) NOT NULL DEFAULT '', input_transformation VARCHAR(255) NOT NULL DEFAULT '', input_transformation_options VARCHAR(255) NOT NULL DEFAULT '');
    INSERT INTO ${PMADB}.pma__column_info (db_name, table_name, column_name, comment) VALUES ('${DB}', '', '(db_comment)', 'The shell test database');
    INSERT INTO ${PMADB}.pma__users VALUES ('${GROUPED}', 'm1shell_group');
    INSERT INTO ${PMADB}.pma__usergroups VALUES ('m1shell_group', 'server_sql', 'N'), ('m1shell_group', 'server_status', 'Y'),
      ('m1shell_group', 'db_central_columns', 'N'), ('m1shell_group', 'db_sql', 'N'), ('m1shell_group', 'table_browse', 'N');
  `)
  for (const u of [LIMITED, TRIG, GRANTOR, GROUPED, PW]) {
    await root.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}';`)
  }
  await root.query(`
    GRANT SELECT ON ${DB}.* TO '${LIMITED}'@'%';
    GRANT SELECT, TRIGGER, EVENT ON ${DB}.* TO '${TRIG}'@'%';
    GRANT SELECT ON ${DB}.* TO '${GRANTOR}'@'%' WITH GRANT OPTION;
    GRANT SELECT ON ${DB}.* TO '${GROUPED}'@'%';
  `)
})

afterAll(async () => {
  await root.query(
    `DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${EMPTY}; DROP DATABASE IF EXISTS ${PMADB};`,
  )
  for (const u of [LIMITED, TRIG, GRANTOR, GROUPED, PW]) await root.query(`DROP USER IF EXISTS '${u}'@'%'`)
  await root.end()
})

type Tabs = { tabs: Array<{ key: string; warning?: string }> }
const keys = (r: { json: Record<string, unknown> }) => (r.json as unknown as Tabs).tabs.map((x) => x.key)

/** pmadb = m1shell_pmadb read with root as control user (only the users/usergroups/column_info tables). */
const storageCfg = (o = {}) =>
  testConfig(o, { controluser: MYSQL.user, controlpass: MYSQL.password, pmadb: PMADB })

describe('GET /api/servers/:s — server tabs (Menu::getServerTabs)', () => {
  it('root sees every server tab, incl. User accounts, Binary log, Replication', async () => {
    t = testApp()
    await t.login()
    const r = await t.req('GET', '/api/servers/1')
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    expect(keys(r)).toEqual([
      'databases',
      'sql',
      'status',
      'rights',
      'export',
      'import',
      'settings',
      'binlog',
      'replication',
      'vars',
      'charset',
      'engine',
      'plugins',
    ])
    expect(r.json).toMatchObject({
      index: 1,
      name: `${MYSQL.host}:${MYSQL.port}`,
      authType: 'cookie',
      isMariaDb: false,
      capabilities: { isSuperUser: true, isGrantUser: true, hasBinaryLogs: true, currentUser: ['root', '%'] },
    })
  })

  it('a limited user has no User accounts, Binary log or Replication', async () => {
    t = testApp()
    await t.login(LIMITED, LIMITED)
    const r = await t.req('GET', '/api/servers/1')
    expect(keys(r)).toEqual([
      'databases',
      'sql',
      'status',
      'export',
      'import',
      'settings',
      'vars',
      'charset',
      'engine',
      'plugins',
    ])
    expect(r.json).toMatchObject({
      capabilities: { isSuperUser: false, isGrantUser: false, isCreateUser: false, hasBinaryLogs: false },
    })
  })

  it('GRANT OPTION alone does not show User accounts: the probe UNIONs mysql.user, which fails (quirk Q44)', async () => {
    t = testApp()
    await t.login(GRANTOR, GRANTOR)
    const r = await t.req('GET', '/api/servers/1')
    expect(keys(r)).not.toContain('rights')
    expect(r.json).toMatchObject({ capabilities: { isGrantUser: false, isCreateUser: false } })
  })

  it('user groups (pma__usergroups allowed=N) remove tabs at every level', async () => {
    t = testApp(storageCfg())
    await t.login(GROUPED, GROUPED)
    expect(keys(await t.req('GET', '/api/servers/1'))).not.toContain('sql')
    expect(keys(await t.req('GET', '/api/servers/1'))).toContain('status')
    const db = await t.req('GET', `/api/servers/1/databases/${DB}`)
    expect(keys(db)).not.toContain('sql')
    expect(keys(db)).toContain('structure')
    expect(keys(await t.req('GET', `/api/servers/1/databases/${DB}/tables/t1/capabilities`))).not.toContain(
      'browse',
    )
  })

  it('caches the probes in the session (SessionCache)', async () => {
    t = testApp(testConfig({ DBG: { sql: true } }))
    await t.login()
    await t.req('GET', '/api/servers/1')
    const s = t.deps.store.get(t.jar.get('bma_sid')!)!
    expect(s.servers['1']!.cache).toMatchObject({
      is_superuser: true,
      binary_logs: true,
      mysql_cur_user: 'root@%',
    })
  })
})

describe('GET /api/servers/:s/databases/:db — database tabs (Menu::getDbTabs)', () => {
  it('root: every tab; Tracking and Central columns come from the configuration storage', async () => {
    t = testApp()
    await t.login()
    // no controluser: the user connection finds the `phpmyadmin` storage database by ZeroConf
    const r = await t.req('GET', `/api/servers/1/databases/${DB}`)
    expect(keys(r)).toEqual([
      'structure',
      'sql',
      'search',
      'query',
      'export',
      'import',
      'operation',
      'privileges',
      'routines',
      'events',
      'triggers',
      'tracking',
      'designer',
      'central_columns',
    ])
    expect(r.json).toMatchObject({ db: DB, isSystemSchema: false, numTables: 4, comment: '' })
    await t.close()
    // a storage without pma__tracking / pma__central_columns
    t = testApp(storageCfg())
    await t.login()
    const k = keys(await t.req('GET', `/api/servers/1/databases/${DB}`))
    expect(k).not.toContain('tracking')
    expect(k).not.toContain('central_columns')
  })

  it('the database comment comes from pma__column_info when column comments work [p08-d94efe]', async () => {
    t = testApp(storageCfg())
    await t.login()
    const r = await t.req('GET', `/api/servers/1/databases/${DB}`)
    expect(r.json.comment).toBe('The shell test database')
  })

  it('a SELECT-only user has no Privileges, Events or Triggers tab', async () => {
    t = testApp()
    await t.login(LIMITED, LIMITED)
    expect(keys(await t.req('GET', `/api/servers/1/databases/${DB}`))).toEqual([
      'structure',
      'sql',
      'search',
      'query',
      'export',
      'import',
      'operation',
      'routines',
      'designer',
    ])
  })

  it('EVENT / TRIGGER on the schema show Events / Triggers', async () => {
    t = testApp()
    await t.login(TRIG, TRIG)
    const k = keys(await t.req('GET', `/api/servers/1/databases/${DB}`))
    expect(k).toContain('events')
    expect(k).toContain('triggers')
  })

  it('system schemas keep only Structure, SQL, Search, Query, Export; mysql is not one', async () => {
    t = testApp()
    await t.login()
    const r = await t.req('GET', '/api/servers/1/databases/information_schema')
    expect(keys(r)).toEqual(['structure', 'sql', 'search', 'query', 'export'])
    expect(r.json.isSystemSchema).toBe(true)
    expect(keys(await t.req('GET', '/api/servers/1/databases/mysql'))).toContain('operation')
  })

  it('an empty database flags Search, Query and Export with "Database seems to be empty!"', async () => {
    t = testApp()
    await t.login()
    const r = await t.req('GET', `/api/servers/1/databases/${EMPTY}`)
    const tabs = (r.json as unknown as Tabs).tabs
    expect(tabs.filter((x) => x.warning === 'Database seems to be empty!').map((x) => x.key)).toEqual([
      'search',
      'query',
      'export',
    ])
  })

  it('an unknown database is a 404', async () => {
    t = testApp()
    await t.login()
    const r = await t.req('GET', '/api/servers/1/databases/m1shell_nope')
    expect(r.status).toBe(404)
  })
})

describe('GET …/tables/:t/capabilities — table tabs (Menu::getTableTabs)', () => {
  it('a base table: every tab, comment without "; InnoDB free"', async () => {
    t = testApp()
    await t.login()
    const r = await t.req('GET', `/api/servers/1/databases/${DB}/tables/t1/capabilities`)
    expect(keys(r)).toEqual([
      'browse',
      'structure',
      'sql',
      'search',
      'insert',
      'export',
      'import',
      'privileges',
      'operation',
      'tracking',
      'triggers',
    ])
    expect(r.json).toMatchObject({ isView: false, comment: 'Bookmarks' })
  })

  it('an updatable view keeps Insert, loses Import and Triggers; its comment is empty', async () => {
    t = testApp()
    await t.login()
    const r = await t.req('GET', `/api/servers/1/databases/${DB}/tables/v_upd/capabilities`)
    expect(keys(r)).toEqual([
      'browse',
      'structure',
      'sql',
      'search',
      'insert',
      'export',
      'privileges',
      'operation',
      'tracking',
    ])
    expect(r.json).toMatchObject({ isView: true, isUpdatableView: true, comment: '' })
  })

  it('a non-updatable view has no Insert', async () => {
    t = testApp()
    await t.login()
    const r = await t.req('GET', `/api/servers/1/databases/${DB}/tables/v_ro/capabilities`)
    expect(keys(r)).not.toContain('insert')
    expect(r.json.isUpdatableView).toBe(false)
  })

  it('information_schema tables are system views', async () => {
    t = testApp()
    await t.login()
    const r = await t.req('GET', '/api/servers/1/databases/information_schema/tables/TABLES/capabilities')
    expect(keys(r)).toEqual(['browse', 'structure', 'sql', 'search', 'export'])
    expect(r.json.isView).toBe(true)
  })

  it('a SELECT-only user has no Privileges or Triggers', async () => {
    t = testApp()
    await t.login(LIMITED, LIMITED)
    const k = keys(await t.req('GET', `/api/servers/1/databases/${DB}/tables/t2/capabilities`))
    expect(k).not.toContain('privileges')
    expect(k).not.toContain('triggers')
  })
})

describe('GET /api/servers/:s/home (HomeController)', () => {
  it('returns the blocks and the warnings phpMyAdmin would show [p06-f6908d]', async () => {
    t = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass' }))
    await t.login()
    const r = await t.req('GET', '/api/servers/1/home', undefined, { host: '127.0.0.1:8080' })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    // biome-ignore lint/suspicious/noExplicitAny: loose JSON assertions
    const home = r.json as Record<string, any>
    expect(home.hasChangePasswordLink).toBe(true)
    expect(home.hasServerSelection).toBe(false)
    expect(home.collation.selected).toBe('utf8mb4_general_ci')
    const utf8mb4 = home.collation.charsets.find((c: { name: string }) => c.name === 'utf8mb4')
    expect(utf8mb4.description).toBe('UTF-8 Unicode')
    expect(
      utf8mb4.collations.find((c: { name: string }) => c.name === 'utf8mb4_0900_ai_ci').description,
    ).toBe('Unicode (UCA 9.0.0), accent-insensitive, case-insensitive')
    expect(home.databaseServer).toMatchObject({
      host: `${MYSQL.host} via TCP/IP`,
      type: 'MySQL',
      connection: { message: 'SSL is not being used', danger: false },
      charset: 'UTF-8 Unicode (utf8mb4)',
    })
    expect(home.databaseServer.version).toMatch(/^8\.\d+\.\d+.* - /)
    expect(home.webServer.database).toMatch(/^libmysql - mysql2 \d+\.\d+\.\d+$/)
    const texts = home.warnings.map((w: { message: string }) => w.message)
    expect(texts).toContain(
      "Your server is running with default values for the controluser and password (controlpass) and is open to intrusion; you really should fix this security weakness by changing the password for controluser 'pma'.",
    )
    // the test secret is 36 bytes
    expect(texts).toContain(
      'The cookie encryption key in the configuration file is longer than necessary. It should only be 32 bytes long. Please refer to the [doc@cfg_blowfish_secret]documentation[/doc].',
    )
  })

  it('LoginCookieStore < LoginCookieValidity, missing HTTP_HOST', async () => {
    t = testApp(testConfig({ LoginCookieStore: 60 }))
    await t.login()
    const r = await t.req('GET', '/api/servers/1/home', undefined, { host: '' })
    const texts = (r.json.warnings as Array<{ message: string }>).map((w) => w.message)
    expect(texts).toContain(
      'Login cookie store is lower than cookie validity configured in phpMyAdmin, because of this, your login will expire sooner than configured in phpMyAdmin.',
    )
  })

  it('config storage notice: Error when pmadb is configured but incomplete [p06-f6908d]', async () => {
    t = testApp(storageCfg())
    await t.login()
    const r = await t.req('GET', '/api/servers/1/home')
    expect(r.json.configStorageMessage).toEqual({ type: 'error', zeroConf: true })
  })

  it('ShowServerInfo = false hides the Database server and Web server blocks [p06-f6908d]', async () => {
    t = testApp(testConfig({ ShowServerInfo: false }))
    await t.login()
    const r = await t.req('GET', '/api/servers/1/home')
    expect(r.json.databaseServer).toBeNull()
    expect(r.json.webServer).toBeNull()
  })
})

describe('POST /api/servers/:s/session/collation (/collation-connection)', () => {
  it('sets collation_connection on the connections of this login', async () => {
    t = testApp()
    await t.login()
    const r = await t.req('POST', '/api/servers/1/session/collation', { collation_connection: 'utf8mb4_bin' })
    expect(r.json).toEqual({ ok: true, collation: 'utf8mb4_bin' })
    const q = await t.req('POST', '/api/servers/1/query', { sql: 'SELECT @@collation_connection AS c' })
    const st = (q.json.statements as Array<{ result: { rows: unknown[][] } }>)[0]!
    expect(st.result.rows[0]).toEqual(['utf8mb4_bin'])
    const home = await t.req('GET', '/api/servers/1/home')
    // phpMyAdmin keeps getDefaultCollation() selected in the list (quirk Q42)
    expect(home.json.collation).toMatchObject({ selected: 'utf8mb4_general_ci', current: 'utf8mb4_bin' })
  })
})

describe('change password (/user-password)', () => {
  it('validates like UserPassword::setChangePasswordMsg', async () => {
    t = testApp()
    await t.login(PW, PW)
    const empty = await t.req('POST', '/api/servers/1/account/password', {
      nopass: false,
      pma_pw: '',
      pma_pw2: '',
    })
    expect(empty.json.error).toMatchObject({ message: 'The password is empty!' })
    const diff = await t.req('POST', '/api/servers/1/account/password', {
      nopass: false,
      pma_pw: 'a',
      pma_pw2: 'b',
    })
    expect(diff.json.error).toMatchObject({ message: "The passwords aren't the same!" })
    const long = 'x'.repeat(257)
    const tl = await t.req('POST', '/api/servers/1/account/password', {
      nopass: false,
      pma_pw: long,
      pma_pw2: long,
    })
    expect(tl.json.error).toMatchObject({ message: 'Password is too long!' })
  })

  it('the form preselects mysql_native_password (getCurrentAuthenticationPlugin with an empty user)', async () => {
    t = testApp()
    await t.login(PW, PW)
    const f = await t.req('GET', '/api/servers/1/account/password')
    expect(f.json).toMatchObject({
      origAuthPlugin: 'mysql_native_password',
      showHashing: true,
      allowNoPassword: false,
    })
    expect((f.json.authPlugins as Array<{ name: string }>).map((p) => p.name)).toContain(
      'caching_sha2_password',
    )
  })

  it('changes the password with the preselected plugin: plain ALTER USER, session kept, new password works', async () => {
    t = testApp()
    await t.login(PW, PW)
    // the user cannot read mysql.user: the original plugin falls back to mysql_native_password, the
    // form posts mysql_native_password, so the plugin is "unchanged" and no WITH clause is added
    const r = await t.req('POST', '/api/servers/1/account/password', {
      nopass: false,
      pma_pw: 'm1shell_new',
      pma_pw2: 'm1shell_new',
      authentication_plugin: 'mysql_native_password',
    })
    expect(r.json, JSON.stringify(r.json)).toEqual({
      ok: true,
      message: 'The profile has been updated.',
      sql: `ALTER USER '${PW}'@'%' IDENTIFIED BY '***'`,
    })
    expect((await t.req('POST', '/api/servers/1/query', { sql: 'SELECT 1' })).status).toBe(200)
    const t2 = testApp()
    expect((await t2.login(PW, 'm1shell_new')).status).toBe(200)
    await t2.close()
    await root.query(`ALTER USER '${PW}'@'%' IDENTIFIED BY '${PW}'`)
  })

  it('choosing another plugin adds WITH <plugin>, which needs CREATE USER since MySQL 5.7.37 (error shown with the masked SQL)', async () => {
    t = testApp()
    await t.login(PW, PW)
    const r = await t.req('POST', '/api/servers/1/account/password', {
      nopass: false,
      pma_pw: 'm1shell_new',
      pma_pw2: 'm1shell_new',
      authentication_plugin: 'caching_sha2_password',
    })
    expect(r.json.error).toMatchObject({
      errno: 1227,
      sql: `ALTER USER '${PW}'@'%' IDENTIFIED WITH caching_sha2_password BY '***'`,
    })
    expect(JSON.stringify(r.json)).not.toContain('m1shell_new')
  })

  it('is refused with config auth', async () => {
    t = testApp(testConfig({}, { auth_type: 'config', user: MYSQL.user, password: MYSQL.password }))
    await t.login()
    const r = await t.req('GET', '/api/servers/1/account/password')
    expect(r.json.error).toMatchObject({
      message: "You don't have sufficient privileges to be here right now!",
    })
  })
})

describe('meta and telemetry', () => {
  it('config-public never contains secrets', async () => {
    t = testApp()
    const r = await t.req('GET', '/api/meta/config-public')
    expect(r.json).toMatchObject({
      ThemeDefault: 'pmahomme',
      ThemeManager: true,
      TabsMode: 'both',
      Confirm: true,
    })
    expect(JSON.stringify(r.json)).not.toContain('test-secret')
    expect(r.json).not.toHaveProperty('blowfish_secret')
    expect(r.json).not.toHaveProperty('Servers')
  })

  it('version-check returns {} without a feed', async () => {
    t = testApp()
    expect((await t.req('GET', '/api/meta/version-check')).json).toEqual({})
  })

  it('error report settings and submission messages (ErrorReportController)', async () => {
    t = testApp()
    await t.req('GET', '/api/auth/state')
    expect(
      (await t.req('POST', '/api/telemetry/error', { exception_type: 'js', get_settings: true })).json,
    ).toEqual({
      report_setting: 'ask',
    })
    const sent = await t.req('POST', '/api/telemetry/error', {
      exception_type: 'js',
      send_error_report: true,
      always_send: true,
      exception: { message: 'boom', stack: [] },
      url: 'http://h/s/1/db/secret/t/tbl/structure?token=x',
    })
    expect(sent.json).toEqual({
      message: {
        type: 'notice',
        text: 'Thank you for submitting this report. You may want to refresh the page.',
      },
    })
    // "Automatically send report next time"
    expect(
      (await t.req('POST', '/api/telemetry/error', { exception_type: 'js', get_settings: true })).json,
    ).toEqual({
      report_setting: 'always',
    })
  })
})

describe('partial logout (LoginCookieDeleteAll = false)', () => {
  it('keeps the other server and flags the message once', async () => {
    const cfg = testConfig({ LoginCookieDeleteAll: false })
    const servers = cfg.Servers as unknown as Record<string, unknown>
    servers['2'] = { ...(servers['1'] as object) }
    t = testApp(cfg)
    await t.login()
    await t.req('POST', '/api/auth/login', { server: 2, username: MYSQL.user, password: MYSQL.password })
    // the current server (2, the last login) is logged out, server 1 stays
    const out = await t.req('POST', '/api/auth/logout')
    expect(out.json).toMatchObject({ ok: true, server: 1 })
    expect((await t.req('GET', '/api/servers/2/home')).status).toBe(401)
    expect((await t.req('GET', '/api/servers/1/home')).json.partialLogout).toBe(true)
    expect((await t.req('GET', '/api/servers/1/home')).json.partialLogout).toBe(false)
  })
})
