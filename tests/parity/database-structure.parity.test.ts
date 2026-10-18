import type { DbStructureResponse } from '@bettermyadmin/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compareWrites, normalise } from './lib/compare.ts'
import type { LogEntry } from './lib/general-log.ts'
import { type Harness, both, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of the database Structure tab (docs/features/05-database-level.md): the reads that
 * build the table list (counts, statuses, collations), and the statements of every "With selected:"
 * action, run by phpMyAdmin through the POSTs its JS sends and by BetterMyAdmin through its API on
 * identical databases. phpMyAdmin's configuration-storage writes go through its control user, so
 * BetterMyAdmin is given the same control user.
 */
const users = { pma: 'f05_st_pma', bma: 'f05_st_bma' }
const P = 'f05_stp'
const B = 'f05_stb'
const dbMap: Record<string, string> = {
  [`${P}_t`]: 'TDB',
  [`${B}_t`]: 'TDB',
  [P]: 'DB',
  [B]: 'DB',
  [users.pma]: 'USER',
  [users.bma]: 'USER',
}
let h: Harness

const seed = (db: string) => `
DROP DATABASE IF EXISTS ${db}; DROP DATABASE IF EXISTS ${db}_t;
CREATE DATABASE ${db} DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_general_ci; CREATE DATABASE ${db}_t;
CREATE TABLE ${db}.parent (id INT NOT NULL AUTO_INCREMENT, name VARCHAR(20) COMMENT 'nm', PRIMARY KEY (id), UNIQUE KEY u_name (name), FULLTEXT KEY ft (name)) ENGINE=InnoDB AUTO_INCREMENT=7 COMMENT 'the parent';
INSERT INTO ${db}.parent (name) VALUES ('a'), ('b'), ('c');
CREATE TABLE ${db}.child (id INT NOT NULL, parent_id INT, g INT GENERATED ALWAYS AS (id * 2) VIRTUAL, PRIMARY KEY (id), KEY k_p (parent_id), CONSTRAINT fk_p FOREIGN KEY (parent_id) REFERENCES parent (id) ON DELETE CASCADE) ENGINE=InnoDB;
INSERT INTO ${db}.child (id, parent_id) VALUES (1, 7), (2, 8);
CREATE TABLE ${db}.m (id INT, v TEXT) ENGINE=MyISAM;
INSERT INTO ${db}.m VALUES (1, 'x');
CREATE TABLE ${db}.wp_one (id INT) ENGINE=InnoDB;
CREATE TABLE ${db}.wp_two (id INT) ENGINE=InnoDB;
CREATE VIEW ${db}.v AS SELECT id, name FROM ${db}.parent;
`

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness({}, users, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' })
  await h.root.query(seed(P) + seed(B))
})
afterAll(async () => {
  await h?.root.query(
    `DROP DATABASE IF EXISTS ${P}; DROP DATABASE IF EXISTS ${P}_t; DROP DATABASE IF EXISTS ${B}; DROP DATABASE IF EXISTS ${B}_t`,
  )
  await h?.close()
})

/** Re-creates both databases (each action starts from the seed). */
async function reseed() {
  await h.root.query(seed(P) + seed(B))
}

const bma = (path: string) => `/api/servers/1/databases/${B}${path}`

/** The page's own reads (the per-request menu/navigation/storage probes left out). */
const PAGE_READS =
  /^(SHOW TABLES FROM `DB`;|SELECT \*, `TABLE_SCHEMA` +AS `Db`|SELECT COUNT\(\*\) FROM `DB`|SELECT DEFAULT_COLLATION_NAME FROM information_schema\.SCHEMATA|SELECT @@default_storage_engine|SELECT `COLLATION_NAME` AS `Collation`|SHOW TABLE STATUS FROM `DB`)/

function pageReads(log: LogEntry[]): string[] {
  return log.map((e) => normalise(e.sql, dbMap)).filter((s) => PAGE_READS.test(s))
}

function writes(pmaLog: LogEntry[], bmaLog: LogEntry[]) {
  // SET SQL_QUOTE_SHOW_CREATE is part of the export's definition read (both send it)
  return compareWrites(pmaLog, bmaLog, dbMap)
}

