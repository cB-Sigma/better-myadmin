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

describe('chart', () => {
  it('answers the form data, the rows and the errors', async () => {
    const sql = 'SELECT name, qty, d FROM t'
    let r = await app.req('POST', `${base}/tables/t/chart`, { sql, unlimNumRows: 2 })
    expect(J(r)).toEqual({
      error: null,
      columns: [
        { name: 'name', numeric: false, dateTime: false },
        { name: 'qty', numeric: true, dateTime: false },
        { name: 'd', numeric: false, dateTime: true },
      ],
      // the last page of 2 rows by $cfg['MaxRows']
      fieldset: { pos: 0, rows: 25, unlimNumRows: 2, sql },
    })
    r = await app.req('POST', `${base}/tables/t/chart/data`, { sql, pos: 1, sessionMaxRows: 5 })
    expect(J(r)).toEqual({ error: null, data: [{ name: 'b', qty: '2.50', d: '2024-01-02' }] })
    r = await app.req('POST', `${base}/tables/t/chart/data`, {
      sql: `${sql} LIMIT 1, 1`,
      pos: 0,
      sessionMaxRows: 5,
    })
    expect(J(r).data).toEqual([{ name: 'b', qty: '2.50', d: '2024-01-02' }])
    r = await app.req('POST', `${base}/tables/t/chart/data`, { sql, pos: 5, sessionMaxRows: 5 })
    expect(J(r)).toEqual({ error: 'No data to display', data: [] })
    r = await app.req('POST', `${base}/tables/t/chart`, { sql: 'SELECT name FROM t' })
    expect(J(r).error).toBe('No numeric columns present in the table to plot.')
    r = await app.req('POST', `${base}/tables/t/chart`, { sql: '' })
    expect(J(r).error).toBe('No SQL query was set to fetch data.')
  })
})

describe('GIS visualization', () => {
  it('answers the candidates and the rows', async () => {
    let r = await app.req('POST', `${base}/tables/t/gis`, { sql: 'SELECT * FROM t' })
    expect(J(r)).toMatchObject({
      error: null,
      labelCandidates: ['id', 'name', 'qty', 'd'],
      spatialCandidates: ['g'],
      spatialColumn: 'g',
      labelColumn: '',
      rows: [
        { wkt: 'POINT(1 2)', srid: 0, label: '' },
        { wkt: 'POINT(3 4)', srid: 0, label: '' },
      ],
      hasSrid: false,
    })
    r = await app.req('POST', `${base}/tables/t/gis`, {
      sql: 'SELECT * FROM t',
      labelColumn: 'name',
      sessionMaxRows: 1,
      pos: 1,
    })
    expect(J(r).rows).toEqual([{ wkt: 'POINT(3 4)', srid: 0, label: 'b' }])
    r = await app.req('POST', `${base}/tables/t/gis`, { sql: 'SELECT id FROM t' })
    expect(J(r).error).toBe('No spatial column found for this SQL query.')
  })
})
