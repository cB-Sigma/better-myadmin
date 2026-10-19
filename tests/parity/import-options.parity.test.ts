import { gzipSync } from 'node:zlib'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { convertFromUtf8 } from '../../packages/export/src/charset.ts'
import { createOpenDocument } from '../../packages/export/src/plugins/opendocument.ts'
import { ROOT, createAccounts, withFields } from './lib/export.ts'
import { GeneralLog } from './lib/general-log.ts'
import { type ImportFile, type Pairs, bmaImport, pmaImport, pmaImportForm } from './lib/import.ts'
import { PmaClient } from './lib/pma.ts'
import { PMA_STORAGE, PMA_URL, pmaReachable } from './lib/server-setup.ts'
import { TARGET } from './lib/target.ts'

/**
 * Every import format's options against phpMyAdmin (docs/features/07-export-import.md): the SQL
 * compatibility modes and "no AUTO_INCREMENT for zero", each CSV / LOAD DATA / ODS option on its
 * own, the file charset, interruption, skipped queries and foreign key checks. Same file and form
 * (scraped from phpMyAdmin, changed per case) into twin databases; the messages and the resulting
 * tables (SHOW CREATE TABLE + rows) must match. import.parity.test.ts has the format basics.
 */
const DBS = { pma: 'f07_ioa', bma: 'f07_iob' }
const USERS = { pma: 'f07_iopma', bma: 'f07_iobma' }
const SEED = `CREATE TABLE t (id INT PRIMARY KEY, name VARCHAR(40), v DECIMAL(6,2));
  INSERT INTO t VALUES (1, 'one', 1.50);
  CREATE TABLE ai (id INT AUTO_INCREMENT PRIMARY KEY, s VARCHAR(10));
  CREATE TABLE parent (id INT PRIMARY KEY) ENGINE=InnoDB;
  CREATE TABLE kid (id INT, pid INT, FOREIGN KEY (pid) REFERENCES parent (id)) ENGINE=InnoDB;`

let root: mysql.Connection
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let token = ''
let log: GeneralLog
const forms: Record<'server' | 'database' | 'table', Pairs> = { server: [], database: [], table: [] }

const f = (name: string, data: string | Buffer): ImportFile => ({
  name,
  data: typeof data === 'string' ? Buffer.from(data, 'utf8') : data,
})
type Changes = Record<string, string | string[] | null>
interface Case {
  name: string
  form: keyof typeof forms
  changes: Changes
  file: ImportFile
}
const cases: Case[] = []

// SQL: every compatibility mode, on a file that depends on it ("" identifiers, || concatenation)
const MODE_SQL = `CREATE TABLE "qa" (id INT AUTO_INCREMENT PRIMARY KEY, s VARCHAR(20));
INSERT INTO "qa" (id, s) VALUES (0, 'a' || 'b'), (5, CONCAT('c', 'd'));
`
for (const mode of [
  'NONE',
  'ANSI',
  'DB2',
  'MAXDB',
  'MYSQL323',
  'MYSQL40',
  'MSSQL',
  'ORACLE',
  'TRADITIONAL',
]) {
  cases.push({
    name: `sql sql_compatibility=${mode}`,
    form: 'database',
    changes: { format: 'sql', sql_compatibility: mode },
    file: f('mode.sql', MODE_SQL),
  })
}
for (const on of [true, false]) {
  cases.push({
    name: `sql sql_no_auto_value_on_zero ${on ? 'on' : 'off'}`,
    form: 'database',
    changes: { format: 'sql', sql_no_auto_value_on_zero: on ? 'y' : null },
    file: f('zero.sql', "INSERT INTO ai VALUES (0, 'zero'), (0, 'again');\n"),
  })
}
// the file's charset
for (const charset of ['iso-8859-1', 'windows-1251', 'utf-16', 'SHIFT_JIS', 'euc-jp', 'koi8-r']) {
  const text = "INSERT INTO t VALUES (2, 'Привет ïé', 2), (3, 'カタカナ', 3);\n"
  cases.push({
    name: `sql charset_of_file=${charset}`,
    form: 'database',
    changes: { format: 'sql', charset_of_file: charset },
    file: f('cs.sql', convertFromUtf8(Buffer.from(text), charset)),
  })
}
cases.push(
  {
    name: 'sql allow_interrupt off',
    form: 'database',
    changes: { format: 'sql', allow_interrupt: null },
    file: f('i.sql', "INSERT INTO t VALUES (9, 'nine', 9);\n"),
  },
  {
    name: 'sql skip_queries=1 of 3',
    form: 'database',
    changes: { format: 'sql', skip_queries: '1' },
    file: f(
      's.sql',
      "INSERT INTO t VALUES (2, 'a', 1);\nINSERT INTO t VALUES (3, 'b', 1);\nINSERT INTO t VALUES (4, 'c', 1);\n",
    ),
  },
  {
    name: 'sql fk_checks off',
    form: 'database',
    changes: { format: 'sql', fk_checks: '0' },
    file: f('fk.sql', 'INSERT INTO kid VALUES (1, 42);\n'),
  },
  {
    name: 'sql gzip of a latin1 file',
    form: 'database',
    changes: { format: 'sql', charset_of_file: 'iso-8859-1' },
    file: f(
      'g.sql.gz',
      gzipSync(convertFromUtf8(Buffer.from("INSERT INTO t VALUES (7, 'déjà', 7);\n"), 'iso-8859-1')),
    ),
  },
)

