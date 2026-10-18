import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Feature 08 checklist (docs/features/08-settings-preferences-pmadb.md): the configuration storage
 * notices, rename propagation, the foreign key dropdown limit, a failed preferences save and the
 * language / theme kept in the preferences. Uses the shared pmadb (`phpmyadmin`, control user pma);
 * only `f08p*` databases, the user `f08p_u` and their pmadb rows are touched.
 */
const USER = 'f08p_u'
const DB = 'f08p_db'
const DB2 = 'f08p_db2'
const SRV = { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }
// biome-ignore lint/suspicious/noExplicitAny: loosely typed API payloads in tests
type Json = Record<string, any>
let root: mysql.Connection

const PMA_TABLES: Array<[string, string]> = [
  ['pma__relation', 'master_db'],
  ['pma__relation', 'foreign_db'],
  ['pma__table_info', 'db_name'],
  ['pma__column_info', 'db_name'],
  ['pma__table_coords', 'db_name'],
  ['pma__table_uiprefs', 'db_name'],
  ['pma__navigationhiding', 'db_name'],
]

async function cleanup() {
  await root.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB2}`)
  for (const [table, col] of PMA_TABLES) {
    await root.query(`DELETE FROM phpmyadmin.${table} WHERE ${col} LIKE 'f08p%'`)
  }
  await root.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER])
  await root.query(`DROP USER IF EXISTS '${USER}'@'%'`)
}

const rows = async (sql: string, args: unknown[] = []) =>
  (await root.query(sql, args))[0] as Array<Record<string, unknown>>

async function storedPrefs(): Promise<Json | null> {
  const r = await rows('SELECT config_data FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER])
  return r[0] === undefined ? null : (JSON.parse(String(r[0].config_data)) as Json)
}

async function app(cfg: Parameters<typeof testConfig>[0] = {}, server: Json = SRV) {
  const t = testApp(testConfig(cfg, server))
  const r = await t.login(USER, USER)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return t
}

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await cleanup()
  await root.query(`CREATE DATABASE ${DB}; CREATE DATABASE ${DB2}; USE ${DB};
    CREATE TABLE small (id INT PRIMARY KEY, name VARCHAR(10)) ENGINE=InnoDB;
    INSERT INTO small VALUES (1, 'one');
    CREATE TABLE big (id INT PRIMARY KEY, name VARCHAR(10)) ENGINE=InnoDB;
    INSERT INTO big VALUES (1, 'a'), (2, 'b'), (3, 'c');
    CREATE TABLE child (id INT PRIMARY KEY, s INT, b INT,
      CONSTRAINT f08p_s FOREIGN KEY (s) REFERENCES small (id),
      CONSTRAINT f08p_b FOREIGN KEY (b) REFERENCES big (id)) ENGINE=InnoDB;
    CREATE TABLE a (id INT PRIMARY KEY, pid INT, name VARCHAR(10));
    CREATE TABLE b (id INT PRIMARY KEY, x INT);
    CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f08p\\_%\`.* TO '${USER}'@'%';`)
})

afterAll(async () => {
  await cleanup()
  await root.end()
})

describe('configuration storage notices', () => {
  it('[p08-9f5c8d] error when a pmadb is configured, notice otherwise, the ZeroConf line, PmaNoRelation_DisableWarning hides them', async () => {
    // a configured pmadb that does not work: error, on the home page and on database Operations
    let t = await app({ ZeroConf: true }, { pmadb: 'f08p_missing' })
    let s = (await t.req('GET', '/api/servers/1/metadata-storage/status')).json as Json
    expect(s.homeNotice).toEqual({
      type: 'error',
      text: 'The phpMyAdmin configuration storage is not completely configured, some extended features have been deactivated. %sFind out why%s. ',
      detail: "Or alternately go to 'Operations' tab of any database to set it up there.",
    })
    expect((await t.req('GET', '/api/servers/1/home')).json.configStorageMessage).toEqual({
      type: 'error',
      zeroConf: true,
    })
    expect((await t.req('GET', `/api/servers/1/databases/${DB}/operations`)).json.storageNotice).toEqual({
      type: 'error',
      text: 'The phpMyAdmin configuration storage has been deactivated. %sFind out why%s.',
    })
    await t.close()

    // nothing configured, ZeroConf off: a notice, without the Operations hint
    t = await app({ ZeroConf: false }, {})
    s = (await t.req('GET', '/api/servers/1/metadata-storage/status')).json as Json
    expect(s.homeNotice).toMatchObject({ type: 'notice' })
    expect(s.homeNotice.detail).toBeUndefined()
    expect((await t.req('GET', '/api/servers/1/home')).json.configStorageMessage).toEqual({
      type: 'notice',
      zeroConf: false,
    })
    expect(
      (await t.req('GET', `/api/servers/1/databases/${DB}/operations`)).json.storageNotice,
    ).toMatchObject({ type: 'notice' })
    await t.close()

    // suppressed
    t = await app({ ZeroConf: true, PmaNoRelation_DisableWarning: true }, { pmadb: 'f08p_missing' })
    s = (await t.req('GET', '/api/servers/1/metadata-storage/status')).json as Json
    expect(s.homeNotice).toBeNull()
    expect(s.operationsNotice).toBeNull()
    expect((await t.req('GET', '/api/servers/1/home')).json.configStorageMessage).toBeNull()
    expect((await t.req('GET', `/api/servers/1/databases/${DB}/operations`)).json.storageNotice).toBeNull()
    await t.close()
  })
})

