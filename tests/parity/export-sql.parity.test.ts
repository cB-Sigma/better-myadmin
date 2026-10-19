import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import {
  type Pairs,
  ROOT,
  bmaDump,
  comparable,
  createAccounts,
  maskExportHost,
  pmaDump,
  pmaExportForm,
  seedDatabase,
  withFields,
} from './lib/export.ts'
import { PmaClient } from './lib/pma.ts'
import { PMA_STORAGE, PMA_URL, pmaReachable } from './lib/server-setup.ts'

/**
 * Golden byte parity of the SQL export (docs/features/07-export-import.md, SQL plugin): the same
 * form (scraped from phpMyAdmin's export page, then changed per case) is posted to the reference
 * phpMyAdmin and to BetterMyAdmin for the seed schema with every column type; both dumps must be
 * byte-identical once the tool/version/time header lines are removed.
 */
const DB = 'f07_exp'
const USERS = { pma: 'f07_pma', bma: 'f07_bma' }

let root: mysql.Connection
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let bmaStorage: ReturnType<typeof testApp>
let dbForm: Pairs
let tableForm: Pairs
let viewForm: Pairs
let serverForm: Pairs

/** Custom SQL options all ticked except the ones listed. */
const ALL_SQL = {
  quick_or_custom: 'custom',
  sql_include_comments: 'y',
  sql_dates: null,
  sql_drop_table: 'y',
  sql_if_not_exists: null,
  sql_procedure_function: 'y',
  sql_create_trigger: 'y',
}

