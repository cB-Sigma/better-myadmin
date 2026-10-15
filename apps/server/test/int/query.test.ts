import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp } from '../support/app.ts'

type St = {
  kind: string
  executedSql: string
  message: { type: string; text: string }
  result?: {
    rows: unknown[][]
    totalRows: number
    limitAppended: boolean
    fields: Array<{ name: string; flags: { numeric: boolean } }>
  }
  affectedRows?: number
  db: string | null
}

let t: ReturnType<typeof testApp>
const DB = 'bma_it_query'

beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(20), big BIGINT UNSIGNED, d DECIMAL(30,10), b VARBINARY(4), bits BIT(5), j JSON);
    INSERT INTO t (name, big, d, b, bits, j) VALUES ('first', 18446744073709551615, 12345678901234567890.0123456789, 0x00ff10, b'10101', '{"a": 1}');`)
  for (let i = 2; i <= 30; i++) await c.query(`INSERT INTO ${DB}.t (name) VALUES ('row${i}')`)
  await c.end()
  t = testApp()
  await t.login()
})
afterAll(async () => t?.close())

async function q(sql: string, extra: Record<string, unknown> = {}): Promise<St[]> {
  const r = await t.req('POST', '/api/servers/1/query', { sql, db: DB, fromQueryBox: true, ...extra })
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json.statements as St[]
}

describe('query pipeline (Sql.php parity)', () => {
  it('appends LIMIT pos, max_rows to a plain SELECT … FROM and counts exactly when just browsing [p02-9f5692 p02-b29af3]', async () => {
    const [st] = await q('SELECT * FROM t')
    expect(st!.executedSql).toBe('SELECT * FROM t LIMIT 0, 25')
    expect(st!.result!.rows).toHaveLength(25)
    expect(st!.result!.totalRows).toBe(30)
    expect(st!.message.text).toMatch(/^Showing rows 0 - 24 \(30 total, Query took \d+\.\d{4} seconds\.\)$/)
  })

  it('respects session_max_rows and pos', async () => {
    const [st] = await q('SELECT * FROM t', { pos: 25, maxRows: 10 })
    expect(st!.executedSql).toBe('SELECT * FROM t LIMIT 25, 10')
    expect(st!.result!.rows).toHaveLength(5)
    // fewer rows than a page: no count query, total = pos + numRows
    expect(st!.result!.totalRows).toBe(30)
    expect(st!.message.text).toMatch(/^Showing rows 25 - 29 \(30 total,/)
  })

  it('does not limit SELECT without FROM, or a query with its own LIMIT [p02-9f5692 p02-290262]', async () => {
    const [a] = await q('SELECT 1')
    expect(a!.executedSql).toBe('SELECT 1;')
    const [b] = await q('SELECT * FROM t LIMIT 3')
    expect(b!.executedSql).toBe('SELECT * FROM t LIMIT 3;')
    expect(b!.result!.rows).toHaveLength(3)
  })

  it('wraps a non-trivial SELECT in SELECT COUNT(*) FROM (…) as cnt [p02-b29af3]', async () => {
    const [st] = await q("SELECT id, name FROM t WHERE name LIKE 'row%' ORDER BY id DESC", { maxRows: 5 })
    expect(st!.result!.totalRows).toBe(29)
    const r = await t.req('POST', '/api/servers/1/query', {
      sql: "SELECT id FROM t WHERE name LIKE 'row%'",
      db: DB,
      maxRows: 5,
    })
    expect((r.json.statements as St[])[0]!.result!.totalRows).toBe(29)
  })

  it('never parses numbers: BIGINT/DECIMAL/JSON as exact text, binary as base64, BIT as bytes', async () => {
    const [st] = await q('SELECT big, d, b, bits, j FROM t WHERE id = 1')
    const row = st!.result!.rows[0]!
    expect(row[0]).toBe('18446744073709551615')
    expect(row[1]).toBe('12345678901234567890.0123456789')
    expect(row[2]).toEqual({ b64: Buffer.from([0x00, 0xff, 0x10]).toString('base64'), bytes: 3 })
    expect(row[3]).toEqual({ b64: Buffer.from([0b10101]).toString('base64'), bytes: 1 })
    expect(row[4]).toBe('{"a": 1}')
    expect(st!.result!.fields[0]!.flags.numeric).toBe(true)
  })

  it('INSERT reports rows inserted and the inserted row id [p09-a212a5 p02-68785a]', async () => {
    const [st] = await q("INSERT INTO t (name) VALUES ('x'), ('y')")
    expect(st!.kind).toBe('affected')
    expect(st!.message.text).toMatch(/^2 rows inserted\.\nInserted row id: 32 \(Query took/)
    const [d] = await q("DELETE FROM t WHERE name IN ('x', 'y')")
    expect(d!.message.text).toMatch(/^2 rows deleted\. \(Query took/)
  })

  it('UPDATE counts changed rows like mysqli (no CLIENT_FOUND_ROWS) [p09-a212a5]', async () => {
    const [same] = await q("UPDATE t SET name = 'first' WHERE id = 1")
    expect(same!.message.text).toMatch(/^0 rows affected\./)
  })

  it('UPDATE matching nothing says 0 rows affected; DDL says executed successfully [p09-a212a5 p02-68785a]', async () => {
    const [u] = await q("UPDATE t SET name = 'z' WHERE id = -1")
    expect(u!.message.text).toMatch(/^0 rows affected\./)
    const [c] = await q('CREATE TABLE IF NOT EXISTS t2 (a INT)')
    // SQL-box statements get messageToShow = '' (ImportController goSql branch)
    expect(c!.message.text).toMatch(/^MySQL returned an empty result set \(i\.e\. zero rows\)\./)
  })

  it('empty result set with columns [p09-a212a5 p02-68785a p02-141e59]', async () => {
    const [st] = await q('SELECT * FROM t WHERE id = -1')
    expect(st!.kind).toBe('empty')
    expect(st!.message.text).toMatch(/^MySQL returned an empty result set \(i\.e\. zero rows\)\./)
  })

  it('splits multi-statement input by the delimiter field and honours DELIMITER lines', async () => {
    const sts = await q('SELECT 1; SELECT 2;\nDELIMITER //\nSELECT 3 //')
    expect(sts.map((s) => s.executedSql)).toEqual(['SELECT 1;', 'SELECT 2;', 'SELECT 3;'])
    const custom = await q('SELECT 1 $$ SELECT 2', { delimiter: '$$' })
    expect(custom).toHaveLength(2)
  })

  it('stops at the first error and reports #errno - message [p02-fa2d56]', async () => {
    const sts = await q('SELECT 1; SELECT * FROM nope; SELECT 1')
    // like mysqlDie: the response is only the error, showing the SQL actually sent
    expect(sts).toHaveLength(1)
    expect(sts[0]!.kind).toBe('error')
    expect(sts[0]!.executedSql).toBe('SELECT * FROM nope LIMIT 0, 25')
    expect(sts[0]!.message.text).toBe(`#1146 - Table '${DB}.nope' doesn't exist`)
  })

  it('re-selects the page database before every statement, like phpMyAdmin', async () => {
    // verified against the reference phpMyAdmin: the second statement still sees the page's db
    const sts = await q('USE mysql; SELECT DATABASE()')
    expect(sts[0]!.message.text).toMatch(/^MySQL returned an empty result set/)
    expect(sts[1]!.result!.rows[0]![0]).toBe(DB)
  })

  it('SHOW is not limited and has no navigation message [p02-507e37]', async () => {
    const [st] = await q('SHOW TABLES')
    expect(st!.executedSql).toBe('SHOW TABLES;')
    expect(st!.message.text).toMatch(/^Your SQL query has been executed successfully\. \(Query took/)
  })
})
