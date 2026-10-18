import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Messages phpMyAdmin answers on the table-level endpoints that we did not show before: the
 * get-field checks (GetFieldController), the add-key type check (AddKeyController), the table name
 * checks of the favorite list (TableName::from) and the index and move-columns errors.
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const DB = 'f05_msg'
const STORAGE = { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }
const app = testApp(testConfig({}, STORAGE))
let root: mysql.Connection
const base = `/api/servers/1/databases/${DB}/tables/t`
const error = (r: { json: Any }) => r.json.error?.message ?? r.json.message?.text

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, a INT, b INT)`)
  await app.login()
})
afterAll(async () => {
  await root.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root.end()
  await app.close()
})

describe('get-field (BLOB download)', () => {
  const field = (q: Record<string, string>) =>
    app.req('GET', `/api/servers/1/browse/field?${new URLSearchParams(q)}`)

  it('a missing database, then an unknown table, before the signature is checked', async () => {
    const nodb = await field({ db: 'f05_msg_nope', table: 't', where: '1', sig: 'x', key: 'id' })
    expect(nodb.status).toBe(404)
    expect(error(nodb)).toBe("'f05_msg_nope' database does not exist.")
    const notable = await field({ db: DB, table: 'nope', where: '1', sig: 'x', key: 'id' })
    expect(notable.status).toBe(404)
    expect(error(notable)).toBe('Invalid table name')
    const unsigned = await field({ db: DB, table: 't', where: '1', sig: 'x', key: 'id' })
    expect(error(unsigned)).toBe('There is an issue with your request.')
    expect(error(await field({ db: DB, table: '', where: '1', sig: 'x', key: 'id' }))).toBe(
      'Missing parameter: table',
    )
  })
})

describe('structure', () => {
  it('add-key with an unknown key type: "Invalid request parameter."', async () => {
    const r = await app.req('POST', `${base}/columns/key`, { type: 'BOGUS', columns: ['a'] })
    expect(r.status).toBe(400)
    expect(error(r)).toBe('Invalid request parameter.')
  })

  it('move columns: the order must match the table, and change something', async () => {
    const same = await app.req('POST', `${base}/columns/move`, { order: ['id', 'a', 'b'] })
    expect(error(same)).toBe('The selected columns are already in the correct order.')
    const other = await app.req('POST', `${base}/columns/move`, { order: ['id', 'a'] })
    expect(error(other)).toBe('The selected columns do not match the columns in the table.')
  })

  it('index editor: a PRIMARY named otherwise, an index named PRIMARY, no columns', async () => {
    const save = (index: Record<string, unknown>) =>
      app.req('POST', `${base}/indexes`, {
        oldIndex: null,
        // (the error is answered before anything runs; a dry run would only preview)
        index: { type: '', keyBlockSize: '', parser: '', comment: '', ...index },
      })
    const col = [{ name: 'a', subPart: '' }]
    expect(error(await save({ name: 'pk', choice: 'PRIMARY', columns: col }))).toBe(
      'The name of the primary key must be "PRIMARY"!',
    )
    expect(error(await save({ name: 'PRIMARY', choice: 'INDEX', columns: col }))).toBe(
      "Can't rename index to PRIMARY!",
    )
    expect(error(await save({ name: 'i', choice: 'INDEX', columns: [] }))).toBe('No index parts defined!')
  })
})

describe('favorite tables (TableName::from)', () => {
  const fav = (table: string) =>
    app.req('POST', '/api/servers/1/favorites', { db: DB, table, action: 'add', favoriteTables: '' })

  it('an empty, too long or space-ended table name is refused with its message', async () => {
    expect(error(await fav(''))).toBe('The table name must be a non-empty string.')
    expect(error(await fav('x'.repeat(65)))).toBe('The table name cannot be longer than 64 characters.')
    expect(error(await fav('t '))).toBe('The table name cannot end with a space character.')
    expect((await fav('t')).json.changes).toBe(true)
    await app.req('POST', '/api/servers/1/favorites', {
      db: DB,
      table: 't',
      action: 'remove',
      favoriteTables: '',
    })
  })
})

describe('events', () => {
  it('editing an event that does not exist: "No event with name … found in database …"', async () => {
    const r = await app.req('GET', `/api/servers/1/databases/${DB}/events/editor?name=nope`)
    expect(r.status).toBe(404)
    expect(error(r)).toBe(
      `Error in processing request: No event with name \`nope\` found in database \`${DB}\`.`,
    )
  })
})
