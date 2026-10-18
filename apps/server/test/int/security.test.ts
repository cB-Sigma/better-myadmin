import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SESSION_COOKIE } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signSql } from '../../src/query/signature.ts'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Regression tests of docs/reference/security-review.md: each one failed before its fix.
 */
// biome-ignore lint/suspicious/noExplicitAny: loosely typed API payloads in tests
type Json = Record<string, any>
const DB = 'm1sec_it'
let root: mysql.Connection

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.f (id INT PRIMARY KEY, blb BLOB)`)
})
afterAll(async () => {
  await root?.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root?.end()
})

describe('S1 UploadDir: a file name cannot leave the directory (Core::securePath)', () => {
  const top = mkdtempSync(join(tmpdir(), 'bma-sec-'))
  const uploadDir = join(top, 'uploads')
  mkdirSync(uploadDir)
  writeFileSync(join(uploadDir, 'ok.bin'), 'inside')
  // outside the UploadDir
  writeFileSync(join(top, 'secret.txt'), 'TOPSECRET')
  const t = testApp(testConfig({ UploadDir: uploadDir }))
  beforeAll(() => t.login())
  afterAll(() => t.close())

  const preview = async (uploadLocal: string): Promise<Json> => {
    const f = (await t.req('POST', `/api/servers/1/databases/${DB}/tables/f/insert-form`, {})).json as Json
    const fields = (f.columns as Json[]).map((col, i) => {
      const cell = f.rows[0].cells[i] as Json
      return {
        name: col.field,
        value: col.field === 'id' ? '1' : '',
        type: cell.fieldsType,
        isNull: false,
        nullPrev: cell.nullPrev,
        function: '',
        prev: cell.prev,
        autoIncrement: cell.autoIncrement,
        virtual: cell.virtual,
        ...(col.field === 'blb' ? { uploadLocal } : {}),
      }
    })
    return (
      await t.req('POST', `/api/servers/1/databases/${DB}/tables/f/rows`, {
        rows: [{ fields }],
        preview: true,
      })
    ).json as Json
  }
  const hex = (s: string) => Buffer.from(s).toString('hex')

  it('reads a file of the UploadDir', async () => {
    expect(JSON.stringify(await preview('ok.bin'))).toContain(hex('inside'))
  })
  it.each(['../secret.txt', '....//secret.txt', '..././secret.txt', `${top}/secret.txt`])(
    'refuses %s',
    async (name) => {
      expect(JSON.stringify(await preview(name))).not.toContain(hex('TOPSECRET'))
    },
  )
})

describe('S5 login rate limit: concurrent attempts are counted one by one (X2)', () => {
  const t = testApp(
    testConfig({ LoginRateLimit: { maxAttempts: 3, windowSeconds: 900, lockoutSeconds: 300 } }),
  )
  afterAll(() => t.close())
  it('ten parallel wrong passwords: three attempts reach MySQL, seven are locked out', async () => {
    await t.req('GET', '/api/auth/state')
    const user = 'm1sec_nobody'
    const all = await Promise.all(
      Array.from({ length: 10 }, () =>
        t.req('POST', '/api/auth/login', { server: 1, username: user, password: 'wrong' }),
      ),
    )
    const texts = all.map((r) => JSON.stringify(r.json))
    expect(texts.filter((x) => x.includes('Too many failed login attempts'))).toHaveLength(7)
  })
})

describe('S2–S4 a query carried in a URL needs its signature (Core::checkSqlQuerySignature)', () => {
  const t = testApp(testConfig({}))
  beforeAll(() => t.login())
  afterAll(() => t.close())
  const base = `/api/servers/1/databases/${DB}`
  const secret = () => t.deps.store.get(t.jar.get(SESSION_COOKIE) ?? '')?.hmacSecret ?? ''
  const sign = (sql: string) => signSql(sql, secret(), t.deps.cfg.blowfish_secret)
  const sql = 'SELECT id FROM f'

  it('S2 chart: a wrong signature drops the query; a valid one runs and signs the form query', async () => {
    const sql = 'SELECT 1 AS n'
    const bad = (await t.req('POST', `${base}/tables/f/chart`, { sql, sig: '' })).json as Json
    expect(bad).toMatchObject({ error: 'No SQL query was set to fetch data.', fieldset: null })
    const ok = (await t.req('POST', `${base}/tables/f/chart`, { sql, sig: sign(sql) })).json as Json
    expect(ok.fieldset).toMatchObject({ sql, sig: sign(sql) })
    const data = (
      await t.req('POST', `${base}/tables/f/chart/data`, { sql, sig: '', pos: 0, sessionMaxRows: 5 })
    ).json as Json
    expect(data).toMatchObject({ error: 'No data to display', data: [] })
    const gis = (await t.req('POST', `${base}/tables/f/gis`, { sql, sig: 'x' })).json as Json
    expect(gis.error).toBe('No SQL query was set to fetch data.')
    const server = (
      await t.req('POST', '/api/servers/1/visualization/chart', { sql: 'SELECT 1 AS n', sig: '' })
    ).json as Json
    expect(server.error).toBe('No SQL query was set to fetch data.')
  })

  it('S3 edit form: "Go back" runs the Browse query only with its signature', async () => {
    const f = (await t.req('POST', `${base}/tables/f/insert-form`, {})).json as Json
    const fields = (f.columns as Json[]).map((col, i) => {
      const cell = f.rows[0].cells[i] as Json
      return {
        name: col.field,
        value: col.field === 'id' ? '7' : '',
        type: cell.fieldsType,
        isNull: col.field !== 'id',
        nullPrev: cell.nullPrev,
        function: '',
        prev: cell.prev,
        autoIncrement: cell.autoIncrement,
        virtual: cell.virtual,
      }
    })
    const evil = `DROP TABLE ${DB}.f`
    const r = (
      await t.req('POST', `${base}/tables/f/rows`, { rows: [{ fields }], sqlQuery: evil, sqlQuerySig: '' })
    ).json as Json
    expect(r.next).toEqual({ action: 'back' })
    const good = 'SELECT * FROM `f`'
    const r2 = (
      await t.req('POST', `${base}/tables/f/rows`, {
        rows: [{ fields: fields.map((x) => (x.name === 'id' ? { ...x, value: '8' } : x)) }],
        sqlQuery: good,
        sqlQuerySig: sign(good),
      })
    ).json as Json
    expect(r2.next).toEqual({ action: 'back', sql: { sql: good, sig: sign(good) } })
  })

  it('S4 export page: sql_query of the URL only with a valid sql_signature', async () => {
    const page = async (pairs: Array<[string, string]>) =>
      (await t.req('GET', `/api/servers/1/export/page?${new URLSearchParams(pairs)}`)).json as Json
    const evil = `DELETE FROM ${DB}.f`
    const common: Array<[string, string]> = [
      ['db', DB],
      ['table', 'f'],
      ['single_table', 'true'],
    ]
    expect((await page([...common, ['sql_query', evil], ['sql_signature', '']])).sqlQuery).toBe('')
    expect((await page([...common, ['sql_query', sql], ['sql_signature', sign(sql)]])).sqlQuery).toBe(sql)
  })
})
