import { createHash } from 'node:crypto'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signSql } from '../../apps/server/src/query/signature.ts'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { SESSION_COOKIE } from '../../packages/contracts/src/constants.ts'
import { compareWrites, normalise } from './lib/compare.ts'
import { type Pairs, findForm, removePair, serializeForm, setPair } from './lib/form.ts'
import { GeneralLog, type LogEntry } from './lib/general-log.ts'
import { decodeEntities } from './lib/nav-html.ts'
import { PmaClient, type PmaJson } from './lib/pma.ts'

/**
 * Golden parity of the Insert/Edit form save path (docs/features/03-insert-edit-transformations.md).
 *
 * phpMyAdmin: its own /table/change form is scraped and posted to /table/replace with the values a
 * user would type (plus what change.ts does on a change: untick NULL and the row's Ignore box).
 * BetterMyAdmin: the insert-form endpoint pre-fills the same fields, the same edits are applied and
 * posted to …/rows. The INSERT/UPDATE statements in MySQL's general log must be identical, and so
 * must the resulting table contents.
 */
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const PMA_USER = 'f03_pma'
const BMA_USER = 'f03_bma'
const DB_PMA = 'f03_pdb'
const DB_BMA = 'f03_bdb'
const dbMap = { [DB_PMA]: 'f03_db', [DB_BMA]: 'f03_db' }
const PMADB = 'phpmyadmin'

const reachable = await fetch(`${PMA_URL}/index.php`)
  .then((r) => r.ok)
  .catch(() => false)

const SEED = `
  CREATE TABLE parent (id INT PRIMARY KEY, label VARCHAR(20));
  INSERT INTO parent VALUES (1, 'one'), (2, 'two'), (3, 'three');
  CREATE TABLE t (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) DEFAULT 'x' COMMENT 'the name',
    qty INT NOT NULL DEFAULT 0,
    price DECIMAL(8,2) DEFAULT NULL,
    body TEXT,
    kind ENUM('a','b') NOT NULL DEFAULT 'a',
    tags SET('p','q','r'),
    flags BIT(4) DEFAULT b'0101',
    bin VARBINARY(8),
    blb BLOB,
    d DATE,
    dt DATETIME(3),
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    parent_id INT,
    doubled BIGINT GENERATED ALWAYS AS (qty * 2) VIRTUAL,
    CONSTRAINT fk_p FOREIGN KEY (parent_id) REFERENCES parent (id)
  );
  INSERT INTO t (name, qty, body, bin, blb, d, dt, created, parent_id) VALUES
    ('first', 1, 'b1', 0x0102, 0xCAFE, '2020-01-01', '2020-01-01 10:00:00.123', '2020-01-01 00:00:00', 1),
    ('second', 2, NULL, NULL, NULL, NULL, NULL, '2020-01-02 00:00:00', NULL),
    ('third', 3, 'b3', NULL, NULL, NULL, NULL, '2020-01-03 00:00:00', 2);
  CREATE TABLE g (id INT PRIMARY KEY, pt POINT NOT NULL SRID 0);
  INSERT INTO g VALUES (1, ST_GeomFromText('POINT(1 2)'));
  CREATE TABLE u (k CHAR(36) NOT NULL PRIMARY KEY, v VARCHAR(80), ip VARBINARY(16), code VARCHAR(10));
`

let log: GeneralLog
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let root: mysql.Connection

const md5 = (s: string) => createHash('md5').update(s).digest('hex')

/** One user edit of a cell. */
interface Mod {
  row: number
  col: string
  /** typed value; a list for SET */
  value?: string | string[]
  /** tick (true) / untick (false) the NULL box */
  null?: boolean
  fn?: string
  salt?: string
}

interface Case {
  name: string
  table: string
  /** rows to edit (unique conditions); none = Insert tab */
  where?: string[]
  /** Copy (default_action=insert) */
  copy?: boolean
  clauseIsUnique?: boolean
  mods: Mod[]
  /** rows whose Ignore box is unticked without typing (insert mode) */
  unignore?: number[]
  submitType?: 'save' | 'insert' | 'insertignore' | 'showinsert'
  afterInsert?: 'back' | 'new_insert' | 'same_insert' | 'edit_next'
  preview?: boolean
  /** phpMyAdmin's statement fails too (MySQL error shown) */
  expectError?: boolean
  /** statements masked before comparing (random UUIDs, password hashes) */
  mask?: RegExp
}

// ------------------------------------------------------------------ phpMyAdmin side

const NULLIFY: Record<string, 'select' | 'radio' | 'text'> = {
  '1': 'select',
  '2': 'radio',
  '3': 'select',
  '4': 'select',
  '5': 'text',
  '6': 'text',
}

