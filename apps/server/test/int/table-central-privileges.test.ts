import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Table Structure → central columns actions, the Pick from Central Columns list and the table
 * Privileges tab through the API (docs/features/04-table-level.md).
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const J = (r: { json: unknown }): Any => r.json
const DB = 'f04_it_central'
let root: mysql.Connection
const app = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }))
const bare = testApp(testConfig({}))
const base = `/api/servers/1/databases/${DB}`
const clean = `DELETE FROM phpmyadmin.pma__central_columns WHERE db_name = '${DB}';`

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.a (id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(10) DEFAULT 'x');
    CREATE TABLE ${DB}.b (id INT);
    ${clean}`)
  await app.login()
  await bare.login()
})
afterAll(async () => {
  await root.query(`${clean} DROP DATABASE IF EXISTS ${DB}`)
  await root.end()
  await app.close()
  await bare.close()
})

describe('Structure central columns', () => {
  it('adds and removes columns, marks them on the page, lists them for the column form', async () => {
    let r = await app.req('POST', `${base}/tables/a/structure/central-columns-add`, { columns: ['id', 'v'] })
    expect(J(r).messages).toEqual([
      { type: 'success', text: 'Your SQL query has been executed successfully.' },
    ])
    r = await app.req('GET', `${base}/tables/a/structure`)
    expect(J(r).columns.map((c: Any) => c.inCentralList)).toEqual([true, true])
    // Pick from Central Columns on b: the central columns b does not have
    r = await app.req('GET', `${base}/central-columns/list?table=b`)
    expect(J(r).map((c: Any) => c.name)).toEqual(['v'])
    r = await app.req('POST', `${base}/tables/a/structure/central-columns-add`, { columns: ['v'] })
    expect(J(r).messages[0].text).toContain("Could not add 'v' as they already exist in central list!")
    r = await app.req('POST', `${base}/tables/a/structure/central-columns-remove`, { columns: ['v'] })
    expect(J(r).messages[0].type).toBe('success')
    r = await app.req('GET', `${base}/tables/a/structure`)
    expect(J(r).columns.map((c: Any) => c.inCentralList)).toEqual([true, false])
    r = await app.req('POST', `${base}/tables/a/structure/central-columns-remove`, { columns: [] })
    expect(J(r).messages[0]).toEqual({ type: 'error', text: 'No column selected.' })
    r = await app.req('GET', `${base}/tables/a/columns/add-form`)
    expect(J(r).options).toMatchObject({ centralColumns: true, maxRows: 25 })
  })
})

describe('table Privileges', () => {
  it('lists the accounts with access to the table', async () => {
    const r = await bare.req('GET', `${base}/tables/a/privileges`)
    expect(r.status).toBe(200)
    expect(J(r)).toMatchObject({ db: DB, table: 'a', gate: { isSuperUser: true, noPrivileges: false } })
    expect(J(r).accounts.some((a: Any) => a.privileges.some((p: Any) => p.type === 'g'))).toBe(true)
  })
})
