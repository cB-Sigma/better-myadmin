import type {
  CreateDatabaseResponse,
  DatabasesResponse,
  DropDatabasesResponse,
} from '@bettermyadmin/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { $, $$, type Node, classes, pageHtml, parse, text } from './lib/html.ts'
import { type Harness, both, diff, pmaReachable, startHarness, suiteUsers } from './lib/server-setup.ts'

/**
 * Golden parity of Server → Databases: the list (collations, statistics, sorting, paging, the create
 * form with the user's wildcard database prefilled) with accounts that only see `m3srv\_db%`
 * databases, then create and drop.
 */
const PMA_USER = 'm3srv_dbp'
const BMA_USER = 'm3srv_dbb'
const users = { pma: PMA_USER, bma: BMA_USER }
let h: Harness

const SEED = `
DROP DATABASE IF EXISTS m3srv_db_a; DROP DATABASE IF EXISTS m3srv_db_b; DROP DATABASE IF EXISTS m3srv_db_10; DROP DATABASE IF EXISTS m3srv_db_9;
CREATE DATABASE m3srv_db_a DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE m3srv_db_a.t1 (id INT PRIMARY KEY, v VARCHAR(20)) ENGINE=InnoDB;
INSERT INTO m3srv_db_a.t1 VALUES (1, 'x'), (2, 'y');
CREATE TABLE m3srv_db_a.t2 (id INT) ENGINE=MyISAM;
INSERT INTO m3srv_db_a.t2 VALUES (1), (2), (3);
CREATE DATABASE m3srv_db_b DEFAULT CHARSET latin1 COLLATE latin1_german2_ci;
CREATE DATABASE m3srv_db_10;
CREATE DATABASE m3srv_db_9;
ANALYZE TABLE m3srv_db_a.t1, m3srv_db_a.t2;
`

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness({}, { ...users, grant: "GRANT ALL ON `m3srv\\_db%`.* TO '{user}'@'%'" })
  await h.root.query(SEED)
})
afterAll(async () => {
  await h?.root.query(
    'DROP DATABASE IF EXISTS m3srv_db_a; DROP DATABASE IF EXISTS m3srv_db_b; DROP DATABASE IF EXISTS m3srv_db_10; DROP DATABASE IF EXISTS m3srv_db_9; DROP DATABASE IF EXISTS m3srv_db_newp; DROP DATABASE IF EXISTS m3srv_db_newb',
  )
  await h?.close()
})

function fromHtml(html: Node) {
  const table = $(html, 'form#dbStatsForm table')
  const create = $(html, 'form#create_database_form')
  return {
    title: text($(html, 'h2')!),
    create:
      create === undefined
        ? text($(html, 'span.text-danger') ?? { tag: 'x', attrs: {}, children: [] })
        : {
            value: $(create, 'input#text_create_db')!.attrs.value,
            selected: $$(create, 'option').find((o) => 'selected' in o.attrs)?.attrs.value ?? null,
            optgroups: $$(create, 'optgroup').length,
          },
    headers:
      table === undefined
        ? []
        : $$(table, 'thead th').map((th) => [text(th), $(th, 'a')?.attrs.href ?? null]),
    rows:
      table === undefined
        ? []
        : $$(table, 'tbody tr').map((tr) => ({
            name: text($(tr, 'td.name')!),
            disabled: $(tr, 'input')?.attrs.disabled !== undefined,
            noclick: classes(tr).includes('noclick'),
            collation: [text($(tr, 'dfn')!), $(tr, 'dfn')!.attrs.title],
            stats: $$(tr, 'td.value')
              .slice(1)
              .map((td) => text(td)),
          })),
    total: table === undefined ? null : text($(table, 'tfoot')!),
    stats: $(html, 'a.card-link') !== undefined,
    none: $(html, 'div.alert-primary') !== undefined ? text($(html, 'div.alert-primary')!) : null,
    pager: $(html, 'div.pageselector') !== undefined || $$(html, 'select.pageselector').length > 0,
  }
}