describe('with the configuration storage', () => {
  let t: Awaited<ReturnType<typeof app>>
  beforeAll(async () => {
    t = await app({ ForeignKeyMaxLimit: 2 })
  })
  afterAll(() => t?.close())

  it('[p08-8b840d] a rename updates relation (both sides), table_info, column_info, table_coords, table_uiprefs and navigationhiding; a move to another database deletes the coordinates', async () => {
    await root.query(
      `INSERT INTO phpmyadmin.pma__relation (master_db, master_table, master_field, foreign_db, foreign_table, foreign_field)
         VALUES (?, 'a', 'pid', ?, 'b', 'id'), (?, 'b', 'x', ?, 'a', 'id');
       INSERT INTO phpmyadmin.pma__table_info (db_name, table_name, display_field) VALUES (?, 'a', 'name');
       INSERT INTO phpmyadmin.pma__column_info (db_name, table_name, column_name, comment) VALUES (?, 'a', 'name', 'the name');
       INSERT INTO phpmyadmin.pma__table_coords (db_name, table_name, pdf_page_number, x, y) VALUES (?, 'a', 1, 10, 20);
       INSERT INTO phpmyadmin.pma__table_uiprefs (username, db_name, table_name, prefs) VALUES (?, ?, 'a', '{}');
       INSERT INTO phpmyadmin.pma__navigationhiding (username, item_name, item_type, db_name, table_name)
         VALUES (?, 'name', 'column', ?, 'a'), (?, 'a', 'table', ?, '');`,
      [DB, DB, DB, DB, DB, DB, DB, USER, DB, USER, DB, USER, DB],
    )
    const snapshot = async () => ({
      relation: await rows(
        "SELECT master_db, master_table, foreign_db, foreign_table FROM phpmyadmin.pma__relation WHERE master_db LIKE 'f08p%' ORDER BY master_field",
      ),
      tableInfo: await rows(
        "SELECT db_name, table_name FROM phpmyadmin.pma__table_info WHERE db_name LIKE 'f08p%'",
      ),
      columnInfo: await rows(
        "SELECT db_name, table_name FROM phpmyadmin.pma__column_info WHERE db_name LIKE 'f08p%'",
      ),
      coords: await rows(
        "SELECT db_name, table_name FROM phpmyadmin.pma__table_coords WHERE db_name LIKE 'f08p%'",
      ),
      uiprefs: await rows(
        "SELECT db_name, table_name FROM phpmyadmin.pma__table_uiprefs WHERE db_name LIKE 'f08p%'",
      ),
      hiding: await rows(
        "SELECT item_name, db_name, table_name FROM phpmyadmin.pma__navigationhiding WHERE db_name LIKE 'f08p%' ORDER BY item_type",
      ),
    })
    let r = await t.req('POST', `/api/servers/1/databases/${DB}/tables/a/operations/options`, {
      newName: 'a2',
    })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    expect(await snapshot()).toEqual({
      relation: [
        { master_db: DB, master_table: 'a2', foreign_db: DB, foreign_table: 'b' },
        { master_db: DB, master_table: 'b', foreign_db: DB, foreign_table: 'a2' },
      ],
      tableInfo: [{ db_name: DB, table_name: 'a2' }],
      columnInfo: [{ db_name: DB, table_name: 'a2' }],
      coords: [{ db_name: DB, table_name: 'a2' }],
      uiprefs: [{ db_name: DB, table_name: 'a2' }],
      hiding: [
        { item_name: 'name', db_name: DB, table_name: 'a2' },
        { item_name: 'a2', db_name: DB, table_name: '' },
      ],
    })

    r = await t.req('POST', `/api/servers/1/databases/${DB}/tables/a2/operations/move-copy`, {
      op: 'move',
      newName: 'a3',
      targetDb: DB2,
    })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    expect(await snapshot()).toEqual({
      relation: [
        { master_db: DB2, master_table: 'a3', foreign_db: DB, foreign_table: 'b' },
        { master_db: DB, master_table: 'b', foreign_db: DB2, foreign_table: 'a3' },
      ],
      tableInfo: [{ db_name: DB2, table_name: 'a3' }],
      columnInfo: [{ db_name: DB2, table_name: 'a3' }],
      coords: [],
      uiprefs: [{ db_name: DB2, table_name: 'a3' }],
      hiding: [
        { item_name: 'name', db_name: DB2, table_name: 'a3' },
        { item_name: 'a3', db_name: DB2, table_name: '' },
      ],
    })
  })

  it('[p08-ad6ee4] a foreign key gets a dropdown only below ForeignKeyMaxLimit rows, else the browse-values link', async () => {
    const r = await t.req('POST', `/api/servers/1/databases/${DB}/tables/child/insert-form`, {})
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    const f = r.json as Json
    const widget = (field: string) =>
      f.rows[0].cells[(f.columns as Json[]).findIndex((c) => c.field === field)].widget as Json
    expect(widget('s').kind).toBe('foreign-select')
    expect((widget('s').options as Json[]).map((o) => o.value)).toEqual(['', '1', '', '1'])
    expect(widget('b')).toEqual({ kind: 'foreign-link' })
  })
})

