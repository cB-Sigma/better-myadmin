import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SESSION_COOKIE, USER_ERRORS_HEADER } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { PNG } from 'pngjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signSql } from '../../src/query/signature.ts'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * The transformation wrapper's thumbnails (WrapperController, resize=jpeg|png, GD's resampling) and
 * Text_Plain_External with programs configured, through the API. The pixels against GD itself are
 * in test/unit/gd-resize.test.ts.
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Json = any
const DB = 'f05_tfw'
const STORAGE = { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }
const fixtures = join(import.meta.dirname, '../fixtures/gd-resize')
let root: mysql.Connection
const apps: Array<ReturnType<typeof testApp>> = []
const make = (o: Parameters<typeof testConfig>[0] = {}) => {
  const a = testApp(testConfig(o, STORAGE))
  apps.push(a)
  return a
}

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY, img BLOB, txt VARCHAR(20));
    DELETE FROM phpmyadmin.pma__column_info WHERE db_name = '${DB}';
    INSERT INTO phpmyadmin.pma__column_info (db_name, table_name, column_name, comment, mimetype,
      transformation, transformation_options, input_transformation, input_transformation_options)
    VALUES ('${DB}', 't', 'txt', '', 'text_plain', 'output/text_plain_external.php', "", '', '')`)
  await root.query(`INSERT INTO ${DB}.t VALUES (1, ?, 'hello <b>')`, [
    readFileSync(join(fixtures, 'opaque.png')),
  ])
})
afterAll(async () => {
  await root.query(
    `DELETE FROM phpmyadmin.pma__column_info WHERE db_name = '${DB}'; DROP DATABASE IF EXISTS ${DB}`,
  )
  await root.end()
  for (const a of apps) await a.close()
})

describe('resize=jpeg|png', () => {
  it('the thumbnail fits newWidth × newHeight in the requested format; not an image gives nothing', async () => {
    const app = make()
    await app.login()
    const secret = (await app.deps.store.get(app.jar.get(SESSION_COOKIE) ?? ''))?.hmacSecret ?? ''
    const where = '`t`.`id` = 1'
    const get = async (q: Record<string, string>) => {
      const p = new URLSearchParams({
        where,
        sig: signSql(where, secret, app.deps.cfg.blowfish_secret),
        ...q,
      })
      const r = await app.app.request(`/api/servers/1/databases/${DB}/tables/t/transformation/wrapper?${p}`, {
        headers: { cookie: [...app.jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      })
      return { r, body: Buffer.from(await r.arrayBuffer()) }
    }
    const png = await get({ key: 'img', resize: 'png', newWidth: '30', newHeight: '30', ct: 'image/png' })
    expect(png.r.headers.get('content-type')).toBe('image/png')
    // 97 × 61 into 30 × 30: 30 × 19 (round(61 / (97 / 30)))
    const p = PNG.sync.read(png.body)
    expect([p.width, p.height]).toEqual([30, 19])
    const jpg = await get({ key: 'img', resize: 'jpeg', newWidth: '50', newHeight: '9999' })
    expect(jpg.body.subarray(0, 3).toString('hex')).toBe('ffd8ff')
    // a size above 2000 is 2000 (formatSize): the width decides, 50 × 31
    expect(jpg.body.readUInt16BE(jpg.body.indexOf(Buffer.from([0xff, 0xc0])) + 5)).toBe(31)
    expect((await get({ key: 'txt', resize: 'png', newWidth: '10', newHeight: '10' })).body.length).toBe(0)
    // without resize: the original bytes
    expect((await get({ key: 'img' })).body.equals(readFileSync(join(fixtures, 'opaque.png')))).toBe(true)
  })
})

describe('Text_Plain_External', () => {
  const grid = async (app: ReturnType<typeof make>) => {
    const r = await app.req('POST', '/api/servers/1/browse', { db: DB, table: 't' })
    const g = (r.json as Json).statements[0].grid
    const i = (g.columns as Json[]).findIndex((c) => c.name === 'txt')
    return { cell: g.rows[0].cells[i], header: r.res.headers.get(USER_ERRORS_HEADER) }
  }

  it('no program configured (phpMyAdmin as shipped): the value unchanged, nothing run', async () => {
    const app = make()
    await app.login()
    const { cell, header } = await grid(app)
    expect(cell.tf.file).toBe('Output/Text_Plain_External')
    expect(cell.tf.external).toBeUndefined()
    expect(header).toBeNull()
  })

  it("a configured program's escaped output; the default options field raises the deprecation notice", async () => {
    const app = make({ TransformationsExternalPrograms: ['/usr/bin/tr a-z A-Z'] })
    await app.login()
    const { cell, header } = await grid(app)
    // DefaultTransformations.External: [0, '-f /dev/null -i -wrap -q', 1, 1] — tr refuses the options
    expect(cell.tf.external).toBe('')
    expect(JSON.parse(decodeURIComponent(header ?? '[]'))).toEqual([{ kind: 'external-options' }])
  })

  it('options without the command-line field: the output, no notice', async () => {
    const app = make({
      TransformationsExternalPrograms: ['/usr/bin/tr a-z A-Z'],
      DefaultTransformations: { External: [0, '', 1, 1] },
    })
    await app.login()
    const { cell, header } = await grid(app)
    expect(cell.tf.external).toBe('HELLO &lt;B&gt;')
    expect(header).toBeNull()
  })
})