const cases: Array<{ name: string; form: () => Pairs; changes: Record<string, string | string[] | null> }> = [
  {
    name: 'database, quick defaults [p07-ac34e1 p07-082881 p07-16d4c6 p07-8d25af p07-8ea5f1]',
    form: () => dbForm,
    changes: {},
  },
  { name: 'database, view as text [p07-8cba02]', form: () => dbForm, changes: { output_format: 'astext' } },
  { name: 'database, no comments [p07-ac34e1]', form: () => dbForm, changes: { sql_include_comments: null } },
  {
    name: 'database, drop + create database + header comment',
    form: () => dbForm,
    changes: { ...ALL_SQL, sql_create_database: 'y', sql_header_comment: 'one\\ntwo' },
  },
  { name: 'database, IF NOT EXISTS [p07-16d4c6]', form: () => dbForm, changes: { sql_if_not_exists: 'y' } },
  {
    name: 'database, IF NOT EXISTS without auto increment',
    form: () => dbForm,
    changes: { sql_if_not_exists: 'y', sql_auto_increment: null },
  },
  {
    name: 'database, no AUTO_INCREMENT value [p07-e00e83]',
    form: () => dbForm,
    changes: { sql_auto_increment: null },
  },
  { name: 'database, no backquotes', form: () => dbForm, changes: { sql_backquotes: null } },
  { name: 'database, structure only', form: () => dbForm, changes: { sql_structure_or_data: 'structure' } },
  { name: 'database, data only', form: () => dbForm, changes: { sql_structure_or_data: 'data' } },
  { name: 'database, complete inserts', form: () => dbForm, changes: { sql_insert_syntax: 'complete' } },
  {
    name: 'database, extended inserts [p07-bf25c1]',
    form: () => dbForm,
    changes: { sql_insert_syntax: 'extended' },
  },
  { name: 'database, neither syntax', form: () => dbForm, changes: { sql_insert_syntax: 'none' } },
  {
    name: 'database, max query size 300 [p07-bf25c1]',
    form: () => dbForm,
    changes: { sql_max_query_size: '300' },
  },
  {
    name: 'database, max query size 0 [p07-bf25c1]',
    form: () => dbForm,
    changes: { sql_max_query_size: '0' },
  },
  {
    name: 'database, no hex for binary [p07-d565d2]',
    form: () => dbForm,
    changes: { sql_hex_for_binary: null },
  },
  { name: 'database, no UTC [p07-8d25af]', form: () => dbForm, changes: { sql_utc_time: null } },
  {
    name: 'database, no transaction, disable FK [p07-8d25af]',
    form: () => dbForm,
    changes: { sql_use_transaction: null, sql_disable_fk: 'y' },
  },
  { name: 'database, REPLACE [p07-0e07e2]', form: () => dbForm, changes: { sql_type: 'REPLACE' } },
  { name: 'database, UPDATE [p07-0e07e2]', form: () => dbForm, changes: { sql_type: 'UPDATE' } },
  {
    name: 'database, INSERT IGNORE DELAYED + truncate [p07-0e07e2]',
    form: () => dbForm,
    changes: { sql_ignore: 'y', sql_delayed: 'y', sql_truncate: 'y' },
  },
  { name: 'database, views as tables', form: () => dbForm, changes: { sql_views_as_tables: 'y' } },
  {
    name: 'database, view options',
    form: () => dbForm,
    changes: { sql_simple_view_export: 'y', sql_or_replace_view: 'y', sql_drop_table: 'y' },
  },
  {
    name: 'database, exclude definer [p07-1c04ca]',
    form: () => dbForm,
    changes: { sql_view_current_user: 'y' },
  },
  {
    name: 'database, no routines/triggers/views/create table',
    form: () => dbForm,
    changes: { sql_procedure_function: null, sql_create_trigger: null, sql_create_view: null },
  },
  { name: 'database, ANSI [p07-8ea5f1]', form: () => dbForm, changes: { sql_compatibility: 'ANSI' } },
  { name: 'database, MSSQL [p07-40938a]', form: () => dbForm, changes: { sql_compatibility: 'MSSQL' } },
  { name: 'database, TRADITIONAL', form: () => dbForm, changes: { sql_compatibility: 'TRADITIONAL' } },
  {
    name: 'database, MYSQL40 without backquotes',
    form: () => dbForm,
    changes: { sql_compatibility: 'MYSQL40', sql_backquotes: null },
  },
  {
    name: 'database, subset of tables, structure/data split',
    form: () => dbForm,
    changes: {
      'table_select[]': ['child', 'many', 'types', 'v_types'],
      'table_structure[]': ['child', 'types', 'v_types'],
      'table_data[]': ['many', 'types'],
    },
  },
  {
    name: 'database, separate files zip [p07-6c1430]',
    form: () => dbForm,
    changes: { as_separate_files: 'database', compression: 'zip' },
  },
  { name: 'database, gzip', form: () => dbForm, changes: { compression: 'gzip' } },
  { name: 'database, zip', form: () => dbForm, changes: { compression: 'zip' } },
  {
    name: 'database, windows-1252 charset [p07-65bcd4]',
    form: () => dbForm,
    changes: { charset: 'windows-1252' },
  },
  { name: 'database, lock tables [p07-35f358]', form: () => dbForm, changes: { lock_tables: 'y' } },
  {
    name: 'database, skip tables larger than [p07-e2aaab]',
    form: () => dbForm,
    changes: { maxsize: '0.01' },
  },
  {
    name: 'database, aliases',
    form: () => dbForm,
    changes: {
      'aliases[f07_exp][alias]': 'renamed',
      'aliases[f07_exp][tables][child][alias]': 'kid',
      'aliases[f07_exp][tables][types][alias]': 'kinds',
    },
  },
  { name: 'table, all options', form: () => tableForm, changes: { ...ALL_SQL } },
  {
    name: 'table, rows subset',
    form: () => tableForm,
    changes: { allrows: '0', limit_to: '2', limit_from: '1' },
  },
  {
    name: 'table, IF NOT EXISTS + drop',
    form: () => tableForm,
    changes: { sql_if_not_exists: 'y', sql_drop_table: 'y' },
  },
  { name: 'table, UPDATE [p07-0e07e2]', form: () => tableForm, changes: { sql_type: 'UPDATE' } },
  { name: 'view at table scope', form: () => viewForm, changes: { sql_drop_table: 'y' } },
  { name: 'server, two databases', form: () => serverForm, changes: { 'db_select[]': [DB, `${DB}2`] } },
  {
    name: 'server, drop database, separate files',
    form: () => serverForm,
    changes: {
      'db_select[]': [DB, `${DB}2`],
      sql_drop_database: 'y',
      as_separate_files: 'server',
      compression: 'zip',
    },
  },
  {
    name: 'raw query [p07-967550]',
    form: () => tableForm,
    changes: {
      export_type: 'raw',
      table: '',
      single_table: null,
      raw_query: 'true',
      sql_query: 'SELECT id, vc, bn FROM types WHERE id < 3',
    },
  },
  {
    name: 'table with sql_query',
    form: () => tableForm,
    changes: { sql_query: 'SELECT * FROM `types` WHERE `id` > 2' },
  },
]