describe('preferences', () => {
  it('[p08-a42fac] a failed save shows the posted values with their errors; revert saves nothing', async () => {
    const t = await app()
    const g = (await t.req('GET', '/api/servers/1/preferences/forms/features')).json as Json
    const values: Record<string, string> = {}
    for (const form of g.formSet.forms as Json[]) {
      for (const item of form.items as Json[]) {
        if (item.kind !== 'field') continue
        const fld = item.field as Json
        if (fld.type === 'checkbox') {
          if (fld.value === true) values[fld.id] = 'on'
        } else if (fld.type === 'select') {
          const opts = fld.options as Json[]
          values[fld.id] = opts.some((o) => o.value === fld.value) ? fld.value : (opts[0]?.value ?? '')
        } else values[fld.id] = String(fld.value)
      }
    }
    const before = await storedPrefs()
    const s = (
      await t.req('POST', '/api/servers/1/preferences/forms/features', {
        values: { ...values, MaxDbList: '120', MaxTableList: '120' },
      })
    ).json as Json
    expect(s.saved).toBe(false)
    expect(s.formSet.hasErrors).toBe(true)
    // the upper bound of MaxDbList is the configured value (100)
    expect(s.formSet.errorList).toEqual([
      { name: 'Maximum databases', errors: ['Value must be less than or equal to 100!'] },
    ])
    const field = (id: string) =>
      (s.formSet.forms as Json[])
        .flatMap((fm) => fm.items as Json[])
        .find((i) => i.kind === 'field' && i.field.id === id)?.field as Json
    // the posted values stay on screen, the erroneous one with its error
    expect(field('MaxDbList')).toMatchObject({
      value: '120',
      errors: ['Value must be less than or equal to 100!'],
    })
    expect(field('MaxTableList').value).toBe('120')
    expect(await storedPrefs()).toEqual(before)
    const rv = (await t.req('POST', '/api/servers/1/preferences/forms/features', { values, revert: true }))
      .json as Json
    expect(rv).toEqual({ saved: false })
    expect(await storedPrefs()).toEqual(before)
    await t.close()
  })

  it('[p08-495415] a language chosen anywhere is stored as `lang` (removed for en); without the cookie the stored one is used; a theme cookie is stored as ThemeDefault (removed for original)', async () => {
    const t = await app()
    await t.req('GET', '/api/i18n?lang=fr')
    expect(t.jar.get('bma_lang')).toBe('fr')
    await t.req('GET', '/api/servers/1/home')
    expect((await storedPrefs())?.lang).toBe('fr')

    // another browser without the cookie: the stored language, and the cookie written with it
    t.jar.delete('bma_lang')
    const h = await t.req('GET', '/api/servers/1/home')
    expect(h.status).toBe(200)
    expect(t.jar.get('bma_lang')).toBe('fr')

    await t.req('GET', '/api/i18n?lang=en')
    await t.req('GET', '/api/servers/1/home')
    expect((await storedPrefs())?.lang).toBeUndefined()

    // the theme cookie differs from the preferences: stored silently, `original` removes it
    let r = await t.req('POST', '/api/servers/1/themes/set', { theme: 'metro', sync: true })
    expect(r.json).toEqual({ ok: true })
    expect((await storedPrefs())?.ThemeDefault).toBe('metro')
    r = await t.req('POST', '/api/servers/1/themes/set', { theme: 'original', sync: true })
    expect(r.json).toEqual({ ok: true })
    expect((await storedPrefs())?.ThemeDefault).toBeUndefined()
    // ThemeSetController itself stores the chosen theme as is
    await t.req('POST', '/api/servers/1/themes/set', { theme: 'original' })
    expect((await storedPrefs())?.ThemeDefault).toBe('original')
    await t.close()
  })

  it('[p08-d68897] without permanent storage two-factor authentication is not available', async () => {
    const t = await app({ ZeroConf: false }, { pmadb: 'f08p_missing' })
    const r = (await t.req('GET', '/api/servers/1/preferences/two-factor')).json as Json
    expect(r.enabled).toBe(false)
    const c = await t.req('POST', '/api/servers/1/preferences/two-factor/configure', {
      backend: 'application',
    })
    expect(c.json.configured).not.toBe(true)
    await t.close()
  })
})
