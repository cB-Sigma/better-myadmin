import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { getCreateTableSqlQueries } from '../../packages/metadata/src/resources.ts'
import { compareMetadataLogs } from './lib/compare.ts'
import { GeneralLog, type LogEntry } from './lib/general-log.ts'
import { type PmaInstance, phpAvailable, startPmaInstance } from './lib/pma-instance.ts'
import { PmaClient, visibleText } from './lib/pma.ts'

/**
 * Golden parity for the configuration storage: the same action in a private phpMyAdmin
 * instance (reference checkout, own config.inc.php) and in BetterMyAdmin, each with its own pmadb
 * and control user, then the pmadb rows and the statements on both links are diffed.
 * Only m1meta_* databases and users are touched.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const P = {
  user: 'm1meta_pma',
  ctl: 'm1meta_pctl',
  pmadb: 'm1meta_pmadb_p',
  db: 'm1meta_dp',
  zc: 'm1meta_zc_p',
}
const B = {
  user: 'm1meta_bma',
  ctl: 'm1meta_bctl',
  pmadb: 'm1meta_pmadb_b',
  db: 'm1meta_db',
  zc: 'm1meta_zc_b',
}
// longest names first: m1meta_pma is a prefix of m1meta_pmadb_p
const dbMap: Record<string, string> = {
  [P.pmadb]: 'PMADB',
  [B.pmadb]: 'PMADB',
  [P.zc]: 'ZC',
  [B.zc]: 'ZC',
  [P.ctl]: 'CTL',
  [B.ctl]: 'CTL',
  [P.user]: 'USER',
  [B.user]: 'USER',
  [P.db]: 'DB',
  [B.db]: 'DB',
}
const norm = (s: string) => {
  let out = s
  for (const [from, to] of Object.entries(dbMap)) out = out.replaceAll(from, to)
  return out.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/g, '<TS>')
}

const SETTINGS = { QueryHistoryDB: true, QueryHistoryMax: 3, NumFavoriteTables: 3 }

function pmaConfig(x: typeof P, server: Record<string, string | boolean> = {}): string {
  const lines = Object.entries({ controluser: x.ctl, controlpass: x.ctl, pmadb: x.pmadb, ...server }).map(
    ([k, v]) =>
      `$cfg['Servers'][$i][${JSON.stringify(k)}] = ${typeof v === 'boolean' ? String(v) : JSON.stringify(v)};`,
  )
  return `$cfg['blowfish_secret'] = 'm1meta-parity-secret-0123456789abcdef';
$i = 1;
$cfg['Servers'][$i]['host'] = ${JSON.stringify(ROOT.host)};
$cfg['Servers'][$i]['port'] = ${JSON.stringify(String(ROOT.port))};
$cfg['Servers'][$i]['auth_type'] = 'cookie';
${lines.join('\n')}
$cfg['QueryHistoryDB'] = true;
$cfg['QueryHistoryMax'] = 3;
$cfg['NumFavoriteTables'] = 3;`
}

const available = phpAvailable()

let root: mysql.Connection
let log: GeneralLog

async function createStorage(db: string, only?: string[]) {
  await root.query(`DROP DATABASE IF EXISTS \`${db}\``)
  await root.query(`CREATE DATABASE \`${db}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`)
  await root.query(`USE \`${db}\``)
  for (const [name, sql] of Object.entries(getCreateTableSqlQueries({}))) {
    if (only === undefined || only.includes(name)) await root.query(sql)
  }
}

async function dump(x: typeof P, table: string): Promise<unknown[]> {
  const [cols] = (await root.query(`SHOW COLUMNS FROM \`${x.pmadb}\`.\`${table}\``)) as unknown as [
    Array<{ Field: string }>,
  ]
  const keep = cols.map((c) => c.Field).filter((f) => f !== 'timevalue' && f !== 'last_update')
  const [rows] = (await root.query(
    `SELECT ${keep.map((c) => `\`${c}\``).join(', ')} FROM \`${x.pmadb}\`.\`${table}\` ORDER BY ${keep.map((c) => `\`${c}\``).join(', ')}`,
  )) as unknown as [Array<Record<string, unknown>>]
  return rows.map((r) => JSON.parse(norm(JSON.stringify(r))))
}

/** The SQL tab form (sql/query.twig) posted to /import. */
function sqlBoxForm(sql: string, db: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    route: '/import',
    db,
    table: '',
    is_js_confirmed: '0',
    pos: '0',
    goto: '/database/sql',
    message_to_show: 'Your SQL query has been executed successfully.',
    prev_sql_query: '',
    sql_query: sql,
    sql_delimiter: ';',
    fk_checks: '1',
    SQL: 'Go',
    ajax_page_request: 'true',
    ...extra,
  }
}

