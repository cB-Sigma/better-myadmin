import type { NavBranchResponse, NavList, NavNode, NavTreeResponse } from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import { translatorFor } from '@bettermyadmin/i18n/node'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'
import { hasPerformanceSchema, isMariaDb } from '../support/vendor.ts'

/** A user that only sees `m1nav\_it%` databases (plus information_schema / performance_schema). */
const USER = 'm1nav_it'

/** the first-level databases besides ours (MariaDB has performance_schema off by default) */
const SYSTEM_DBS = hasPerformanceSchema ? ['performance_schema'] : []

const SEED = `
CREATE DATABASE m1nav_it_a;
CREATE TABLE m1nav_it_a.t1 (id INT PRIMARY KEY, name VARCHAR(30) DEFAULT 'a long default', u INT UNIQUE);
CREATE TABLE m1nav_it_a.t2 (x INT);
CREATE TABLE m1nav_it_a.t10 (x INT);
CREATE TABLE m1nav_it_a.log__a (x INT);
CREATE TABLE m1nav_it_a.log__b (x INT);
CREATE VIEW m1nav_it_a.v1 AS SELECT 1 AS one;
CREATE DATABASE m1nav_it_b;
CREATE TABLE m1nav_it_b.only (x INT);
CREATE DATABASE m1nav_it_large;
CREATE TABLE m1nav_it_large.other (x INT);
${Array.from({ length: 502 }, (_, i) => `CREATE TABLE m1nav_it_large.big__${i} (x INT);`).join('\n')}
`

let root: mysql.Connection

async function dropAll() {
  const [dbs] = await root.query("SHOW DATABASES LIKE 'm1nav\\_it%'")
  for (const r of dbs as Array<Record<string, string>>)
    await root.query(`DROP DATABASE \`${Object.values(r)[0]}\``)
}

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await dropAll()
  await root.query(SEED)
  await root.query(
    `DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}'; GRANT ALL ON \`m1nav\\_it%\`.* TO '${USER}'@'%'`,
  )
}, 60000)

afterAll(async () => {
  await dropAll()
  await root.query(`DROP USER IF EXISTS '${USER}'@'%'`)
  await root.end()
})

async function app(cfg = {}, server = {}) {
  const t = testApp(testConfig(cfg, server))
  await t.login(USER, USER)
  return t
}

const labels = (l: NavList | null): string[] => (l?.items ?? []).map((n) => n.label)
const find = (l: NavList | null, label: string): NavNode => {
  const n = l?.items.find((i) => i.label === label)
  if (n === undefined) throw new Error(`no ${label} in ${labels(l).join(', ')}`)
  return n
}

