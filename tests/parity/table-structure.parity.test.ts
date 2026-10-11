import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setStructureFeaturesFactory } from '../../apps/server/src/table/structure-page.ts'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { compareWrites, normalise } from './lib/compare.ts'
import { type Pairs, findForm, getPair, removePair, serializeForm, setPair } from './lib/form.ts'
import { GeneralLog } from './lib/general-log.ts'
import { decodeEntities, parseHtml } from './lib/nav-html.ts'
import { PmaClient, type PmaJson, isPmaUp, visibleText } from './lib/pma.ts'

/**
 * Golden parity of the table Structure tab, the column definition form (create / add / change),
 * the index editor and partitions (docs/features/04-table-level.md).
 *
 * Every DDL action is performed in the reference phpMyAdmin with the POSTs its forms and JS send
 * (forms are scraped from phpMyAdmin's own HTML, so pre-filled values come from phpMyAdmin) and in
 * BetterMyAdmin through its API (pre-filled values come from its form endpoints), on identical
 * tables. The write statements of both in MySQL's general log must be identical, and so must the
 * resulting SHOW CREATE TABLE.
 */
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const PMA_USER = 'm2tbl_pma'
const BMA_USER = 'm2tbl_bma'
const DB_PMA = 'm2tbl_pdb'
const DB_BMA = 'm2tbl_bdb'
const dbMap = {
  [DB_PMA]: 'm2tbl_db',
  [DB_BMA]: 'm2tbl_db',
  [PMA_USER]: 'm2tbl_user',
  [BMA_USER]: 'm2tbl_user',
}

const reachable = await isPmaUp(PMA_URL)

/**
 * phpMyAdmin writes to its configuration storage through the control user (other account, not in
 * the compared log) except Transformations::clear on a dropped column, which uses the user's
 * connection. BetterMyAdmin gets the same feature flag the metadata layer will provide.
 */
setStructureFeaturesFactory(async () => ({
  centralColumns: false,
  relation: false,
  tracking: false,
  browserTransformation: { database: 'phpmyadmin', columnInfo: 'pma__column_info' },
}))

const SEED = `
  CREATE TABLE t (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(30) COLLATE utf8mb4_unicode_ci DEFAULT 'x' COMMENT 'the name',
    qty INT UNSIGNED NOT NULL DEFAULT '0',
    price DECIMAL(10,2) DEFAULT NULL,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    body TEXT,
    kind ENUM('a','b''c') NOT NULL DEFAULT 'a',
    flags BIT(4) DEFAULT b'0101',
    doubled BIGINT GENERATED ALWAYS AS (qty * 2) VIRTUAL,
    geo POINT NOT NULL SRID 0,
    PRIMARY KEY (id),
    KEY k_name (name(10), qty)
  ) ENGINE=InnoDB COMMENT 'seed';
  INSERT INTO t (name, qty, price, body, geo) VALUES
    ('one', 1, 1.5, 'b1', ST_GeomFromText('POINT(1 1)')), ('two', 2, NULL, 'b2', ST_GeomFromText('POINT(2 2)'));
  CREATE TABLE nk (a INT NOT NULL, b INT, c VARCHAR(10));
  CREATE TABLE np (id INT NOT NULL, y INT, PRIMARY KEY (id));
  CREATE TABLE p (id INT NOT NULL, y INT NOT NULL, PRIMARY KEY (id, y)) PARTITION BY RANGE (y) (
    PARTITION p0 VALUES LESS THAN (2000) COMMENT 'old',
    PARTITION p1 VALUES LESS THAN (3000),
    PARTITION p2 VALUES LESS THAN MAXVALUE);
  INSERT INTO p VALUES (1, 1990), (2, 2010), (3, 3010);
`

let log: GeneralLog
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let root: mysql.Connection

const bmaPath = (path: string) => `/api/servers/1/databases/${DB_BMA}${path}`
async function bmaPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  return (await bma.req('POST', bmaPath(path), body)).json
}
async function bmaGet(path: string): Promise<Record<string, unknown>> {
  const r = await bma.req('GET', bmaPath(path))
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}

/** phpMyAdmin's Preview SQL answer (components/_preview_sql.twig) as plain SQL; '' for "No change". */
function previewSql(json: PmaJson): string {
  const html = String(json.sql_data ?? '')
  const codes = [...html.matchAll(/<code class="sql"[^>]*>([\s\S]*?)<\/code>/g)].map((m) =>
    decodeEntities((m[1] ?? '').replace(/<[^>]+>/g, '')),
  )
  return codes.join('\n')
}

async function showCreate(db: string, table: string): Promise<string | null> {
  try {
    const [rows] = await root.query({ sql: `SHOW CREATE TABLE \`${db}\`.\`${table}\``, rowsAsArray: true })
    return String((rows as unknown[][])[0]?.[1] ?? '')
  } catch {
    return null
  }
}

interface Case {
  name: string
  /** tables whose SHOW CREATE TABLE must match afterwards */
  tables: string[]
  pma: (db: string) => Promise<unknown>
  bma: (db: string) => Promise<unknown>
}