type Bma = ReturnType<typeof testApp>

interface Step {
  name: string
  pma: (p: PmaClient) => Promise<unknown>
  bma: (b: Bma) => Promise<unknown>
  /** pmadb tables compared after the step */
  tables: string[]
  /** extra checks on both answers */
  check?: (pma: Record<string, unknown>, bma: Record<string, unknown>) => void
}

async function runStep(pma: PmaClient, bma: Bma, s: Step) {
  const m1 = await log.marker()
  const pr = (await s.pma(pma)) as Record<string, unknown>
  const pmaLog: LogEntry[] = [...(await log.since(P.ctl, m1)), ...(await log.since(P.user, m1))]
  const m2 = await log.marker()
  const br = (await s.bma(bma)) as Record<string, unknown>
  const bmaLog: LogEntry[] = [...(await log.since(B.ctl, m2)), ...(await log.since(B.user, m2))]
  const cmp = compareMetadataLogs(pmaLog, bmaLog, dbMap)
  expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
  for (const t of s.tables) expect(await dump(B, t), `${t} rows`).toEqual(await dump(P, t))
  s.check?.(pr, br)
}

const pmaText = (r: Record<string, unknown>) => visibleText(String(r.message ?? r.error ?? ''))
const bmaMsg = (r: Record<string, unknown>) => {
  const json = (r.json ?? r) as Record<string, unknown>
  const m = json.message as { text?: string } | string | undefined
  return typeof m === 'string' ? m : (m?.text ?? '')
}

