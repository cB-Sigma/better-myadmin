import type { NavBranchResponse, NavPath, NavTreeResponse } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { compareLogs } from './lib/compare.ts'
import { GeneralLog } from './lib/general-log.ts'
import { type Entry, listFromJson, pathFromHtml, stateFromHtml } from './lib/nav-html.ts'
import { type PmaShadow, canStartShadow, startPmaShadow } from './lib/pma-shadow.ts'
import { PmaClient } from './lib/pma.ts'

/**
 * Golden parity of the navigation tree: the same /navigation request in phpMyAdmin (a private
 * instance of the reference, so directives can change per case) and in BetterMyAdmin must give the
 * same nodes (names, order, grouping, containers, links, paging, filters) and send the same SQL.
 *
 * Both tools log in as users that only see `m1nav\_%` databases (plus information_schema and
 * performance_schema), so databases created by other suites never show up.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const PMA_USER = 'm1nav_pma'
const BMA_USER = 'm1nav_bma'
const PORT = Number(process.env.BMA_PARITY_NAV_PORT ?? 18000 + (process.pid % 1000))
const dbMap = { [PMA_USER]: 'nav_user', [BMA_USER]: 'nav_user' }

const reachable = canStartShadow()

/** The navigation counts indexes with SHOW INDEXES: the grid's allowance does not apply here. */
const COMPARE = {
  exclude: ['^SHOW INDEXES FROM '],
  extra: [
    {
      tool: 'pma' as const,
      pattern: '^SHOW TABLES FROM `',
      why: 'DbTableExists check of the request `db` parameter (middleware), not the navigation.',
    },
  ],
}

const BIG_TABLES = 120

const SEED = `
CREATE DATABASE m1nav_a;
CREATE TABLE m1nav_a.t1 (id INT PRIMARY KEY, n VARCHAR(20) DEFAULT 'abcdefghij', u INT, UNIQUE KEY uq (u), KEY k2 (n, u));
CREATE TABLE m1nav_a.t2 (x INT);
CREATE TABLE m1nav_a.t10 (x INT);
CREATE TABLE m1nav_a.T3 (x INT);
CREATE TABLE m1nav_a.grp__one (x INT);
CREATE TABLE m1nav_a.grp__two (x INT);
CREATE TABLE m1nav_a.grp__sub__a (x INT);
CREATE TABLE m1nav_a.grp__sub__b (x INT);
CREATE TABLE m1nav_a.solo__x (x INT);
CREATE VIEW m1nav_a.v1 AS SELECT 1 AS one;
CREATE VIEW m1nav_a.v__2 AS SELECT 2 AS two;
CREATE PROCEDURE m1nav_a.p1() SELECT 1;
CREATE FUNCTION m1nav_a.f1() RETURNS INT DETERMINISTIC RETURN 1;
CREATE EVENT m1nav_a.e1 ON SCHEDULE EVERY 1 YEAR DISABLE DO SELECT 1;
CREATE TRIGGER m1nav_a.tr1 BEFORE INSERT ON m1nav_a.t1 FOR EACH ROW SET NEW.u = NEW.u;
CREATE DATABASE m1nav_b_1;
CREATE TABLE m1nav_b_1.only (x INT);
CREATE DATABASE m1nav_b_2;
CREATE DATABASE m1nav_c;
CREATE VIEW m1nav_c.vonly AS SELECT 1 AS x;
CREATE DATABASE m1nav_big;
${Array.from({ length: BIG_TABLES }, (_, i) => `CREATE TABLE m1nav_big.tbl_${i + 1} (x INT);`).join('\n')}
CREATE DATABASE m1nav_2;
CREATE DATABASE m1nav_2_x;
CREATE DATABASE m1nav_10;
`

