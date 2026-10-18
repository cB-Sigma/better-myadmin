import { gzipSync } from 'node:zlib'
import { SESSION_COOKIE } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Large data at a test-sized scale (docs/architecture/17-large-data.md; the full-size measurements
 * against phpMyAdmin are in that document): an import interrupted by ExecTimeLimit and resumed
 * from its offset until done, a saved BLOB whose statement is not sent back, a browse page of
 * large TEXT/BLOB cells without their full values.
 */
const DB = 'f07_large'
type Json = Record<string, unknown>
let root: mysql.Connection

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE b (id INT PRIMARY KEY, data LONGBLOB, tiny TINYBLOB);
    CREATE TABLE big (id INT PRIMARY KEY, note LONGTEXT, data LONGBLOB);
    INSERT INTO big SELECT n, REPEAT('long text ', 30000), REPEAT(x'ab', 300000)
      FROM (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3) s;`)
})
afterAll(async () => {
  await root.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root.end()
})

/** the chunked upload, the job and its SSE result (the web app's import calls) */
async function importFile(
  t: ReturnType<typeof testApp>,
  pairs: Array<[string, string]>,
  data: Buffer,
  name: string,
) {
  const cookie = () => [...t.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const token = String(t.deps.store.get(t.jar.get(SESSION_COOKIE) ?? '')?.csrfToken ?? '')
  const u = await t.req('POST', '/api/servers/1/import/uploads', {})
  const id = u.json.id as string
  const CHUNK = 1024 * 1024
  for (let off = 0; off < data.length; off += CHUNK) {
    const r = await t.app.request(`/api/servers/1/import/uploads/${id}?offset=${off}`, {
      method: 'PATCH',
      headers: { cookie: cookie(), 'X-BMA-Token': token },
      body: data.subarray(off, off + CHUNK),
    })
    expect(r.status).toBe(200)
  }
  const job = await t.req('POST', '/api/servers/1/import/jobs', { params: pairs, upload: { id, name } })
  const res = await t.app.request(`/api/servers/1/import/jobs/${job.json.id as string}/events`, {
    headers: { cookie: cookie() },
  })
  const m = /event: result\ndata: (.*)\n/.exec(await res.text())
  return (m === null ? {} : JSON.parse(m[1] as string)) as { message?: { type: string; html: string } }
}

describe('import: ExecTimeLimit with allow_interrupt, resumed with skip=offset', () => {
  it('stops 5 seconds before the limit, the link resumes where it stopped, every row once [p07-89e7c9 p07-5a8804]', async () => {
    // 4,000 statements, each waiting a little, in a file of several read chunks (gzip: decompressed to disk)
    let sql = 'CREATE TABLE r (id INT PRIMARY KEY, pad VARCHAR(255));\n'
    for (let i = 1; i <= 4000; i++) {
      sql += `INSERT INTO r VALUES (${i}, '${'p'.repeat(200)}');${i % 400 === 0 ? ' DO SLEEP(0.4);' : ''}\n`
    }
    const data = gzipSync(sql)
    // ExecTimeLimit 6: maximumTime 5, so the reads stop once a second has passed
    const t = testApp(testConfig({ ExecTimeLimit: 6 }))
    try {
      await t.login()
      const form: Array<[string, string]> = [
        ['import_type', 'database'],
        ['db', DB],
        ['format', 'sql'],
        ['charset_of_file', 'utf-8'],
        ['allow_interrupt', 'yes'],
        ['skip_queries', '0'],
        ['sql_compatibility', 'NONE'],
      ]
      let skip: string | null = null
      let runs = 0
      let last: { message?: { type: string; html: string } } = {}
      while (runs < 40) {
        runs++
        last = await importFile(t, skip === null ? form : [...form, ['skip', skip]], data, 'r.sql.gz')
        const link = /href="([^"]+)"/.exec(last.message?.html ?? '')?.[1]?.replaceAll('&amp;', '&')
        if (link === undefined) break
        expect(last.message?.html).toMatch(
          /^Script timeout passed, if you want to finish import, please <a href="\/s\/1\/db\/f07_large\/import\?timeout_passed=1&amp;offset=\d+">resubmit the same file<\/a>/,
        )
        skip = new URL(link, 'http://x').searchParams.get('offset')
      }
      expect(runs).toBeGreaterThan(1)
      expect(last.message?.html).toMatch(/^<em>Import has been successfully finished/)
      const [rows] = (await root.query(
        `SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS d FROM ${DB}.r`,
      )) as unknown as [Array<{ n: number; d: number }>]
      expect(rows[0]).toEqual({ n: 4000, d: 4000 })
    } finally {
      await t.close()
    }
  }, 120_000)
})

describe('Insert/Edit of a large BLOB', () => {
  const t = testApp()
  beforeAll(async () => {
    await t.login()
  })
  afterAll(async () => {
    await t.close()
  })
  const base = `/api/servers/1/databases/${DB}/tables/b`
  async function save(id: number, column: string, bytes: number) {
    const f = (await t.req('POST', `${base}/insert-form`, {})).json as Json
    const cols = f.columns as Array<Json>
    const cells = (f.rows as Array<{ cells: Json[] }>)[0]!.cells
    const fields = cols.map((col, i) => ({
      name: col.field,
      value: col.field === 'id' ? String(id) : '',
      type: cells[i]!.fieldsType,
      isNull: col.field !== 'id' && col.field !== column,
      nullPrev: cells[i]!.nullPrev,
      function: '',
      prev: cells[i]!.prev,
      autoIncrement: false,
      virtual: false,
      ...(col.field === column ? { upload: Buffer.alloc(bytes, 7).toString('base64') } : {}),
    }))
    return t.req('POST', `${base}/rows`, {
      rows: [{ whereClause: null, ignore: false, fields }],
      submitType: 'insert',
      afterInsert: 'back',
    })
  }

  it('the saved statement comes back cut at MaxCharactersInDisplayedSQL, like Generator::getMessage', async () => {
    const r = await save(1, 'data', 2_000_000)
    expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200)
    const [rows] = (await root.query(`SELECT LENGTH(data) AS n FROM ${DB}.b WHERE id = 1`)) as unknown as [
      Array<{ n: number }>,
    ]
    expect(rows[0]?.n).toBe(2_000_000)
    const message = r.json.message as { sql: string }
    expect(message.sql).toMatch(/^INSERT INTO `b` \(`id`, `data`, `tiny`\) VALUES \('1', 0x0707.*\[\.\.\.\]$/)
    expect(message.sql.length).toBe(1000 + '[...]'.length)
    expect(JSON.stringify(r.json).length).toBeLessThan(10_000)
  })

  it("a failing statement's error carries the SQL cut the same way (Generator::mysqlDie)", async () => {
    // a TINYBLOB holds 255 bytes: MySQL refuses the row (strict mode)
    const r = await save(2, 'tiny', 1_000_000)
    expect(r.status).toBe(400)
    const error = r.json.error as { sql: string; errno: number }
    expect(error.errno).toBe(1406)
    expect(error.sql.endsWith('[...]')).toBe(true)
    expect(JSON.stringify(r.json).length).toBeLessThan(10_000)
  })
})

describe('Insert/Edit uploads and MaxUploadSize (upload_max_filesize, post_max_size)', () => {
  it('a larger file is not inserted, the row is saved without it (as ReplaceController does)', async () => {
    const t = testApp(testConfig({ MaxUploadSize: 100_000 }))
    try {
      await t.login()
      const base = `/api/servers/1/databases/${DB}/tables/b`
      const f = (await t.req('POST', `${base}/insert-form`, {})).json as Json
      const cols = f.columns as Array<Json>
      const cells = (f.rows as Array<{ cells: Json[] }>)[0]!.cells
      const fields = (upload: string) =>
        cols.map((col, i) => ({
          name: col.field,
          value: col.field === 'id' ? '3' : '',
          type: cells[i]!.fieldsType,
          isNull: col.field === 'tiny',
          nullPrev: cells[i]!.nullPrev,
          function: '',
          prev: cells[i]!.prev,
          autoIncrement: false,
          virtual: false,
          ...(col.field === 'data' ? { upload } : {}),
        }))
      const body = (upload: string) => ({
        rows: [{ whereClause: null, ignore: false, fields: fields(upload) }],
        submitType: 'insert',
        afterInsert: 'back',
      })
      const r = await t.req('POST', `${base}/rows`, body(Buffer.alloc(200_000, 1).toString('base64')))
      expect(r.status).toBe(200)
      // ReplaceController lists $insertErrors only for a skipped row: the file is dropped, the row saved
      expect(r.json.message).toMatchObject({ type: 'success', text: '1 row inserted.' })
      const [rows] = (await root.query(`SELECT LENGTH(data) AS n FROM ${DB}.b WHERE id = 3`)) as unknown as [
        Array<{ n: number }>,
      ]
      expect(rows[0]?.n).toBe(0)
      // a request whose Content-Length passes MaxUploadSize (base64) + 1 MiB is refused
      const payload = body('A'.repeat(1_300_000))
      const huge = await t.req('POST', `${base}/rows`, payload, {
        'content-length': String(Buffer.byteLength(JSON.stringify(payload))),
      })
      expect(huge.status).toBe(400)
      expect((huge.json.error as { message: string }).message).toMatch(
        /^You probably tried to upload a file that is too large/,
      )
    } finally {
      await t.close()
    }
  })
})

describe('Browse of large TEXT and BLOB cells', () => {
  it('the page holds the truncated text and BLOB placeholders, not the values (makegrid loads them on edit)', async () => {
    const t = testApp()
    try {
      await t.login()
      const r = await t.req('POST', '/api/servers/1/browse', { db: DB, table: 'big' })
      const st = (r.json.statements as Json[])[0] as Json
      const grid = st.grid as { rows: Array<{ cells: Array<{ cls: string; t?: string }> }> }
      expect(grid.rows).toHaveLength(3)
      expect(grid.rows[0]!.cells[1]!.cls).toContain('truncated')
      expect(grid.rows[0]!.cells[2]!.t).toBe('[BLOB - 293.0 KiB]')
      // the raw rows keep the editable id only
      expect((st.result as { rows: unknown[][] }).rows).toEqual([
        ['1', null, null],
        ['2', null, null],
        ['3', null, null],
      ])
      // 3 x (300 KB text + 300 KB blob) without the guard
      expect(JSON.stringify(r.json).length).toBeLessThan(50_000)
    } finally {
      await t.close()
    }
  })
})
