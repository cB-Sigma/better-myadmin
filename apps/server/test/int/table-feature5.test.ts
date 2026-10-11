import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * The view form, the chart and the GIS visualization through the API
 * (docs/features/04-table-level.md, feature 5 of the table level).
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const J = (r: { json: unknown }): Any => r.json
const DB = 'f04_it_f5'
let root: mysql.Connection
const app = testApp(testConfig({}))
const base = `/api/servers/1/databases/${DB}`

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, name VARCHAR(10), qty DECIMAL(6,2), d DATE, g POINT);
    INSERT INTO ${DB}.t VALUES (1, 'a', 1.5, '2024-01-01', ST_GeomFromText('POINT(1 2)')),
      (2, 'b', 2.5, '2024-01-02', ST_GeomFromText('POINT(3 4)'));`)
  await app.login()
})
afterAll(async () => {
  await root.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root.end()
  await app.close()
})

describe('view form', () => {
  it('creates, prefills the edit form, alters', async () => {
    let r = await app.req('GET', `${base}/views/form?sql=${encodeURIComponent('SELECT id FROM t')}`)
    expect(J(r)).toMatchObject({ operation: 'create', view: { as: 'SELECT id FROM t', name: '' } })
    r = await app.req('POST', `${base}/views`, {
      operation: 'create',
      view: { name: 'v', algorithm: 'UNDEFINED', as: 'SELECT id, name FROM t' },
    })
    expect(J(r)).toMatchObject({ ok: true, messages: [{ type: 'success' }] })
    expect(J(r).messages[0].sql).toBe(
      'CREATE\r\n ALGORITHM = UNDEFINED\r\n VIEW `v`\r\n AS SELECT id, name FROM t',
    )
    r = await app.req('GET', `${base}/views/form?table=v`)
    expect(J(r)).toMatchObject({
      operation: 'alter',
      view: { name: 'v', algorithm: 'UNDEFINED', sqlSecurity: 'DEFINER' },
    })
    expect(J(r).view.as).toContain('`t`.`name`')
    r = await app.req('POST', `${base}/views`, {
      operation: 'alter',
      view: { name: 'v', as: 'SELECT id FROM t' },
    })
    expect(J(r).ok).toBe(true)
    r = await app.req('GET', `${base}/tables/v/structure`)
    expect(J(r).links.editView).toBe(true)
  })

  it('answers the errors', async () => {
    let r = await app.req('POST', `${base}/views`, {
      operation: 'create',
      view: { name: '', as: 'SELECT 1' },
    })
    expect(J(r).messages).toEqual([{ type: 'error', text: 'View name can not be empty!' }])
    r = await app.req('POST', `${base}/views`, { operation: 'create', view: { name: 'v', as: 'SELECT 1' } })
    expect(J(r).ok).toBe(false)
    expect(J(r).messages[0].text).toBe("#1050 - Table 'v' already exists")
  })
})