function applyPma(pairs: Pairs, html: string, mods: Mod[], unignore: number[]): Pairs {
  let out = pairs
  for (const r of unignore) out = removePair(out, `insert_ignore_${r}`)
  for (const m of mods) {
    const key = `[multi_edit][${m.row}][${md5(m.col)}]`
    if (m.null === true) {
      out = setPair(out, `fields_null${key}`, 'on')
      // nullify(): function select reset, value cleared according to the nullify code
      out = removePair(out, `funcs${key}`)
      const code = html.match(new RegExp(`name="nullify_code${escapeRe(key)}" value="(\\d)"`))?.[1] ?? '5'
      if (NULLIFY[code] === 'text') out = setPair(out, `fields${key}`, '')
      else out = removePair(out, `fields${key}`)
      continue
    }
    if (m.null === false) out = removePair(out, `fields_null${key}`)
    if (m.fn !== undefined) out = setPair(out, `funcs${key}`, m.fn)
    if (m.salt !== undefined) out = setPair(out, `salt${key}`, m.salt)
    if (m.value !== undefined) {
      if (Array.isArray(m.value)) {
        out = removePair(out, `fields${key}[]`)
        for (const v of m.value) out = [...out, [`fields${key}[]`, v]]
      } else out = setPair(out, `fields${key}`, m.value)
    }
    // verificationsAfterFieldChange: the NULL box and the row's Ignore box are unticked
    if (m.value !== undefined || m.fn !== undefined) {
      out = removePair(out, `fields_null${key}`)
      out = removePair(out, `insert_ignore_${m.row}`)
    }
  }
  return out
}
const escapeRe = (s: string) => s.replace(/[[\]]/g, '\\$&')

async function pmaRun(c: Case, db: string): Promise<{ preview?: string[] }> {
  let html: string
  if (c.where !== undefined) {
    const params: Array<[string, string]> = [
      ['db', db],
      ['table', c.table],
      ['goto', 'index.php?route=/sql'],
      ['default_action', c.copy === true ? 'insert' : 'update'],
    ]
    for (const w of c.where) params.push(['rows_to_delete[]', w])
    if (c.clauseIsUnique === true) params.push(['clause_is_unique', '1'])
    html = await pma.post('/table/change/rows', params, { ajax: false })
  } else {
    html = await pma.pageGet('/table/change', { db, table: c.table, server: '1' })
  }
  let pairs = serializeForm(findForm(html, { id: 'insertForm' }))
  pairs = applyPma(pairs, html, c.mods, c.unignore ?? [])
  if (c.submitType !== undefined) pairs = setPair(pairs, 'submit_type', c.submitType)
  if (c.afterInsert !== undefined) pairs = setPair(pairs, 'after_insert', c.afterInsert)
  if (c.preview === true) {
    const j = JSON.parse(
      await pma.post('/table/replace', [...pairs, ['do_save_data', '1'], ['preview_sql', '1']]),
    ) as PmaJson
    const codes = [...String(j.sql_data ?? '').matchAll(/<code class="sql"[^>]*>([\s\S]*?)<\/code>/g)].map(
      (m) => decodeEntities((m[1] ?? '').replace(/<[^>]+>/g, '')),
    )
    return { preview: codes }
  }
  await pma.post('/table/replace', [...pairs, ['ajax_page_request', 'true']])
  return {}
}

// ------------------------------------------------------------------ BetterMyAdmin side

// biome-ignore lint/suspicious/noExplicitAny: loosely typed API payloads in tests
type Json = Record<string, any>

function signed(clause: string) {
  const secret = bma.deps.store.get(bma.jar.get(SESSION_COOKIE) ?? '')?.hmacSecret ?? ''
  return { clause, sig: signSql(clause, secret, bma.deps.cfg.blowfish_secret) }
}

