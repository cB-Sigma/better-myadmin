import type { DbStructureResponse } from '@bettermyadmin/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compareWrites, normalise } from './lib/compare.ts'
import type { LogEntry } from './lib/general-log.ts'
import { type Harness, both, pmaReachable, startHarness } from './lib/server-setup.ts'
import { TARGET } from './lib/target.ts'

/**
 * MariaDB-only objects against phpMyAdmin on MariaDB (BMA_PARITY_TARGET=mariadb; skipped on MySQL):
 * system-versioned tables (TABLE_TYPE `SYSTEM VERSIONED`, counted as tables by the "tables only"
 * filter) and sequences (TABLE_TYPE `SEQUENCE`) on the database Structure tab, and the statements
 * of dropping and emptying them.
 */
const users = { pma: 'f09m_pma', bma: 'f09m_bma' }
const P = 'f09m_p'
const B = 'f09m_b'
const dbMap: Record<string, string> = { [P]: 'DB', [B]: 'DB', [users.pma]: 'USER', [users.bma]: 'USER' }
const run = pmaReachable && TARGET === 'mariadb'
let h: Harness

const seed = (db: string) => `
DROP DATABASE IF EXISTS ${db};
CREATE DATABASE ${db} DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE TABLE ${db}.plain (id INT PRIMARY KEY, v VARCHAR(10)) ENGINE=InnoDB;
INSERT INTO ${db}.plain VALUES (1, 'a'), (2, 'b');
CREATE TABLE ${db}.versioned (id INT PRIMARY KEY, v VARCHAR(10)) ENGINE=InnoDB WITH SYSTEM VERSIONING;
INSERT INTO ${db}.versioned VALUES (1, 'a');
UPDATE ${db}.versioned SET v = 'b';
CREATE SEQUENCE ${db}.seq START WITH 10 INCREMENT BY 5;
CREATE VIEW ${db}.vw AS SELECT id FROM ${db}.plain;
`

beforeAll(async () => {
  if (!run) return
  h = await startHarness({}, users, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' })
  await h.root.query(seed(P) + seed(B))
})
afterAll(async () => {
  await h?.root.query(`DROP DATABASE IF EXISTS ${P}; DROP DATABASE IF EXISTS ${B}`)
  await h?.close()
})

const bma = (path: string) => `/api/servers/1/databases/${B}${path}`

/** The page's own reads (the per-request menu/navigation/storage probes left out). */
const PAGE_READS =
  /^(SHOW TABLES FROM `DB`;|SELECT \*, `TABLE_SCHEMA` +AS `Db`|SELECT COUNT\(\*\) FROM `DB`|SELECT DEFAULT_COLLATION_NAME FROM information_schema\.SCHEMATA|SELECT @@default_storage_engine|SELECT `COLLATION_NAME` AS `Collation`|SHOW TABLE STATUS FROM `DB`)/

const pageReads = (log: LogEntry[]) =>
  log.map((e) => normalise(e.sql, dbMap)).filter((s) => PAGE_READS.test(s))

describe.skipIf(!run)('parity (MariaDB): system-versioned tables and sequences', () => {
  for (const [name, params] of [
    ['structure page', {}],
    ['tables only (BASE TABLE and SYSTEM VERSIONED)', { tbl_type: 'table' }],
    ['views only', { tbl_type: 'view' }],
  ] as Array<[string, Record<string, string>]>) {
    it(name, async () => {
      const qs = new URLSearchParams(params).toString()
      const r = await both(
        h,
        () => h.pma.getJson('/database/structure', { db: P, ...params }),
        () => h.bma.req('GET', bma(`/structure${qs === '' ? '' : `?${qs}`}`)),
      )
      expect(r.b.status, JSON.stringify(r.b.json)).toBe(200)
      expect(pageReads(r.bmaLog)).toEqual(pageReads(r.pmaLog))
      const d = r.b.json as unknown as DbStructureResponse
      const html = String(r.p.message ?? '')
      const pmaNames = [...html.matchAll(/<tr id="row_tbl_\d+"[^>]*data-filter-row="([^"]+)"/g)].map(
        (m) => m[1],
      )
      expect(d.tables.map((t) => t.name.toUpperCase())).toEqual(pmaNames)
      const pmaRows = [
        ...html.matchAll(/<td class="value tbl_rows[^"]*"\s+data-table="([^"]+)">\s*([\s\S]*?)<\/td>/g),
      ].map((m) => [m[1], (m[2] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, '')])
      expect(
        d.tables.filter((t) => t.rows !== null).map((t) => [t.name, `${t.approx ? '~' : ''}${t.rowsText}`]),
      ).toEqual(pmaRows)
    })
  }

  const sel = (tables: string[]) => tables.map((t) => ['selected[]', t] as [string, string])
  for (const c of [
    {
      name: 'empty a system-versioned table and a sequence',
      pma: () =>
        h.pma.postJson('/database/structure/empty-table', [
          ['db', P],
          ...sel(['versioned', 'seq']),
          ['fk_checks', '1'],
          ['mult_btn', 'Yes'],
        ]),
      bma: () => h.bma.req('POST', bma('/structure/empty'), { tables: ['versioned', 'seq'], fkChecks: true }),
    },
    {
      name: 'drop a system-versioned table, a sequence and a view',
      pma: () =>
        h.pma.postJson('/database/structure/drop-table', [
          ['db', P],
          ...sel(['versioned', 'seq', 'vw']),
          ['fk_checks', '1'],
          ['mult_btn', 'Yes'],
        ]),
      bma: () =>
        h.bma.req('POST', bma('/structure/drop'), { tables: ['versioned', 'seq', 'vw'], fkChecks: true }),
    },
  ]) {
    it(c.name, async () => {
      await h.root.query(seed(P) + seed(B))
      const r = await both(h, c.pma, c.bma)
      const w = compareWrites(r.pmaLog, r.bmaLog, dbMap)
      expect(w.bma).toEqual(w.pma)
      expect(w.pma.length).toBeGreaterThan(0)
      const [left] = (await h.root.query(
        `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA IN ('${P}', '${B}') ORDER BY TABLE_NAME, TABLE_SCHEMA`,
      )) as unknown as [Array<{ TABLE_SCHEMA: string; TABLE_NAME: string; TABLE_TYPE: string }>]
      const of = (db: string) =>
        left.filter((x) => x.TABLE_SCHEMA === db).map((x) => [x.TABLE_NAME, x.TABLE_TYPE])
      expect(of(B)).toEqual(of(P))
    })
  }
})