describe('GET /navigation/tree', () => {
  it('groups databases by prefix, puts New first and returns the panel settings [p01-a333a2]', async () => {
    const t = await app()
    try {
      const r = await t.req('GET', '/api/servers/1/navigation/tree')
      expect(r.status).toBe(200)
      const body = r.json as unknown as NavTreeResponse
      expect(body.settings.NavigationWidth).toBe(240)
      expect(body.controls).toBe(true)
      // m1nav > it is merged into one group because `it` holds every member of `m1nav`
      expect(labels(body.tree)).toEqual(['New', 'information_schema', 'm1nav_it', ...SYSTEM_DBS])
      const group = find(body.tree, 'm1nav_it')
      expect(group.kind).toBe('group')
      expect(group.loaded).toBe(true)
      expect(labels(group.children)).toEqual(['m1nav_it_a', 'm1nav_it_b', 'm1nav_it_large'])
      const db = find(group.children, 'm1nav_it_a')
      expect(db).toMatchObject({
        kind: 'database',
        aPath: ['m1nav_it_a'],
        vPath: ['m1nav_it', 'a'],
        expandable: true,
      })
      expect(db.link).toEqual({
        title: 'Structure',
        route: '/database/structure',
        params: { db: 'm1nav_it_a' },
      })
      expect(body.tree.fastFilter).toBeNull()
      expect(body.tree.pageSelector).toBeNull()
    } finally {
      await t.close()
    }
  })

  it('pages by first-level prefix with FirstLevelNavigationItems and shows the db filter [p01-41d435 p01-79ae51]', async () => {
    const t = await app({ FirstLevelNavigationItems: 1, NavigationTreeDisplayDbFilterMinimum: 2 })
    try {
      const r = await t.req('GET', '/api/servers/1/navigation/tree?pos=1')
      const body = r.json as unknown as NavTreeResponse
      expect(body.tree.fastFilter).toEqual({ kind: 'db', aPath: [] })
      // first-level items: information_schema, m1nav_it (and performance_schema)
      const last = hasPerformanceSchema ? 2 : null
      expect(body.tree.pageSelector).toMatchObject({
        count: 2 + SYSTEM_DBS.length,
        pos: 1,
        maxCount: 1,
        begin: 0,
        prev: 0,
        next: last,
        end: last,
      })
      expect(body.tree.pageSelector?.pages.map((p) => p.selected)).toEqual(
        hasPerformanceSchema ? [false, true, false] : [false, true],
      )
      // one group holding every other item is not created (rfe #1634)
      expect(labels(body.tree)).toEqual(['New', 'm1nav_it_a', 'm1nav_it_b', 'm1nav_it_large'])
    } finally {
      await t.close()
    }
  })

  it('computes the initial page from the current database [p01-41d435]', async () => {
    const t = await app({ FirstLevelNavigationItems: 1 })
    try {
      const r = await t.req('GET', '/api/servers/1/navigation/tree?db=performance_schema')
      expect((r.json as unknown as NavTreeResponse).pos).toBe(2)
    } finally {
      await t.close()
    }
  })

  it('ShowDatabasesNavigationAsTree off: the legacy database select, no grouping, filter or controls', async () => {
    const t = await app({ ShowDatabasesNavigationAsTree: false, NavigationTreeDisplayDbFilterMinimum: 1 })
    try {
      const r = await t.req('GET', '/api/servers/1/navigation/tree?db=m1nav_it_b')
      const body = r.json as unknown as NavTreeResponse
      expect(body.settings.ShowDatabasesNavigationAsTree).toBe(false)
      expect(body.controls).toBe(false)
      expect(body.tree.fastFilter).toBeNull()
      expect(labels(body.tree)).toEqual([
        'New',
        'information_schema',
        'm1nav_it_a',
        'm1nav_it_b',
        'm1nav_it_large',
        'performance_schema',
      ])
      // the options of #navi_db_select: the databases without New, in the order of the query
      expect(body.dbSelect).toEqual([
        'information_schema',
        'm1nav_it_a',
        'm1nav_it_b',
        'm1nav_it_large',
        'performance_schema',
      ])
    } finally {
      await t.close()
    }
  })

  it('requires a login', async () => {
    const t = testApp()
    await t.req('GET', '/api/auth/state')
    const r = await t.req('GET', '/api/servers/1/navigation/tree')
    expect(r.status).toBe(401)
    await t.close()
  })
})

