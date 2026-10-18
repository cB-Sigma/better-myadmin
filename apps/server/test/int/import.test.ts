import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Import endpoints against a live MySQL (docs/features/07-export-import.md): the page view-model per
 * scope, the chunked upload, the SSE job, UploadDir files and request errors. Parity of the
 * outcome with phpMyAdmin is in tests/parity/import.parity.test.ts.
 */
const DB = 'f07_it_import'
let t: ReturnType<typeof testApp>
let root: mysql.Connection
let token = ''
const uploadDir = mkdtempSync(join(tmpdir(), 'f07-upload-'))

async function run(pairs: Array<[string, string]>, file?: { name: string; data: Buffer }, chunk = 7) {
  const cookie = () => [...t.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  let upload: { id: string; name: string } | undefined
  if (file !== undefined) {
    const u = await t.req('POST', '/api/servers/1/import/uploads', {})
    const id = u.json.id as string
    for (let off = 0; off < file.data.length; off += chunk) {
      const r = await t.app.request(`/api/servers/1/import/uploads/${id}?offset=${off}`, {
        method: 'PATCH',
        headers: { cookie: cookie(), 'X-BMA-Token': token },
        body: file.data.subarray(off, off + chunk),
      })
      expect(r.status).toBe(200)
    }
    upload = { id, name: file.name }
  }
  const job = await t.req('POST', '/api/servers/1/import/jobs', {
    params: pairs,
    ...(upload ? { upload } : {}),
  })
  const res = await t.app.request(`/api/servers/1/import/jobs/${job.json.id as string}/events`, {
    headers: { cookie: cookie() },
  })
  expect(res.headers.get('content-type')).toContain('text/event-stream')
  const text = await res.text()
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({
    event: m[1] as string,
    data: JSON.parse(m[2] as string) as Record<string, unknown>,
  }))
  return { events, result: events.find((e) => e.event === 'result')?.data ?? {} }
}

const base: Array<[string, string]> = [
  ['import_type', 'database'],
  ['db', DB],
  ['charset_of_file', 'utf-8'],
  ['skip_queries', '0'],
  ['fk_checks', '0'],
  ['fk_checks', '1'],
]

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(
    `DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB}; CREATE TABLE a (id INT PRIMARY KEY, v VARCHAR(10));`,
  )
  writeFileSync(join(uploadDir, 'srv.sql'), 'INSERT INTO a VALUES (99, "srv");')
  writeFileSync(join(uploadDir, 'skip.bin'), 'ignored')
  t = testApp(testConfig({ UploadDir: uploadDir }))
  const r = await t.login()
  token = String(r.json.csrfToken ?? '')
})
afterAll(async () => {
  await root?.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root?.end()
  await t?.close()
  rmSync(uploadDir, { recursive: true, force: true })
})

describe('import page', () => {
  it('describes each scope', async () => {
    const s = await t.req('GET', '/api/servers/1/import/page')
    expect(s.status).toBe(200)
    expect(s.json.title).toBe('Importing into the current server')
    expect((s.json.plugins as Array<{ name: string }>).map((p) => p.name)).toEqual([
      'csv',
      'shp',
      'mediawiki',
      'ods',
      'sql',
      'xml',
    ])
    expect(s.json.selectedPlugin).toBe('sql')
    expect(s.json.localFiles).toEqual([{ name: 'srv.sql', selected: false }])
    const d = await t.req('GET', `/api/servers/1/import/page?db=${DB}`)
    expect(d.json.title).toBe(`Importing into the database "${DB}"`)
    const tb = await t.req('GET', `/api/servers/1/import/page?db=${DB}&table=a`)
    expect((tb.json.plugins as Array<{ name: string }>).map((p) => p.name)).toContain('ldi')
    const missing = await t.req('GET', `/api/servers/1/import/page?db=${DB}&table=nope`)
    expect(missing.status).toBe(404)
    expect((missing.json.error as { message: string }).message).toBe('No table selected.')
  })
})

describe('import job', () => {
  it('runs a chunked, gzipped SQL upload in import mode with progress events', async () => {
    const sql = Array.from({ length: 55 }, (_, i) => `INSERT INTO a VALUES (${i + 1}, 'r${i}');`).join('\n')
    const { events, result } = await run([...base, ['format', 'sql']], {
      name: 'rows.sql.gz',
      data: gzipSync(sql),
    })
    expect(events.some((e) => e.event === 'progress')).toBe(true)
    expect(result.message).toEqual({
      type: 'success',
      html: '<em>Import has been successfully finished, 55 queries executed.</em> (rows.sql.gz)',
    })
    const [rows] = (await root.query(`SELECT COUNT(*) AS n FROM ${DB}.a`)) as unknown as [[{ n: number }]]
    expect(rows[0].n).toBe(55)
  })

  it('imports a file from the UploadDir [p07-e1518d]', async () => {
    const { result } = await run([...base, ['format', 'sql'], ['local_import_file', 'srv.sql']])
    expect((result.statements as Array<{ message: { text: string } }>)[0]?.message.text).toMatch(
      /^1 row inserted\./,
    )
  })

  it('reports a missing file and a wrong format', async () => {
    expect((await run([...base, ['format', 'sql']])).result.message).toMatchObject({ type: 'error' })
    expect(
      (await run([...base, ['format', 'nope']], { name: 'x.sql', data: Buffer.from('SELECT 1') })).result
        .message,
    ).toEqual({
      type: 'error',
      html: 'Incorrect format parameter',
    })
  })

  it('rejects an upload chunk at the wrong offset', async () => {
    const u = await t.req('POST', '/api/servers/1/import/uploads', {})
    const r = await t.app.request(`/api/servers/1/import/uploads/${u.json.id as string}?offset=5`, {
      method: 'PATCH',
      headers: { cookie: [...t.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'X-BMA-Token': token },
      body: Buffer.from('abc'),
    })
    expect(r.status).toBe(400)
  })
})
