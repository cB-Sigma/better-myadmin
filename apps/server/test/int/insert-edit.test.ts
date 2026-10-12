import { SESSION_COOKIE } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signSql } from '../../src/query/signature.ts'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Insert/Edit form, save, foreign values and the transformation wrapper against a live MySQL
 * (docs/features/03-insert-edit-transformations.md). The statements themselves are compared with
 * phpMyAdmin in tests/parity/insert-edit.parity.test.ts.
 */
const DB = 'f03_ie_it'
let t: ReturnType<typeof testApp>
let root: mysql.Connection

// biome-ignore lint/suspicious/noExplicitAny: loosely typed API payloads in tests
type Json = Record<string, any>
const base = `/api/servers/1/databases/${DB}/tables`

async function post(path: string, body: unknown, status = 200): Promise<Json> {
  const r = await t.req('POST', path, body)
  expect(r.status, JSON.stringify(r.json)).toBe(status)
  return r.json
}
function signed(clause: string) {
  const secret = t.deps.store.get(t.jar.get(SESSION_COOKIE) ?? '')?.hmacSecret ?? ''
  return { clause, sig: signSql(clause, secret, t.deps.cfg.blowfish_secret) }
}
const writes = (j: Json) =>
  ((j.executed ?? []) as Array<{ sql: string }>)
    .map((e) => e.sql)
    .filter((s) => !/^(SELECT|SHOW|USE|SET )/i.test(s))

