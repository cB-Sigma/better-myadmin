import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp } from '../support/app.ts'

/** Database Operations through the API: copy, rename, collation. */
const DB = 'f05_it_ops'
let root: mysql.Connection
const app = testApp()
const base = (db: string) => `/api/servers/1/databases/${db}`

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB}_c; DROP DATABASE IF EXISTS ${DB}_r;
    CREATE DATABASE ${DB}; CREATE TABLE ${DB}.a (id INT PRIMARY KEY); INSERT INTO ${DB}.a VALUES (1), (2);
    CREATE VIEW ${DB}.v AS SELECT id FROM ${DB}.a;`)
  await app.login()
})
afterAll(async () => {
  await root.query(
    `DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB}_c; DROP DATABASE IF EXISTS ${DB}_r`,
  )
  await root.end()
  await app.close()
})

describe('database operations', () => {
  it('reads the page', async () => {
    const r = await app.req('GET', `${base(DB)}/operations`)
    expect(r.status).toBe(200)
    expect(r.json.isDropDatabaseAllowed).toBe(true)
    expect((r.json.charsets as unknown[]).length).toBeGreaterThan(5)
  })

  it('copies with data and switches to the copy', async () => {
    const r = await app.req('POST', `${base(DB)}/operations/copy`, { newName: `${DB}_c`, switchToNew: true })
    expect(r.json.db).toBe(`${DB}_c`)
    const [rows] = await root.query(`SELECT COUNT(*) n FROM ${DB}_c.v`)
    expect((rows as Array<{ n: number }>)[0]?.n).toBe(2)
  })

  it('renames and drops the old database', async () => {
    const r = await app.req('POST', `${base(`${DB}_c`)}/operations/rename`, { newName: `${DB}_r` })
    expect(JSON.stringify(r.json.messages)).toContain('has been renamed to')
    const [rows] = await root.query(`SHOW DATABASES LIKE '${DB}\\_c'`)
    expect((rows as unknown[]).length).toBe(0)
  })

  it('changes the collation of the database and its tables', async () => {
    const r = await app.req('POST', `${base(DB)}/operations/collation`, {
      collation: 'latin1_bin',
      changeAllTables: true,
    })
    expect(r.status).toBe(200)
    const [rows] = await root.query(
      `SELECT TABLE_COLLATION c FROM information_schema.TABLES WHERE TABLE_SCHEMA='${DB}' AND TABLE_NAME='a'`,
    )
    expect((rows as Array<{ c: string }>)[0]?.c).toBe('latin1_bin')
    const none = await app.req('POST', `${base(DB)}/operations/collation`, { collation: '' })
    expect(none.status).toBe(400)
  })
})