type State = {
  pos?: number
  searchClause?: string
  db?: string
  paths?: NavPath[]
  reload?: boolean
}
type Branch = {
  path: string[]
  vPath?: string[]
  pos?: number
  pos2Name?: string
  pos2Value?: number
  pos3Name?: string
  pos3Value?: number
  searchClause?: string
  searchClause2?: string
}
interface Case {
  name: string
  cfg?: Record<string, unknown>
  server?: Record<string, unknown>
  state?: State
  branch?: Branch
  /** phpMyAdmin renders nothing (an empty database, a database not on the page). */
  empty?: true
}

const enc = (parts: string[]) => ['root', ...parts].map((p) => Buffer.from(p).toString('base64')).join('.')

function pmaParams(c: Case): Record<string, string> {
  const p: Record<string, string> = {}
  if (c.state !== undefined) {
    const s = c.state
    p[s.reload === true ? 'reload' : 'full'] = 'true'
    if (s.pos !== undefined) p.pos = String(s.pos)
    if (s.searchClause !== undefined) p.searchClause = s.searchClause
    if (s.db !== undefined) p.db = s.db
    ;(s.paths ?? []).forEach((path, i) => {
      p[`n${i}_aPath`] = enc(path.aPath)
      p[`n${i}_vPath`] = enc(path.vPath)
      if (path.pos2Name !== undefined) {
        p[`n${i}_pos2_name`] = path.pos2Name
        p[`n${i}_pos2_value`] = String(path.pos2Value ?? 0)
      }
      if (path.pos3Name !== undefined) {
        p[`n${i}_pos3_name`] = path.pos3Name
        p[`n${i}_pos3_value`] = String(path.pos3Value ?? 0)
      }
    })
  } else if (c.branch !== undefined) {
    const b = c.branch
    if (b.path.length > 0) {
      p.aPath = enc(b.path)
      p.vPath = enc(b.vPath ?? b.path)
    }
    p.pos = String(b.pos ?? 0)
    if (b.pos2Name !== undefined) p.pos2_name = b.pos2Name
    if (b.pos2Value !== undefined) p.pos2_value = String(b.pos2Value)
    if (b.pos3Name !== undefined) p.pos3_name = b.pos3Name
    if (b.pos3Value !== undefined) p.pos3_value = String(b.pos3Value)
    if (b.searchClause !== undefined) p.searchClause = b.searchClause
    if (b.searchClause2 !== undefined) p.searchClause2 = b.searchClause2
  }
  return p
}

function branchQuery(b: Branch): string {
  const q = new URLSearchParams()
  for (const part of b.path) q.append('path', part)
  q.set('pos', String(b.pos ?? 0))
  for (const k of [
    'pos2Name',
    'pos2Value',
    'pos3Name',
    'pos3Value',
    'searchClause',
    'searchClause2',
  ] as const) {
    if (b[k] !== undefined) q.set(k, String(b[k]))
  }
  return q.toString()
}

const t1 = ['m1nav_a', 'tables', 't1']