describe('GET /navigation/branch', () => {
  it('lists the containers of a database with their New nodes', async () => {
    const t = await app()
    try {
      const r = await t.req('GET', '/api/servers/1/navigation/branch?path=m1nav_it_a')
      const body = r.json as unknown as NavBranchResponse
      expect(body.error).toBeNull()
      expect(labels(body.list)).toEqual(['Tables', 'Views'])
      const tables = find(body.list, 'Tables')
      expect(tables).toMatchObject({ kind: 'container', container: 'tables', loaded: false, flatten: false })
      expect(labels(tables.children)).toEqual(['New'])
    } finally {
      await t.close()
    }
  })

  it("names and titles follow the request's language (__('Tables'), _pgettext('Create new table', 'New'))", async () => {
    const t = await app()
    const de = translatorFor('de')
    try {
      // ?lang= beats the language cookie the login set
      const r = await t.req('GET', '/api/servers/1/navigation/branch?path=m1nav_it_a&lang=de')
      const body = r.json as unknown as NavBranchResponse
      // sorted by the translated names, as NavigationTree::sortNode does
      expect(labels(body.list)).toEqual([de.gettext('Views'), de.gettext('Tables')])
      expect(de.gettext('Tables')).not.toBe('Tables')
      const tables = find(body.list, de.gettext('Tables'))
      // the container keeps its real name for the paths
      expect(tables.container).toBe('tables')
      expect(labels(tables.children)).toEqual([de.pgettext('Create new table', 'New')])
      const b = await t.req(
        'GET',
        '/api/servers/1/navigation/branch?path=m1nav_it_a&path=tables&pos2Name=tables&pos2Value=0&searchClause2=t1&lang=de',
      )
      const branch = b.json as unknown as NavBranchResponse
      expect(find(branch.list, 't1').icons[0]?.title).toBe(de.gettext('Structure'))
      // (motranslator's German plural rule `(n != 1)` is a boolean, so the singular form is used: as phpMyAdmin)
      const n = Number.parseInt(branch.results ?? '', 10)
      expect(branch.results).toBe(sprintf(de.ngettext('%s result found', '%s results found', n), n))
      expect(branch.results).not.toContain('result')
    } finally {
      await t.close()
    }
  })

  it('expands Tables: natural order, groups, default action icons and links [p01-a333a2 p01-d23a2e]', async () => {
    const t = await app({ NavigationTreeDefaultTabTable2: 'sql' })
    try {
      const r = await t.req(
        'GET',
        '/api/servers/1/navigation/branch?path=m1nav_it_a&path=tables&pos2Name=tables&pos2Value=0',
      )
      const body = r.json as unknown as NavBranchResponse
      expect(labels(body.list)).toEqual(['New', 'log', 't1', 't2', 't10'])
      const t1 = find(body.list, 't1')
      expect(t1.icons.map((i) => [i.image, i.title, i.route])).toEqual([
        ['b_props', 'Structure', '/table/structure'],
        ['b_sql', 'SQL', '/table/sql'],
      ])
      expect(t1.link).toEqual({
        title: 'Browse',
        route: '/sql',
        params: { pos: 0, db: 'm1nav_it_a', table: 't1' },
      })
      expect(t1.pagination).toEqual({ position: 'pos2_nav', name: 'tables', value: 0 })
      expect(labels(find(body.list, 'log').children)).toEqual(['log__a', 'log__b'])
    } finally {
      await t.close()
    }
  })

  it('shows the tables directly when Tables is the only container [p01-5523b6]', async () => {
    const t = await app()
    try {
      const r = await t.req('GET', '/api/servers/1/navigation/branch?path=m1nav_it_b')
      const body = r.json as unknown as NavBranchResponse
      expect(labels(body.list)).toEqual(['New', 'only'])
    } finally {
      await t.close()
    }
  })

  it('lists columns with key, type, truncated default and nullable [p01-60ce39]', async () => {
    const t = await app()
    try {
      const r = await t.req(
        'GET',
        '/api/servers/1/navigation/branch?path=m1nav_it_a&path=tables&path=t1&path=columns&pos2Name=tables&pos2Value=0&pos3Name=columns&pos3Value=0',
      )
      const body = r.json as unknown as NavBranchResponse
      expect(labels(body.list)).toEqual([
        'New',
        'id (PRI, int)',
        // NodeTable::getColumns reads information_schema COLUMN_DEFAULT: MariaDB quotes string
        // literals and reports a NULL default as the text NULL, NodeColumn shows both as they come
        isMariaDb ? "name (varchar, 'a lon..., nullable)" : 'name (varchar, a long..., nullable)',
        isMariaDb ? 'u (UNI, int, NULL, nullable)' : 'u (UNI, int, nullable)',
      ])
      expect(body.list?.items[1]?.icons[0]?.image).toBe('b_primary')
    } finally {
      await t.close()
    }
  })

  it('counts search results', async () => {
    const t = await app()
    try {
      const r = await t.req('GET', '/api/servers/1/navigation/branch?searchClause=it_b')
      const body = r.json as unknown as NavBranchResponse
      expect(body.searchResults).toBe(true)
      expect(body.results).toBe('1 result found')
      const r2 = await t.req(
        'GET',
        '/api/servers/1/navigation/branch?path=m1nav_it_a&path=tables&pos2Name=tables&pos2Value=0&searchClause2=t',
      )
      expect((r2.json as unknown as NavBranchResponse).results).toBe('5 results found')
    } finally {
      await t.close()
    }
  })

  it('warns once about groups larger than 500 items [p01-a333a2]', async () => {
    const t = await app()
    try {
      const r = await t.req(
        'GET',
        '/api/servers/1/navigation/branch?path=m1nav_it_large&path=tables&pos2Name=tables&pos2Value=0',
      )
      const body = r.json as unknown as NavBranchResponse
      // only 50 tables are on the page: the group is not large
      expect(body.errors).toEqual([])
      const t2 = await app({ MaxNavigationItems: 1000 })
      const r2 = await t2.req(
        'GET',
        '/api/servers/1/navigation/branch?path=m1nav_it_large&path=tables&pos2Name=tables&pos2Value=0',
      )
      expect((r2.json as unknown as NavBranchResponse).errors).toEqual([
        'There are large item groups in navigation panel which may affect the performance. Consider disabling item grouping in the navigation panel.',
      ])
      await t2.close()
    } finally {
      await t.close()
    }
  })

  it('reports a branch that cannot be built', async () => {
    const t = await app()
    try {
      const r = await t.req('GET', '/api/servers/1/navigation/branch?path=m1nav_it_missing')
      const body = r.json as unknown as NavBranchResponse
      expect(body.list).toBeNull()
      expect(body.error).toBe('An error has occurred while loading the navigation display')
    } finally {
      await t.close()
    }
  })

  it('rejects an invalid position', async () => {
    const t = await app()
    try {
      const r = await t.req('GET', '/api/servers/1/navigation/branch?path=x&pos=-1')
      expect(r.status).toBe(400)
    } finally {
      await t.close()
    }
  })
})

