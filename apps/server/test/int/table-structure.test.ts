import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Table Structure tab, column definition form, index editor and partitions against a live MySQL
 * (docs/features/04-table-level.md). The SQL shapes themselves are verified against phpMyAdmin by
 * the unit fixtures and tests/parity/table-structure.parity.test.ts.
 */
const DB = 'm2tbl_it'
let t: ReturnType<typeof testApp>
let root: mysql.Connection

type Json = Record<string, unknown>
const base = `/api/servers/1/databases/${DB}`

async function seed(sql: string) {
  await root.query(`USE ${DB}; ${sql}`)
}
async function createSql(table: string): Promise<string> {
  const [rows] = await root.query({ sql: `SHOW CREATE TABLE ${DB}.\`${table}\``, rowsAsArray: true })
  return String((rows as unknown[][])[0]?.[1])
}
async function post(path: string, body: unknown, status = 200) {
  const r = await t.req('POST', path, body)
  expect(r.status, JSON.stringify(r.json)).toBe(status)
  return r.json
}
async function get(path: string, status = 200) {
  const r = await t.req('GET', path)
  expect(r.status, JSON.stringify(r.json)).toBe(status)
  return r.json
}
const executedWrites = (j: Json) =>
  (j.executed as Array<{ sql: string }>)
    .map((e) => e.sql)
    .filter((s) => !/^(SELECT|SHOW|USE|SET (NAMES|lc_messages|collation_connection))/i.test(s))

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}`)
  t = testApp(testConfig({ DBG: { sql: true } }))
  await t.login()
})
afterAll(async () => {
  await root?.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root?.end()
  await t?.close()
})

describe('GET structure', () => {
  beforeAll(() =>
    seed(`CREATE TABLE s (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(20) COMMENT 'the name',
      body TEXT,
      flags BIT(3) DEFAULT b'101',
      ts TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      kind ENUM('a','b''c') NOT NULL DEFAULT 'a',
      g POINT NOT NULL SRID 0,
      PRIMARY KEY (id), KEY k (name, id), KEY k2 (name, id), SPATIAL KEY sp (g)
    ) ENGINE=InnoDB COMMENT='tbl comment';`),
  )

  it('lists columns with the Structure page values and row-action availability', async () => {
    const j = await get(`${base}/tables/s/structure`)
    expect(j.engine).toBe('INNODB')
    const cols = j.columns as Array<Record<string, unknown>>
    expect(cols.map((c) => c.name)).toEqual(['id', 'name', 'body', 'flags', 'ts', 'kind', 'g'])
    const [id, name, body, flags, ts, kind, g] = cols
    expect(id).toMatchObject({
      printType: 'int',
      isPrimary: true,
      hasIndex: true,
      extra: 'AUTO_INCREMENT',
      default: null,
    })
    expect((id?.actions as Json).primary).toBe(false)
    expect(name).toMatchObject({
      comment: 'the name',
      isNull: true,
      collation: { name: 'utf8mb4_0900_ai_ci' },
    })
    expect((name?.collation as Json).description).toBe(
      'Unicode (UCA 9.0.0), accent-insensitive, case-insensitive',
    )
    expect((name?.actions as Json).fulltext).toBe(true)
    expect(body?.actions).toEqual({
      primary: false,
      unique: false,
      index: false,
      spatial: false,
      fulltext: true,
    })
    expect(flags?.default).toBe('101')
    expect(ts).toMatchObject({ attribute: 'on update CURRENT_TIMESTAMP', default: 'CURRENT_TIMESTAMP' })
    expect(ts?.extra).toBe('DEFAULT_GENERATED ON UPDATE CURRENT_TIMESTAMP')
    expect(kind?.printType).toBe("enum('a', 'b''c')")
    expect((g?.actions as Json).spatial).toBe(true)
    expect(name?.distinctSql).toBe(
      'SELECT COUNT(*) AS `Rows`, `name` FROM `s` GROUP BY `name` ORDER BY `name`',
    )
  })

  it('lists indexes, duplicate notices and the information card', async () => {
    const j = await get(`${base}/tables/s/structure`)
    const indexes = j.indexes as Array<Record<string, unknown>>
    expect(indexes.map((i) => [i.name, i.type, i.unique])).toEqual([
      ['PRIMARY', 'BTREE', true],
      ['k', 'BTREE', false],
      ['k2', 'BTREE', false],
      ['sp', 'SPATIAL', false],
    ])
    expect(j.indexNotices).toEqual([
      'The indexes k and k2 seem to be equal and one of them could possibly be removed.',
    ])
    const stats = j.stats as Json
    expect(stats.tableComment).toBe('tbl comment')
    expect(stats.data).toEqual(['16.0', 'KiB'])
    const labels = (stats.rows as Array<{ label: string }>).map((r) => r.label)
    expect(labels).toEqual(['Format', 'Collation', 'Next autoindex', 'Creation', 'Last update', 'Last check'])
    expect(stats.optimizeSql).toBe('OPTIMIZE TABLE `s`')
    expect((j.partitions as Json).partitions).toEqual([])
  })

  it('refuses unknown tables and databases with phpMyAdmin messages', async () => {
    expect((await get(`${base}/tables/nope/structure`, 404)).error).toMatchObject({
      message: 'No table selected.',
    })
    expect((await get('/api/servers/1/databases/m2tbl_missing/tables/x/structure', 404)).error).toMatchObject(
      {
        message: 'No databases selected.',
      },
    )
  })
})

describe('create table, add and change columns', () => {
  const cols = [
    { name: 'id', type: 'INT', autoIncrement: true },
    {
      name: 'label',
      type: 'VARCHAR',
      length: '40',
      null: true,
      defaultType: 'NULL',
      collation: 'utf8mb4_bin',
      comments: "it's",
    },
  ]

  it('previews and creates a table', async () => {
    const req = {
      table: 'c1',
      columns: cols,
      indexes: [{ choice: 'PRIMARY', columns: [{ colIndex: 0 }] }],
      engine: 'InnoDB',
      collation: 'utf8mb4_unicode_ci',
      comment: 'created',
    }
    const preview = await post(`${base}/tables`, { ...req, dryRun: true })
    expect(preview.preview).toBe(
      "CREATE TABLE `m2tbl_it`.`c1` (`id` INT NOT NULL AUTO_INCREMENT , `label` VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL COMMENT 'it\\'s' , PRIMARY KEY (`id`)) ENGINE = InnoDB CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT = 'created';",
    )
    const r = await post(`${base}/tables`, req)
    expect(executedWrites(r)).toEqual([preview.preview])
    expect(await createSql('c1')).toContain(
      "`label` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'it''s'",
    )
    const again = await post(`${base}/tables`, req, 400)
    expect(again.error).toMatchObject({ message: 'Table c1 already exists!' })
  })

  it('adds columns at the beginning / after a column, only the first honours the position', async () => {
    const r = await post(`${base}/tables/c1/columns/add`, {
      columns: [
        { name: 'a', type: 'INT' },
        { name: 'b', type: 'DATE', null: true, defaultType: 'NULL' },
      ],
      indexes: [{ choice: 'INDEX', keyName: 'ia', columns: [{ colIndex: 0 }] }],
      where: 'after',
      afterField: 'id',
    })
    expect(r.messages).toEqual([
      {
        type: 'success',
        text: 'Table c1 has been altered successfully.',
        sql: 'ALTER TABLE `c1` ADD `a` INT NOT NULL AFTER `id`, ADD `b` DATE NULL DEFAULT NULL AFTER `a`, ADD INDEX `ia` (`a`);',
      },
    ])
    const first = await post(`${base}/tables/c1/columns/add`, {
      columns: [{ name: 'z', type: 'TINYINT', length: '1' }],
      where: 'first',
      dryRun: true,
    })
    expect(first.preview).toBe('ALTER TABLE `c1` ADD `z` TINYINT(1) NOT NULL FIRST;')
  })

  it('pre-fills the change form like phpMyAdmin and only CHANGEs columns that differ', async () => {
    const form = await get(`${base}/tables/c1/columns/form?fields=label&fields=id`)
    const rows = form.columns as Array<{ values: Json; orig: Json }>
    // table order, not selection order
    expect(rows.map((r) => r.values.name)).toEqual(['id', 'label'])
    expect(rows[1]?.values).toMatchObject({
      type: 'VARCHAR',
      length: '40',
      collation: 'utf8mb4_bin',
      null: true,
      defaultType: 'NULL',
      comments: "it's",
    })
    expect(rows[0]?.orig).toMatchObject({ extra: 'auto_increment', type: 'INT' })
    expect((form.options as Json).privsAvailable).toBe(true)
    const columns: Json[] = rows.map((r) => ({ ...r.values, orig: r.orig }))
    // untouched: id is re-stated (A_I box vs "auto_increment"), label is not
    const unchanged = await post(`${base}/tables/c1/columns/change`, { columns, dryRun: true })
    expect(unchanged.preview).toBe('ALTER TABLE `c1` CHANGE `id` `id` INT NOT NULL AUTO_INCREMENT;')
    const renamed = columns.map((c) => (c.name === 'label' ? { ...c, name: 'title', length: '60' } : c))
    const r = await post(`${base}/tables/c1/columns/change`, { columns: renamed, onlineTransaction: false })
    expect((r.messages as Json[])[0]).toMatchObject({
      type: 'success',
      text: 'Table c1 has been altered successfully.',
    })
    expect(await createSql('c1')).toContain('`title` varchar(60)')
  })

  it('changes a collation through a BLOB conversion first', async () => {
    const form = await get(`${base}/tables/c1/columns/form?fields=title`)
    const row = (form.columns as Array<{ values: Json; orig: Json }>)[0]!
    const r = await post(`${base}/tables/c1/columns/change`, {
      columns: [{ ...row.values, collation: 'utf8mb4_general_ci', orig: row.orig }],
    })
    expect(executedWrites(r)).toEqual([
      'ALTER TABLE `c1` CHANGE `title` `title` BLOB;',
      "ALTER TABLE `c1` CHANGE `title` `title` VARCHAR(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT 'it\\'s';",
    ])
  })

  it('moves columns and reports phpMyAdmin errors', async () => {
    const before = ((await get(`${base}/tables/c1/structure`)).columns as Json[]).map((c) => c.name as string)
    const same = await post(`${base}/tables/c1/columns/move`, { order: before }, 400)
    expect(same.error).toMatchObject({ message: 'The selected columns are already in the correct order.' })
    const bad = await post(`${base}/tables/c1/columns/move`, { order: ['nope'] }, 400)
    expect(bad.error).toMatchObject({
      message: 'The selected columns do not match the columns in the table.',
    })
    const order = [...before.slice(1), before[0]!]
    const preview = await post(`${base}/tables/c1/columns/move`, { order, dryRun: true })
    expect(String(preview.preview)).toMatch(/^ALTER TABLE `c1`\n {2}CHANGE /)
    const r = await post(`${base}/tables/c1/columns/move`, { order })
    expect(r.columns).toEqual(order)
    expect((r.messages as Json[])[0]).toMatchObject({ text: 'The columns have been moved successfully.' })
    const after = ((await get(`${base}/tables/c1/structure`)).columns as Json[]).map((c) => c.name)
    expect(after).toEqual(order)
  })

  it('checks reserved words', async () => {
    const r = await post(`${base}/tables/c1/columns/reserved-word-check`, {
      names: ['select ', 'ok', 'from'],
    })
    expect(r).toEqual({ reserved: true, message: "The names 'select,from' are MySQL reserved keywords." })
    expect(await post(`${base}/tables/c1/columns/reserved-word-check`, { names: ['ok'] })).toMatchObject({
      reserved: false,
    })
  })
})

describe('row actions, bulk buttons, drop', () => {
  beforeAll(() => seed('CREATE TABLE k (a INT NOT NULL, b INT NOT NULL, c TEXT, PRIMARY KEY (a));'))

  it('adds keys from the row links (Primary replaces the existing one)', async () => {
    const u = await post(`${base}/tables/k/columns/key`, { type: 'UNIQUE', columns: ['b'] })
    expect((u.messages as Json[])[0]).toEqual({
      type: 'success',
      text: 'Your SQL query has been executed successfully.',
      sql: 'ALTER TABLE `k` ADD UNIQUE(`b`);',
    })
    const p = await post(`${base}/tables/k/columns/key`, { type: 'PRIMARY', columns: ['b'] })
    expect(executedWrites(p)).toEqual(['ALTER TABLE `k` DROP PRIMARY KEY, ADD PRIMARY KEY(`b`);'])
    const err = await post(`${base}/tables/k/columns/key`, { type: 'INDEX', columns: ['c'] })
    expect((err.messages as Json[])[0]).toMatchObject({
      type: 'error',
      sql: 'ALTER TABLE `k` ADD INDEX(`c`);',
    })
    expect(String((err.messages as Json[])[0]?.text)).toMatch(/^#1170 - /)
  })

  it('asks before replacing the primary key from the bulk button', async () => {
    const q = await post(`${base}/tables/k/columns/key`, {
      type: 'PRIMARY',
      columns: ['a', 'b'],
      source: 'bulk',
    })
    expect(q.confirm).toEqual({
      question: 'Do you really want to execute the following query?',
      sql: 'ALTER TABLE `k`\n  DROP PRIMARY KEY,\n   ADD PRIMARY KEY(\n     `a`,\n     `b`\n   );',
    })
    const yes = await post(`${base}/tables/k/columns/key`, {
      type: 'PRIMARY',
      columns: ['a', 'b'],
      source: 'bulk',
      confirmed: true,
    })
    expect(executedWrites(yes)).toEqual(['ALTER TABLE `k` DROP PRIMARY KEY, ADD PRIMARY KEY(`a`, `b`);'])
  })

  it('drops a column from its row link (through /sql) and several from the bulk page', async () => {
    const r = await post(`${base}/tables/k/columns/drop`, { columns: ['c'], source: 'row' })
    expect(executedWrites(r)).toEqual([
      'SET FOREIGN_KEY_CHECKS = OFF;',
      'ALTER TABLE `k` DROP `c`;',
      // Sql::deleteTransformationInfo → Transformations::clear (the user link, browser transformations on)
      "DELETE FROM `phpmyadmin`.`pma__column_info` WHERE `db_name` = 'm2tbl_it' AND `table_name` = 'k' AND `column_name` = 'c' ",
      'SET FOREIGN_KEY_CHECKS = ON;',
    ])
    expect(String((r.messages as Json[])[0]?.text)).toMatch(
      /^Column c has been dropped\. \(Query took \d+\.\d{4} seconds\.\)$/,
    )
    await seed('ALTER TABLE k ADD d INT, ADD e INT')
    const bulk = await post(`${base}/tables/k/columns/drop`, { columns: ['d', 'e'] })
    expect(executedWrites(bulk)).toEqual(['ALTER TABLE `k` DROP `d`, DROP `e`;'])
    expect(bulk.messages).toEqual([{ type: 'success', text: '2 columns have been dropped successfully.' }])
  })
})

describe('index editor', () => {
  beforeAll(() =>
    seed(
      "CREATE TABLE i (id INT PRIMARY KEY, name VARCHAR(50), qty INT, KEY name_idx (name(10), qty DESC) COMMENT 'c');",
    ),
  )

  it('pre-fills an existing index and re-posts it unchanged as DROP + ADD', async () => {
    const form = await get(`${base}/tables/i/indexes/form?index=name_idx`)
    expect(form).toMatchObject({
      oldIndex: 'name_idx',
      primaryAllowed: false,
      index: {
        name: 'name_idx',
        choice: 'INDEX',
        keyBlockSize: '0',
        type: 'BTREE',
        comment: 'c',
        columns: [
          { name: 'name', subPart: '10', collation: 'A' },
          { name: 'qty', subPart: '', collation: 'D' },
        ],
      },
    })
    const r = await post(`${base}/tables/i/indexes`, { oldIndex: 'name_idx', index: form.index })
    expect(executedWrites(r)).toEqual([
      "ALTER TABLE `m2tbl_it`.`i` DROP INDEX `name_idx`, ADD INDEX `name_idx` (`name`(10) ASC, `qty` DESC) USING BTREE COMMENT 'c';",
    ])
  })

  it('creates an index on N columns, refuses bad names, renames and drops', async () => {
    const form = await get(`${base}/tables/i/indexes/form?create=2`)
    // a new Index() is UNIQUE and offers PRIMARY even when the table has one (phpMyAdmin quirk)
    expect(form).toMatchObject({
      oldIndex: null,
      primaryAllowed: true,
      index: { choice: 'UNIQUE', name: '' },
    })
    expect((form.index as Json).columns).toEqual([
      { name: 'id', subPart: '', collation: '' },
      { name: 'name', subPart: '', collation: '' },
    ])
    expect(form.fields).toEqual([
      ['id', 'int'],
      ['name', 'varchar(50)'],
      ['qty', 'int'],
    ])
    const bad = await post(
      `${base}/tables/i/indexes`,
      { index: { name: 'PRIMARY', choice: 'UNIQUE', columns: [{ name: 'qty' }] } },
      400,
    )
    expect(bad.error).toMatchObject({ message: "Can't rename index to PRIMARY!" })
    const none = await post(
      `${base}/tables/i/indexes`,
      { index: { choice: 'INDEX', columns: [{ name: '' }] } },
      400,
    )
    expect(none.error).toMatchObject({ message: 'No index parts defined!' })
    const created = await post(`${base}/tables/i/indexes`, {
      index: { name: 'q', choice: 'UNIQUE', keyBlockSize: '8', columns: [{ name: 'qty' }] },
    })
    expect((created.messages as Json[])[0]).toMatchObject({
      text: 'Table i has been altered successfully.',
      sql: 'ALTER TABLE `m2tbl_it`.`i` ADD UNIQUE `q` (`qty`) KEY_BLOCK_SIZE = 8;',
    })
    const renamed = await post(`${base}/tables/i/indexes/rename`, { oldIndex: 'q', name: 'q2' })
    expect(executedWrites(renamed)).toEqual(['ALTER TABLE `m2tbl_it`.`i` RENAME INDEX `q` TO `q2`;'])
    const dropped = await post(`${base}/tables/i/indexes/drop`, { name: 'q2' })
    expect(String((dropped.messages as Json[])[0]?.text)).toMatch(/^Index q2 has been dropped\./)
    const pk = await post(`${base}/tables/i/indexes/drop`, { name: 'PRIMARY' })
    expect(executedWrites(pk)).toContain('ALTER TABLE `i` DROP PRIMARY KEY;')
    expect(String((pk.messages as Json[])[0]?.text)).toMatch(/^The primary key has been dropped\./)
  })
})

describe('partitions', () => {
  beforeAll(() =>
    seed(`CREATE TABLE p (id INT NOT NULL, y INT NOT NULL) PARTITION BY RANGE (y) (
      PARTITION p0 VALUES LESS THAN (2000) COMMENT 'old', PARTITION p1 VALUES LESS THAN MAXVALUE);
      INSERT INTO p VALUES (1, 1990), (2, 2010);`),
  )

  it('shows the partitions card and pre-fills the editor from SHOW CREATE TABLE', async () => {
    const j = await get(`${base}/tables/p/structure`)
    const parts = j.partitions as Json
    expect(parts).toMatchObject({
      method: 'RANGE',
      expression: '`y`',
      hasDescription: true,
      rangeOrList: true,
    })
    expect((parts.partitions as Json[]).map((p) => [p.name, p.description, p.comment])).toEqual([
      ['p0', '2000', 'old'],
      ['p1', 'MAXVALUE', ''],
    ])
    const form = await get(`${base}/tables/p/partitions/form`)
    expect(form.partitioning).toMatchObject({
      partitionBy: 'RANGE',
      partitionExpr: '`y`',
      partitionCount: '2',
      partitions: [
        { name: 'p0', valueType: 'LESS THAN', value: '2000', engine: 'InnoDB', comment: 'old' },
        { name: 'p1', valueType: 'LESS THAN MAXVALUE', value: '', engine: 'InnoDB', comment: '' },
      ],
    })
    expect(form.valueEnabled).toBe(true)
  })

  it('runs partition maintenance, re-partitions and removes partitioning', async () => {
    const a = await post(`${base}/tables/p/partitions/maintenance`, { operation: 'ANALYZE', partition: 'p0' })
    expect(a.maintenance).toMatchObject({ title: 'Analyze partition', partition: 'p0' })
    expect(((a.maintenance as Json).rows as Json[])[0]).toMatchObject({ table: `${DB}.p`, op: 'analyze' })
    const tr = await post(`${base}/tables/p/partitions/maintenance`, {
      operation: 'TRUNCATE',
      partition: 'p0',
    })
    expect(executedWrites(tr)).toEqual(['ALTER TABLE `p` TRUNCATE PARTITION `p0`;'])
    const hash = await post(`${base}/tables/p/partitions/partitioning`, {
      partitioning: { partitionBy: 'HASH', partitionExpr: 'id', partitionCount: '3' },
    })
    expect(executedWrites(hash)).toEqual(['ALTER TABLE `p`  PARTITION BY HASH (id) PARTITIONS 3'])
    const rm = await post(`${base}/tables/p/partitions/remove-partitioning`, {})
    expect(executedWrites(rm)).toContain('ALTER TABLE `p` REMOVE PARTITIONING')
    expect(await createSql('p')).not.toContain('PARTITION')
  })
})