const CASES: Case[] = [
  { name: 'databases level with grouping and the New node [p01-a333a2]', state: {} },
  { name: 'expand a database with tables, views, routines and events', branch: { path: ['m1nav_a'] } },
  {
    name: 'expand Tables: natural order, "__" groups one level deep [p01-a333a2]',
    branch: { path: ['m1nav_a', 'tables'], pos2Name: 'tables', pos2Value: 0 },
  },
  { name: 'expand Views', branch: { path: ['m1nav_a', 'views'], pos2Name: 'views', pos2Value: 0 } },
  {
    name: 'expand Procedures',
    branch: { path: ['m1nav_a', 'procedures'], pos2Name: 'procedures', pos2Value: 0 },
  },
  {
    name: 'expand Functions',
    branch: { path: ['m1nav_a', 'functions'], pos2Name: 'functions', pos2Value: 0 },
  },
  { name: 'expand Events', branch: { path: ['m1nav_a', 'events'], pos2Name: 'events', pos2Value: 0 } },
  {
    name: 'expand a table: columns, indexes, triggers containers',
    branch: { path: t1, pos2Name: 'tables', pos2Value: 0 },
  },
  {
    name: 'expand Columns: key, type, truncated default, nullable [p01-60ce39]',
    branch: { path: [...t1, 'columns'], pos2Name: 'tables', pos2Value: 0, pos3Name: 'columns', pos3Value: 0 },
  },
  {
    name: 'expand Indexes (one node per index column)',
    branch: { path: [...t1, 'indexes'], pos2Name: 'tables', pos2Value: 0, pos3Name: 'indexes', pos3Value: 0 },
  },
  {
    name: 'expand Triggers',
    branch: {
      path: [...t1, 'triggers'],
      pos2Name: 'tables',
      pos2Value: 0,
      pos3Name: 'triggers',
      pos3Value: 0,
    },
  },
  {
    name: 'a database whose only container is Tables shows the tables directly [p01-5523b6]',
    branch: { path: ['m1nav_b_1'] },
  },
  { name: 'a database with only views', branch: { path: ['m1nav_c'] } },
  { name: 'an empty database', branch: { path: ['m1nav_b_2'] }, empty: true },
  {
    name: '120 tables: item filter, page selector at MaxNavigationItems [p01-41d435 p01-79ae51]',
    branch: { path: ['m1nav_big'] },
  },
  {
    name: 'tables page 3 (pos2_value=100)',
    branch: { path: ['m1nav_big', 'tables'], pos2Name: 'tables', pos2Value: 100 },
  },
  {
    name: 'item fast filter server search (searchClause2)',
    branch: { path: ['m1nav_big', 'tables'], pos2Name: 'tables', pos2Value: 0, searchClause2: 'tbl_1' },
  },
  { name: 'database fast filter server search (searchClause)', branch: { path: [], searchClause: 'b_' } },
  { name: 'database search with LIKE wildcards escaped', state: { searchClause: 'nav_' } },
  {
    name: 'state restore: several expanded branches with positions',
    state: {
      paths: [
        { aPath: ['m1nav_a', 'tables'], vPath: ['m1nav', 'a', 'Tables'], pos2Name: 'tables', pos2Value: 0 },
        {
          aPath: [...t1, 'columns'],
          vPath: ['m1nav', 'a', 'Tables', 't1', 'Columns'],
          pos2Name: 'tables',
          pos2Value: 0,
          pos3Name: 'columns',
          pos3Value: 0,
        },
        {
          aPath: ['m1nav_big', 'tables'],
          vPath: ['m1nav', 'big', 'Tables'],
          pos2Name: 'tables',
          pos2Value: 50,
        },
      ],
    },
  },
  {
    name: 'reload keeps the expanded branches [p01-b7e594]',
    state: { reload: true, paths: [{ aPath: ['m1nav_a'], vPath: ['m1nav', 'a'] }] },
  },
  {
    name: 'FirstLevelNavigationItems=2 pages by prefix and shows the db filter at 3 [p01-41d435 p01-79ae51]',
    cfg: { FirstLevelNavigationItems: 2, NavigationTreeDisplayDbFilterMinimum: 3 },
    state: { pos: 2 },
  },
  {
    name: 'initial page computed from the current database [p01-41d435]',
    cfg: { FirstLevelNavigationItems: 2 },
    state: { db: 'performance_schema' },
  },
  {
    name: 'grouping disabled',
    cfg: { NavigationTreeEnableGrouping: false, FirstLevelNavigationItems: 3 },
    state: { pos: 3 },
  },
  {
    name: 'table grouping disabled',
    cfg: { NavigationTreeEnableGrouping: false },
    branch: { path: ['m1nav_a', 'tables'], pos2Name: 'tables', pos2Value: 0 },
  },
  {
    name: 'several table separators and two group levels [p01-a333a2]',
    cfg: { NavigationTreeTableSeparator: ['__', '1'], NavigationTreeTableLevel: 2 },
    branch: { path: ['m1nav_a', 'tables'], pos2Name: 'tables', pos2Value: 0 },
  },
  {
    name: 'NaturalOrder off, second table icon, default tab Structure [p01-d23a2e]',
    cfg: { NaturalOrder: false, NavigationTreeDefaultTabTable2: 'browse', DefaultTabTable: 'structure' },
    branch: { path: ['m1nav_a', 'tables'], pos2Name: 'tables', pos2Value: 0 },
  },
  {
    name: 'NavigationTreeShow* switches',
    cfg: {
      NavigationTreeShowViews: false,
      NavigationTreeShowEvents: false,
      NavigationTreeShowFunctions: false,
    },
    branch: { path: ['m1nav_a'] },
  },
  {
    name: 'NavigationTreeEnableExpansion off: no expanders, no grouping',
    cfg: { NavigationTreeEnableExpansion: false },
    state: { paths: [{ aPath: ['m1nav_a'], vPath: ['m1nav', 'a'] }] },
  },
  { name: 'another database separator', cfg: { NavigationTreeDbSeparator: 'nav_' }, state: {} },
  {
    name: 'item filter at NavigationTreeDisplayItemFilterMinimum [p01-79ae51]',
    cfg: { NavigationTreeDisplayItemFilterMinimum: 2, MaxNavigationItems: 3 },
    branch: { path: ['m1nav_a', 'tables'], pos2Name: 'tables', pos2Value: 3 },
  },
  { name: 'hide_db (NOT REGEXP)', server: { hide_db: '^m1nav_b' }, state: {} },
  { name: 'only_db list (LIKE … OR …)', server: { only_db: ['m1nav\\_a', 'm1nav\\_2%'] }, state: {} },
  { name: 'DisableIS: SHOW DATABASES LIKE per granted pattern', server: { DisableIS: true }, state: {} },
  {
    name: 'DisableIS: paging by prefix',
    server: { DisableIS: true },
    cfg: { FirstLevelNavigationItems: 2 },
    state: { pos: 2 },
  },
  {
    name: 'DisableIS without grouping',
    server: { DisableIS: true },
    cfg: { NavigationTreeEnableGrouping: false, FirstLevelNavigationItems: 4 },
    state: { pos: 4 },
  },
  {
    name: 'DisableIS: database children via SHOW FULL TABLES / SHOW … STATUS / SHOW EVENTS',
    server: { DisableIS: true },
    branch: { path: ['m1nav_a'] },
  },
  {
    name: 'DisableIS: columns via SHOW COLUMNS',
    server: { DisableIS: true },
    branch: { path: [...t1, 'columns'], pos2Name: 'tables', pos2Value: 0, pos3Name: 'columns', pos3Value: 0 },
  },
  {
    name: 'DisableIS: triggers via SHOW TRIGGERS',
    server: { DisableIS: true },
    branch: {
      path: [...t1, 'triggers'],
      pos2Name: 'tables',
      pos2Value: 0,
      pos3Name: 'triggers',
      pos3Value: 0,
    },
  },
  {
    name: 'DisableIS: database search',
    server: { DisableIS: true },
    branch: { path: [], searchClause: 'big' },
  },
  {
    name: 'a database not on the current page cannot be expanded',
    branch: { path: ['m1nav_a'], pos: 100 },
    empty: true,
  },
]