describe.skipIf(!available)('parity: configuration storage (pmadb) rows and statements', () => {
  let inst: PmaInstance
  let pma: PmaClient
  let bma: Bma
  let ids: { pma: Record<string, number>; bma: Record<string, number> }

  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    log = await GeneralLog.open(ROOT)
    for (const x of [P, B]) {
      await createStorage(x.pmadb)
      await root.query(`DROP DATABASE IF EXISTS ${x.db}; CREATE DATABASE ${x.db};
        CREATE TABLE ${x.db}.t (id INT PRIMARY KEY, name VARCHAR(20));
        CREATE TABLE ${x.db}.t2 (id INT PRIMARY KEY);
        CREATE TABLE ${x.db}.t3 (id INT PRIMARY KEY);
        CREATE VIEW ${x.db}.v AS SELECT id FROM ${x.db}.t;
        INSERT INTO ${x.db}.t VALUES (1, 'a'), (2, 'b');
        ANALYZE TABLE ${x.db}.t;`)
      // information_schema caches CREATE_TIME (information_schema_stats_expiry): ANALYZE refreshes
      // it, so every session reads the creation time of this incarnation of the table
      for (const u of [x.user, x.ctl]) {
        await root.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'`)
      }
      await root.query(`GRANT ALL ON \`${x.db}\`.* TO '${x.user}'@'%'`)
      await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, ALTER ON \`${x.pmadb}\`.* TO '${x.ctl}'@'%'`)
      await root.query(`GRANT ALL ON \`${x.zc}\`.* TO '${x.ctl}'@'%'`)
    }
    inst = await startPmaInstance(pmaConfig(P), { dumpState: true })
    pma = new PmaClient(inst.url)
    await pma.login(P.user, P.user)
    bma = testApp(
      testConfig({ ...SETTINGS, DataDir: '' }, { controluser: B.ctl, controlpass: B.ctl, pmadb: B.pmadb }),
    )
    const r = await bma.login(B.user, B.user)
    expect(r.status).toBe(200)
    // phpMyAdmin's home page (login response) renders the navigation's recent / favorite lists,
    // loading them into its session; the SPA's navigation does the same request
    await bma.req('GET', '/api/servers/1/recent-favorite')
    ids = { pma: {}, bma: {} }
  })

  afterAll(async () => {
    await bma?.close()
    await inst?.stop()
    for (const x of [P, B]) {
      await root?.query(
        `DROP DATABASE IF EXISTS ${x.pmadb}; DROP DATABASE IF EXISTS ${x.db}; DROP DATABASE IF EXISTS ${x.zc};`,
      )
      for (const u of [x.user, x.ctl]) await root?.query(`DROP USER IF EXISTS '${u}'@'%'`)
    }
    await root?.end()
    await log?.close()
  })

  // -------------------------------------------------------------------------------------------
  // favorites (pma: /database/structure/favorite-table)
  // -------------------------------------------------------------------------------------------
  const fav = (action: 'add' | 'remove', table: string): Step => ({
    name: `favorite ${action} ${table}`,
    pma: (p) =>
      p.ajax('/index.php?route=/database/structure/favorite-table', {
        db: P.db,
        favorite_table: table,
        [`${action}_favorite`]: 'true',
        favoriteTables: '{}',
      }),
    bma: async (b) =>
      (await b.req('POST', '/api/servers/1/favorites', { db: B.db, table, action, favoriteTables: '{}' }))
        .json,
    tables: ['pma__favorite'],
    check: (pr, br) => {
      expect(br.changes).toBe(pr.changes)
      if (pr.changes === false) expect(pmaText(pr)).toContain(bmaMsg(br))
      else {
        // localStorage payload: same lists under each user's sha1
        const pf = Object.values(JSON.parse(String(pr.favoriteTables)) as object)[0]
        const bf = Object.values(JSON.parse(String(br.favoriteTables)) as object)[0]
        expect(norm(JSON.stringify(bf))).toBe(norm(JSON.stringify(pf)))
      }
    },
  })
  for (const s of [
    fav('add', 't'),
    fav('add', 't2'),
    fav('add', 'v'),
    fav('add', 't3'),
    fav('remove', 'v'),
    fav('add', 't3'),
  ]) {
    it(s.name, () => runStep(pma, bma, s))
  }

  // -------------------------------------------------------------------------------------------
  // recent tables (pma: RecentTableHandling on any request with db + table)
  // -------------------------------------------------------------------------------------------
  const recent = (table: string): Step => ({
    name: `recent table ${table}`,
    pma: (p) => p.request(`/index.php?route=/table/sql&db=${P.db}&table=${table}&ajax_request=true`),
    bma: async (b) => (await b.req('POST', '/api/servers/1/recent', { db: B.db, table })).json,
    tables: ['pma__recent'],
  })
  for (const s of [recent('t2'), recent('t'), recent('v'), recent('t')])
    it(s.name, () => runStep(pma, bma, s))

  // -------------------------------------------------------------------------------------------
  // bookmarks
  // -------------------------------------------------------------------------------------------
  const storeBkm = (label: string, query: string, shared: boolean): Step => ({
    name: `bookmark this SQL query (${label}${shared ? ', shared' : ''})`,
    pma: (p) =>
      p.ajax('/index.php?route=/sql', {
        db: P.db,
        goto: 'index.php?route=/sql',
        'bkm_fields[bkm_database]': P.db,
        'bkm_fields[bkm_label]': label,
        'bkm_fields[bkm_sql_query]': query,
        'bkm_fields[bkm_user]': P.user,
        store_bkm: '1',
        ...(shared ? { bkm_all_users: 'true' } : {}),
      }),
    bma: async (b) =>
      (await b.req('POST', '/api/servers/1/bookmarks', { db: B.db, label, query, shared })).json,
    tables: ['pma__bookmark'],
    check: (pr, br) => expect(pmaText(pr)).toBe(bmaMsg(br)),
  })
  for (const s of [
    storeBkm('b1', 'SELECT * FROM t', false),
    storeBkm('by id', 'SELECT name FROM t WHERE id = /*[VARIABLE1]*/', true),
  ]) {
    it(s.name, () => runStep(pma, bma, s))
  }

  it('console: add bookmark (/console/bookmark/add)', () =>
    runStep(pma, bma, {
      name: 'console add',
      pma: (p) =>
        p.ajax('/index.php?route=/console/bookmark/add', {
          db: P.db,
          label: 'from console',
          bookmark_query: 'SELECT 2',
          shared: 'false',
        }),
      bma: async (b) =>
        (
          await b.req('POST', '/api/servers/1/console/bookmarks', {
            db: B.db,
            label: 'from console',
            bookmark_query: 'SELECT 2',
          })
        ).json,
      tables: ['pma__bookmark'],
      check: (pr, br) => {
        expect(br.message).toBe(pr.message)
        expect(JSON.parse(norm(JSON.stringify(br.data)))).toEqual(JSON.parse(norm(JSON.stringify(pr.data))))
      },
    }))

  it('SQL box with bkm_label + bkm_replace replaces same-label bookmarks', () =>
    runStep(pma, bma, {
      name: 'replace',
      pma: (p) =>
        p.ajax(
          '/index.php?route=/import',
          sqlBoxForm('SELECT 1', P.db, { bkm_label: 'b1', bkm_replace: '1', no_history: 'true' }),
        ),
      bma: async (b) => {
        await b.req('POST', '/api/servers/1/query', { sql: 'SELECT 1', db: B.db, noHistory: true })
        return (
          await b.req('POST', '/api/servers/1/bookmarks', {
            db: B.db,
            label: 'b1',
            query: 'SELECT 1',
            replace: true,
          })
        ).json
      },
      tables: ['pma__bookmark'],
    }))

  it('run a bookmark with variables (/import id_bookmark, action_bookmark=0)', async () => {
    const id = async (x: typeof P) =>
      Number(
        (
          (await root.query(`SELECT id FROM ${x.pmadb}.pma__bookmark WHERE label = 'by id'`))[0] as Array<{
            id: number
          }>
        )[0]?.id,
      )
    ids.pma.byId = await id(P)
    ids.bma.byId = await id(B)
    await runStep(pma, bma, {
      name: 'run',
      pma: (p) =>
        p.ajax(
          '/index.php?route=/import',
          sqlBoxForm('', P.db, {
            id_bookmark: String(ids.pma.byId),
            action_bookmark: '0',
            'bookmark_variable[1]': '2',
            no_history: 'true',
          }),
        ),
      bma: async (b) =>
        (
          await b.req('POST', `/api/servers/1/bookmarks/${ids.bma.byId}/run`, {
            db: B.db,
            variables: { '1': '2' },
            noHistory: true,
          })
        ).json,
      tables: [],
      check: (pr, br) => {
        const st = (br.statements as Array<{ sql: string; message: { text: string } }>)[0]!
        expect(st.sql).toBe('SELECT name FROM t WHERE id = 2;')
        expect(visibleText(String(pr.message))).toContain('SELECT name FROM t WHERE id = 2')
      },
    })
  })

  it('delete a bookmark (/import action_bookmark=2)', () =>
    runStep(pma, bma, {
      name: 'delete',
      pma: (p) =>
        p.ajax(
          '/index.php?route=/import',
          sqlBoxForm('', P.db, { id_bookmark: String(ids.pma.byId), action_bookmark: '2' }),
        ),
      bma: async (b) => (await b.req('POST', `/api/servers/1/bookmarks/${ids.bma.byId}/delete`)).json,
      tables: ['pma__bookmark'],
      check: (pr, br) => expect(pmaText(pr)).toBe(bmaMsg(br)),
    }))

  // -------------------------------------------------------------------------------------------
  // SQL history: what StatementHistory records (phpMyAdmin keeps it in $_SESSION['sql_history'];
  // see docs/reference/parity-exceptions.md for why it never reaches pma__history in master)
  // -------------------------------------------------------------------------------------------
  const HISTORY: Array<{ sql: string; db?: string; table?: string; delimiter?: string }> = [
    { sql: 'SELECT 1; SELECT * FROM t' },
    { sql: 'SELECT * FROM t2', table: 't' },
    { sql: 'SELECT 1; SELECT * FROM missing; SELECT 3' },
    { sql: 'DELIMITER //\nSELECT 4 //\nSELECT 5 //' },
    { sql: '  SELECT   6  ' },
    { sql: `USE ${'DB'}; SELECT 7`, db: '' },
  ]
  for (const h of HISTORY) {
    it(`history entry for ${JSON.stringify(h.sql)}`, async () => {
      const sqlFor = (x: typeof P) => h.sql.replaceAll('DB', x.db)
      const m1 = await log.marker()
      await pma.ajax(
        '/index.php?route=/import',
        sqlBoxForm(sqlFor(P), h.db ?? P.db, { table: h.table ?? '', sql_delimiter: h.delimiter ?? ';' }),
      )
      const pmaCtl = await log.since(P.ctl, m1)
      const last = inst.dumps().at(-1)?.sqlHistory?.at(-1)
      await bma.req('POST', '/api/servers/1/query', {
        sql: sqlFor(B),
        db: h.db ?? B.db,
        table: h.table ?? '',
        fromQueryBox: true,
      })
      const hist = (await bma.req('GET', '/api/servers/1/sql/history')).json.history as Array<{
        db: string
        table: string
        sqlquery: string
      }>
      const mine = hist[0]!
      expect(norm(JSON.stringify({ db: mine.db, table: mine.table, sqlquery: mine.sqlquery }))).toBe(
        norm(JSON.stringify(last)),
      )
      // phpMyAdmin master never inserts into pma__history (History is built before the storage
      // is initialised); BetterMyAdmin does, as History::setHistory is written
      expect(pmaCtl.filter((e) => /^INSERT INTO .*pma__history/.test(e.sql))).toEqual([])
    })
  }

  // -------------------------------------------------------------------------------------------
  // table UI preferences (pma: /sql/set-column-preferences)
  // -------------------------------------------------------------------------------------------
  const createTime = async (x: typeof P) =>
    String(
      (
        (
          await root.query(
            `SELECT CAST(CREATE_TIME AS CHAR) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${x.db}' AND TABLE_NAME = 't'`,
          )
        )[0] as Array<{ c: string }>
      )[0]?.c,
    )
  const colPrefs = (name: string, order: string, visib: string, stale = false): Step => ({
    name,
    pma: async (p) =>
      p.ajax('/index.php?route=/sql/set-column-preferences', {
        db: P.db,
        table: 't',
        col_order: order,
        col_visib: visib,
        table_create_time: stale ? '1999-01-01 00:00:00' : await createTime(P),
      }),
    bma: async (b) =>
      (
        await b.req('POST', `/api/servers/1/databases/${B.db}/tables/t/uiprefs`, {
          col_order: order,
          col_visib: visib,
          table_create_time: stale ? '1999-01-01 00:00:00' : await createTime(B),
        })
      ).json,
    tables: ['pma__table_uiprefs'],
    check: (pr, br) => {
      expect(br.success).toBe(pr.success)
      if (pr.success === false) expect(pmaText(pr)).toBe(bmaMsg(br))
    },
  })
  for (const s of [
    colPrefs('column order and visibility', '1,0', '1,0'),
    colPrefs('column order again', '0,1', '1,1'),
    colPrefs('stale table_create_time is refused', '1,0', '1,0', true),
  ]) {
    it(s.name, async () => {
      // phpMyAdmin's table pages (the recent-table steps above) already loaded `t`'s UI prefs into
      // its session; the SPA's grid reads them when it opens the table
      await bma.req('GET', `/api/servers/1/databases/${B.db}/tables/t/uiprefs`)
      // `t` is already the most recent table, so phpMyAdmin's RecentTableHandling writes nothing
      await runStep(pma, bma, s)
    })
  }

  // -------------------------------------------------------------------------------------------
  // navigation hiding (pma: /navigation hideNavItem / unhideNavItem)
  // -------------------------------------------------------------------------------------------
  const nav = (action: 'hide' | 'unhide', itemName: string, itemType: string): Step => ({
    name: `${action} ${itemType} ${itemName}`,
    pma: (p) =>
      p.ajax('/index.php?route=/navigation', {
        [`${action}NavItem`]: 'true',
        itemName,
        itemType,
        dbName: P.db,
      }),
    bma: async (b) =>
      (await b.req('POST', `/api/servers/1/navigation/${action}`, { itemName, itemType, dbName: B.db })).json,
    tables: ['pma__navigationhiding'],
  })
  for (const s of [nav('hide', 't', 'table'), nav('hide', 'v', 'view'), nav('unhide', 't', 'table')]) {
    it(s.name, () => runStep(pma, bma, s))
  }

  // -------------------------------------------------------------------------------------------
  // user preferences (pma: /console/update-config → setUserValue, /preferences/manage reset)
  // -------------------------------------------------------------------------------------------
  const consoleCfg = (
    key: string,
    value: string,
    path = `Console/${key}`,
    bValue: unknown = value,
  ): Step => ({
    name: `console setting ${key}=${value}`,
    pma: (p) => p.ajax('/index.php?route=/console/update-config', { key, value }),
    bma: async (b) => (await b.req('POST', '/api/servers/1/prefs/option', { path, value: bValue })).json,
    tables: ['pma__userconfig'],
  })
  for (const s of [
    consoleCfg('Mode', 'collapse'),
    consoleCfg('Height', '150', 'Console/Height', 150),
    consoleCfg('Mode', 'info'),
  ]) {
    it(s.name, () => runStep(pma, bma, s))
  }

  it('reset all settings (/preferences/manage submit_clear)', () =>
    runStep(pma, bma, {
      name: 'reset',
      pma: async (p) => {
        await p.request('/index.php?route=/preferences/manage', {
          submit_clear: '1',
          token: p.token,
          server: '1',
        })
        return {}
      },
      bma: async (b) => (await b.req('POST', '/api/servers/1/prefs/reset')).json,
      tables: ['pma__userconfig'],
    }))
})