/** Cases that read the configuration storage (BetterMyAdmin then runs with the same pmadb). */
const PMADB_CASES: Array<{
  name: string
  form: () => Pairs
  changes: Record<string, string | string[] | null>
  has: string[]
}> = [
  {
    name: 'pmadb: relations, media types, dates',
    form: () => dbForm,
    changes: { ...ALL_SQL, sql_relation: 'y', sql_mime: 'y', sql_dates: 'y' },
    has: ['RELATIONSHIPS FOR TABLE', 'MEDIA TYPES FOR TABLE', '-- Creation:'],
  },
  {
    name: 'pmadb: metadata (database) [p07-ab7ea3]',
    form: () => dbForm,
    changes: { sql_metadata: 'y' },
    has: ['Metadata for database', 'SET @LAST_PAGE', 'pma__bookmark'],
  },
  {
    name: 'pmadb: metadata (table)',
    form: () => tableForm,
    changes: { sql_metadata: 'y', sql_relation: 'y', sql_mime: 'y' },
    has: ['Metadata for table types', 'pma__column_info'],
  },
]

const PMADB_SEED = `
  INSERT INTO phpmyadmin.pma__relation (master_db, master_table, master_field, foreign_db, foreign_table, foreign_field)
    VALUES ('${DB}', 'child', 'label', '${DB}', 'types', 'vc');
  INSERT INTO phpmyadmin.pma__column_info (db_name, table_name, column_name, comment, mimetype, transformation, transformation_options)
    VALUES ('${DB}', 'types', 'vc', 'pmadb comment', 'text_plain', 'output/text_plain_bool2text.php', ''),
           ('${DB}', 'types', 'bl', '', 'image_jpeg', '', '');
  INSERT INTO phpmyadmin.pma__bookmark (dbase, user, label, query) VALUES ('${DB}', 'f07_pma', 'bm', 'SELECT 1');
  INSERT INTO phpmyadmin.pma__pdf_pages (db_name, page_descr) VALUES ('${DB}', 'page one');
  INSERT INTO phpmyadmin.pma__table_coords (db_name, table_name, pdf_page_number, x, y)
    VALUES ('${DB}', 'types', LAST_INSERT_ID(), 10, 20);
`
const PMADB_CLEAN = [
  'relation:master_db',
  'column_info:db_name',
  'bookmark:dbase',
  'pdf_pages:db_name',
  'table_coords:db_name',
]
  .map((t) => `DELETE FROM phpmyadmin.pma__${t.split(':')[0]} WHERE ${t.split(':')[1]} = '${DB}';`)
  .join(' ')

describe.skipIf(!pmaReachable)('export SQL parity', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    await createAccounts(root, [USERS.pma, USERS.bma])
    await seedDatabase(root, DB)
    await seedDatabase(root, `${DB}2`)
    pma = new PmaClient(PMA_URL)
    await pma.login(USERS.pma, USERS.pma)
    bma = testApp(testConfig({}, PMA_STORAGE))
    await bma.login(USERS.bma, USERS.bma)
    await root.query(PMADB_CLEAN + PMADB_SEED)
    bmaStorage = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }))
    await bmaStorage.login(USERS.bma, USERS.bma)
    dbForm = await pmaExportForm(pma, 'database', { db: DB })
    tableForm = await pmaExportForm(pma, 'table', { db: DB, table: 'types', single_table: 'true' })
    viewForm = await pmaExportForm(pma, 'table', { db: DB, table: 'v_types', single_table: 'true' })
    serverForm = await pmaExportForm(pma, 'server')
  }, 60000)

  afterAll(async () => {
    await bma?.close()
    await bmaStorage?.close()
    if (root !== undefined) {
      await root.query(PMADB_CLEAN)
      await root.query(`DROP DATABASE IF EXISTS \`${DB}\`; DROP DATABASE IF EXISTS \`${DB}2\``)
      for (const u of Object.values(USERS)) await root.query(`DROP USER IF EXISTS '${u}'@'%'`)
      await root.end()
    }
  })

  for (const c of cases) {
    it(c.name, async () => {
      const pairs = withFields(c.form(), c.changes)
      const p = await pmaDump(pma, pairs)
      const b = await bmaDump(bma, pairs)
      expect(p.status).toBe(200)
      expect(b.status).toBe(200)
      expect(maskExportHost(b.filename)).toBe(maskExportHost(p.filename))
      expect(maskExportHost(comparable(b))).toBe(maskExportHost(comparable(p)))
    })
  }

  for (const c of PMADB_CASES) {
    it(c.name, async () => {
      const pairs = withFields(c.form(), c.changes)
      const p = await pmaDump(pma, pairs)
      const b = await bmaDump(bmaStorage, pairs)
      expect(b.status).toBe(200)
      for (const h of c.has) expect(comparable(p)).toContain(h)
      // the dump's "-- Host:" line and any per-file zip-entry name carry the env-determined server
      // host and connection port; maskExportHost aligns only those, the dump stays byte-exact
      expect(maskExportHost(comparable(b))).toBe(maskExportHost(comparable(p)))
    })
  }
})