describe.skipIf(!reachable)('parity: navigation tree (/navigation vs /navigation/tree|branch)', () => {
  let log: GeneralLog
  let shadow: PmaShadow
  let root: mysql.Connection

  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    const [dbs] = await root.query("SHOW DATABASES LIKE 'm1nav\\_%'")
    for (const r of dbs as Array<Record<string, string>>) {
      await root.query(`DROP DATABASE \`${Object.values(r)[0]}\``)
    }
    await root.query(SEED)
    for (const u of [PMA_USER, BMA_USER]) {
      await root.query(
        `DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON \`m1nav\\_%\`.* TO '${u}'@'%'; GRANT ALL ON \`m1nav\\_2%\`.* TO '${u}'@'%'; GRANT ALL ON \`m1nav\\_10\`.* TO '${u}'@'%'`,
      )
    }
    log = await GeneralLog.open(ROOT)
    // the private reference instance: pmadb hiding off (it lives in the metadata layer, tested there)
    shadow = await startPmaShadow(PORT, { server: { navigationhiding: false } })
  }, 120000)

  afterAll(async () => {
    await shadow?.stop()
    const [dbs] = (await root?.query("SHOW DATABASES LIKE 'm1nav\\_%'")) ?? [[]]
    for (const r of dbs as Array<Record<string, string>>) {
      await root.query(`DROP DATABASE \`${Object.values(r)[0]}\``)
    }
    await root?.query(`DROP USER IF EXISTS '${PMA_USER}'@'%'; DROP USER IF EXISTS '${BMA_USER}'@'%'`)
    await root?.end()
    await log?.close()
  })

  for (const c of CASES) {
    it(c.name, async () => {
      shadow.configure({ ...(c.cfg ? { cfg: c.cfg } : {}), ...(c.server ? { server: c.server } : {}) })
      const pma = new PmaClient(shadow.url)
      await pma.login(PMA_USER, PMA_USER)
      const bma = testApp(testConfig(c.cfg ?? {}, c.server ?? {}))
      try {
        await bma.login(BMA_USER, BMA_USER)
        // phpMyAdmin's login renders the home page: let its statements reach the log first
        await log.settle(PMA_USER)
        await log.settle(BMA_USER)

        const m1 = await log.marker()
        const pr = await pma.postJson('/index.php?route=/navigation&ajax_request=1', pmaParams(c))
        const pmaLog = await log.since(PMA_USER, m1)
        expect(pr.success, JSON.stringify(pr)).toBe(true)

        const m2 = await log.marker()
        let bmaEntries: Entry[]
        let pmaEntries: Entry[]
        if (c.state !== undefined) {
          const s = c.state
          const r =
            s.paths === undefined && s.reload === undefined
              ? await bma.req(
                  'GET',
                  `/api/servers/1/navigation/tree?${new URLSearchParams(
                    Object.entries({ pos: s.pos, searchClause: s.searchClause, db: s.db })
                      .filter(([, v]) => v !== undefined)
                      .map(([k, v]) => [k, String(v)]),
                  )}`,
                )
              : await bma.req('POST', '/api/servers/1/navigation/tree', s)
          expect(r.status, JSON.stringify(r.json)).toBe(200)
          bmaEntries = listFromJson((r.json as unknown as NavTreeResponse).tree)
          pmaEntries = stateFromHtml(pr.message ?? '')
        } else {
          const r = await bma.req(
            'GET',
            `/api/servers/1/navigation/branch?${branchQuery(c.branch as Branch)}`,
          )
          expect(r.status, JSON.stringify(r.json)).toBe(200)
          const body = r.json as unknown as NavBranchResponse
          bmaEntries = body.list === null ? [] : listFromJson(body.list)
          pmaEntries = pathFromHtml(pr.message ?? '')
          if (body.error !== null) expect(pr.message).toContain(body.error)
          // the count is in the JSON (`results`) whenever a search clause was sent
          expect(body.results ?? undefined).toBe(pr.results)
        }
        const bmaLog = await log.since(BMA_USER, m2)

        expect(pmaEntries.length > 0, 'phpMyAdmin rendered nodes').toBe(c.empty !== true)
        expect(bmaEntries).toEqual(pmaEntries)
        const cmp = compareLogs(pmaLog, bmaLog, dbMap, COMPARE)
        expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
      } finally {
        await bma.close()
      }
    })
  }
})
