import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Database → Central columns, Tracking, Data dictionary and Privileges through the API
 * (docs/features/05-database-level.md), with and without the configuration storage.
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const J = (r: { json: unknown }): Any => r.json
const DB = 'f05_it_admin'
let root: mysql.Connection
const app = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }))
const bare = testApp(testConfig({}))
const base = `/api/servers/1/databases/${DB}`
const clean = `DELETE FROM phpmyadmin.pma__central_columns WHERE db_name = '${DB}'; DELETE FROM phpmyadmin.pma__tracking WHERE db_name = '${DB}';`

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.a (id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(10) DEFAULT 'x' COMMENT 'val') COMMENT='the a';
    CREATE TABLE ${DB}.b (id INT, a_id INT, FOREIGN KEY (a_id) REFERENCES a (id));
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

describe('central columns', () => {
  it('adds the columns of tables, lists them, edits and deletes [p05-b6cb36]', async () => {
    let r = await app.req('POST', `${base}/structure/central-add`, { tables: ['a', 'b'] })
    expect(J(r).messages[0].text).toContain("Could not add 'id' as they already exist in central list!")
    r = await app.req('GET', `${base}/central-columns`)
    expect(J(r).columns.map((c: { name: string }) => c.name)).toEqual(['a_id', 'id', 'v'])
    expect(J(r).message.text).toBe('Showing rows 1 - 3.')
    const v = J(r).columns.find((c: { name: string }) => c.name === 'v')
    expect(v).toMatchObject({ type: 'varchar', length: '10', defaultType: 'USER_DEFINED', defaultValue: 'x' })
    r = await app.req('POST', `${base}/central-columns`, {
      action: 'edit',
      origName: 'v',
      column: { name: 'v2', type: 'VARCHAR', length: '20', isNull: true },
    })
    expect(J(r).ok).toBe(true)
    r = await app.req('GET', `${base}/central-columns/populate?table=a`)
    expect(J(r)).toEqual(['v'])
    r = await app.req('POST', `${base}/central-columns`, { action: 'delete', columns: ['v2', 'zz'] })
    expect(J(r).message.text).toBe(
      "Couldn't remove Column(s) 'zz' as they don't exist in central columns list!",
    )
  })
})

describe('tracking', () => {
  it('creates a version, lists tracked and untracked tables, deletes', async () => {
    let r = await app.req('POST', `${base}/tracking`, {
      action: 'create-version',
      tables: ['a'],
      version: '1',
      statements: ['alter_table', 'insert'],
    })
    expect(J(r).messages[0].text).toBe(
      'Version 1 was created for selected tables, tracking is active for them.',
    )
    r = await app.req('GET', `${base}/tracking`)
    expect(J(r).tracked.map((t: { table: string }) => t.table)).toEqual(['a'])
    expect(J(r).untracked).toEqual(['b'])
    expect(J(r).log).toMatch(/^# \d{4}-\d\d-\d\d \d\d:\d\d:\d\d \S+\n\nDROP TABLE IF EXISTS `a`;/)
    const [rows] = await root.query(
      'SELECT tracking, schema_snapshot FROM phpmyadmin.pma__tracking WHERE db_name = ?',
      [DB],
    )
    const row = (rows as Array<{ tracking: string; schema_snapshot: string }>)[0]
    expect(row?.tracking).toBe('INSERT,ALTER TABLE')
    expect(row?.schema_snapshot).toMatch(/^a:2:\{s:7:"COLUMNS";a:2:\{i:0;a:8:\{s:5:"Field";s:2:"id";/)
    r = await app.req('POST', `${base}/tracking`, {
      action: 'toggle',
      table: 'a',
      version: '1',
      active: false,
    })
    expect(J(r).messages[0].text).toBe(`Tracking for ${DB}.a was deactivated at version 1.`)
    r = await app.req('POST', `${base}/tracking`, { action: 'delete', tables: ['a'] })
    expect(J(r).messages[0].text).toBe('Tracking data deleted successfully.')
    r = await app.req('GET', `${base}/tracking`)
    expect(J(r).tracked).toEqual([])
  })
})

describe('data dictionary and privileges', () => {
  it('data dictionary', async () => {
    const r = await app.req('GET', `${base}/data-dictionary`)
    const a = J(r).tables.find((t: { name: string }) => t.name === 'a')
    expect(a.comment).toBe('the a')
    expect(a.columns[0]).toMatchObject({ name: 'id', isPrimary: true, printType: 'int' })
    expect(a.columns[1]).toMatchObject({ name: 'v', default: 'x', comment: 'val' })
    const b = J(r).tables.find((t: { name: string }) => t.name === 'b')
    expect(b.hasRelation).toBe(true)
    expect(b.columns[1].relation).toBe('a -> id')
  })

  it('privileges (read-only list)', async () => {
    const r = await bare.req('GET', `${base}/privileges`)
    expect(J(r).gate.isSuperUser).toBe(true)
    expect(J(r).accounts.some((a: { user: string }) => a.user === 'root')).toBe(true)
  })
})