function fromJson(d: DatabasesResponse, sortLinks: (key: string) => string) {
  const statHeaders = d.hasStatistics
    ? d.headerStatistics.map((s) => [s.title, sortLinks(s.key)] as [string, string])
    : []
  return {
    title: d.hasStatistics ? 'Databases statistics' : 'Databases',
    create: d.hasCreateDatabasePrivileges
      ? {
          value: d.databaseToCreate,
          selected: d.charsets.flatMap((c) => c.collations).find((c) => c.isSelected)?.name ?? null,
          optgroups: d.charsets.length,
        }
      : 'No privileges to create databases',
    headers: [
      ...(d.isDropAllowed ? [['', null]] : []),
      ['Database', sortLinks('SCHEMA_NAME')],
      ['Collation', sortLinks('DEFAULT_COLLATION_NAME')],
      ...statHeaders,
      ...(d.hasPrimaryReplication ? [['Primary replication', null]] : []),
      ...(d.hasReplicaReplication ? [['Replica replication', null]] : []),
      ['Action', null],
    ],
    rows: d.databases.map((db) => ({
      name: db.name,
      disabled: d.isDropAllowed ? db.isSystemSchema || db.isPmadb : false,
      noclick: db.isSystemSchema || db.isPmadb,
      collation: [db.collation?.name ?? '', db.collation?.description ?? ''],
      stats: db.statistics.map((s) => s.value),
    })),
    total: [
      `Total: ${d.databaseCount}`,
      ...d.totalStatistics.flatMap((s) => (s.format === 'byte' ? [s.value, s.unit] : [s.value])),
    ].join(' '),
    stats: !d.hasStatistics,
    none: d.databaseCount === 0 ? 'No databases' : null,
    pager: d.pager !== null,
  }
}

describe.skipIf(!pmaReachable)('parity: databases list', () => {
  const CASES: Array<[string, Record<string, string>]> = [
    ['default', {}],
    ['statistics', { statistics: '1' }],
    ['sorted by collation desc', { sort_by: 'DEFAULT_COLLATION_NAME', sort_order: 'desc' }],
    ['statistics sorted by rows', { statistics: '1', sort_by: 'SCHEMA_TABLE_ROWS', sort_order: 'desc' }],
    ['unknown sort column falls back to the name', { sort_by: 'nope', sort_order: 'DESC' }],
    ['a position past the list', { pos: '100' }],
  ]
  for (const [name, params] of CASES) {
    it(name, async () => {
      const qs = new URLSearchParams(params).toString()
      const r = await both(
        h,
        () => h.pma.pagePost('/server/databases', params, true),
        () => h.bma.req('GET', `/api/servers/1/databases${qs === '' ? '' : `?${qs}`}`),
        users,
      )
      expect(r.b.status, JSON.stringify(r.b.json)).toBe(200)
      const cmp = diff(h, r.pmaLog, r.bmaLog)
      expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
      const d = r.b.json as unknown as DatabasesResponse
      const html = parse(pageHtml(r.p))
      const sortLink = (key: string) => {
        const p = new URLSearchParams({
          statistics: d.hasStatistics ? '1' : '0',
          pos: String(d.pos),
          sort_by: key,
          sort_order: d.sortBy === key && d.sortOrder === 'asc' ? 'desc' : 'asc',
        })
        return `index.php?route=/server/databases&${p.toString().replaceAll('%2F', '/')}`
      }
      const pma = fromHtml(html)
      // header links: compare the parameters only (phpMyAdmin's url() adds nothing else here)
      expect(fromJson(d, sortLink)).toEqual(pma)
    })
  }

  it('create database with a collation, then drop it', async () => {
    const r = await both(
      h,
      () =>
        h.pma.pagePostJson('/server/databases/create', {
          new_db: 'm3srv_db_newp',
          db_collation: 'utf8mb4_bin',
        }),
      () =>
        h.bma.req('POST', '/api/servers/1/databases', {
          new_db: 'm3srv_db_newb',
          db_collation: 'utf8mb4_bin',
        }),
      users,
    )
    const cmp = diff(
      h,
      r.pmaLog,
      r.bmaLog,
      [
        {
          tool: 'pma',
          pattern:
            "^SHOW TABLES FROM `NEWDB`$|^SELECT `PRIVILEGE_TYPE` FROM `INFORMATION_SCHEMA`\\.`SCHEMA_PRIVILEGES` WHERE .* 'NEWDB' LIKE",
          why: 'After CREATE DATABASE phpMyAdmin makes the new database current (Current::$database) and its response middleware checks it and the database tab privileges; the SPA opens the database page with its own request.',
        },
      ],
      { m3srv_db_newp: 'NEWDB', m3srv_db_newb: 'NEWDB' },
    )
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(cmp.bma).toContain('CREATE DATABASE `NEWDB` DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_bin')
    const c = r.b.json as unknown as CreateDatabaseResponse
    expect(text(parse(String(r.p.message)))).toBe(c.message.text.replace('m3srv_db_newb', 'm3srv_db_newp'))
  })

  it('create with an unknown collation drops the collation part; an existing name reports the error', async () => {
    const r = await both(
      h,
      () => h.pma.pagePostJson('/server/databases/create', { new_db: 'm3srv_db_a', db_collation: 'nope_ci' }),
      () => h.bma.req('POST', '/api/servers/1/databases', { new_db: 'm3srv_db_a', db_collation: 'nope_ci' }),
      users,
    )
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(cmp.bma).toContain('CREATE DATABASE `m3srv_db_a`')
    expect(r.p.success).toBe(false)
    const c = r.b.json as unknown as CreateDatabaseResponse
    expect(text(parse(String(r.p.message ?? r.p.error)))).toContain(c.message.text)
  })
})