// CSV: each option alone, into a new table (database scope) and into `t` (table scope)
const CSV = 'id,name,v\r\n2,"a ""q"" b",\r\n3,"line1\r\nline2",NULL\r\n4,x,1.5\r\n'
const csvOpts: Array<[string, Changes, string?]> = [
  ['defaults', {}],
  ['csv_col_names', { csv_col_names: 'y' }],
  ['csv_empty_as_null', { csv_col_names: 'y', csv_empty_as_null: 'y' }],
  ['csv_terminated=|', { csv_terminated: '|' }, 'id|name|v\n2|a|1\n'],
  ['csv_enclosed=~', { csv_enclosed: '~' }, '2,~a,b~,1\n'],
  ['csv_escaped=\\', { csv_escaped: '\\' }, '2,"a\\"b",1\n'],
  ['csv_new_line=\\r\\n', { csv_new_line: '\\r\\n' }, '2,a,1\r\n3,b,2\r\n'],
  ['csv_new_line=\\n', { csv_new_line: '\\n' }, '2,a,1\n3,b,2\n'],
  ['csv_partial_import=1', { csv_partial_import: '1' }],
  ['csv_ignore', { csv_ignore: 'y' }],
  ['csv_replace', { csv_replace: 'y' }],
]
for (const [label, changes, data] of csvOpts) {
  cases.push({
    name: `csv database ${label}`,
    form: 'database',
    changes: { format: 'csv', csv_new_tbl_name: 'nt', ...changes },
    file: f('n.csv', data ?? CSV),
  })
  if (label === 'csv_col_names' || label === 'csv_empty_as_null') continue
  cases.push({
    name: `csv table ${label}`,
    form: 'table',
    changes: { format: 'csv', ...changes },
    file: f('t.csv', (data ?? CSV).replace(/^id,name,v\r\n/, '').replace(/^id\|name\|v\n/, '')),
  })
}
cases.push(
  {
    name: 'csv table csv_columns=name,id',
    form: 'table',
    changes: { format: 'csv', csv_columns: 'name,id' },
    file: f('c.csv', 'five,5\nsix,6\n'),
  },
  {
    name: 'csv table csv_ignore with a duplicate key',
    form: 'table',
    changes: { format: 'csv', csv_ignore: 'y' },
    file: f('d.csv', '1,dup,1\n2,new,2\n'),
  },
  {
    name: 'csv table csv_replace with a duplicate key',
    form: 'table',
    changes: { format: 'csv', csv_replace: 'y' },
    file: f('d.csv', '1,dup,1\n2,new,2\n'),
  },
  {
    name: 'csv server csv_new_db_name + csv_new_tbl_name',
    form: 'server',
    changes: { format: 'csv', csv_new_db_name: `${DBS.pma}_new`, csv_new_tbl_name: 'nt', csv_col_names: 'y' },
    file: f('s.csv', CSV),
  },
)

