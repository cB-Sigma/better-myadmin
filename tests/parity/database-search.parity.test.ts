import type { DbSearchResponse } from '@bettermyadmin/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalise } from './lib/compare.ts'
import { visibleText } from './lib/pma.ts'
import { type Harness, both, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of Database → Search (docs/features/05-database-level.md): the COUNT statement of
 * every searched table for each search type, the column restriction, the hex option, and the
 * counts phpMyAdmin renders.
 */
const users = { pma: 'f05_se_pma', bma: 'f05_se_bma' }
const P = 'f05_sep'
const B = 'f05_seb'
const dbMap: Record<string, string> = { [P]: 'DB', [B]: 'DB' }
let h: Harness

const seed = (db: string) => `
DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db};
CREATE TABLE ${db}.a (id INT, name VARCHAR(20), note TEXT);
INSERT INTO ${db}.a VALUES (1, 'apple pie', 'x'), (2, 'banana', 'apple'), (3, 'cherry', NULL);
CREATE TABLE ${db}.b (code VARCHAR(10));
INSERT INTO ${db}.b VALUES ('apple'), ('APPLE'), ('pear');
CREATE TABLE ${db}.c (n INT);
`

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness({}, users)
  await h.root.query(seed(P) + seed(B))
})
afterAll(async () => {
  await h?.root.query(`DROP DATABASE IF EXISTS ${P}; DROP DATABASE IF EXISTS ${B}`)
  await h?.close()
})

const CASES: Array<[string, { s: string; type: string; tables: string[]; column?: string; hex?: boolean }]> =
  [
    ['at least one of the words', { s: 'apple cherry', type: '1', tables: ['a', 'b', 'c'] }],
    ['all of the words', { s: 'apple pie', type: '2', tables: ['b', 'a'] }],
    ['exact phrase as substring', { s: 'pple', type: '3', tables: ['a', 'b'] }],
    ['exact phrase as whole field', { s: 'apple', type: '4', tables: ['a', 'b'] }],
    ['regular expression', { s: '^ba', type: '5', tables: ['a'] }],
    [
      'inside a column, hex matches',
      { s: 'apple', type: '1', tables: ['a', 'b'], column: 'name', hex: true },
    ],
    ['a missing column gives WHERE FALSE', { s: 'apple', type: '1', tables: ['a'], column: 'nope' }],
    ['an invalid type falls back to the first', { s: 'pear', type: '9', tables: ['b', 'zz'] }],
  ]

describe.skipIf(!pmaReachable)('parity: database search', () => {
  for (const [name, c] of CASES) {
    it(name, async () => {
      const r = await both(
        h,
        () =>
          h.pma.postJson('/database/search', [
            ['db', P],
            ['criteriaSearchString', c.s],
            ['criteriaSearchType', c.type],
            ...c.tables.map((t) => ['criteriaTables[]', t] as [string, string]),
            ['criteriaColumnName', c.column ?? ''],
            ['criteriaSearchOptionIncludeHex', c.hex === true ? '1' : '0'],
            ['submit_search', 'Search'],
          ]),
        () =>
          h.bma.req('POST', `/api/servers/1/databases/${B}/search`, {
            searchString: c.s,
            searchType: c.type,
            tables: c.tables,
            columnName: c.column ?? '',
            includeHex: c.hex === true,
          }),
      )
      expect(r.b.status, JSON.stringify(r.b.json)).toBe(200)
      const counts = (log: typeof r.pmaLog) =>
        log.map((e) => normalise(e.sql, dbMap)).filter((s) => s.startsWith('SELECT COUNT(*) AS `count`'))
      expect(counts(r.bmaLog)).toEqual(counts(r.pmaLog))
      const d = r.b.json as unknown as DbSearchResponse
      const html = String(r.p.message)
      const pmaRows = [...html.matchAll(/<tr class="noclick">\s*<td>([\s\S]*?)<\/td>/g)].map((m) =>
        visibleText(m[1] ?? ''),
      )
      expect(d.rows.map((x) => `${x.count} ${x.count === 1 ? 'match' : 'matches'} in ${x.table}`)).toEqual(
        pmaRows,
      )
      expect(html).toContain(`Search results for "<em>${c.s.replace('^', '^')}</em>" ${d.description}:`)
    })
  }
})
