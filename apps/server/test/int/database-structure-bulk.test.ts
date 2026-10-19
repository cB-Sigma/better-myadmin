import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp } from '../support/app.ts'
import { isMariaDb } from '../support/vendor.ts'

/**
 * The Structure tab's bulk actions as phpMyAdmin answers them (side by side QA): the maintenance
 * page's `db`.`table` cards and query card, the copy form's databases, a failed DROP with its query
 * card, a failed TRUNCATE as mysqlDie, the row count of a table copied with a prefix.
 */
const DB = 'f07_it_bulk'
let root: mysql.Connection
const app = testApp()
const base = `/api/servers/1/databases/${DB}`
type Json = Record<string, unknown>

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE authors (id INT PRIMARY KEY) ENGINE=InnoDB;
    CREATE TABLE books (id INT, author_id INT, FOREIGN KEY (author_id) REFERENCES authors (id)) ENGINE=InnoDB;
    CREATE TABLE logs (id INT) ENGINE=MyISAM;
    INSERT INTO authors VALUES (1), (2); INSERT INTO books VALUES (1, 1); INSERT INTO logs VALUES (1), (2);`)
  await app.login()
})
afterAll(async () => {
  await root.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root.end()
  await app.close()
})

describe('database structure bulk actions', () => {
  it('maintenance: the cards are named `db`.`table`; ANALYZE has the query card with Refresh and Profiling', async () => {
    const r = await app.req('POST', `${base}/structure/maintenance`, {
      op: 'analyze',
      tables: ['authors', 'logs'],
    })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    const rows = (r.json.maintenance as { rows: Array<{ table: string }> }).rows
    expect([...new Set(rows.map((x) => x.table))]).toEqual([`${DB}.authors`, `${DB}.logs`])
    const m = (r.json.messages as Json[])[0] as { sql: string; card: { links: Json } }
    expect(m.sql).toBe('ANALYZE TABLE `authors`, `logs`;')
    expect(m.card.links).toMatchObject({ editInline: true, edit: true, php: 'create', refresh: true })
    expect(m.card.links.profiling).toEqual({ checked: false })
    const check = await app.req('POST', `${base}/structure/maintenance`, { op: 'check', tables: ['logs'] })
    const c = (check.json.messages as Json[])[0] as { card: { links: Json } }
    expect(c.card.links).toMatchObject({ refresh: false, profiling: null })
  })

  it('the copy form lists the databases but the current one and the system schemas', async () => {
    const r = await app.req('GET', `${base}/structure/copy-form`)
    const dbs = r.json.databases as string[]
    expect(dbs).toContain('mysql')
    expect(dbs).not.toContain(DB)
    for (const s of ['information_schema', 'performance_schema', 'sys']) expect(dbs).not.toContain(s)
  })

  it('a failed DROP: the error with its query card (Generator::getMessage)', async () => {
    const r = await app.req('POST', `${base}/structure/drop`, { tables: ['authors'], fkChecks: true })
    const m = (r.json.messages as Json[])[0] as { type: string; text: string; card: { links: Json } }
    expect(m.type).toBe('error')
    // MySQL 8: #3730 "Cannot drop table … referenced by a foreign key constraint"; MariaDB keeps
    // the generic parent-row error #1451 for DROP (both are the server's own wording, shown as is)
    expect(m.text).toMatch(
      isMariaDb
        ? /^#1451 - Cannot delete or update a parent row: a foreign key constraint fails/
        : /^#3730 - Cannot drop table 'authors' referenced by a foreign key constraint/,
    )
    expect(m.card.links).toMatchObject({ editInline: true, edit: true, php: 'create' })
  })

  it('a failed TRUNCATE is the MySQL error with its statement (mysqlDie)', async () => {
    const r = await app.req('POST', `${base}/structure/empty`, { tables: ['authors'], fkChecks: true })
    expect(r.status).toBe(400)
    const e = r.json.error as { errno: number; sql: string }
    expect(e).toMatchObject({ errno: 1701, sql: 'TRUNCATE `authors`' })
  })

  it('a table copied with a prefix shows its rows (Table::isView does not read its status before the data)', async () => {
    const r = await app.req('POST', `${base}/structure/copy-with-prefix`, {
      tables: ['logs'],
      fromPrefix: 'l',
      toPrefix: 'c',
    })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    const s = await app.req('GET', `${base}/structure`)
    const cogs = (s.json.tables as Array<{ name: string; rowsText: string }>).find((t) => t.name === 'cogs')
    expect(cogs?.rowsText).toBe('2')
  })
})