describe('POST /navigation/tree', () => {
  it('restores expanded branches and reload keeps them [p01-b7e594]', async () => {
    const t = await app()
    try {
      const paths = [
        {
          aPath: ['m1nav_it_a', 'tables'],
          vPath: ['m1nav_it', 'a', 'Tables'],
          pos2Name: 'tables',
          pos2Value: 0,
        },
      ]
      for (const reload of [false, true]) {
        const r = await t.req('POST', '/api/servers/1/navigation/tree', { paths, reload })
        expect(r.status).toBe(200)
        const body = r.json as unknown as NavTreeResponse
        const db = find(find(body.tree, 'm1nav_it').children, 'm1nav_it_a')
        expect(db).toMatchObject({ loaded: true, expanded: true })
        const tables = find(db.children, 'Tables')
        expect(tables).toMatchObject({ loaded: true, expanded: true })
        expect(labels(tables.children)).toEqual(['New', 'log', 't1', 't2', 't10'])
      }
    } finally {
      await t.close()
    }
  })

  it('DisableIS uses SHOW DATABASES LIKE per granted pattern', async () => {
    const t = await app({ DBG: { sql: true } }, { DisableIS: true })
    try {
      const r = await t.req('POST', '/api/servers/1/navigation/tree', {})
      const body = r.json as unknown as NavTreeResponse
      expect(labels(body.tree)).toEqual(['New', 'information_schema', 'm1nav_it', ...SYSTEM_DBS])
    } finally {
      await t.close()
    }
  })
})