// LOAD DATA (table scope): every option; the reference MySQL refuses LOCAL and server files, so
// the statements (in the messages) are what is compared
const ldiOpts: Array<[string, Changes]> = [
  ['defaults', {}],
  ['ldi_replace', { ldi_replace: 'y' }],
  ['ldi_ignore', { ldi_ignore: 'y' }],
  ['ldi_terminated=,', { ldi_terminated: ',' }],
  ['ldi_enclosed=~', { ldi_enclosed: '~' }],
  ['ldi_escaped=#', { ldi_escaped: '#' }],
  ['ldi_new_line=\\r\\n', { ldi_new_line: '\\r\\n' }],
  ['ldi_columns=id,name', { ldi_columns: 'id,name' }],
  ['ldi_local_option on', { ldi_local_option: 'y' }],
  ['ldi_local_option off', { ldi_local_option: null }],
]
for (const [label, changes] of ldiOpts) {
  cases.push({
    name: `ldi table ${label}`,
    form: 'table',
    changes: { format: 'ldi', ...changes },
    file: f('t.ldi', '5;five;5\n'),
  })
}

// ODS: each switch on and off
const cell = (v: string) =>
  `<table:table-cell office:value-type="string"><text:p>${v}</text:p></table:table-cell>`
const ODS_CONTENT = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.0"><office:body><office:spreadsheet><table:table table:name="sh"><table:table-row>${cell('name')}${cell('pct')}${cell('price')}</table:table-row><table:table-row>${cell('a')}<table:table-cell office:value-type="percentage" office:value="0.25"><text:p>25.00%</text:p></table:table-cell><table:table-cell office:value-type="currency" office:value="9.99"><text:p>9.99 €</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell table:number-columns-repeated="3"/></table:table-row><table:table-row>${cell('b')}<table:table-cell office:value-type="percentage" office:value="1"><text:p>100%</text:p></table:table-cell><table:table-cell office:value-type="currency" office:value="-2"><text:p>-$2.00</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`
const ods = createOpenDocument(
  'application/vnd.oasis.opendocument.spreadsheet',
  ODS_CONTENT,
  { name: 'x', version: '1' },
  new Date(0),
)
for (const opt of [
  'ods_col_names',
  'ods_empty_rows',
  'ods_recognize_percentages',
  'ods_recognize_currency',
]) {
  for (const on of [true, false]) {
    cases.push({
      name: `ods database ${opt} ${on ? 'on' : 'off'}`,
      form: 'database',
      changes: { format: 'ods', [opt]: on ? 'y' : null },
      file: f('x.ods', ods),
    })
  }
}

async function snapshot(db: string): Promise<string> {
  const [tables] = (await root.query(`SHOW TABLES FROM \`${db}\``)) as unknown as [
    Array<Record<string, string>>,
  ]
  const out: string[] = []
  for (const t of tables.map((r) => Object.values(r)[0] as string).sort()) {
    const [[create]] = (await root.query(`SHOW CREATE TABLE \`${db}\`.\`${t}\``)) as unknown as [
      [Record<string, string>],
    ]
    const [rows] = (await root.query(`SELECT * FROM \`${db}\`.\`${t}\``)) as unknown as [unknown[]]
    out.push(
      String(create?.['Create Table']).replace(/ AUTO_INCREMENT=\d+/, ''),
      JSON.stringify(rows, (_k, v) => (Buffer.isBuffer(v) ? v.toString('hex') : v)),
    )
  }
  return out.join('\n')
}

const reset = (db: string) =>
  `DROP DATABASE IF EXISTS \`${db}_new\`; DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`