describe.skipIf(!pmaReachable)('parity: drop databases', () => {
  let su: Harness
  beforeAll(async () => {
    su = await startHarness({}, suiteUsers('drop'))
    await su.root.query(
      'CREATE DATABASE IF NOT EXISTS m3srv_db_dropp; CREATE DATABASE IF NOT EXISTS m3srv_db_dropb',
    )
  })
  afterAll(async () => {
    await su?.root.query('DROP DATABASE IF EXISTS m3srv_db_dropp; DROP DATABASE IF EXISTS m3srv_db_dropb')
    await su?.close()
  })

  // the pmadb clean-up (Transformations::clear, RelationCleanup::database) belongs to the metadata
  // layer (setDatabaseDropCleanup), not wired in this suite: its statements are left out here
  const withoutPmadb = (log: Array<{ command: string; sql: string }>) =>
    log.filter((e) => !/^DELETE FROM `phpmyadmin`\.`pma__/.test(e.sql))

  it('drops the selected databases, skipping system schemas', async () => {
    const r = await both(
      su,
      () =>
        su.pma.pagePostJson('/server/databases/destroy', {
          'selected_dbs[0]': 'm3srv_db_dropp',
          'selected_dbs[1]': 'mysql',
        }),
      () =>
        su.bma.req('POST', '/api/servers/1/databases/drop', { selected_dbs: ['m3srv_db_dropb', 'mysql'] }),
    )
    const cmp = diff(su, withoutPmadb(r.pmaLog), r.bmaLog, [], {
      m3srv_db_dropp: 'DROPDB',
      m3srv_db_dropb: 'DROPDB',
    })
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(cmp.bma).toContain('DROP DATABASE `DROPDB`')
    const d = r.b.json as unknown as DropDatabasesResponse
    expect(d.message.text).toBe('1 database has been dropped successfully.')
    expect(text(parse(String(r.p.message)))).toBe(d.message.text)
  })

  it('nothing to drop', async () => {
    const r = await both(
      su,
      () => su.pma.pagePostJson('/server/databases/destroy', { 'selected_dbs[0]': 'information_schema' }),
      () => su.bma.req('POST', '/api/servers/1/databases/drop', { selected_dbs: ['information_schema'] }),
    )
    const cmp = diff(su, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(text(parse(String(r.p.error)))).toBe((r.b.json as unknown as DropDatabasesResponse).message.text)
  })
})