async function bmaRun(c: Case, db: string): Promise<{ preview?: string[] }> {
  const base = `/api/servers/1/databases/${db}/tables/${c.table}`
  const f = (
    await bma.req('POST', `${base}/insert-form`, {
      where: (c.where ?? []).map(signed),
      copy: c.copy === true,
      clauseIsUnique: c.clauseIsUnique === true,
    })
  ).json as Json
  expect(f.columns, JSON.stringify(f)).toBeDefined()
  const rows = (f.rows as Json[]).map((row, r) => ({
    whereClause: row.whereClause,
    ignore: row.ignore === true && !(c.unignore ?? []).includes(r),
    fields: (f.columns as Json[]).map((col, i) => {
      const cell = row.cells[i] as Json
      const w = cell.widget as Json
      let value: string | string[] | null = cell.value
      if (w.kind === 'set') value = w.selected
      else if (w.kind === 'enum-radio') value = w.selected === '' ? null : w.selected
      else if (w.kind === 'enum-select') value = w.selected
      else if (w.kind === 'foreign-select') value = w.selected < 0 ? '' : w.options[w.selected].value
      else if (w.kind === 'foreign-link') value = cell.data
      else if (w.kind === 'protected') value = ''
      return {
        name: col.field,
        value,
        type: cell.fieldsType,
        isNull: col.isNull && cell.isNull,
        nullPrev: col.isNull && cell.nullPrev,
        function: col.functionCell === 'select' ? col.defaultFunction : '',
        salt: null as string | null,
        prev: cell.prev,
        autoIncrement: cell.autoIncrement,
        virtual: cell.virtual,
      }
    }),
  }))
  for (const m of c.mods) {
    const row = rows[m.row]!
    const field = row.fields.find((x) => x.name === m.col)!
    if (m.null === true) {
      field.isNull = true
      field.function = ''
      field.value = ''
      continue
    }
    if (m.null === false) field.isNull = false
    if (m.fn !== undefined) field.function = m.fn
    if (m.salt !== undefined) field.salt = m.salt
    if (m.value !== undefined) field.value = m.value
    if (m.value !== undefined || m.fn !== undefined) {
      field.isNull = false
      row.ignore = false
    }
  }
  const r = (
    await bma.req('POST', `${base}/rows`, {
      rows,
      submitType: c.submitType ?? (c.where !== undefined && c.copy !== true ? 'save' : 'insert'),
      afterInsert: c.afterInsert ?? 'back',
      clauseIsUnique: c.clauseIsUnique === true,
      preview: c.preview === true,
    })
  ).json as Json
  if (c.expectError === true) expect(r.error).toBeDefined()
  else expect(r.error, JSON.stringify(r)).toBeUndefined()
  return c.preview === true ? { preview: r.preview as string[] } : {}
}

async function dump(db: string, table: string): Promise<unknown[]> {
  const [rows] = await root.query({ sql: `SELECT * FROM \`${db}\`.\`${table}\``, rowsAsArray: true })
  return (rows as unknown[][]).map((r) =>
    r.map((v) => (Buffer.isBuffer(v) ? v.toString('hex') : v instanceof Date ? 'DATE' : v)),
  )
}