/**
 * `ldi_local_option off` is a server-side `LOAD DATA INFILE` of the uploaded file, which the
 * reference server (its own container) cannot read either tool's path: both fail, only the error
 * code differs by the staging path. MySQL (`secure_file_priv=/var/lib/mysql-files`) refuses both
 * paths with #1290. MariaDB (`secure_file_priv=NULL`) allows server-side `LOAD DATA` only from a
 * file directly in `@@tmpdir` (`/tmp`): phpMyAdmin stages in PHP's `upload_tmp_dir` = `/tmp`, so it
 * gets #13 (file not found); BetterMyAdmin stages in an isolated, private `tmpdir()/bma-import/`
 * (0700 dir, 0600 random-named files — a deliberate security choice we keep), a subdirectory, so
 * MariaDB rejects it with #1290. Both statements are identical (compared above); the difference is
 * the harness's (the file is on neither DB server's filesystem), so it is normalised away here, as
 * import.parity.test.ts does. See the report for why the isolated staging is not changed to match.
 */
const serverFileError = (m: string): string =>
  TARGET === 'mariadb'
    ? m.replace(
        /^error: #(13 - Can't get stat of '[^']*' \(Errcode: 2 "No such file or directory"\)|1290 - The MariaDB server is running with the --secure-file-priv option so it cannot execute this statement)$/,
        'error: <the server cannot read the uploaded file>',
      )
    : m

describe.skipIf(!pmaReachable)('import options parity', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    await createAccounts(root, [USERS.pma, USERS.bma])
    await root.query(reset(DBS.pma) + reset(DBS.bma))
    pma = new PmaClient(PMA_URL)
    await pma.login(USERS.pma, USERS.pma)
    bma = testApp(testConfig({}, PMA_STORAGE))
    const r = await bma.login(USERS.bma, USERS.bma)
    token = String(r.json.csrfToken ?? '')
    forms.database = await pmaImportForm(pma, 'database', { db: DBS.pma })
    forms.table = await pmaImportForm(pma, 'table', { db: DBS.pma, table: 't' })
    forms.server = await pmaImportForm(pma, 'server')
    log = await GeneralLog.open(ROOT)
  }, 60000)

  afterAll(async () => {
    await bma?.close()
    await log?.close()
    if (root !== undefined) {
      for (const db of Object.values(DBS))
        await root.query(`DROP DATABASE IF EXISTS \`${db}\`; DROP DATABASE IF EXISTS \`${db}_new\``)
      for (const u of Object.values(USERS)) await root.query(`DROP USER IF EXISTS '${u}'@'%'`)
      await root.end()
    }
  })

  for (const c of cases) {
    it(c.name, async () => {
      await root.query(reset(DBS.pma) + reset(DBS.bma))
      const pairs = withFields(forms[c.form], c.changes)
      const bPairs = pairs.map(([k, v]): [string, string] => [k, v.replaceAll(DBS.pma, DBS.bma)])
      const mark = await log.marker()
      const p = await pmaImport(pma, pairs, c.file)
      const b = await bmaImport(bma, token, bPairs, c.file)
      // the statements that import the data: the LOAD DATA options, the sql_mode of a compatibility
      // mode, the generated CREATE / INSERT (the uploaded file's path differs)
      const writes = async (user: string, db: string) =>
        (await log.since(user, mark))
          .map((e) => e.sql)
          .filter((q) => /^\s*(LOAD DATA|INSERT|REPLACE|CREATE|ALTER|SET SQL_MODE|SET @@SQL_MODE)/i.test(q))
          .map((q) => q.replaceAll(db, 'DB').replace(/INFILE '[^']*'/i, "INFILE 'F'"))
      expect(await writes(USERS.bma, DBS.bma)).toEqual(await writes(USERS.pma, DBS.pma))
      expect(b.messages.map((m) => serverFileError(m.replaceAll(DBS.bma, DBS.pma)))).toEqual(
        p.map(serverFileError),
      )
      expect((await snapshot(DBS.bma)).replaceAll(DBS.bma, DBS.pma)).toBe(await snapshot(DBS.pma))
      const [news] = (await root.query(`SHOW DATABASES LIKE '${DBS.pma}_new'`)) as unknown as [unknown[]]
      if (news.length > 0)
        expect((await snapshot(`${DBS.bma}_new`)).replaceAll(DBS.bma, DBS.pma)).toBe(
          await snapshot(`${DBS.pma}_new`),
        )
    })
  }
})
