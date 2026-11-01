import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * GET /api/servers/:s/command-palette — the command palette's databases and tables (BetterMyAdmin
 * only, parity exception X61).
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const J = (r: { json: unknown }): Any => r.json
const DB = 'x61_it_palette'
const HIDDEN = 'x61_it_palette_hidden'
let root: mysql.Connection
const app = testApp(testConfig({}))

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    DROP DATABASE IF EXISTS ${HIDDEN}; CREATE DATABASE ${HIDDEN};
    CREATE TABLE ${DB}.x61_customer (id INT); CREATE TABLE ${DB}.x61_customer_list (id INT);
    CREATE TABLE ${DB}.x61_c_u_s_t (id INT); CREATE VIEW ${DB}.x61_cust_view AS SELECT 1 AS a;
    CREATE TABLE ${HIDDEN}.x61_customer (id INT);`)
  await app.login()
})
afterAll(async () => {
  await root.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${HIDDEN}`)
  await root.end()
  await app.close()
})

const search = async (q: string, db?: string, a = app) =>
  J(await a.req('GET', `/api/servers/1/command-palette?${new URLSearchParams({ q, ...(db ? { db } : {}) })}`))

describe('command palette search (X61)', () => {
  it('finds tables of every database by the letters of the query in order, best first', async () => {
    const r = await search('x61_cust')
    const ours = r.tables.filter((t: Any) => t.db === DB).map((t: Any) => t.table)
    // prefixes (shorter first), then the scattered match; LIKE wildcards in the query are literal
    expect(ours).toEqual(['x61_customer', 'x61_cust_view', 'x61_customer_list', 'x61_c_u_s_t'])
    expect((await search('x61%cust')).tables).toEqual([])
    expect(r.tables.find((t: Any) => t.table === 'x61_cust_view')).toMatchObject({ db: DB, view: true })
    expect(r.tables.find((t: Any) => t.db === HIDDEN)).toBeTruthy()
  })

  it('narrows both parts with db.table and matches databases', async () => {
    const r = await search(`${HIDDEN}.x61cus`)
    expect(r.tables).toEqual([{ db: HIDDEN, table: 'x61_customer', view: false }])
    expect(r.databases).toEqual([HIDDEN])
    expect((await search('x61itpal')).databases).toEqual([DB, HIDDEN])
  })

  it('lists the current database tables for an empty query', async () => {
    const r = await search('', DB)
    expect(r.tables.map((t: Any) => t.table).sort()).toEqual([
      'x61_c_u_s_t',
      'x61_cust_view',
      'x61_customer',
      'x61_customer_list',
    ])
    expect((await search('')).tables).toEqual([])
  })

  it('leaves out the databases hide_db hides', async () => {
    const hidden = testApp(testConfig({}, { hide_db: '^x61_it_palette_hidden$' }))
    await hidden.login()
    const r = await search('x61cus', undefined, hidden)
    expect(r.tables.some((t: Any) => t.db === HIDDEN)).toBe(false)
    expect(r.tables.some((t: Any) => t.db === DB)).toBe(true)
    expect((await search('x61itpal', undefined, hidden)).databases).toEqual([DB])
    await hidden.close()
  })
})