async function runCase(c: Case): Promise<{ pmaLog: LogEntry[]; bmaLog: LogEntry[] }> {
  for (const db of [DB_PMA, DB_BMA]) {
    await root.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`)
  }
  const m1 = await log.marker()
  const p = await pmaRun(c, DB_PMA)
  const pmaLog = await log.since(PMA_USER, m1)
  const m2 = await log.marker()
  const b = await bmaRun(c, DB_BMA)
  const bmaLog = await log.since(BMA_USER, m2)
  const mask = (xs: string[]) =>
    c.mask === undefined ? xs : xs.map((s) => s.replace(c.mask as RegExp, '<MASKED>'))
  if (c.preview === true) {
    expect(mask((b.preview ?? []).map((s) => normalise(s, dbMap)))).toEqual(
      mask((p.preview ?? []).map((s) => normalise(s, dbMap))),
    )
  }
  const cmp = compareWrites(pmaLog, bmaLog, dbMap)
  expect(mask(cmp.bma), `writes of ${c.name}`).toEqual(mask(cmp.pma))
  if (c.mask === undefined) {
    for (const table of ['t', 'g', 'u']) {
      expect(await dump(DB_BMA, table), `${table} after ${c.name}`).toEqual(await dump(DB_PMA, table))
    }
  }
  return { pmaLog, bmaLog }
}

describe.skipIf(!reachable)('Insert/Edit parity', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    for (const u of [PMA_USER, BMA_USER]) {
      await root.query(
        `DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON *.* TO '${u}'@'%'`,
      )
    }
    log = await GeneralLog.open(ROOT)
    pma = new PmaClient(PMA_URL)
    await pma.login(PMA_USER, PMA_USER)
    bma = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: PMADB }))
    await bma.login(BMA_USER, BMA_USER)
  })
  afterAll(async () => {
    await bma?.close()
    await log?.close()
    await root?.query(`DELETE FROM ${PMADB}.pma__column_info WHERE db_name IN ('${DB_PMA}', '${DB_BMA}')`)
    for (const db of [DB_PMA, DB_BMA]) await root?.query(`DROP DATABASE IF EXISTS \`${db}\``)
    for (const u of [PMA_USER, BMA_USER]) await root?.query(`DROP USER IF EXISTS '${u}'@'%'`)
    await root?.end()
  })

  const cases: Case[] = [
    {
      name: 'insert one row (second row ignored)',
      table: 't',
      mods: [
        { row: 0, col: 'name', value: 'new' },
        { row: 0, col: 'qty', value: '7' },
        { row: 0, col: 'kind', value: 'b' },
        { row: 0, col: 'tags', value: ['p', 'r'] },
        { row: 0, col: 'parent_id', value: '2' },
        { row: 0, col: 'bin', value: 'abcd' },
        { row: 0, col: 'flags', value: '1x01' },
        { row: 0, col: 'd', value: '2021-02-03' },
        { row: 0, col: 'dt', value: 'CURRENT_TIMESTAMP' },
      ],
    },
    {
      name: 'insert two rows in one statement [p03-632952]',
      table: 't',
      mods: [
        { row: 0, col: 'name', value: 'r0' },
        { row: 1, col: 'name', value: "r1 'quoted'" },
        { row: 1, col: 'price', value: '3.5' },
      ],
    },
    {
      name: 'insert with functions, salt and NULL',
      table: 't',
      mods: [
        { row: 0, col: 'name', value: 'secret', fn: 'SHA2', salt: '256' },
        { row: 0, col: 'body', value: 'hello', fn: 'UPPER' },
        { row: 0, col: 'qty', value: '', fn: 'PI' },
        { row: 0, col: 'price', null: true },
        { row: 0, col: 'd', value: '', fn: 'CURRENT_DATE' },
      ],
    },
    {
      name: 'insert ignore',
      table: 't',
      submitType: 'insertignore',
      mods: [
        { row: 0, col: 'id', value: '1' },
        { row: 0, col: 'name', value: 'dup' },
      ],
    },
    { name: 'preview of an insert [p03-789dce]', table: 't', preview: true, mods: [{ row: 0, col: 'name', value: 'pv' }] },
    {
      name: 'edit one row: changed columns only, NULL set [p03-30e777]',
      table: 't',
      where: ['`t`.`id` = 1'],
      clauseIsUnique: true,
      mods: [
        { row: 0, col: 'name', value: 'renamed' },
        { row: 0, col: 'created', fn: '' },
        { row: 0, col: 'body', null: true },
        { row: 0, col: 'tags', value: ['q'] },
      ],
    },
    {
      name: 'edit a row with NULLs, not unique (LIMIT 1)',
      table: 't',
      where: ['`t`.`id` = 2'],
      mods: [
        { row: 0, col: 'created', fn: '' },
        { row: 0, col: 'price', value: '9.99' },
        { row: 0, col: 'body', value: 'was null' },
      ],
    },
    {
      name: 'multi-row edit',
      table: 't',
      where: ['`t`.`id` = 1', '`t`.`id` = 3'],
      clauseIsUnique: true,
      mods: [
        { row: 0, col: 'created', fn: '' },
        { row: 1, col: 'created', fn: '' },
        { row: 0, col: 'qty', value: '10' },
        { row: 1, col: 'qty', value: '30' },
      ],
    },
    {
      name: 'edit then "Insert as new row" (protected BLOB copied)',
      table: 't',
      where: ['`t`.`id` = 1'],
      clauseIsUnique: true,
      submitType: 'insert',
      mods: [
        { row: 0, col: 'created', fn: '' },
        { row: 0, col: 'id', value: '' },
      ],
    },
    {
      name: 'copy row',
      table: 't',
      where: ['`t`.`id` = 3'],
      copy: true,
      clauseIsUnique: true,
      mods: [{ row: 0, col: 'created', fn: '' }],
    },
    {
      name: 'edit with "edit next row"',
      table: 't',
      where: ['`t`.`id` = 1'],
      clauseIsUnique: true,
      afterInsert: 'edit_next',
      mods: [
        { row: 0, col: 'created', fn: '' },
        { row: 0, col: 'name', value: 'next' },
      ],
    },
    {
      name: 'preview of an update',
      table: 't',
      where: ['`t`.`id` = 3'],
      preview: true,
      mods: [
        { row: 0, col: 'created', fn: '' },
        { row: 0, col: 'name', value: 'p' },
      ],
    },
    {
      name: 'GIS point through ST_GeomFromText [p03-486ab6]',
      table: 'g',
      mods: [
        { row: 0, col: 'id', value: '5' },
        { row: 0, col: 'pt', value: "'POINT(3 4)',0" },
      ],
    },
    {
      name: 'GIS edit keeps WKT [p03-31dbd7]',
      table: 'g',
      where: ['`g`.`id` = 1'],
      clauseIsUnique: true,
      mods: [{ row: 0, col: 'pt', value: "'POINT(5 6)',0" }],
    },
    {
      name: 'UUID default for a char(36) primary key [p03-074264]',
      table: 'u',
      mask: /'[0-9a-f-]{36}'/g,
      mods: [{ row: 0, col: 'v', value: 'x' }],
    },
    {
      name: 'password_hash()',
      table: 'u',
      mask: /'\$2y\$10\$[^']+'/g,
      mods: [
        { row: 0, col: 'k', value: 'k1', fn: '' },
        { row: 0, col: 'v', value: 'pw', fn: 'PHP_PASSWORD_HASH' },
      ],
    },
  ]

  for (const c of cases) {
    it(c.name, async () => {
      await runCase(c)
    })
  }

  it('the edit-next lookup and the protected-value fetch read the same rows', async () => {
    const { pmaLog, bmaLog } = await runCase(cases.find((c) => c.name.startsWith('edit then'))!)
    const pick = (l: LogEntry[]) =>
      l.map((e) => normalise(e.sql, dbMap)).filter((s) => /^SELECT `blb` FROM `t`|^SELECT UUID\(\)/.test(s))
    expect(pick(bmaLog)).toEqual(pick(pmaLog))
    const n = await runCase(cases.find((c) => c.afterInsert === 'edit_next')!)
    const next = (l: LogEntry[]) =>
      l.map((e) => normalise(e.sql, dbMap)).filter((s) => / WHERE `t`\.`id` > 1 LIMIT 1/.test(s))
    expect(next(n.bmaLog)).toEqual(next(n.pmaLog))
    expect(next(n.bmaLog)).toHaveLength(1)
  })

  describe('input transformations', () => {
    beforeAll(async () => {
      for (const db of [DB_PMA, DB_BMA]) {
        await root.query(
          `DELETE FROM ${PMADB}.pma__column_info WHERE db_name = '${db}';
           INSERT INTO ${PMADB}.pma__column_info (db_name, table_name, column_name, comment, mimetype, transformation, transformation_options, input_transformation, input_transformation_options) VALUES
           ('${db}', 'u', 'ip', '', 'text/plain', '', '', 'Input/Text_Plain_Iptobinary.php', ''),
           ('${db}', 'u', 'code', '', 'text/plain', '', '', 'Input/Text_Plain_RegexValidation.php', '/^[a-z]+$/')`,
        )
      }
    })
    afterAll(async () => {
      await root.query(`DELETE FROM ${PMADB}.pma__column_info WHERE db_name IN ('${DB_PMA}', '${DB_BMA}')`)
    })

    it('IPv4/IPv6 To Binary and a passing regex', async () => {
      await runCase({
        name: 'ip',
        table: 'u',
        mods: [
          { row: 0, col: 'k', value: 'a', fn: '' },
          { row: 0, col: 'ip', value: '127.0.0.1' },
          { row: 0, col: 'code', value: 'abc' },
        ],
      })
    })

    it('a failing regex skips the row', async () => {
      await runCase({
        name: 'regex',
        table: 'u',
        // phpMyAdmin lists the columns of the skipped first row too: the INSERT fails in both
        expectError: true,
        mods: [
          { row: 0, col: 'k', value: 'b', fn: '' },
          { row: 0, col: 'code', value: 'ABC1' },
          { row: 1, col: 'k', value: 'c', fn: '' },
          { row: 1, col: 'code', value: 'ok' },
        ],
      })
    })
  })

  it('browse foreign values reads the same pages', async () => {
    for (const db of [DB_PMA, DB_BMA]) {
      await root.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`)
    }
    const m1 = await log.marker()
    await pma.post('/browse-foreigners', {
      db: DB_PMA,
      table: 't',
      field: 'parent_id',
      foreign_filter: 'o',
      data: '1',
    })
    const pmaLog = await log.since(PMA_USER, m1)
    const m2 = await log.marker()
    const r = await bma.req('POST', `/api/servers/1/databases/${DB_BMA}/tables/t/browse-foreigners`, {
      field: 'parent_id',
      filter: 'o',
      data: '1',
    })
    const bmaLog = await log.since(BMA_USER, m2)
    const pick = (l: LogEntry[]) =>
      l
        .map((e) => normalise(e.sql, dbMap))
        .filter((s) => /`parent`/.test(s) && !/SHOW|information_schema/i.test(s))
    expect(pick(bmaLog)).toEqual(pick(pmaLog))
    expect((r.json as Json).rows.map((x: Json) => x.left.key)).toEqual(['1', '2'])
  })
})
