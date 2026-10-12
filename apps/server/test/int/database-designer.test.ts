import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Database → Designer and the relational schema export through the API
 * (docs/features/05-database-level.md), with and without the configuration storage.
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const J = (r: { json: unknown }): Any => r.json
const DB = 'f05d_it'
let root: mysql.Connection
const app = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }))
const bare = testApp(testConfig({}))
const base = `/api/servers/1/databases/${DB}`
const clean = `DELETE FROM phpmyadmin.pma__table_coords WHERE db_name = '${DB}';
  DELETE FROM phpmyadmin.pma__pdf_pages WHERE db_name = '${DB}';
  DELETE FROM phpmyadmin.pma__table_info WHERE db_name = '${DB}';
  DELETE FROM phpmyadmin.pma__relation WHERE master_db = '${DB}';`

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.a (id INT PRIMARY KEY, v VARCHAR(10), d DATETIME) ENGINE=InnoDB;
    CREATE TABLE ${DB}.b (id INT PRIMARY KEY, a_id INT, KEY (a_id), FOREIGN KEY (a_id) REFERENCES a (id)) ENGINE=InnoDB;
    CREATE TABLE ${DB}.c (x INT) ENGINE=MyISAM;
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

const pos = (table: string, x: number, y: number, h = true) => ({
  x: String(x),
  y: String(y),
  v: true,
  h,
  db: DB,
  table,
})

describe('designer', () => {
  it('a new page shows every table at a random place, with icons, keys and the relation', async () => {
    const r = J(await app.req('GET', `${base}/designer`))
    expect(r.displayPage).toBe(-1)
    expect(r.selectedPage).toBeNull()
    expect(r.tablesEnabled).toBe(true)
    expect(r.tables.map((t: Any) => [t.table, t.supportsFk])).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
    ])
    for (const t of r.tables) {
      expect(t.x).toBeGreaterThanOrEqual(20)
      expect(t.x).toBeLessThanOrEqual(700)
    }
    expect(r.tables[0].columns.map((c: Any) => c.icon)).toEqual([
      'designer/FieldKey_small',
      'designer/Field_small_char',
      'designer/Field_small_date',
    ])
    expect(r.relations).toEqual([
      {
        constraint: 'b_ibfk_1',
        masterTable: `${DB}.b`,
        masterField: 'a_id',
        foreignTable: `${DB}.a`,
        foreignField: 'id',
      },
    ])
  })

  it('saves a page, loads it, saves again and deletes it', async () => {
    let r = J(
      await app.req('POST', `${base}/designer/save-page`, {
        save_page: 'new',
        selected_value: `${DB} page`,
        tables: [pos('a', 10, 20), pos('b', 200, 40), pos('c', 0, 0, false)],
      }),
    )
    expect(r.success).toBe(true)
    const id = r.id
    r = J(await app.req('GET', `${base}/designer?page=${id}`))
    expect(r.selectedPage).toBe(`${DB} page`)
    expect(r.tables.map((t: Any) => [t.table, t.onPage, t.onPage ? [t.x, t.y] : null])).toEqual([
      ['a', true, [10, 20]],
      ['b', true, [200, 40]],
      ['c', false, null],
    ])
    // the only page of the database is the loading page
    expect(J(await app.req('GET', `${base}/designer`)).displayPage).toBe(id)
    expect(J(await app.req('GET', `${base}/designer/pages`))).toEqual({
      pdfwork: true,
      pages: [{ id, name: `${DB} page` }],
    })
    r = J(
      await app.req('POST', `${base}/designer/save-page`, {
        save_page: 'same',
        selected_page: String(id),
        tables: [pos('a', 11, 21)],
      }),
    )
    expect(r).toEqual({ success: true })
    r = J(await app.req('GET', `${base}/designer?page=${id}`))
    expect(r.tables.filter((t: Any) => t.onPage).map((t: Any) => t.table)).toEqual(['a'])
    expect(J(await app.req('POST', `${base}/designer/delete-page`, { selected_page: String(id) }))).toEqual({
      success: true,
    })
    expect(J(await app.req('GET', `${base}/designer/pages`)).pages).toEqual([])
  })

  it('display field, internal relation, export form, add table and the schema file', async () => {
    let r = J(await app.req('POST', `${base}/designer/display-field`, { db: DB, table: 'a', field: 'v' }))
    expect(r).toEqual({
      success: true,
      message: { type: 'success', text: 'Your SQL query has been executed successfully.' },
    })
    expect(J(await app.req('GET', `${base}/designer`)).tables[0].displayField).toBe('v')
    r = J(
      await app.req('POST', `${base}/designer/add-relation`, {
        DB1: DB,
        T1: 'a',
        F1: 'id',
        DB2: DB,
        T2: 'c',
        F2: 'x',
      }),
    )
    expect(r.message.text).toBe('Internal relationship has been added.')
    r = J(await app.req('GET', `${base}/designer/export?page=-1`))
    expect(r.plugins.map((p: Any) => p.name)).toEqual(['dia', 'eps', 'svg'])
    expect(r.choice).toBe('dia')
    expect(r.plugins[2].options[0].items.map((i: Any) => [i.name, i.checked ?? i.value])).toEqual([
      ['svg_show_color', true],
      ['svg_show_keys', false],
      ['svg_all_tables_same_width', false],
    ])
    r = J(await app.req('GET', `${base}/designer/table?db=${DB}&table=c`))
    expect(r.map((t: Any) => t.table)).toEqual(['c'])
    r = J(
      await app.req('POST', `${base}/schema-export`, {
        export_type: 'svg',
        tables: [pos('a', 10, 20), pos('c', 200, 40)],
      }),
    )
    expect(r.fileName).toBe(`${DB}.svg`)
    expect(r.mediaType).toBe('image/svg+xml')
    expect(r.data).toContain('<line ')
    const bad = await app.req('POST', `${base}/schema-export`, { export_type: 'pdf', tables: [] })
    expect(bad.status).toBe(400)
    expect(JSON.stringify(bad.json)).toContain('Bad type!')
    r = J(
      await app.req('POST', `${base}/designer/remove-relation`, {
        T1: `${DB}.a`,
        F1: 'id',
        T2: `${DB}.c`,
        F2: 'x',
      }),
    )
    expect(r.message.text).toBe('Internal relationship has been removed.')
  })

  it('without a pmadb: pages kept in the per-user storage (X8)', async () => {
    const r = J(await bare.req('GET', `${base}/designer`))
    expect(r.tablesEnabled).toBe(true)
    expect(r.displayPage).toBe(-1)
    const saved = J(
      await bare.req('POST', `${base}/designer/save-page`, {
        save_page: 'new',
        selected_value: 'local',
        tables: [pos('a', 5, 6)],
      }),
    )
    expect(saved.success).toBe(true)
    const pages = J(await bare.req('GET', `${base}/designer/pages`))
    expect(pages.pages.map((p: Any) => p.name)).toContain('local')
    const loaded = J(await bare.req('GET', `${base}/designer?page=${saved.id}`))
    expect(loaded.tables.find((t: Any) => t.table === 'a')).toMatchObject({ x: 5, y: 6, onPage: true })
    await bare.req('POST', `${base}/designer/delete-page`, { selected_page: String(saved.id) })
  })
})
