import type { DbStructureResponse } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalise } from './lib/compare.ts'
import type { LogEntry } from './lib/general-log.ts'
import { type PmaShadow, canStartShadow, startPmaShadow } from './lib/pma-shadow.ts'
import { type Harness, ROOT, both, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of configuration directives that change the statements a page sends, against a
 * phpMyAdmin shadow configured the same way.
 *
 * - `SkipLockedTables`: the database Structure tab lists the tables from `SHOW OPEN TABLES … In_use > 0`
 *   and `SHOW FULL TABLES`, without the status of the tables in use
 *   (StructureController::getTablesWhenOpen).
 */
const PORT = 18951
const users = { pma: 'f01a_dir_pma', bma: 'f01a_dir_bma' }
const P = 'f01a_dirp'
const B = 'f01a_dirb'
const dbMap: Record<string, string> = { [P]: 'DB', [B]: 'DB' }
const available = pmaReachable && canStartShadow()

let shadow: PmaShadow
let h: Harness
let locker: mysql.Connection

const seed = (db: string) => `
DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db};
CREATE TABLE ${db}.a (id INT) ENGINE=InnoDB; CREATE TABLE ${db}.b (id INT) ENGINE=MyISAM;
CREATE TABLE ${db}.c10 (id INT); CREATE TABLE ${db}.c9 (id INT); CREATE VIEW ${db}.v AS SELECT id FROM ${db}.a;
`

beforeAll(async () => {
  if (!available) return
  shadow = await startPmaShadow(PORT, { cfg: { SkipLockedTables: true } })
  h = await startHarness({ SkipLockedTables: true }, users, {}, { root: ROOT, pmaUrl: shadow.url })
  await h.root.query(seed(P) + seed(B))
})
afterAll(async () => {
  await locker?.end()
  await h?.root.query(`DROP DATABASE IF EXISTS ${P}; DROP DATABASE IF EXISTS ${B}`)
  await h?.close()
  await shadow?.stop()
})

const READS = /^(SHOW OPEN TABLES|SHOW FULL TABLES|SELECT \*, `TABLE_SCHEMA` +AS `Db`|SHOW TABLE STATUS)/
const reads = (log: LogEntry[]) => log.map((e) => normalise(e.sql, dbMap)).filter((s) => READS.test(s))

async function page(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString()
  const r = await both(
    h,
    () => h.pma.getJson('/database/structure', { db: P, ...params }),
    () => h.bma.req('GET', `/api/servers/1/databases/${B}/structure${qs === '' ? '' : `?${qs}`}`),
  )
  expect(r.b.status, JSON.stringify(r.b.json)).toBe(200)
  const html = String(r.p.message ?? '')
  const pmaNames = [...html.matchAll(/<tr id="row_tbl_\d+"[^>]*data-filter-row="([^"]+)"/g)].map((m) => m[1])
  const d = r.b.json as unknown as DbStructureResponse
  return {
    pmaReads: reads(r.pmaLog),
    bmaReads: reads(r.bmaLog),
    pmaNames,
    bmaNames: d.tables.map((t) => t.name.toUpperCase()),
  }
}

describe.skipIf(!available)('parity: SkipLockedTables', () => {
  it('no table in use: nothing is listed', async () => {
    const r = await page()
    expect(r.bmaReads).toEqual(r.pmaReads)
    expect(r.bmaReads[0]).toBe('SHOW OPEN TABLES FROM `DB` WHERE In_use > 0')
    expect(r.bmaNames).toEqual(r.pmaNames)
    expect(r.bmaNames).toEqual([])
  })

  it('a locked table is listed without its status, the others with it; group and type filters', async () => {
    locker = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    await locker.query(`LOCK TABLES ${P}.b READ, ${B}.b READ`)
    for (const params of [{}, { tbl_type: 'table' }, { tbl_type: 'view' }, { tbl_group: 'c' }]) {
      const r = await page(params)
      expect(r.bmaReads, JSON.stringify(params)).toEqual(r.pmaReads)
      expect(r.bmaNames, JSON.stringify(params)).toEqual(r.pmaNames)
      if (Object.keys(params).length === 0) {
        expect(r.bmaNames).toEqual(['A', 'B', 'C9', 'C10', 'V'])
        // the table in use is not asked for its status
        expect(r.bmaReads.some((s) => s.includes("IN ('a', 'c10', 'c9', 'v')"))).toBe(true)
      }
    }
    await locker.query('UNLOCK TABLES')
  })
})
