import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/** Database Structure tab and its bulk actions through the API (docs/features/05-database-level.md). */
const DB = 'f05_it_struct'
let root: mysql.Connection
const app = testApp(testConfig({ MaxTableList: 2 }))
const base = `/api/servers/1/databases/${DB}`

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB}_copy; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.a (id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(10)) ENGINE=InnoDB;
    INSERT INTO ${DB}.a (v) VALUES ('x'), ('y');
    CREATE TABLE ${DB}.b (id INT, KEY (id)) ENGINE=MyISAM;
    CREATE TABLE ${DB}.c (id INT, a_id INT, FOREIGN KEY (a_id) REFERENCES a (id)) ENGINE=InnoDB;
    CREATE VIEW ${DB}.v AS SELECT * FROM ${DB}.a;
    CREATE DATABASE ${DB}_copy;`)
  await app.login()
})
afterAll(async () => {
  await root.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB}_copy`)
  await root.end()
  await app.close()
})

describe('database structure', () => {
  it('lists a page of tables with exact counts, the pager and the summary', async () => {
    const r = await app.req('GET', `${base}/structure?pos=0`)
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    const tables = r.json.tables as Array<{ name: string; rows: number; engine: string }>
    expect(tables.map((t) => t.name)).toEqual(['a', 'b'])
    expect(tables[0]).toMatchObject({ rows: 2, engine: 'InnoDB' })
    expect((r.json.pager as { total: number }).total).toBe(4)
    expect((r.json.summary as { numTables: number }).numTables).toBe(2)
  })

  it('redirects a position past the end to the last page [p05-9533c7]', async () => {
    const r = await app.req('GET', `${base}/structure?pos=10`)
    expect(r.json.redirectPos).toBe(2)
  })

  it('shows the view with -1 rows (MaxExactCountViews = 0) [p05-be3af8]', async () => {
    const r = await app.req('GET', `${base}/structure?pos=2`)
    const v = (r.json.tables as Array<{ name: string; isView: boolean; rowsText: string }>).find(
      (t) => t.name === 'v',
    )
    expect(v).toMatchObject({ isView: true, rowsText: '-1' })
  })

  it('copies tables to another database, adds a prefix and shows create [p05-d5ead9]', async () => {
    const copy = await app.req('POST', `${base}/structure/copy`, {
      tables: ['a', 'c'],
      targetDb: `${DB}_copy`,
    })
    expect(copy.status, JSON.stringify(copy.json)).toBe(200)
    const [rows] = await root.query(`SELECT COUNT(*) n FROM ${DB}_copy.a`)
    expect((rows as Array<{ n: number }>)[0]?.n).toBe(2)
    const pre = await app.req('POST', `${base}/structure/add-prefix`, { tables: ['b'], prefix: 'p_' })
    expect(JSON.stringify(pre.json)).toContain('ALTER TABLE `b` RENAME `p_b`')
    const sc = await app.req('POST', `${base}/structure/show-create`, { tables: ['p_b', 'v'] })
    expect((sc.json.tables as unknown[]).length).toBe(1)
    expect((sc.json.views as unknown[]).length).toBe(1)
  })

  it('runs table maintenance and empties/drops with confirmation [p05-a7eaad]', async () => {
    const m = await app.req('POST', `${base}/structure/maintenance`, { op: 'check', tables: ['a'] })
    // Message::fromArray keeps the server's Table: `db`.`table`
    expect((m.json.maintenance as { rows: Array<{ table: string }> }).rows[0]?.table).toBe(`${DB}.a`)
    const no = await app.req('POST', `${base}/structure/empty`, { tables: ['a'], confirmed: false })
    expect(JSON.stringify(no.json)).toContain('No change')
    const e = await app.req('POST', `${base}/structure/empty`, { tables: ['c'], fkChecks: false })
    expect(JSON.stringify(e.json)).toContain('TRUNCATE `c`')
    const d = await app.req('POST', `${base}/structure/drop`, { tables: ['c', 'v'], fkChecks: false })
    expect(JSON.stringify(d.json)).toContain('DROP TABLE `c`; DROP VIEW `v`;')
  })

  it('counts rows on demand', async () => {
    const r = await app.req('GET', `${base}/structure/real-row-count?all=1`)
    expect(r.json.realRowCountAll).toContainEqual({ table: 'a', rowCount: '2' })
  })
})
