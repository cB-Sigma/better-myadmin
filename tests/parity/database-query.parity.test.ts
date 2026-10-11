import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalise } from './lib/compare.ts'
import { type Harness, both, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of the multi-table query builder (docs/features/05-database-level.md): the column
 * catalogue of the form and the foreign keys "Update query" joins with.
 */
const users = { pma: 'f05_mq_pma', bma: 'f05_mq_bma' }
const P = 'f05_mqp'
const B = 'f05_mqb'
const dbMap: Record<string, string> = { [P]: 'DB', [B]: 'DB' }
let h: Harness

const seed = (db: string) => `
DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db};
CREATE TABLE ${db}.parent (id INT PRIMARY KEY, name VARCHAR(10));
CREATE TABLE ${db}.child (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES ${db}.parent (id));
CREATE TABLE ${db}.other (x INT);
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

const reads = (log: Array<{ sql: string }>, re: RegExp) =>
  log.map((e) => normalise(e.sql, dbMap)).filter((s) => re.test(s))

describe.skipIf(!pmaReachable)('parity: multi-table query', () => {
  it('the form lists every table with its columns', async () => {
    const r = await both(
      h,
      () => h.pma.pageGet('/database/multi-table-query', { db: P }),
      () => h.bma.req('GET', `/api/servers/1/databases/${B}/multi-table-query`),
    )
    const re = /^SELECT TABLE_NAME, COLUMN_NAME FROM information_schema\.columns/
    expect(reads(r.bmaLog, re)).toEqual(reads(r.pmaLog, re))
    const tables = (r.b.json as { tables: Array<{ name: string; columns: string[] }> }).tables
    for (const t of tables) {
      expect(r.p).toContain(`value="${t.name}">${t.name}</option>`)
      for (const c of t.columns) expect(r.p).toContain(`<option value="${c}">${c}</option>`)
    }
  })

  it('the foreign keys between the chosen tables', async () => {
    const r = await both(
      h,
      () =>
        h.pma.getJson('/database/multi-table-query/tables', {
          db: P,
          'tables[0]': 'child',
          'tables[1]': 'parent',
        }),
      () =>
        h.bma.req('GET', `/api/servers/1/databases/${B}/multi-table-query/tables?tables=child&tables=parent`),
    )
    const re = /key_column_usage/
    expect(reads(r.bmaLog, re)).toEqual(reads(r.pmaLog, re))
    expect((r.b.json as { foreignKeyConstrains: unknown[] }).foreignKeyConstrains).toEqual(
      r.p.foreignKeyConstrains,
    )
  })
})