// ---------------------------------------------------------------------------------------------
// Storage creation (pma: /check-relations)
// ---------------------------------------------------------------------------------------------
describe.skipIf(!available)('parity: creating the configuration storage', () => {
  let inst: PmaInstance

  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    log = await GeneralLog.open(ROOT)
    for (const x of [P, B]) {
      await root.query(`DROP DATABASE IF EXISTS ${x.db}; CREATE DATABASE ${x.db}`)
      for (const u of [x.user, x.ctl]) {
        await root.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'`)
      }
      await root.query(`GRANT ALL ON \`${x.db}\`.* TO '${x.user}'@'%'`)
      await root.query(`GRANT ALL ON \`${x.zc}\`.* TO '${x.ctl}'@'%'`)
      await root.query(`GRANT ALL ON \`${x.zc}\`.* TO '${x.user}'@'%'`)
    }
    inst = await startPmaInstance(pmaConfig(P))
  })

  afterAll(async () => {
    await inst?.stop()
    for (const x of [P, B]) {
      await root?.query(`DROP DATABASE IF EXISTS ${x.db}; DROP DATABASE IF EXISTS ${x.zc};`)
      for (const u of [x.user, x.ctl]) await root?.query(`DROP USER IF EXISTS '${u}'@'%'`)
    }
    await root?.end()
    await log?.close()
  })

  const tablesOf = async (db: string) =>
    ((await root.query(`SHOW TABLES FROM \`${db}\``))[0] as Array<Record<string, string>>).map(
      (r) => Object.values(r)[0],
    )

  async function scenario(opts: {
    server: (x: typeof P) => Record<string, string | boolean>
    prepare: (x: typeof P) => Promise<void>
    action: 'fix_pmadb' | 'fixall_pmadb'
    db: (x: typeof P) => string
  }) {
    for (const x of [P, B]) await opts.prepare(x)
    inst.setConfig(pmaConfig(P, opts.server(P)))
    const pma = new PmaClient(inst.url)
    await pma.login(P.user, P.user)
    const bma = testApp(
      testConfig(
        { ...SETTINGS, DataDir: '' },
        { controluser: B.ctl, controlpass: B.ctl, pmadb: '', ...opts.server(B) },
      ),
    )
    await bma.login(B.user, B.user)
    try {
      // the check page offers the same action
      const page = visibleText(await pma.request(`/index.php?route=/check-relations&db=${opts.db(P)}`))
      const status = await bma.req('GET', `/api/servers/1/metadata-storage/status?db=${opts.db(B)}`)
      expect(status.json.offer).toBe(opts.action)
      expect(page).toContain(
        opts.action === 'fix_pmadb'
          ? 'Create missing phpMyAdmin configuration storage tables.'
          : 'Create the phpMyAdmin configuration storage in the current database.',
      )
      const m1 = await log.marker()
      await pma.request('/index.php?route=/check-relations', {
        db: opts.db(P),
        [opts.action]: '1',
        goto: 'index.php?route=/database/operations',
        token: pma.token,
        server: '1',
      })
      const pmaLog = await log.since(P.ctl, m1)
      const m2 = await log.marker()
      const r = await bma.req('POST', '/api/servers/1/metadata-storage/create', {
        action: opts.action,
        db: opts.db(B),
      })
      const bmaLog = await log.since(B.ctl, m2)
      expect(r.json.message).toBeNull()
      const cmp = compareMetadataLogs(pmaLog, bmaLog, dbMap)
      expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
      expect(await tablesOf(B.zc)).toEqual(await tablesOf(P.zc))
    } finally {
      await bma.close()
    }
  }

  it('fix_pmadb: create the missing tables (every table name configured, custom names kept)', () =>
    scenario({
      action: 'fix_pmadb',
      db: () => '',
      server: (x) => ({
        pmadb: x.zc,
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
        tracking: 'pma__tracking',
        userconfig: 'pma__userconfig',
        users: 'pma__users',
        usergroups: 'pma__usergroups',
        navigationhiding: 'pma__navigationhiding',
        savedsearches: 'pma__savedsearches',
        central_columns: 'pma__central_columns',
        designer_settings: 'pma__designer_settings',
        export_templates: 'pma__export_templates',
      }),
      prepare: (x) => createStorage(x.zc, ['pma__bookmark', 'pma__relation', 'pma__userconfig']),
    }))

  it('fixall_pmadb: create the storage in the current database (ZeroConf)', () =>
    scenario({
      action: 'fixall_pmadb',
      db: (x) => x.zc,
      server: () => ({ pmadb: '' }),
      prepare: async (x) => {
        await root.query(`DROP DATABASE IF EXISTS ${x.zc}; CREATE DATABASE ${x.zc}`)
      },
    }))
})
