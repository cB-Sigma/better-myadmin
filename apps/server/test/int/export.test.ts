import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Export endpoints against a live MySQL (docs/features/07-export-import.md): the page view-model
 * per scope, the dump download, save on server, request errors. Byte parity of the dumps with
 * phpMyAdmin is in tests/parity/export-*.parity.test.ts.
 */
const DB = 'f07_it_export'
let t: ReturnType<typeof testApp>
let root: mysql.Connection
const saveDir = mkdtempSync(join(tmpdir(), 'f07-save-'))

async function page(q: Record<string, string>) {
  const r = await t.req('GET', `/api/servers/1/export/page?${new URLSearchParams(q)}`)
  return r
}

async function download(params: Array<[string, string]>) {
  const prep = await t.req('POST', '/api/servers/1/export', { params })
  if (prep.status !== 200 || prep.json.id === undefined) return { prep, body: '' }
  const cookie = [...t.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await t.app.request(`/api/servers/1/export/${prep.json.id as string}`, { headers: { cookie } })
  return { prep, res, body: await res.text() }
}

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(
    `DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
     CREATE TABLE a (id INT PRIMARY KEY, v VARCHAR(10)); INSERT INTO a VALUES (1, 'x'), (2, 'y');
     CREATE VIEW b AS SELECT id FROM a;`,
  )
  t = testApp(testConfig({ SaveDir: saveDir }))
  await t.login()
})
afterAll(async () => {
  await root?.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root?.end()
  await t?.close()
  rmSync(saveDir, { recursive: true, force: true })
})

describe('export page', () => {
  it('lists the tables of a database, all selected by default', async () => {
    const r = await page({ scope: 'database', db: DB })
    expect(r.status).toBe(200)
    expect(r.json.title).toBe(`Exporting tables from "${DB}" database`)
    expect(r.json.tables).toEqual([
      { name: 'a', isView: false, select: true, structure: true, data: true },
      { name: 'b', isView: true, select: true, structure: true, data: true },
    ])
    expect((r.json.plugins as Array<{ name: string }>).map((p) => p.name)).toContain('sql')
    expect(r.json.selectedPlugin).toBe('sql')
    expect(r.json.filenameTemplate).toBe('@DATABASE@')
    expect(r.json.saveDir).toBe(`${saveDir}/`)
  })

  it('pre-selects the tables of "With selected: Export"', async () => {
    const r = await page({ scope: 'database', db: DB, 'selected_tbl[]': 'b' })
    expect((r.json.tables as Array<{ select: boolean }>).map((x) => x.select)).toEqual([false, true])
  })

  it('table scope: rows card with the row count, SQL options only with single_table [p07-d8b116 p07-c3ad37]', async () => {
    const r = await page({ scope: 'table', db: DB, table: 'a' })
    expect(r.json.rows).toEqual({ allrows: '1', limitTo: '2', limitFrom: '0' })
    const sql = (r.json.plugins as Array<{ name: string; options: unknown }>).find((p) => p.name === 'sql')
    expect(sql?.options).toBeNull()
    const single = await page({ scope: 'table', db: DB, table: 'a', single_table: 'true' })
    const sql2 = (single.json.plugins as Array<{ name: string; options: unknown }>).find(
      (p) => p.name === 'sql',
    )
    expect(sql2?.options).not.toBeNull()
  })

  it('rows export: where clauses replace the WHERE and the LIMIT is dropped [p07-91d400]', async () => {
    const r = await page({
      scope: 'table',
      db: DB,
      table: 'a',
      single_table: 'true',
      sql_query: 'SELECT * FROM `a` WHERE 1 LIMIT 0, 25',
      'where_clause[]': '`a`.`id` = 1',
    })
    expect(r.json.sqlQuery).toBe('SELECT * FROM `a` WHERE (`a`.`id` = 1)')
  })

  it('server scope lists databases without system schemas', async () => {
    const r = await page({ scope: 'server' })
    const names = (r.json.databases as Array<{ name: string }>).map((d) => d.name)
    expect(names).toContain(DB)
    expect(names).not.toContain('mysql')
    expect(names).not.toContain('information_schema')
  })

  it('a missing database is refused', async () => {
    const r = await page({ scope: 'database', db: 'f07_it_missing' })
    expect(r.status).toBe(404)
    expect((r.json.error as { message: string }).message).toBe('No database selected.')
  })
})

describe('export run', () => {
  const base: Array<[string, string]> = [
    ['db', DB],
    ['table', 'a'],
    ['export_type', 'table'],
    ['single_table', '1'],
    ['what', 'sql'],
    ['quick_or_custom', 'custom'],
    ['output_format', 'sendit'],
    ['filename_template', '@TABLE@-%Y'],
    ['compression', 'none'],
    ['sql_structure_or_data', 'data'],
    ['sql_include_comments', 'y'],
    ['sql_insert_syntax', 'both'],
    ['sql_backquotes', 'y'],
  ]

  it('streams the dump as an attachment named from the template [p07-b8f822]', async () => {
    const { prep, res, body } = await download(base)
    expect(prep.json.filename).toBe(`a-${new Date().getFullYear()}.sql`)
    expect(res?.headers.get('content-type')).toBe('text/x-sql')
    expect(res?.headers.get('content-disposition')).toContain('attachment')
    expect(body).toContain("INSERT INTO `a` (`id`, `v`) VALUES\n(1, 'x'),\n(2, 'y');")
    // the download id is one-shot
    const again = await t.app.request(`/api/servers/1/export/${prep.json.id as string}`, {
      headers: { cookie: [...t.jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    })
    expect(again.status).toBe(404)
  })

  it('view as text has no charset preamble', async () => {
    const { res, body } = await download(base.map(([k, v]) => [k, k === 'output_format' ? 'astext' : v]))
    expect(res?.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(body).not.toContain('SET NAMES')
  })

  it('saves on the server, refusing to overwrite unless asked [p07-49a9bb]', async () => {
    const params: Array<[string, string]> = [...base, ['onserver', 'saveit']]
    const first = await t.req('POST', '/api/servers/1/export', { params })
    const file = join(saveDir, `a-${new Date().getFullYear()}.sql`)
    expect(first.json.message).toEqual({ type: 'success', text: `Dump has been saved to file ${file}.` })
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('INSERT INTO `a`')
    const second = await t.req('POST', '/api/servers/1/export', { params })
    expect(second.json.message).toEqual({
      type: 'error',
      text: `File ${file} already exists on server, change filename or check overwrite option.`,
    })
    const third = await t.req('POST', '/api/servers/1/export', {
      params: [...params, ['onserver_overwrite', 'saveitover']],
    })
    expect((third.json.message as { type: string }).type).toBe('success')
  })

  it('an unknown format is "Bad type!"', async () => {
    const r = await t.req('POST', '/api/servers/1/export', {
      params: base.map(([k, v]) => [k, k === 'what' ? 'nope' : v]),
    })
    expect(r.status).toBe(400)
    expect((r.json.error as { message: string }).message).toBe('Bad type!')
  })
})
