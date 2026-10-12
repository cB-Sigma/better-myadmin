import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compareLogs } from './lib/compare.ts'
import type { LogEntry } from './lib/general-log.ts'
import { type Harness, PER_REQUEST, both, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * The pickers' name lists (pma: /tables TableController, /columns ColumnController): the export
 * page's "Rename exported databases/tables/columns" dialog. The statements (SHOW TABLES FROM,
 * the information_schema column query) and the lists, in phpMyAdmin's order (NaturalOrder).
 */
const users = { pma: 'f09n_pma', bma: 'f09n_bma' }
const DB = 'f09n_db'
let h: Harness

/**
 * A request with `db` makes phpMyAdmin's middleware check the database first (DbTableExists:
 * `SHOW TABLES FROM \`db\``), then TableController lists the tables with the same statement: the
 * first one is the middleware's (BetterMyAdmin validates scope lazily).
 */
function withoutDbCheck(log: LogEntry[]): LogEntry[] {
  const shows = log.filter((e) => /^SHOW TABLES FROM `[^`]+`;?$/.test(e.sql.trim()))
  if (shows.length < 2) return log
  return log.filter((e) => e !== shows[0])
}

/**
 * Strict: phpMyAdmin's `SHOW TABLES FROM` is the statement under test (allowed-diffs lets it pass as
 * a DbTableExists read elsewhere). The table-scope DbTableExists::hasTable read of /columns is
 * phpMyAdmin's request middleware (BetterMyAdmin validates scope lazily).
 */
const diff = (_h: Harness, pmaLog: LogEntry[], bmaLog: LogEntry[]) =>
  compareLogs(withoutDbCheck(pmaLog), bmaLog, h.dbMap, {
    extra: [
      ...PER_REQUEST,
      {
        tool: 'pma',
        pattern: `^SELECT 1 FROM \`${DB}\`\\.\`[^\`]+\` LIMIT 1$`,
        why: 'DbTableExists::hasTable of the request middleware (db + table parameters)',
      },
    ],
    exclude: ['^SHOW TABLES FROM `[^`]+`$'],
  })

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness({}, users)
  await h.root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t10 (id INT); CREATE TABLE ${DB}.t2 (b INT, a INT, \`c d\` INT); CREATE TABLE ${DB}.T1 (x INT);
    CREATE VIEW ${DB}.v AS SELECT 1 AS one;`)
  // warm-up (session set-up, cached server facts)
  await h.pma.postJson('/tables', { db: DB })
  await h.bma.req('POST', '/api/servers/1/tables', { db: DB })
})
afterAll(async () => {
  await h?.root.query(`DROP DATABASE IF EXISTS ${DB}`)
  await h?.close()
})

describe.skipIf(!pmaReachable)('parity: /tables and /columns', () => {
  const tables = (db?: string) =>
    both(
      h,
      () => h.pma.postJson('/tables', db === undefined ? {} : { db }),
      () => h.bma.req('POST', '/api/servers/1/tables', db === undefined ? {} : { db }),
    )
  const columns = (form: Record<string, string>) =>
    both(
      h,
      () => h.pma.postJson('/columns', form),
      () => h.bma.req('POST', '/api/servers/1/columns', form),
    )

  it('the tables of a database (views included, natural order)', async () => {
    const r = await tables(DB)
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(cmp.bma).toContain(`SHOW TABLES FROM \`${DB}\``)
    const b = r.b.json as { success: boolean; tables: string[] }
    expect(b.success).toBe(true)
    expect(b.tables).toEqual(r.p.tables)
    expect(b.tables).toEqual(['T1', 't2', 't10', 'v'])
  })

  it('an unknown database: an empty list', async () => {
    const r = await tables('f09n_missing')
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect((r.b.json as { tables: string[] }).tables).toEqual(r.p.tables)
  })

  it('no db: success false and Message::error()', async () => {
    const r = await tables()
    expect(r.p.success).toBe(false)
    const b = r.b.json as { success: boolean; message: string }
    expect(b.success).toBe(false)
    expect(String(r.p.error ?? r.p.message)).toContain(b.message)
    expect(diff(h, r.pmaLog, r.bmaLog).problems).toEqual([])
  })

  it('the columns of a table (ORDINAL_POSITION)', async () => {
    const r = await columns({ db: DB, table: 't2' })
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(
      cmp.bma.some((s) =>
        s.startsWith('SELECT `COLUMN_NAME`, `COLUMN_TYPE` FROM `information_schema`.`COLUMNS`'),
      ),
    ).toBe(true)
    const b = r.b.json as { success: boolean; columns: string[] }
    expect(b.columns).toEqual(r.p.columns)
    expect(b.columns).toEqual(['b', 'a', 'c d'])
  })

  it('no table: success false', async () => {
    const r = await columns({ db: DB })
    expect(r.p.success).toBe(false)
    expect((r.b.json as { success: boolean }).success).toBe(false)
    expect(diff(h, r.pmaLog, r.bmaLog).problems).toEqual([])
  })
})