async function runCase(c: Case): Promise<void> {
  for (const db of [DB_PMA, DB_BMA]) {
    await root.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`)
  }
  const m1 = await log.marker()
  await c.pma(DB_PMA)
  const pmaLog = await log.since(PMA_USER, m1)
  const m2 = await log.marker()
  await c.bma(DB_BMA)
  const bmaLog = await log.since(BMA_USER, m2)

  const cmp = compareWrites(pmaLog, bmaLog, dbMap)
  expect(cmp.bma, `writes of ${c.name}`).toEqual(cmp.pma)
  for (const table of c.tables) {
    const a = await showCreate(DB_PMA, table)
    const b = await showCreate(DB_BMA, table)
    expect(b === null ? null : normalise(b, dbMap), `SHOW CREATE TABLE ${table}`).toBe(
      a === null ? null : normalise(a, dbMap),
    )
  }
}

// ------------------------------------------------------------------ column definition form helpers

interface FormColumn {
  name: string
  type: string
  length?: string
  defaultType?: string
  defaultValue?: string
  collation?: string
  attribute?: string
  null?: boolean
  autoIncrement?: boolean
  comments?: string
  virtuality?: string
  expression?: string
}
interface FormIdx {
  choice: 'PRIMARY' | 'INDEX' | 'UNIQUE' | 'FULLTEXT' | 'SPATIAL'
  keyName?: string
  comment?: string
  keyBlockSize?: string
  parser?: string
  type?: string
  columns: Array<{ colIndex: number; size?: string }>
}

/** The create/add form POST (field_* arrays, the five JSON index holders). */
function columnFormPairs(columns: FormColumn[], indexes: FormIdx[]): Pairs {
  const out: Pairs = []
  columns.forEach((c, i) => {
    out.push([`field_name[${i}]`, c.name])
    out.push([`field_type[${i}]`, c.type])
    out.push([`field_length[${i}]`, c.length ?? ''])
    out.push([`field_default_type[${i}]`, c.defaultType ?? 'NONE'])
    out.push([`field_default_value[${i}]`, c.defaultValue ?? ''])
    if (c.collation !== undefined) out.push([`field_collation[${i}]`, c.collation])
    out.push([`field_attribute[${i}]`, c.attribute ?? ''])
    if (c.null === true) out.push([`field_null[${i}]`, 'YES'])
    out.push([`field_key[${i}]`, `none_${i}`])
    if (c.autoIncrement === true) out.push([`field_extra[${i}]`, 'AUTO_INCREMENT'])
    out.push([`field_comments[${i}]`, c.comments ?? ''])
    out.push([`field_virtuality[${i}]`, c.virtuality ?? ''])
    out.push([`field_expression[${i}]`, c.expression ?? ''])
  })
  const bucket = (choice: FormIdx['choice']) =>
    JSON.stringify(
      indexes
        .filter((x) => x.choice === choice)
        .map((x) => ({
          Key_name: x.keyName ?? (choice === 'PRIMARY' ? 'PRIMARY' : ''),
          Index_comment: x.comment ?? '',
          Index_choice: choice,
          Key_block_size: x.keyBlockSize ?? '',
          Parser: x.parser ?? '',
          Index_type: x.type ?? '',
          columns: x.columns.map((col) => ({ col_index: String(col.colIndex), size: col.size ?? '' })),
        })),
    )
  out.push(['primary_indexes', bucket('PRIMARY')])
  out.push(['unique_indexes', bucket('UNIQUE')])
  out.push(['indexes', bucket('INDEX')])
  out.push(['fulltext_indexes', bucket('FULLTEXT')])
  out.push(['spatial_indexes', bucket('SPATIAL')])
  return out
}

const bmaIndexes = (indexes: FormIdx[]) =>
  indexes.map((x) => ({ ...x, keyName: x.keyName ?? (x.choice === 'PRIMARY' ? 'PRIMARY' : '') }))

// change-form modifications, applied to phpMyAdmin's scraped form and to BetterMyAdmin's form payload
type Mod =
  | {
      i: number
      field:
        | 'name'
        | 'type'
        | 'length'
        | 'collation'
        | 'defaultType'
        | 'defaultValue'
        | 'attribute'
        | 'comments'
        | 'moveTo'
        | 'expression'
      value: string
    }
  | { i: number; field: 'null' | 'autoIncrement' | 'adjustPrivileges'; value: boolean }

const PMA_FIELD: Record<Mod['field'], string> = {
  name: 'field_name',
  type: 'field_type',
  length: 'field_length',
  collation: 'field_collation',
  defaultType: 'field_default_type',
  defaultValue: 'field_default_value',
  attribute: 'field_attribute',
  comments: 'field_comments',
  moveTo: 'field_move_to',
  expression: 'field_expression',
  null: 'field_null',
  autoIncrement: 'field_extra',
  adjustPrivileges: 'field_adjust_privileges',
}
const CHECKED: Record<string, string> = {
  null: 'YES',
  autoIncrement: 'AUTO_INCREMENT',
  adjustPrivileges: 'NULL',
}

function applyPmaMods(pairs: Pairs, mods: Mod[]): Pairs {
  let out = pairs
  for (const m of mods) {
    const key = `${PMA_FIELD[m.field]}[${m.i}]`
    if (typeof m.value === 'boolean') {
      out = removePair(out, key)
      if (m.value) out = [...out, [key, CHECKED[m.field] ?? '']]
    } else {
      out = setPair(out, key, m.value)
    }
  }
  return out
}

/** phpMyAdmin: open the change form (one column via the row link, several via the bulk button) and Save. */
async function pmaChange(
  db: string,
  table: string,
  fields: string[],
  mods: Mod[],
  preview = false,
): Promise<PmaJson> {
  const json =
    fields.length === 1
      ? await pma.getJson('/table/structure/change', {
          db,
          table,
          field: fields[0] ?? '',
          change_column: '1',
        })
      : await pma.postJson('/table/structure/change', [
          ['db', db],
          ['table', table],
          ...fields.map((f): [string, string] => ['selected_fld[]', f]),
          ['ajax_page_request', 'true'],
        ])
  const pairs = applyPmaMods(
    serializeForm(findForm(String(json.message), { cls: 'append_fields_form' })),
    mods,
  )
  return pma.postJson('/table/structure/save', [
    ...pairs,
    ['do_save_data', '1'],
    ...(preview ? ([['preview_sql', '1']] as Pairs) : []),
  ])
}

async function bmaChange(
  table: string,
  fields: string[],
  mods: Mod[],
  preview = false,
): Promise<Record<string, unknown>> {
  const qs = fields.map((f) => `fields=${encodeURIComponent(f)}`).join('&')
  const form = await bmaGet(`/tables/${table}/columns/form?${qs}`)
  const privs = (form.options as { privsAvailable: boolean }).privsAvailable
  const columns = (form.columns as Array<{ values: Record<string, unknown>; orig: unknown }>).map((r) => ({
    ...r.values,
    orig: r.orig,
    adjustPrivileges: privs,
  })) as Array<Record<string, unknown>>
  for (const m of mods) {
    const c = columns[m.i]
    if (c !== undefined) c[m.field] = m.value
  }
  return bmaPost(`/tables/${table}/columns/change`, { columns, dryRun: preview })
}

/** The /sql links (data-post + getJsConfirmCommonParam: is_js_confirmed=1, fk_checks=0). */
function pmaSqlLink(params: Record<string, string>): Promise<PmaJson> {
  return pma.postJson('/sql', { ...params, is_js_confirmed: '1', ajax_request: 'true', fk_checks: '0' })
}

// ------------------------------------------------------------------ cases

const CREATE_COLUMNS: FormColumn[] = [
  { name: 'id', type: 'INT', attribute: 'UNSIGNED', autoIncrement: true },
  {
    name: 'title',
    type: 'VARCHAR',
    length: '100',
    defaultType: 'USER_DEFINED',
    defaultValue: "it's",
    collation: 'utf8mb4_unicode_ci',
    comments: 'the "title"',
  },
  { name: 'price', type: 'DECIMAL', length: '10,2', defaultType: 'USER_DEFINED', defaultValue: '0.00' },
  {
    name: 'created',
    type: 'TIMESTAMP',
    defaultType: 'CURRENT_TIMESTAMP',
    attribute: 'on update CURRENT_TIMESTAMP',
  },
  { name: 'kind', type: 'ENUM', length: "'a','b'", null: true, defaultType: 'NULL' },
  { name: '', type: 'INT' },
  {
    name: 'doubled',
    type: 'DECIMAL',
    length: '12,2',
    null: true,
    virtuality: 'VIRTUAL',
    expression: 'price * 2',
  },
  { name: 'note', type: 'TEXT', null: true, collation: 'latin1_swedish_ci' },
  { name: 'flag', type: 'BIT', length: '1', defaultType: 'USER_DEFINED', defaultValue: '1' },
]
const CREATE_INDEXES: FormIdx[] = [
  { choice: 'PRIMARY', columns: [{ colIndex: 0 }] },
  { choice: 'UNIQUE', keyName: 'uq_title', comment: 'unique title', columns: [{ colIndex: 1, size: '20' }] },
  { choice: 'INDEX', columns: [{ colIndex: 2 }, { colIndex: 3 }], type: 'BTREE' },
  { choice: 'FULLTEXT', keyName: 'ft', columns: [{ colIndex: 7 }] },
]

const ROW_KEY_CASES: Array<{ type: string; table: string; column: string }> = [
  { type: 'PRIMARY', table: 'nk', column: 'a' },
  { type: 'PRIMARY', table: 'np', column: 'y' },
  { type: 'PRIMARY', table: 't', column: 'qty' },
  { type: 'UNIQUE', table: 't', column: 'qty' },
  { type: 'INDEX', table: 't', column: 'price' },
  { type: 'FULLTEXT', table: 't', column: 'body' },
  { type: 'SPATIAL', table: 't', column: 'geo' },
]

const CASES: Case[] = [
  {
    name: 'create table: columns, indexes, engine, collation, comment',
    tables: ['c1'],
    pma: (db) =>
      pma.postJson('/table/create', [
        ['db', db],
        ['reload', '1'],
        ['table', 'c1'],
        ['orig_num_fields', String(CREATE_COLUMNS.length)],
        ...columnFormPairs(CREATE_COLUMNS, CREATE_INDEXES),
        ['comment', "Bob's table"],
        ['tbl_collation', 'utf8mb4_general_ci'],
        ['tbl_storage_engine', 'InnoDB'],
        ['connection', ''],
        ['partition_by', ''],
        ['partition_expr', ''],
        ['partition_count', ''],
        ['do_save_data', '1'],
      ]),
    bma: () =>
      bmaPost('/tables', {
        table: 'c1',
        columns: CREATE_COLUMNS,
        indexes: bmaIndexes(CREATE_INDEXES),
        comment: "Bob's table",
        collation: 'utf8mb4_general_ci',
        engine: 'InnoDB',
      }),
  },
  {
    name: 'create table with RANGE partitions',
    tables: ['c2'],
    pma: (db) =>
      pma.postJson('/table/create', [
        ['db', db],
        ['table', 'c2'],
        ['orig_num_fields', '2'],
        ...columnFormPairs(
          [
            { name: 'id', type: 'INT' },
            { name: 'y', type: 'INT' },
          ],
          [{ choice: 'PRIMARY', columns: [{ colIndex: 0 }, { colIndex: 1 }] }],
        ),
        ['tbl_storage_engine', 'InnoDB'],
        ['partition_by', 'RANGE'],
        ['partition_expr', 'y'],
        ['partition_count', '2'],
        ['partitions[0][name]', 'p0'],
        ['partitions[0][value_type]', 'LESS THAN'],
        ['partitions[0][value]', '100'],
        ['partitions[0][engine]', 'InnoDB'],
        ['partitions[0][comment]', 'low'],
        ['partitions[1][name]', 'p1'],
        ['partitions[1][value_type]', 'LESS THAN MAXVALUE'],
        ['partitions[1][value]', ''],
        ['partitions[1][engine]', ''],
        ['partitions[1][comment]', ''],
        ['do_save_data', '1'],
      ]),
    bma: () =>
      bmaPost('/tables', {
        table: 'c2',
        columns: [
          { name: 'id', type: 'INT' },
          { name: 'y', type: 'INT' },
        ],
        indexes: bmaIndexes([{ choice: 'PRIMARY', columns: [{ colIndex: 0 }, { colIndex: 1 }] }]),
        engine: 'InnoDB',
        partitioning: {
          partitionBy: 'RANGE',
          partitionExpr: 'y',
          partitionCount: '2',
          partitions: [
            { name: 'p0', valueType: 'LESS THAN', value: '100', engine: 'InnoDB', comment: 'low' },
            { name: 'p1', valueType: 'LESS THAN MAXVALUE', value: '', engine: '', comment: '' },
          ],
        },
      }),
  },
  {
    name: 'add two columns after a column, with a UNIQUE index on the first',
    tables: ['t'],
    pma: (db) =>
      pma.postJson('/table/add-field', [
        ['db', db],
        ['table', 't'],
        ['field_where', 'after'],
        ['after_field', 'name'],
        ['orig_num_fields', '2'],
        ...columnFormPairs(
          [
            { name: 'code', type: 'CHAR', length: '8', collation: 'ascii_bin' },
            { name: 'at', type: 'DATETIME', length: '3', null: true, defaultType: 'NULL' },
          ],
          [{ choice: 'UNIQUE', keyName: 'uq_code', columns: [{ colIndex: 0 }] }],
        ),
        ['do_save_data', '1'],
      ]),
    bma: () =>
      bmaPost('/tables/t/columns/add', {
        columns: [
          { name: 'code', type: 'CHAR', length: '8', collation: 'ascii_bin' },
          { name: 'at', type: 'DATETIME', length: '3', null: true, defaultType: 'NULL' },
        ],
        indexes: [{ choice: 'UNIQUE', keyName: 'uq_code', columns: [{ colIndex: 0 }] }],
        where: 'after',
        afterField: 'name',
      }),
  },
  {
    name: 'add a column at the beginning with online transaction',
    tables: ['t'],
    pma: (db) =>
      pma.postJson('/table/add-field', [
        ['db', db],
        ['table', 't'],
        ['field_where', 'first'],
        ['after_field', 'first'],
        ['orig_num_fields', '1'],
        ...columnFormPairs(
          [{ name: 'z', type: 'TINYINT', length: '1', defaultType: 'USER_DEFINED', defaultValue: '0' }],
          [],
        ),
        ['online_transaction', 'ONLINE_TRANSACTION_ENABLED'],
        ['do_save_data', '1'],
      ]),
    bma: () =>
      bmaPost('/tables/t/columns/add', {
        columns: [
          { name: 'z', type: 'TINYINT', length: '1', defaultType: 'USER_DEFINED', defaultValue: '0' },
        ],
        where: 'first',
        afterField: 'first',
        onlineTransaction: true,
      }),
  },
  {
    name: 'change: rename and resize a column (privileges adjusted)',
    tables: ['t'],
    pma: (db) =>
      pmaChange(
        db,
        't',
        ['name'],
        [
          { i: 0, field: 'name', value: 'title' },
          { i: 0, field: 'length', value: '50' },
        ],
      ),
    bma: () =>
      bmaChange(
        't',
        ['name'],
        [
          { i: 0, field: 'name', value: 'title' },
          { i: 0, field: 'length', value: '50' },
        ],
      ),
  },
  {
    name: 'change: an untouched TIMESTAMP and BIT are re-stated as phpMyAdmin does',
    tables: ['t'],
    pma: (db) => pmaChange(db, 't', ['created', 'flags', 'kind', 'id'], []),
    bma: () => bmaChange('t', ['created', 'flags', 'kind', 'id'], []),
  },
  {
    name: 'change: a collation change converts through BLOB first',
    tables: ['t'],
    pma: (db) => pmaChange(db, 't', ['body'], [{ i: 0, field: 'collation', value: 'latin1_swedish_ci' }]),
    bma: () => bmaChange('t', ['body'], [{ i: 0, field: 'collation', value: 'latin1_swedish_ci' }]),
  },
  {
    name: 'change: several columns, type, NULL and move to first, online transaction off',
    tables: ['t'],
    pma: (db) =>
      pmaChange(
        db,
        't',
        ['qty', 'price'],
        [
          { i: 1, field: 'type', value: 'BIGINT' },
          { i: 1, field: 'null', value: true },
          { i: 0, field: 'moveTo', value: '-first' },
          { i: 0, field: 'comments', value: "price's \\comment" },
        ],
      ),
    bma: () =>
      bmaChange(
        't',
        ['qty', 'price'],
        [
          { i: 1, field: 'type', value: 'BIGINT' },
          { i: 1, field: 'null', value: true },
          { i: 0, field: 'moveTo', value: '-first' },
          { i: 0, field: 'comments', value: "price's \\comment" },
        ],
      ),
  },
  {
    name: 'change: a virtual column expression',
    tables: ['t'],
    pma: (db) => pmaChange(db, 't', ['doubled'], [{ i: 0, field: 'expression', value: '(`qty` * 3)' }]),
    bma: () => bmaChange('t', ['doubled'], [{ i: 0, field: 'expression', value: '(`qty` * 3)' }]),
  },
  {
    name: 'change: a failing ALTER reverts the BLOB conversion',
    tables: ['t'],
    pma: (db) =>
      pmaChange(
        db,
        't',
        ['name', 'body'],
        [
          { i: 0, field: 'type', value: 'INT' },
          { i: 0, field: 'length', value: '' },
          { i: 1, field: 'collation', value: 'latin1_swedish_ci' },
        ],
      ),
    bma: () =>
      bmaChange(
        't',
        ['name', 'body'],
        [
          { i: 0, field: 'type', value: 'INT' },
          { i: 0, field: 'length', value: '' },
          { i: 1, field: 'collation', value: 'latin1_swedish_ci' },
        ],
      ),
  },
  {
    name: 'drop a column from its row link (via /sql)',
    tables: ['t'],
    pma: (db) =>
      pmaSqlLink({
        db,
        table: 't',
        sql_query: 'ALTER TABLE `t` DROP `price`;',
        dropped_column: 'price',
        purge: '1',
        message_to_show: 'Column price has been dropped.',
        ajax_page_request: '1',
      }),
    bma: () => bmaPost('/tables/t/columns/drop', { columns: ['price'], source: 'row' }),
  },
  {
    name: 'drop columns with the bulk Yes/No page',
    tables: ['t'],
    pma: async (db) => {
      await pma.postJson('/table/structure/drop-confirm', [
        ['db', db],
        ['table', 't'],
        ['selected_fld[]', 'price'],
        ['selected_fld[]', 'kind'],
        ['ajax_page_request', 'true'],
      ])
      await pma.postPage('/table/structure/drop', [
        ['db', db],
        ['table', 't'],
        ['selected[0]', 'price'],
        ['selected[1]', 'kind'],
        ['mult_btn', 'Yes'],
      ])
    },
    bma: () => bmaPost('/tables/t/columns/drop', { columns: ['price', 'kind'], source: 'bulk' }),
  },
  ...ROW_KEY_CASES.map(
    (k): Case => ({
      name: `row action ${k.type} on ${k.table}.${k.column}`,
      tables: [k.table],
      pma: (db) =>
        pma.postJson(`/table/structure/add-key&db=${db}&table=${k.table}`, {
          'selected_fld[0]': k.column,
          key_type: k.type,
          is_js_confirmed: '1',
          fk_checks: '0',
          ajax_page_request: '1',
        }),
      bma: () =>
        bmaPost(`/tables/${k.table}/columns/key`, { type: k.type, columns: [k.column], source: 'row' }),
    }),
  ),
  {
    name: 'bulk Primary on a table with a primary key: confirmation, then Yes',
    tables: ['np'],
    pma: async (db) => {
      const q = await pma.postJson('/table/structure/primary', [
        ['db', db],
        ['table', 'np'],
        ['selected_fld[]', 'id'],
        ['selected_fld[]', 'y'],
        ['ajax_page_request', 'true'],
      ])
      const pairs = serializeForm(findForm(String(q.message), { action: '/table/structure/primary' }))
      await pma.postJson('/table/structure/primary', [
        ...pairs,
        ['mult_btn', 'Yes'],
        ['ajax_page_request', 'true'],
      ])
    },
    bma: async () => {
      const q = await bmaPost('/tables/np/columns/key', {
        type: 'PRIMARY',
        columns: ['id', 'y'],
        source: 'bulk',
      })
      expect(q.confirm).toBeDefined()
      await bmaPost('/tables/np/columns/key', {
        type: 'PRIMARY',
        columns: ['id', 'y'],
        source: 'bulk',
        confirmed: true,
      })
    },
  },
  ...(['unique', 'index', 'fulltext'] as const).map(
    (kind): Case => ({
      name: `bulk ${kind} button`,
      tables: ['t'],
      pma: (db) =>
        pma.postJson(`/table/structure/${kind}`, [
          ['db', db],
          ['table', 't'],
          ['selected_fld[]', kind === 'fulltext' ? 'body' : 'qty'],
          ['selected_fld[]', kind === 'fulltext' ? 'name' : 'price'],
          ['ajax_page_request', 'true'],
        ]),
      bma: () =>
        bmaPost('/tables/t/columns/key', {
          type: kind.toUpperCase(),
          columns: kind === 'fulltext' ? ['body', 'name'] : ['qty', 'price'],
          source: 'bulk',
        }),
    }),
  ),
  {
    name: 'index editor: a new composite index with size, order, block size and comment',
    tables: ['t'],
    pma: async (db) => {
      const f = await pma.postJson('/table/indexes', { db, table: 't', create_index: '1', added_fields: '2' })
      let pairs = serializeForm(findForm(String(f.message), { action: '/table/indexes' }))
      pairs = setPair(pairs, 'index[Key_name]', 'cmp')
      pairs = setPair(pairs, 'index[Index_choice]', 'INDEX')
      pairs = setPair(pairs, 'index[Key_block_size]', '8')
      pairs = setPair(pairs, 'index[Index_comment]', "it's composite")
      const names = pairs.flatMap(([k], i) => (k === 'index[columns][names][]' ? [i] : []))
      const sizes = pairs.flatMap(([k], i) => (k === 'index[columns][sub_parts][]' ? [i] : []))
      const colls = pairs.flatMap(([k], i) => (k === 'index[columns][collations][]' ? [i] : []))
      pairs[names[0] as number] = ['index[columns][names][]', 'name']
      pairs[sizes[0] as number] = ['index[columns][sub_parts][]', '5']
      pairs[colls[0] as number] = ['index[columns][collations][]', 'A']
      pairs[names[1] as number] = ['index[columns][names][]', 'qty']
      pairs[colls[1] as number] = ['index[columns][collations][]', 'D']
      await pma.postJson('/table/indexes', [...pairs, ['do_save_data', '1']])
    },
    bma: async () => {
      const f = await bmaGet('/tables/t/indexes/form?create=2')
      const index = f.index as { columns: Array<Record<string, string>> } & Record<string, unknown>
      await bmaPost('/tables/t/indexes', {
        oldIndex: f.oldIndex,
        index: {
          ...index,
          name: 'cmp',
          choice: 'INDEX',
          keyBlockSize: '8',
          comment: "it's composite",
          columns: [
            { name: 'name', subPart: '5', collation: 'A' },
            { name: 'qty', subPart: '', collation: 'D' },
          ],
        },
      })
    },
  },
  {
    name: 'index editor: re-post an existing index as UNIQUE',
    tables: ['t'],
    pma: async (db) => {
      const f = await pma.postJson('/table/indexes', { db, table: 't', index: 'k_name' })
      const pairs = setPair(
        serializeForm(findForm(String(f.message), { action: '/table/indexes' })),
        'index[Index_choice]',
        'UNIQUE',
      )
      await pma.postJson('/table/indexes', [...pairs, ['do_save_data', '1']])
    },
    bma: async () => {
      const f = await bmaGet('/tables/t/indexes/form?index=k_name')
      await bmaPost('/tables/t/indexes', {
        oldIndex: f.oldIndex,
        index: { ...(f.index as object), choice: 'UNIQUE' },
      })
    },
  },
  {
    name: 'index rename',
    tables: ['t'],
    pma: async (db) => {
      const f = await pma.postJson('/table/indexes/rename', { db, table: 't', index: 'k_name' })
      const pairs = setPair(
        serializeForm(findForm(String(f.message), { action: '/table/indexes/rename' })),
        'index',
        'k_renamed',
      )
      await pma.postJson('/table/indexes/rename', pairs)
    },
    bma: () => bmaPost('/tables/t/indexes/rename', { oldIndex: 'k_name', name: 'k_renamed' }),
  },
  {
    name: 'drop an index (via /sql)',
    tables: ['t'],
    pma: (db) =>
      pmaSqlLink({
        db,
        table: 't',
        sql_query: 'ALTER TABLE `t` DROP INDEX `k_name`;',
        message_to_show: 'Index k_name has been dropped.',
      }),
    bma: () => bmaPost('/tables/t/indexes/drop', { name: 'k_name' }),
  },
  {
    name: 'drop the primary key (via /sql)',
    tables: ['np'],
    pma: (db) =>
      pmaSqlLink({
        db,
        table: 'np',
        sql_query: 'ALTER TABLE `np` DROP PRIMARY KEY;',
        message_to_show: 'The primary key has been dropped.',
      }),
    bma: () => bmaPost('/tables/np/indexes/drop', { name: 'PRIMARY' }),
  },
  {
    name: 'move columns',
    tables: ['t'],
    pma: (db) =>
      pma.postJson('/table/structure/move-columns', [
        ['db', db],
        ['table', 't'],
        ...['qty', 'id', 'price', 'name', 'created', 'body', 'kind', 'doubled', 'flags', 'geo'].map(
          (c): [string, string] => ['move_columns[]', c],
        ),
      ]),
    bma: () =>
      bmaPost('/tables/t/columns/move', {
        order: ['qty', 'id', 'price', 'name', 'created', 'body', 'kind', 'doubled', 'flags', 'geo'],
      }),
  },
  {
    name: 'edit partitioning: the re-posted form with a changed boundary',
    tables: ['p'],
    pma: async (db) => {
      const f = await pma.postJson('/table/structure/partitioning', { db, table: 'p' })
      const pairs = setPair(
        serializeForm(findForm(String(f.message), { action: '/table/structure/partitioning' })),
        'partitions[1][value]',
        '2500',
      )
      await pma.postJson('/table/structure/partitioning', [...pairs, ['save_partitioning', 'Save']])
    },
    bma: async () => {
      const f = await bmaGet('/tables/p/partitions/form')
      const partitioning = f.partitioning as { partitions: Array<Record<string, string>> }
      const p1 = partitioning.partitions[1]
      if (p1 !== undefined) p1.value = '2500'
      await bmaPost('/tables/p/partitions/partitioning', { partitioning })
    },
  },
  ...(['analyze', 'check', 'optimize', 'rebuild', 'repair', 'truncate', 'drop'] as const).map(
    (op): Case => ({
      name: `partition ${op}`,
      tables: ['p'],
      pma: (db) =>
        pma.postJson('/table/partition/' + op, {
          db,
          table: 'p',
          partition_name: 'p1',
          ajax_page_request: 'true',
        }),
      bma: () =>
        bmaPost('/tables/p/partitions/maintenance', { operation: op.toUpperCase(), partition: 'p1' }),
    }),
  ),
  {
    name: 'remove partitioning (via /sql)',
    tables: ['p'],
    pma: (db) =>
      pmaSqlLink({
        db,
        table: 'p',
        sql_query: 'ALTER TABLE `p` REMOVE PARTITIONING',
        ajax_page_request: 'true',
      }),
    bma: () => bmaPost('/tables/p/partitions/remove-partitioning', {}),
  },
  {
    name: 'partition an unpartitioned table',
    tables: ['np'],
    pma: (db) =>
      pma.postJson('/table/structure/partitioning', {
        db,
        table: 'np',
        partition_by: 'HASH',
        partition_expr: 'id',
        partition_count: '3',
        save_partitioning: 'Save',
      }),
    bma: () =>
      bmaPost('/tables/np/partitions/partitioning', {
        partitioning: { partitionBy: 'HASH', partitionExpr: 'id', partitionCount: '3' },
      }),
  },
]

describe.skipIf(!reachable)('parity: table structure DDL (phpMyAdmin forms vs BetterMyAdmin API)', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    for (const u of [PMA_USER, BMA_USER]) {
      await root.query(
        `CREATE USER IF NOT EXISTS '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON *.* TO '${u}'@'%'`,
      )
    }
    log = await GeneralLog.open(ROOT)
    pma = new PmaClient(PMA_URL)
    await pma.login(PMA_USER, PMA_USER)
    bma = testApp(testConfig())
    await bma.login(BMA_USER, BMA_USER)
  })

  afterAll(async () => {
    await root?.query(`DROP DATABASE IF EXISTS ${DB_PMA}; DROP DATABASE IF EXISTS ${DB_BMA}`)
    await root?.query(`DROP USER IF EXISTS '${PMA_USER}'@'%'; DROP USER IF EXISTS '${BMA_USER}'@'%'`)
    await root?.end()
    await log?.close()
    await bma?.close()
  })

  for (const c of CASES) it(c.name, () => runCase(c))

  it('Preview SQL shows the statement that runs (add, change, index, move, create)', async () => {
    for (const db of [DB_PMA, DB_BMA]) {
      await root.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`)
    }
    const add = await pma.postJson('/table/add-field', [
      ['db', DB_PMA],
      ['table', 't'],
      ['field_where', 'last'],
      ['orig_num_fields', '1'],
      ...columnFormPairs([{ name: 'n', type: 'INT', comments: 'c' }], []),
      ['do_save_data', '1'],
      ['preview_sql', '1'],
    ])
    const bAdd = await bmaPost('/tables/t/columns/add', {
      columns: [{ name: 'n', type: 'INT', comments: 'c' }],
      dryRun: true,
    })
    expect(bAdd.preview).toBe(previewSql(add))

    const ch = await pmaChange(DB_PMA, 't', ['name'], [{ i: 0, field: 'name', value: 'nm' }], true)
    const bCh = await bmaChange('t', ['name'], [{ i: 0, field: 'name', value: 'nm' }], true)
    expect(bCh.preview).toBe(previewSql(ch))
    // nothing to change: "No change" in phpMyAdmin, '' here
    expect(String(ch.sql_data)).not.toContain('No change')
    const none = await pmaChange(DB_PMA, 't', ['body'], [], true)
    expect(visibleText(String(none.sql_data))).toBe('No change')
    expect((await bmaChange('t', ['body'], [], true)).preview).toBe('')

    const idx = await pma.postJson('/table/indexes', [
      ['db', DB_PMA],
      ['table', 't'],
      ['create_index', '1'],
      ['index[Key_name]', 'q'],
      ['index[Index_choice]', 'UNIQUE'],
      ['index[Key_block_size]', '0'],
      ['index[Index_type]', 'HASH'],
      ['index[Parser]', ''],
      ['index[Index_comment]', ''],
      ['index[columns][names][]', 'qty'],
      ['index[columns][sub_parts][]', ''],
      ['index[columns][collations][]', ''],
      ['do_save_data', '1'],
      ['preview_sql', '1'],
    ])
    const bIdx = await bmaPost('/tables/t/indexes', {
      index: { name: 'q', choice: 'UNIQUE', keyBlockSize: '0', type: 'HASH', columns: [{ name: 'qty' }] },
      dryRun: true,
    })
    expect(String(bIdx.preview).replaceAll(DB_BMA, DB_PMA)).toBe(previewSql(idx))

    const order = ['name', 'id', 'qty', 'price', 'created', 'body', 'kind', 'flags', 'doubled', 'geo']
    const mv = await pma.postJson('/table/structure/move-columns', [
      ['db', DB_PMA],
      ['table', 't'],
      ...order.map((c): [string, string] => ['move_columns[]', c]),
      ['preview_sql', '1'],
    ])
    const bMv = await bmaPost('/tables/t/columns/move', { order, dryRun: true })
    expect(bMv.preview).toBe(previewSql(mv))

    const cr = await pma.postJson('/table/create', [
      ['db', DB_PMA],
      ['table', 'c9'],
      ...columnFormPairs(CREATE_COLUMNS, CREATE_INDEXES),
      ['tbl_storage_engine', 'InnoDB'],
      ['do_save_data', '1'],
      ['preview_sql', '1'],
    ])
    const bCr = await bmaPost('/tables', {
      table: 'c9',
      columns: CREATE_COLUMNS,
      indexes: bmaIndexes(CREATE_INDEXES),
      engine: 'InnoDB',
      dryRun: true,
    })
    expect(String(bCr.preview).replaceAll(DB_BMA, DB_PMA)).toBe(previewSql(cr))
  })

  it('messages and errors match phpMyAdmin', async () => {
    for (const db of [DB_PMA, DB_BMA]) {
      await root.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`)
    }
    const same = ['id', 'name', 'qty', 'price', 'created', 'body', 'kind', 'flags', 'doubled', 'geo']
    const pm = await pma.postJson('/table/structure/move-columns', [
      ['db', DB_PMA],
      ['table', 't'],
      ...same.map((c): [string, string] => ['move_columns[]', c]),
    ])
    const bm = await bma.req('POST', bmaPath('/tables/t/columns/move'), { order: same })
    expect(visibleText(String(pm.error))).toContain((bm.json.error as { message: string }).message)

    const pi = await pma.postJson('/table/indexes', [
      ['db', DB_PMA],
      ['table', 't'],
      ['create_index', '1'],
      ['index[Key_name]', 'PRIMARY'],
      ['index[Index_choice]', 'INDEX'],
      ['index[columns][names][]', 'qty'],
      ['do_save_data', '1'],
    ])
    const bi = await bma.req('POST', bmaPath('/tables/t/indexes'), {
      index: { name: 'PRIMARY', choice: 'INDEX', columns: [{ name: 'qty' }] },
    })
    expect(visibleText(String(pi.error))).toContain((bi.json.error as { message: string }).message)

    const add = await pma.postJson('/table/add-field', [
      ['db', DB_PMA],
      ['table', 't'],
      ['field_where', 'last'],
      ['orig_num_fields', '1'],
      ...columnFormPairs([{ name: 'n', type: 'INT' }], []),
      ['do_save_data', '1'],
    ])
    const bAdd = await bmaPost('/tables/t/columns/add', { columns: [{ name: 'n', type: 'INT' }] })
    const text = (bAdd.messages as Array<{ text: string }>)[0]?.text ?? ''
    expect(text).toBe('Table t has been altered successfully.')
    expect(visibleText(String(add.message))).toContain(text)

    const kp = await pma.postJson(`/table/structure/add-key&db=${DB_PMA}&table=t`, {
      'selected_fld[0]': 'qty',
      key_type: 'INDEX',
      is_js_confirmed: '1',
      ajax_page_request: '1',
    })
    const bk = await bmaPost('/tables/t/columns/key', { type: 'INDEX', columns: ['qty'] })
    const kText = (bk.messages as Array<{ text: string; sql: string }>)[0]
    // the structure page re-rendered by AddKeyController carries the message in displayMessage
    const shown = visibleText(String(kp.displayMessage ?? ''))
    expect(shown).toContain(kText?.text ?? '?')
    expect(shown).toContain(kText?.sql ?? '?')

    const dc = await pmaSqlLink({
      db: DB_PMA,
      table: 't',
      sql_query: 'ALTER TABLE `t` DROP `price`;',
      dropped_column: 'price',
      purge: '1',
      message_to_show: 'Column price has been dropped.',
    })
    const bdc = await bmaPost('/tables/t/columns/drop', { columns: ['price'], source: 'row' })
    const mask = (s: string) => s.replace(/\d+\.\d{4} seconds/g, 'T seconds')
    expect(mask(visibleText(String(dc.message)))).toContain(
      mask((bdc.messages as Array<{ text: string }>)[0]?.text ?? '?'),
    )
  })

  it('the Structure page shows the same values', async () => {
    for (const db of [DB_PMA, DB_BMA]) {
      await root.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}
        ALTER TABLE t ADD KEY k_dup (name(10), qty), ADD FULLTEXT KEY ft (body);`)
    }
    for (const table of ['t', 'nk', 'p']) {
      const html = await pma.getPage(`/index.php?route=/table/structure&db=${DB_PMA}&table=${table}`)
      const b = await bmaGet(`/tables/${table}/structure`)
      expect(structureFromBma(b), table).toEqual(structureFromPma(html))
    }
  })
})

// ------------------------------------------------------------------ Structure page normalisation

interface El {
  tag: string
  attrs: Record<string, string>
  children: Array<El | string>
}
const kids = (el: El): El[] => el.children.filter((c): c is El => typeof c !== 'string')
const txt = (el: El | string): string => (typeof el === 'string' ? el : el.children.map(txt).join(''))
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
function all(el: El, pred: (e: El) => boolean, out: El[] = []): El[] {
  for (const c of kids(el)) {
    if (pred(c)) out.push(c)
    all(c, pred, out)
  }
  return out
}
const byId = (root: El, id: string) => all(root, (e) => e.attrs.id === id)[0]

interface PageModel {
  columns: Array<Record<string, unknown>>
  indexes: string[][]
  notices: string[]
  partitions: string[][]
  stats: string[][]
}

function structureFromPma(html: string): PageModel {
  const root = parseHtml(html) as El
  const table = byId(root, 'tablestructure') as El
  const rows = all(all(table, (e) => e.tag === 'tbody')[0] as El, (e) => e.tag === 'tr')
  const columns = rows.map((tr) => {
    const cells = kids(tr).filter((e) => e.tag === 'td' || e.tag === 'th')
    const nameCell = cells[2] as El
    const icons = all(nameCell, (e) => e.tag === 'img').map((i) => i.attrs.title ?? '')
    const commented = all(nameCell, (e) => (e.attrs.class ?? '') === 'commented_column')[0]
    const dfn = all(cells[4] as El, (e) => e.tag === 'dfn')[0]
    const more = cells[12] as El
    const action = (cls: string) => {
      const li = all(more, (e) => e.tag === 'li' && (e.attrs.class ?? '').split(' ').includes(cls))[0]
      return li !== undefined && all(li, (e) => e.tag === 'a').length > 0
    }
    return {
      name: clean(txt(commented ?? nameCell)),
      commentTitle: commented?.attrs.title ?? null,
      icons,
      type: clean(txt(cells[3] as El)),
      collation: dfn === undefined ? null : [clean(txt(dfn)), dfn.attrs.title ?? ''],
      attribute: clean(txt(cells[5] as El)),
      null: clean(txt(cells[6] as El)),
      default: clean(txt(cells[7] as El)),
      comments: clean(txt(cells[8] as El)),
      extra: clean(txt(cells[9] as El)),
      actions: ['primary', 'add_unique', 'add_index', 'spatial', 'fulltext'].map(action),
    }
  })
  const indexTable = byId(root, 'table_index')
  const indexes =
    indexTable === undefined
      ? []
      : all(indexTable, (e) => e.tag === 'tr' && (e.attrs.class ?? '') === 'noclick').map((tr) =>
          kids(tr)
            .filter(
              (e) => (e.tag === 'td' || e.tag === 'th') && !(e.attrs.class ?? '').includes('d-print-none'),
            )
            .map((e) => clean(txt(e))),
        )
  const notices = all(byId(root, 'index_div') ?? root, (e) => (e.attrs.class ?? '').includes('alert-primary'))
    .map((e) => clean(txt(e)))
    .filter((s) => s.startsWith('The indexes'))
  const partitionsCard = byId(root, 'partitions')
  const partitions =
    partitionsCard === undefined
      ? []
      : all(partitionsCard, (e) => e.tag === 'tr' && (e.attrs.class ?? '').startsWith('noclick')).map((tr) =>
          kids(tr)
            .filter((e) => e.tag === 'td' || e.tag === 'th')
            .slice(0, 8)
            .map((e) => clean(txt(e)))
            .filter((s) => !/^(Analyze|Check)$/.test(s)),
        )
  const statsCard = byId(root, 'tablestatistics') as El
  const stats = all(statsCard, (e) => e.tag === 'tr' && !(e.attrs.class ?? '').includes('d-print-none'))
    .map((tr) => kids(tr).map((e) => clean(txt(e))))
    .filter((r) => !['Creation', 'Last update', 'Last check'].includes(r[0] ?? ''))
  return { columns, indexes, notices, partitions, stats }
}

function structureFromBma(j: Record<string, unknown>): PageModel {
  const cols = j.columns as Array<Record<string, unknown> & { actions: Record<string, boolean> }>
  const columns = cols.map((c) => {
    const collation = c.collation as { name: string; description: string } | null
    return {
      name: c.name,
      commentTitle: c.comment === '' ? null : c.comment,
      icons: [...(c.isPrimary ? ['Primary'] : []), ...(c.hasIndex ? ['Index'] : [])],
      type: c.displayedType,
      collation: collation === null ? null : [collation.name, collation.description],
      attribute: c.attribute,
      null: c.isNull ? 'Yes' : 'No',
      default: c.default === null ? (c.isNull ? 'NULL' : 'None') : c.default,
      comments: c.comment,
      extra: c.extra,
      actions: [c.actions.primary, c.actions.unique, c.actions.index, c.actions.spatial, c.actions.fulltext],
    }
  })
  const indexes: string[][] = []
  for (const i of j.indexes as Array<Record<string, unknown> & { columns: Array<Record<string, unknown>> }>) {
    i.columns.forEach((col, n) => {
      const colCells = [
        `${col.expression ?? col.name}${col.subPart !== null ? ` (${col.subPart})` : ''}`,
        col.cardinality === null ? '' : String(col.cardinality),
        String(col.collation ?? ''),
        String(col.null),
      ]
      indexes.push(
        n === 0
          ? [
              String(i.name),
              String(i.type),
              i.unique ? 'Yes' : 'No',
              String(i.packed),
              ...colCells,
              clean(String(i.comments)),
            ]
          : colCells,
      )
    })
  }
  const parts = j.partitions as {
    partitions: Array<Record<string, unknown> & { dataLength: string[]; indexLength: string[] }>
    hasDescription: boolean
    method: string
  }
  const partitions = parts.partitions.map((p) => [
    String(p.ordinal),
    String(p.name),
    ...(parts.hasDescription
      ? [`${p.expression}${p.method === 'LIST' ? ` IN (${p.description})` : ` < ${p.description}`}`]
      : []),
    String(p.rows),
    p.dataLength.join(' '),
    p.indexLength.join(' '),
    String(p.comment),
  ])
  const s = j.stats as {
    data: string[]
    index: string[] | null
    overhead: string[] | null
    effective: string[]
    total: string[] | null
    rows: Array<{ label: string; value: string }>
    showSpaceUsage: boolean
  }
  const stats: string[][] = []
  if (s.showSpaceUsage) {
    stats.push(['Data', ...s.data])
    if (s.index !== null) stats.push(['Index', ...s.index])
    if (s.overhead !== null) stats.push(['Overhead', ...s.overhead], ['Effective', ...s.effective])
    if (s.total !== null) stats.push(['Total', ...s.total])
  }
  for (const r of s.rows)
    if (!['Creation', 'Last update', 'Last check'].includes(r.label)) stats.push([r.label, r.value])
  return { columns, indexes, notices: j.indexNotices as string[], partitions, stats }
}
