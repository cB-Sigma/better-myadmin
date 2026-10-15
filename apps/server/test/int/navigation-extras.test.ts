import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * The navigation's Recent list and /table/recent-favorite, and /navigation/update-width
 * (docs/features/01-shell-and-navigation.md).
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const J = (r: { json: unknown }): Any => r.json
const DB = 'f04_it_navx'
let root: mysql.Connection
const app = testApp(testConfig({}))

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.a (id INT); CREATE TABLE ${DB}.b (id INT);`)
  await app.login()
})
afterAll(async () => {
  await root.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root.end()
  await app.close()
})

describe('Recent tables', () => {
  it('adds the visited tables, forgets a dropped one when it is opened [p01-56fa30]', async () => {
    await app.req('POST', '/api/servers/1/recent', { db: DB, table: 'a' })
    let r = await app.req('POST', '/api/servers/1/recent', { db: DB, table: 'b' })
    expect(J(r).recent.slice(0, 2)).toEqual([
      { db: DB, table: 'b' },
      { db: DB, table: 'a' },
    ])
    // a table that does not exist is not added (RecentFavoriteTables::add → hasTable)
    r = await app.req('POST', '/api/servers/1/recent', { db: DB, table: 'nope' })
    expect(J(r).recent.some((t: Any) => t.table === 'nope')).toBe(false)
    await root.query(`DROP TABLE ${DB}.a`)
    r = await app.req('POST', '/api/servers/1/recent-favorite/open', { db: DB, table: 'a' })
    expect(J(r)).toEqual({ ok: true, message: null })
    r = await app.req('GET', '/api/servers/1/recent-favorite')
    expect(J(r).recent.filter((t: Any) => t.db === DB)).toEqual([{ db: DB, table: 'b' }])
    expect(J(r)).toMatchObject({ numRecentTables: 10, numFavoriteTables: 10 })
    r = await app.req('POST', '/api/servers/1/recent-favorite/open', { db: DB, table: 'a ' })
    expect(J(r).message.text).toBe('Invalid database or table name.')
  })
})

describe('navigation width', () => {
  it('stores NavigationWidth, refuses a negative value [p01-34f437]', async () => {
    let r = await app.req('POST', '/api/servers/1/navigation/width', { value: -1 })
    expect(J(r)).toMatchObject({ success: false, message: { text: 'Unexpected parameter value.' } })
    r = await app.req('POST', '/api/servers/1/navigation/width', { value: '310.7' })
    expect(J(r).success).toBe(true)
    r = await app.req('GET', '/api/servers/1/navigation/tree')
    expect(J(r).settings.NavigationWidth).toBe(310)
  })
})

describe('static pages', () => {
  it('answers the license, the changelog and the runtime information', async () => {
    let r = await app.req('GET', '/api/servers/1/about/license')
    expect(J(r).file).toBe('LICENSE')
    if (J(r).available === false) expect(J(r).url).toMatch(/^https:\/\//)
    r = await app.req('GET', '/api/servers/1/about/changelog')
    expect(J(r).file).toMatch(/^CHANGELOG\.md/)
    // $cfg['ShowPhpInfo'] is false by default: no runtime page
    r = await app.req('GET', '/api/servers/1/about/runtime')
    expect(J(r)).toEqual({ enabled: false })
    const on = testApp(testConfig({ ShowPhpInfo: true }))
    await on.login()
    r = await on.req('GET', '/api/servers/1/about/runtime')
    expect(J(r)).toMatchObject({ enabled: true, runtime: { name: 'Node.js', version: process.version } })
    await on.close()
  })
})