/** the fields a browser posts for one row of the form, with overrides by column */
function rowFields(form: Json, rowId: number, values: Record<string, string | null> = {}) {
  return (form.columns as Json[]).map((col, i) => {
    const cell = form.rows[rowId].cells[i] as Json
    const v = col.field in values ? values[col.field] : cell.value
    // editing: leave the function select empty (the default NOW() would wrap the stored value)
    const fn = form.insertMode ? col.defaultFunction : ''
    return {
      name: col.field,
      value: v ?? '',
      type: cell.fieldsType,
      isNull: v === null ? true : col.field in values ? false : cell.isNull,
      nullPrev: cell.nullPrev,
      function: fn,
      prev: cell.prev,
      autoIncrement: cell.autoIncrement,
      virtual: cell.virtual,
    }
  })
}

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE parent (id INT PRIMARY KEY, label VARCHAR(20));
    INSERT INTO parent VALUES (1, 'one'), (2, 'two');
    CREATE TABLE t (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(30) DEFAULT 'x' COMMENT 'the name',
      qty INT UNSIGNED NOT NULL DEFAULT 0,
      body TEXT,
      kind ENUM('a','b') NOT NULL DEFAULT 'a',
      tags SET('p','q','r'),
      flags BIT(4) DEFAULT b'0101',
      bin VARBINARY(8),
      blb BLOB,
      created TIMESTAMP NOT NULL,
      parent_id INT,
      doubled BIGINT GENERATED ALWAYS AS (qty * 2) VIRTUAL,
      CONSTRAINT fk_p FOREIGN KEY (parent_id) REFERENCES parent (id)
    );
    INSERT INTO t (name, qty, body, created, bin) VALUES ('first', 1, 'b1', '2020-01-01 00:00:00', 0x0102), ('second', 2, NULL, '2020-01-02 00:00:00', NULL);`)
  t = testApp(testConfig({ DBG: { sql: true } }))
  await t.login()
})
afterAll(async () => {
  await root?.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root?.end()
  await t?.close()
})

describe('insert form', () => {
  it('describes each column with phpMyAdmin widgets and defaults [p03-1b3909] [p03-7e69f5 p03-79ba1c p03-490417 p03-2e3f92 p03-b3c9a2 p03-4997ee p03-4c37d2 p03-cb66f4 p03-eee6f5 p03-6e8f03 p03-e71e0e p03-0a843f]', async () => {
    const f = await post(`${base}/t/insert-form`, {})
    expect(f.insertMode).toBe(true)
    expect(f.rows).toHaveLength(2)
    expect(f.rows[0].ignore).toBeNull()
    expect(f.rows[1].ignore).toBe(true)
    const cols = Object.fromEntries(
      (f.columns as Json[]).map((c, i) => [c.field, { col: c, cell: f.rows[0].cells[i] }]),
    )
    expect(Object.keys(cols)).not.toContain('doubled')
    expect(cols.name.col.comment).toBe('the name')
    expect(cols.name.cell.widget).toMatchObject({ kind: 'text', size: 30, maxlength: 30 })
    // MySQL 8 reports `int unsigned`: InsertEditColumn::$trueType keeps the attribute, so phpMyAdmin
    // finds no integer range for it; a signed `int` gets one
    expect(cols.qty.cell.widget).toMatchObject({ kind: 'text', min: null, dataType: '' })
    expect(cols.parent_id.col.trueType).toBe('int')
    expect(cols.body.cell.widget.kind).toBe('textarea')
    expect(cols.kind.cell.widget).toMatchObject({ kind: 'enum-radio', selected: 'a' })
    expect(cols.tags.cell.widget).toMatchObject({ kind: 'set', size: 3 })
    expect(cols.flags.cell.value).toBe('101')
    expect(cols.flags.cell.fieldsType).toBe('bit')
    expect(cols.bin.cell.widget).toMatchObject({ kind: 'hex-input', size: 16 })
    expect(cols.blb.cell.widget.kind).toBe('protected')
    expect(cols.created.col.defaultFunction).toBe('NOW')
    expect(cols.id.cell.autoIncrement).toBe(true)
    expect(cols.parent_id.cell.widget.kind).toBe('foreign-select')
    expect(cols.parent_id.cell.widget.options.map((o: Json) => o.value)).toEqual(['', '1', '2', '', '1', '2'])
    expect(f.functions.at(-1)).toMatchObject({ value: 'PHP_PASSWORD_HASH' })
  })

  it('inserts the non-ignored rows in one statement with the default NOW() [p03-c84958 p03-28b5f4]', async () => {
    const f = await post(`${base}/t/insert-form`, {})
    const r = await post(`${base}/t/rows`, {
      rows: [
        { fields: rowFields(f, 0, { name: 'third', qty: '3', parent_id: '1' }) },
        { ignore: true, fields: rowFields(f, 1) },
      ],
      submitType: 'insert',
    })
    expect(writes(r)).toEqual([
      "INSERT INTO `t` (`id`, `name`, `qty`, `body`, `kind`, `tags`, `flags`, `bin`, `blb`, `created`, `parent_id`) VALUES (NULL, 'third', '3', NULL, 'a', NULL, b'101', NULL, NULL, NOW(), '1')",
    ])
    expect(r.message.text).toBe('1 row inserted.\nInserted row id: 3')
    expect(r.next).toEqual({ action: 'back' })
  })

  it('previews without executing', async () => {
    const f = await post(`${base}/t/insert-form`, {})
    const r = await post(`${base}/t/rows`, {
      rows: [{ fields: rowFields(f, 0, { name: 'p' }) }],
      preview: true,
    })
    expect(r.preview).toHaveLength(1)
    expect(writes(r)).toEqual([])
  })
})

describe('edit form', () => {
  it('loads the row, saves only changed columns and finds the next row [p03-28b5f4 p03-2e3f92]', async () => {
    const f = await post(`${base}/t/insert-form`, { where: [signed('`t`.`id` = 1')], clauseIsUnique: true })
    expect(f.insertMode).toBe(false)
    expect(f.foundUniqueKey).toBe(true)
    expect(f.isNumericWhere).toBe(true)
    const i = (f.columns as Json[]).findIndex((c) => c.field === 'bin')
    expect(f.rows[0].cells[i].value).toBe('0102')
    const r = await post(`${base}/t/rows`, {
      rows: [{ whereClause: '`t`.`id` = 1', fields: rowFields(f, 0, { name: 'renamed' }) }],
      afterInsert: 'edit_next',
      clauseIsUnique: true,
    })
    // BIT is posted as binary digits but fields_prev holds the decimal value: always rewritten
    expect(writes(r)).toEqual(["UPDATE `t` SET `name` = 'renamed', `flags` = b'0101' WHERE `t`.`id` = 1"])
    expect(r.next.action).toBe('edit')
    expect(r.next.where[0].clause).toBe('`t`.`id` = 2')
  })

  it('reports an empty result set but still renders the form [p03-5c8c94]', async () => {
    const f = await post(`${base}/t/insert-form`, { where: [signed('`t`.`id` = 999')] })
    expect(f.messages[0].text).toBe('MySQL returned an empty result set (i.e. zero rows).')
    expect(f.rows).toHaveLength(1)
  })

  it('ignores unsigned where clauses [p03-69bc10]', async () => {
    const f = await post(`${base}/t/insert-form`, { where: [{ clause: '`t`.`id` = 1', sig: 'x' }] })
    expect(f.insertMode).toBe(true)
  })

  it('"No change" when nothing differs [p03-c84958]', async () => {
    await root.query(`UPDATE ${DB}.t SET flags = NULL WHERE id = 2`)
    const f = await post(`${base}/t/insert-form`, { where: [signed('`t`.`id` = 2')] })
    const r = await post(`${base}/t/rows`, {
      rows: [{ whereClause: '`t`.`id` = 2', fields: rowFields(f, 0) }],
    })
    expect(r.message.text).toBe('No change')
  })
})

describe('foreign values and wrapper', () => {
  it('browses the referenced table [p03-d20896]', async () => {
    const r = await post(`${base}/t/browse-foreigners`, { field: 'parent_id', data: '2' })
    expect(r.total).toBe(2)
    expect(r.rows.map((x: Json) => x.left.key)).toEqual(['1', '2'])
    expect(r.rows[1].left.selected).toBe(true)
    const f = await post(`${base}/t/browse-foreigners`, { field: 'parent_id', filter: 'tw' })
    expect(f.rows).toHaveLength(1)
  })

  it('streams a cell through the wrapper only with a valid signature [p03-d452fe]', async () => {
    const s = signed('`t`.`id` = 1')
    const ok = await t.app.request(
      `${base}/t/transformation/wrapper?key=bin&where=${encodeURIComponent(s.clause)}&sig=${s.sig}`,
      { headers: { cookie: [...t.jar].map(([k, v]) => `${k}=${v}`).join('; ') } },
    )
    expect(ok.status).toBe(200)
    expect(Buffer.from(await ok.arrayBuffer()).toString('hex')).toBe('0102')
    const bad = await t.app.request(
      `${base}/t/transformation/wrapper?key=bin&where=${encodeURIComponent(s.clause)}&sig=no`,
      {
        headers: { cookie: [...t.jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      },
    )
    expect(bad.status).toBe(400)
  })
})

describe('browser display transformations in the Browse grid', () => {
  let s: ReturnType<typeof testApp>
  beforeAll(async () => {
    await root.query(`DELETE FROM phpmyadmin.pma__column_info WHERE db_name = '${DB}';
      INSERT INTO phpmyadmin.pma__column_info (db_name, table_name, column_name, comment, mimetype,
        transformation, transformation_options, input_transformation, input_transformation_options)
      VALUES ('${DB}', 't', 'name', '', 'text_plain', 'text_plain_preappend.php', "'[',']'", '', '')`)
    s = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }))
    await s.login()
  })
  afterAll(async () => {
    await root.query(`DELETE FROM phpmyadmin.pma__column_info WHERE db_name = '${DB}'`)
    await s?.close()
  })

  it('marks transformed cells; Hide browser transformation turns them off [p03-0f872c p02-15262e]', async () => {
    const run = async (hide: boolean) =>
      (
        (await s.req('POST', '/api/servers/1/browse', { db: DB, table: 't', hideTransformation: hide }))
          .json as Json
      ).statements[0].grid
    const grid = await run(false)
    const i = (grid.columns as Json[]).findIndex((c) => c.name === 'name')
    const cell = grid.rows[0].cells[i]
    expect(cell.cls).toContain('text_plain transformed')
    expect(cell.tf).toMatchObject({ file: 'Text_Plain_PreApPend', options: ['[', ']'], column: 'name' })
    const plain = await run(true)
    expect(plain.rows[0].cells[i].tf).toBeUndefined()
    const cols = (await s.req('GET', `${base}/t/transformations`)).json as Json
    expect(cols.enabled).toBe(true)
    expect(cols.columns.name.transformationOptions).toEqual(['[', ']'])
  })
})