describe.skipIf(!pmaReachable)('parity: database structure page', () => {
  const CASES: Array<[string, Record<string, string>]> = [
    ['default', {}],
    ['sorted by rows desc', { sort: 'records', sort_order: 'DESC' }],
    ['sorted by size', { sort: 'size' }],
    ['unknown sort key ignores DESC', { sort: 'charset', sort_order: 'DESC' }],
    ['tables only', { tbl_type: 'table' }],
    ['a table group', { tbl_group: 'wp' }],
  ]
  for (const [name, params] of CASES) {
    it(name, async () => {
      const qs = new URLSearchParams(params).toString()
      const r = await both(
        h,
        () => h.pma.getJson('/database/structure', { db: P, ...params }),
        () => h.bma.req('GET', bma(`/structure${qs === '' ? '' : `?${qs}`}`)),
      )
      expect(r.b.status, JSON.stringify(r.b.json)).toBe(200)
      // tables of the same size (row estimate) keep the server's order of `ORDER BY Data_length`
      // (`Rows`), which it may change between two requests (InnoDB's row estimates move too): those
      // sorts compare the reads as a multiset, and the size order is checked
      const unstable = params.sort === 'size' || params.sort === 'records'
      if (unstable) expect([...pageReads(r.bmaLog)].sort()).toEqual([...pageReads(r.pmaLog)].sort())
      if (params.sort === 'size') {
        const [sizes] = (await h.root.query(
          'SELECT TABLE_NAME AS t, DATA_LENGTH + INDEX_LENGTH AS s FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
          [B],
        )) as unknown as [Array<{ t: string; s: number | null }>]
        const size = new Map(sizes.map((x) => [x.t, Number(x.s ?? 0)]))
        const counted = pageReads(r.bmaLog)
          .map((q) => /^SELECT COUNT\(\*\) FROM `DB`\.`([^`]+)`/.exec(q)?.[1])
          .filter((t): t is string => t !== undefined)
        const order = counted.map((t) => size.get(t) ?? 0)
        expect(order).toEqual([...order].sort((a, b) => a - b))
      } else if (!unstable) expect(pageReads(r.bmaLog)).toEqual(pageReads(r.pmaLog))
      const d = r.b.json as unknown as DbStructureResponse
      const html = String(r.p.message ?? '')
      const pmaNames = [...html.matchAll(/<tr id="row_tbl_\d+"[^>]*data-filter-row="([^"]+)"/g)].map(
        (m) => m[1],
      )
      // (ties of the size and row sorts: see above)
      const ord = <T>(xs: T[]) => (unstable ? [...xs].sort() : xs)
      expect(ord(d.tables.map((t) => t.name.toUpperCase()))).toEqual(ord(pmaNames))
      const pmaRows = [
        ...html.matchAll(/<td class="value tbl_rows[^"]*"\s+data-table="([^"]+)">\s*([\s\S]*?)<\/td>/g),
      ].map((m) => [m[1], (m[2] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, '')])
      expect(
        ord(
          d.tables.filter((t) => t.rows !== null).map((t) => [t.name, `${t.approx ? '~' : ''}${t.rowsText}`]),
        ),
      ).toEqual(ord(pmaRows))
    })
  }

  it('real row count of one table and of all tables [p05-b35450]', async () => {
    const r = await both(
      h,
      () => h.pma.getJson('/database/structure/real-row-count', { db: P, table: 'parent' }),
      () => h.bma.req('GET', bma('/structure/real-row-count?table=parent')),
    )
    expect(r.b.json.realRowCount).toBe(r.p.real_row_count)
    const all = await both(
      h,
      () => h.pma.getJson('/database/structure/real-row-count', { db: P, real_row_count_all: 'true' }),
      () => h.bma.req('GET', bma('/structure/real-row-count?all=1')),
    )
    expect(all.b.json.realRowCountAll).toEqual(
      (all.p.real_row_count_all as Array<{ table: string; row_count: string }>).map((x) => ({
        table: x.table,
        rowCount: x.row_count,
      })),
    )
    expect(pageReads(all.bmaLog)).toEqual(pageReads(all.pmaLog))
  })
})

describe.skipIf(!pmaReachable)('parity: structure bulk actions', () => {
  const sel = (tables: string[]) => tables.map((t) => ['selected[]', t] as [string, string])
  const selTbl = (tables: string[]) => tables.map((t) => ['selected_tbl[]', t] as [string, string])

  const CASES: Array<{
    name: string
    pma: () => Promise<unknown>
    bma: () => Promise<unknown>
    expectSql: RegExp
  }> = [
    {
      name: 'empty with foreign key checks off',
      pma: () =>
        h.pma.postJson('/database/structure/empty-table', [
          ['db', P],
          ...sel(['child', 'v', 'm']),
          ['fk_checks', '0'],
          ['mult_btn', 'Yes'],
        ]),
      bma: () => h.bma.req('POST', bma('/structure/empty'), { tables: ['child', 'v', 'm'], fkChecks: false }),
      expectSql: /^TRUNCATE `child`$/,
    },
    {
      name: 'drop tables and a view [p05-a7eaad]',
      pma: () =>
        h.pma.postJson('/database/structure/drop-table', [
          ['db', P],
          ...sel(['v', 'child', 'm']),
          ['fk_checks', '1'],
          ['mult_btn', 'Yes'],
        ]),
      bma: () => h.bma.req('POST', bma('/structure/drop'), { tables: ['v', 'child', 'm'], fkChecks: true }),
      expectSql: /^DROP TABLE `child`, `m`$/,
    },
    {
      name: 'add prefix',
      pma: () =>
        h.pma.postJson('/database/structure/add-prefix-table', [
          ['db', P],
          ...sel(['m', 'parent']),
          ['add_prefix', 'x_'],
        ]),
      bma: () => h.bma.req('POST', bma('/structure/add-prefix'), { tables: ['m', 'parent'], prefix: 'x_' }),
      expectSql: /^ALTER TABLE `m` RENAME `x_m`$/,
    },
    {
      name: 'replace prefix leaves non-matching names [p05-fdecd7]',
      pma: () =>
        // phpMyAdmin answers the whole Structure page here, not JSON
        h.pma.postPage('/database/structure/replace-prefix', [
          ['db', P],
          ...sel(['wp_one', 'm']),
          ['from_prefix', 'wp_'],
          ['to_prefix', 'zz_'],
        ]),
      bma: () =>
        h.bma.req('POST', bma('/structure/replace-prefix'), {
          tables: ['wp_one', 'm'],
          fromPrefix: 'wp_',
          toPrefix: 'zz_',
        }),
      expectSql: /^ALTER TABLE `wp_one` RENAME `zz_one`$/,
    },
    {
      name: 'copy with prefix [p05-fdecd7]',
      pma: () =>
        h.pma.postJson('/database/structure/copy-table-with-prefix', [
          ['db', P],
          ...sel(['wp_one', 'parent']),
          ['from_prefix', 'wp_'],
          ['to_prefix', 'cp_'],
        ]),
      bma: () =>
        h.bma.req('POST', bma('/structure/copy-with-prefix'), {
          tables: ['wp_one', 'parent'],
          fromPrefix: 'wp_',
          toPrefix: 'cp_',
        }),
      expectSql: /^CREATE TABLE `DB`\.`cp_one`/,
    },
    {
      name: 'copy tables (structure and data, constraints, AUTO_INCREMENT, DROP TABLE) to another database',
      pma: () =>
        h.pma.postJson('/database/structure/copy-table', [
          ['db', P],
          ...sel(['parent', 'child', 'v']),
          ['target_db', `${P}_t`],
          ['what', 'data'],
          ['drop_if_exists', 'true'],
          ['sql_auto_increment', '1'],
          ['add_constraints', '1'],
        ]),
      bma: () =>
        h.bma.req('POST', bma('/structure/copy'), {
          tables: ['parent', 'child', 'v'],
          targetDb: `${B}_t`,
          what: 'data',
          dropIfExists: true,
          autoIncrement: true,
          addConstraints: true,
        }),
      expectSql: /AUTO_INCREMENT=10$/,
    },
    {
      name: 'copy structure only, then data only',
      pma: async () => {
        await h.pma.postJson('/database/structure/copy-table', [
          ['db', P],
          ...sel(['m']),
          ['target_db', `${P}_t`],
          ['what', 'structure'],
        ])
        return h.pma.postJson('/database/structure/copy-table', [
          ['db', P],
          ...sel(['m']),
          ['target_db', `${P}_t`],
          ['what', 'dataonly'],
        ])
      },
      bma: async () => {
        await h.bma.req('POST', bma('/structure/copy'), {
          tables: ['m'],
          targetDb: `${B}_t`,
          what: 'structure',
        })
        return h.bma.req('POST', bma('/structure/copy'), {
          tables: ['m'],
          targetDb: `${B}_t`,
          what: 'dataonly',
        })
      },
      expectSql: /^INSERT INTO `TDB`\.`m`/,
    },
    {
      name: 'check table',
      pma: () => h.pma.postJson('/table/maintenance/check', [['db', P], ...selTbl(['parent', 'm'])]),
      bma: () => h.bma.req('POST', bma('/structure/maintenance'), { op: 'check', tables: ['parent', 'm'] }),
      expectSql: /^CHECK TABLE `parent`, `m`$/,
    },
    {
      name: 'optimize table',
      pma: () => h.pma.postJson('/table/maintenance/optimize', [['db', P], ...selTbl(['m'])]),
      bma: () => h.bma.req('POST', bma('/structure/maintenance'), { op: 'optimize', tables: ['m'] }),
      expectSql: /^OPTIMIZE TABLE `m`$/,
    },
  ]

  for (const c of CASES) {
    it(c.name, async () => {
      await reseed()
      const r = await both(h, c.pma, c.bma)
      const cmp = writes(r.pmaLog, r.bmaLog)
      expect(cmp.bma, `pma: ${JSON.stringify(cmp.pma, null, 1)}`).toEqual(cmp.pma)
      const all = r.bmaLog.map((e) => normalise(e.sql, dbMap))
      expect(
        all.some((s) => c.expectSql.test(s)),
        JSON.stringify(all, null, 1),
      ).toBe(true)
    })
  }

  it('show create', async () => {
    await reseed()
    const r = await both(
      h,
      () => h.pma.postJson('/database/structure/show-create', [['db', P], ...selTbl(['parent', 'v'])]),
      () => h.bma.req('POST', bma('/structure/show-create'), { tables: ['parent', 'v'] }),
    )
    const html = String(r.p.message)
    const b = r.b.json as { tables: Array<{ name: string }>; views: Array<{ name: string }> }
    expect(b.tables.map((t) => t.name)).toEqual(['parent'])
    expect(b.views.map((t) => t.name)).toEqual(['v'])
    expect(html).toContain('<div class="card-header">Views</div>')
  })
})
