import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SESSION_COOKIE } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signSql } from '../../src/query/signature.ts'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * The value widgets of the Insert/Edit form and the BLOB download through the API
 * (docs/features/03-insert-edit-transformations.md › Micro-behaviours checklist).
 */
// biome-ignore lint/suspicious/noExplicitAny: loosely typed API payloads in tests
type Json = Record<string, any>
const DB = 'f04_it_widgets'
const base = `/api/servers/1/databases/${DB}/tables`
const uploads = mkdtempSync(join(tmpdir(), 'f04-upload-'))
const t = testApp(testConfig({ UploadDir: uploads }))
let root: mysql.Connection

async function form(table: string, body: unknown = {}): Promise<Json> {
  const r = await t.req('POST', `${base}/${table}/insert-form`, body)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}
const column = (f: Json, name: string) => {
  const i = (f.columns as Json[]).findIndex((c) => c.field === name)
  expect(i, name).toBeGreaterThanOrEqual(0)
  return { col: f.columns[i] as Json, cell: f.rows[0].cells[i] as Json }
}
function signed(clause: string) {
  const secret = t.deps.store.get(t.jar.get(SESSION_COOKIE) ?? '')?.hmacSecret ?? ''
  return { clause, sig: signSql(clause, secret, t.deps.cfg.blowfish_secret) }
}

beforeAll(async () => {
  writeFileSync(join(uploads, 'a.txt'), 'hello')
  mkdirSync(join(uploads, 'sub'))
  symlinkSync(join(uploads, 'a.txt'), join(uploads, 'link.txt'))
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE p (id INT PRIMARY KEY, code VARBINARY(4) UNIQUE);
    INSERT INTO p VALUES (1, 0x01);
    CREATE TABLE w (
      id INT PRIMARY KEY,
      i INT,
      f FLOAT,
      g POINT,
      txt TEXT,
      dt DATETIME NOT NULL,
      nn VARCHAR(5) NOT NULL,
      nl VARCHAR(5) DEFAULT NULL,
      blb BLOB,
      pid INT,
      pcode VARBINARY(4),
      FOREIGN KEY (pid) REFERENCES p (id),
      FOREIGN KEY (pcode) REFERENCES p (code)
    ) ENGINE=InnoDB;
    INSERT INTO w (id, txt, dt, nn, blb) VALUES (1, REPEAT('a', 32001), '2020-01-01 00:00:00', 'x', 0x89504E470D0A);`)
  await t.login()
})
afterAll(async () => {
  await root?.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root?.end()
  await t.close()
  rmSync(uploads, { recursive: true, force: true })
})

describe('insert form widgets', () => {
  it('integer inputs carry the exact range, numeric input mode [p03-d96416]', async () => {
    const { cell } = column(await form('w'), 'i')
    expect(cell.widget).toMatchObject({
      kind: 'text',
      min: '-2147483648',
      max: '2147483647',
      dataType: 'INT',
    })
  })

  it('float/double and geometry inputs: the column length clamped to MaxSizeForInputField [p03-0470d0]', async () => {
    const f = await form('w')
    // the sizes phpMyAdmin renders for this table (InsertEdit::getColumnSize): 11, 60, 60
    expect(column(f, 'i').cell.widget).toMatchObject({ kind: 'text', size: 11 })
    expect(column(f, 'f').cell.widget).toMatchObject({ kind: 'text', size: 60 })
    expect(column(f, 'g').cell.widget).toMatchObject({ kind: 'gis', size: 60 })
  })

  it('NOT NULL DATETIME without default starts at the current time; NULL boxes per column [p03-e016c1 p03-422a08]', async () => {
    const f = await form('w')
    expect(column(f, 'dt').cell.value).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.000000$/)
    // NOT NULL: no NULL checkbox; a NULL default: pre-checked when inserting
    expect(column(f, 'nn').col.isNull).toBe(false)
    expect(column(f, 'nl').col.isNull).toBe(true)
    expect(column(f, 'nl').cell.isNull).toBe(true)
    // editing: checked for a NULL value, recorded as fields_null_prev
    const e = await form('w', { where: [signed('`w`.`id` = 1')] })
    expect(column(e, 'nl').cell).toMatchObject({ isNull: true, nullPrev: true })
    expect(column(e, 'nn').cell).toMatchObject({ isNull: false, nullPrev: false })
  })

  it('a TEXT value longer than 32000 characters gets the "might not be editable" notice [p03-877a7f]', async () => {
    const e = await form('w', { where: [signed('`w`.`id` = 1')] })
    expect(column(e, 'txt').cell.widget).toMatchObject({ kind: 'textarea', tooLong: true })
    expect(column(await form('w'), 'txt').cell.widget.tooLong).toBe(false)
  })

  it('a foreign key column posts fields_type foreign, or hex for a binary one [p03-d9e3db]', async () => {
    const f = await form('w')
    expect(column(f, 'pid').cell.fieldsType).toBe('foreign')
    expect(column(f, 'pcode').cell.fieldsType).toBe('hex')
  })

  it('BLOB columns get the upload input with its maximum, and the UploadDir files without symlinks [p03-0e3fd8 p03-2a23de]', async () => {
    const f = await form('w')
    expect(f.uploadEnabled).toBe(true)
    expect(f.hasBlob).toBe(true)
    const blb = column(f, 'blb').col
    expect(blb.upload).toMatchObject({ maxSize: expect.stringMatching(/^\(Max: \d/) })
    expect(blb.uploadDir).toEqual(['a.txt'])
    expect(column(f, 'txt').col.upload).toBeNull()
  })
})

describe('BLOB download', () => {
  it('/table/get-field: <table>-<column>.bin with the sniffed content type [p03-f61c7d]', async () => {
    const s = signed('`w`.`id` = 1')
    const q = new URLSearchParams({ db: DB, table: 'w', where: s.clause, sig: s.sig, key: 'blb' })
    const r = await t.app.request(`/api/servers/1/browse/field?${q}`, {
      headers: { cookie: [...t.jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/png')
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="w-blb.bin"')
    expect(Buffer.from(await r.arrayBuffer()).toString('hex')).toBe('89504e470d0a')
  })
})
