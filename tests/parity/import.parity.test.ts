import { gzipSync } from 'node:zlib'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { createOpenDocument } from '../../packages/export/src/plugins/opendocument.ts'
import { createZip } from '../../packages/export/src/zip.ts'
import { ROOT, createAccounts, withFields } from './lib/export.ts'
import { type ImportFile, type Pairs, bmaImport, pmaImport, pmaImportForm } from './lib/import.ts'
import { PmaClient } from './lib/pma.ts'
import { PMA_STORAGE, PMA_URL, pmaReachable } from './lib/server-setup.ts'

/**
 * Import parity (docs/features/07-export-import.md): the same file and form (scraped from
 * phpMyAdmin's import page, changed per case) imported by phpMyAdmin into one database and by
 * BetterMyAdmin into a twin; the resulting tables (SHOW CREATE TABLE + rows) and the messages of
 * the result page must match.
 */
const DBS = { pma: 'f07_ia', bma: 'f07_ib' }
const USERS = { pma: 'f07_ipma', bma: 'f07_ibma' }
const SEED = `CREATE TABLE t (id INT PRIMARY KEY, name VARCHAR(20), v DECIMAL(6,2));
  INSERT INTO t VALUES (1, 'one', 1.50);
  CREATE TABLE parent (id INT PRIMARY KEY) ENGINE=InnoDB;
  CREATE TABLE kid (id INT, pid INT, FOREIGN KEY (pid) REFERENCES parent (id)) ENGINE=InnoDB;`

let root: mysql.Connection
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let token = ''
let dbForm: Pairs
let tableForm: Pairs
let serverForm: Pairs

const f = (name: string, data: string | Buffer): ImportFile => ({
  name,
  data: typeof data === 'string' ? Buffer.from(data, 'utf8') : data,
})

const many = `CREATE TABLE m (a INT);\n${Array.from({ length: 60 }, (_, i) => `INSERT INTO m VALUES (${i});`).join('\n')}\n`

const ODS_CONTENT = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.0"><office:body><office:spreadsheet><table:table table:name="sheet_a"><table:table-row><table:table-cell office:value-type="string"><text:p>name</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>qty</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>pct</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>price</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell office:value-type="string"><text:p>apple</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="3"><text:p>3</text:p></table:table-cell><table:table-cell office:value-type="percentage" office:value="0.125"><text:p>12.50%</text:p></table:table-cell><table:table-cell office:value-type="currency" office:value="5.5"><text:p>$5.50</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell table:number-columns-repeated="4"/></table:table-row><table:table-row><table:table-cell office:value-type="string"><text:p>line1</text:p><text:p>line2</text:p></table:table-cell><table:table-cell/><table:table-cell office:value-type="float" office:value="1.5"><text:p>1.5</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p><text:a xlink:href="mailto:x@example.org" xmlns:xlink="http://www.w3.org/1999/xlink">x@example.org</text:a></text:p></table:table-cell></table:table-row></table:table><table:table table:name="sheet_b"><table:table-row><table:table-cell office:value-type="float" office:value="12345678901"><text:p>12345678901</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`
const ods = createOpenDocument(
  'application/vnd.oasis.opendocument.spreadsheet',
  ODS_CONTENT,
  { name: 'x', version: '1' },
  new Date(0),
)

const XML_DATA = (db: string) => `<?xml version="1.0" encoding="utf-8"?>
<pma_xml_export version="1.0">
    <database name="${db}">
        <table name="xt">
            <column name="id">1</column>
            <column name="label">a &amp; b</column>
        </table>
        <table name="xt">
            <column name="id">2</column>
            <column name="label">NULL</column>
        </table>
    </database>
</pma_xml_export>`
const XML_STRUCT = `<?xml version="1.0" encoding="utf-8"?>
<pma_xml_export version="1.0" xmlns:pma="https://www.phpmyadmin.net/some_doc_url/">
    <pma:structure_schemas>
        <pma:database name="any" collation="utf8mb4_general_ci" charset="utf8mb4">
            <pma:table name="xs">
                CREATE TABLE \`xs\` (
                  \`id\` int NOT NULL,
                  PRIMARY KEY (\`id\`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            </pma:table>
        </pma:database>
    </pma:structure_schemas>
    <database name="any">
        <table name="xs">
            <column name="id">7</column>
        </table>
    </database>
</pma_xml_export>`

const WIKI = `<!--
Table data for \`wk\`
-->

{| class="wikitable sortable"
|+ wk
|-
 ! id !! label
|-
 | 1 || alpha
|-
 | 2 || [[Link|text]]
|}
`

/** an ESRI shapefile with two points */
function shp(): Buffer {
  const recs = [
    [1, 2.5],
    [-3, 4],
  ]
  const header = Buffer.alloc(100)
  header.writeUInt32BE(9994, 0)
  header.writeUInt32BE((100 + recs.length * 28) / 2, 24)
  header.writeUInt32LE(1000, 28)
  header.writeUInt32LE(1, 32)
  const body = recs.map(([x, y], i) => {
    const b = Buffer.alloc(28)
    b.writeUInt32BE(i + 1, 0)
    b.writeUInt32BE(10, 4)
    b.writeUInt32LE(1, 8)
    b.writeDoubleLE(x as number, 12)
    b.writeDoubleLE(y as number, 20)
    return b
  })
  return Buffer.concat([header, ...body])
}

type Changes = Record<string, string | string[] | null>
const cases: Array<{
  name: string
  form: () => Pairs
  changes?: Changes
  file: ((db: string) => ImportFile | null) | ImportFile | null
}> = [
  {
    name: 'sql, a few statements (goSql) [p07-2162b4]',
    form: () => dbForm,
    file: f(
      'a.sql',
      'CREATE TABLE s1 (a INT, b VARCHAR(5));\nINSERT INTO s1 VALUES (1, "x"), (2, "y");\nSELECT * FROM s1;\n',
    ),
  },
  { name: 'sql, 61 statements (import mode) [p07-2162b4]', form: () => dbForm, file: f('many.sql', many) },
  {
    name: 'sql, error in goSql',
    form: () => dbForm,
    file: f('err.sql', 'CREATE TABLE s2 (a INT);\nINSERT INTO nope VALUES (1);\n'),
  },
  {
    name: 'sql, error in import mode',
    form: () => dbForm,
    file: f('err2.sql', `${many}INSERT INTO nope VALUES (1);\nINSERT INTO m VALUES (99);\n`),
  },
  {
    name: 'sql, skip queries',
    form: () => dbForm,
    changes: { skip_queries: '2' },
    file: f('skip.sql', many),
  },
  {
    name: 'sql, BOM and CR line ends [p07-78ed9c]',
    form: () => dbForm,
    file: f('bom.sql', '﻿CREATE TABLE s3 (a INT);\rINSERT INTO s3 VALUES (1);\r\nINSERT INTO s3 VALUES (2);'),
  },
  { name: 'sql, gzip [p07-85c45c]', form: () => dbForm, file: f('g.sql.gz', gzipSync(Buffer.from(many))) },
  {
    name: 'sql, zip [p07-85c45c]',
    form: () => dbForm,
    file: f('z.sql.zip', createZip(Buffer.from(many), 'z.sql', new Date(0))),
  },
  {
    name: 'sql, latin1 file [p07-02628c]',
    form: () => dbForm,
    changes: { charset_of_file: 'iso-8859-1' },
    file: f(
      'l1.sql',
      Buffer.from("CREATE TABLE s4 (a VARCHAR(10));\nINSERT INTO s4 VALUES ('caf\xe9');\n", 'latin1'),
    ),
  },
  {
    name: 'sql, no AUTO_INCREMENT for zero + compatibility',
    form: () => dbForm,
    changes: { sql_compatibility: 'ANSI', sql_no_auto_value_on_zero: 'something' },
    file: f('ai.sql', 'CREATE TABLE s5 (id INT AUTO_INCREMENT PRIMARY KEY);\nINSERT INTO s5 VALUES (0);\n'),
  },
  {
    name: 'sql, foreign key checks off [p07-abd2aa]',
    form: () => dbForm,
    changes: { fk_checks: '0' },
    file: f('fk.sql', 'INSERT INTO kid VALUES (1, 42);\n'),
  },
  {
    name: 'sql, foreign key checks on [p07-abd2aa]',
    form: () => dbForm,
    changes: { fk_checks: ['0', '1'] },
    file: f('fk2.sql', 'INSERT INTO kid VALUES (2, 43);\n'),
  },
  {
    name: 'csv, new table with column names [p07-b1fc0b]',
    form: () => dbForm,
    changes: { format: 'csv', csv_col_names: 'something' },
    file: f(
      'people.csv',
      'name,age,score,big\n"Ann",31,1.5,3000000000\nBob,,22.25,1\n"C, ""quoted""",7,NULL,-4\n',
    ),
  },
  {
    name: 'csv, no column names, semicolons, empty as NULL [p07-e0700d]',
    form: () => dbForm,
    changes: { format: 'csv', csv_terminated: ';', csv_enclosed: "'", csv_empty_as_null: 'something' },
    file: f('semi.csv', "1;'a;b';\r\n2;;x\r\n"),
  },
  {
    name: 'csv, named table, ignore',
    form: () => dbForm,
    changes: { format: 'csv', csv_new_tbl_name: 'named', csv_ignore: 'something' },
    file: f('x.csv', 'a,b\nc,d'),
  },
  {
    name: 'csv, into existing table',
    form: () => tableForm,
    changes: { format: 'csv' },
    file: f('t.csv', '2,two,2.25\n3,"three",NULL\n'),
  },
  {
    name: 'csv, existing table, columns + replace',
    form: () => tableForm,
    changes: { format: 'csv', csv_columns: 'id, `name`', csv_replace: 'something' },
    file: f('t2.csv', '1,uno\n4,four\n'),
  },
  {
    name: 'csv, wrong column count',
    form: () => tableForm,
    changes: { format: 'csv' },
    file: f('bad.csv', '5,five\n'),
  },
  {
    name: 'csv, invalid column name',
    form: () => tableForm,
    changes: { format: 'csv', csv_columns: 'id,nope' },
    file: f('bad2.csv', '5,five\n'),
  },
  {
    name: 'csv, invalid separator [p07-e0700d]',
    form: () => dbForm,
    changes: { format: 'csv', csv_terminated: '' },
    file: f('bad3.csv', 'a\n'),
  },
  {
    name: 'csv, invalid format',
    form: () => dbForm,
    changes: { format: 'csv' },
    file: f('bad4.csv', 'a,"b\n'),
  },
  {
    name: 'csv, new database at server scope',
    form: () => serverForm,
    changes: { format: 'csv', csv_new_db_name: `${DBS.pma}_new`, csv_new_tbl_name: 'nt' },
    file: f('srv.csv', '1,2\n3,4\n'),
  },
  // LOAD DATA (table scope): the reference MySQL runs with local_infile=OFF and secure_file_priv
  {
    name: 'ldi, LOCAL [p07-d5749f]',
    form: () => tableForm,
    changes: { format: 'ldi', ldi_local_option: 'something', ldi_terminated: ',' },
    file: f('t.ldi', '7,seven,7.5\n'),
  },
  {
    name: 'ldi, server file [p07-d5749f]',
    form: () => tableForm,
    changes: { format: 'ldi', ldi_local_option: null, ldi_ignore: 'something', ldi_columns: 'id, name' },
    file: f('t2.ldi', '8;eight\n'),
  },
  {
    name: 'ldi, compressed [p07-d5749f]',
    form: () => tableForm,
    changes: { format: 'ldi' },
    file: f('t3.ldi.gz', gzipSync(Buffer.from('9;nine;1\n'))),
  },
  { name: 'mediawiki', form: () => dbForm, changes: { format: 'mediawiki' }, file: f('wiki.txt', WIKI) },
  {
    name: 'ods, column names, percentages, currency [p07-3e1771]',
    form: () => dbForm,
    changes: { format: 'ods', ods_col_names: 'something' },
    file: f('book.ods', ods),
  },
  {
    name: 'ods, raw values, empty rows kept',
    form: () => dbForm,
    changes: {
      format: 'ods',
      ods_empty_rows: null,
      ods_recognize_percentages: null,
      ods_recognize_currency: null,
    },
    file: f('book2.ods', ods),
  },
  {
    name: 'xml, data only',
    form: () => dbForm,
    changes: { format: 'xml' },
    file: (db) => f('data.xml', XML_DATA(db)),
  },
  {
    name: 'xml, structure [p07-712f57]',
    form: () => dbForm,
    changes: { format: 'xml' },
    file: f('struct.xml', XML_STRUCT),
  },
  {
    name: 'xml, malformed',
    form: () => dbForm,
    changes: { format: 'xml' },
    file: f('bad.xml', '<pma_xml_export><database'),
  },
  { name: 'shp, points', form: () => dbForm, changes: { format: 'shp' }, file: f('pts.shp', shp()) },
  { name: 'no file [p07-797ff9]', form: () => dbForm, file: null },
  {
    name: 'incorrect format',
    form: () => dbForm,
    changes: { format: 'nope' },
    file: f('a.sql', 'SELECT 1;'),
  },
]

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

describe.skipIf(!pmaReachable)('import parity', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    await createAccounts(root, [USERS.pma, USERS.bma])
    await root.query(reset(DBS.pma) + reset(DBS.bma))
    pma = new PmaClient(PMA_URL)
    await pma.login(USERS.pma, USERS.pma)
    bma = testApp(testConfig({}, PMA_STORAGE))
    const r = await bma.login(USERS.bma, USERS.bma)
    token = String(r.json.csrfToken ?? '')
    dbForm = await pmaImportForm(pma, 'database', { db: DBS.pma })
    tableForm = await pmaImportForm(pma, 'table', { db: DBS.pma, table: 't' })
    serverForm = await pmaImportForm(pma, 'server')
  }, 60000)

  afterAll(async () => {
    await bma?.close()
    if (root !== undefined) {
      await root.query(
        `DROP DATABASE IF EXISTS \`${DBS.pma}\`; DROP DATABASE IF EXISTS \`${DBS.bma}\`; DROP DATABASE IF EXISTS \`${DBS.pma}_new\`; DROP DATABASE IF EXISTS \`${DBS.bma}_new\``,
      )
      for (const u of Object.values(USERS)) await root.query(`DROP USER IF EXISTS '${u}'@'%'`)
      await root.end()
    }
  })

  for (const c of cases) {
    it(c.name, async () => {
      await root.query(reset(DBS.pma) + reset(DBS.bma))
      const pairs = withFields(c.form(), c.changes ?? {})
      const bPairs = pairs.map(([k, v]): [string, string] => [k, v.replaceAll(DBS.pma, DBS.bma)])
      const file = (db: string) => (typeof c.file === 'function' ? c.file(db) : c.file)
      const p = await pmaImport(pma, pairs, file(DBS.pma))
      const b = await bmaImport(bma, token, bPairs, file(DBS.bma))
      const norm = (m: string[]) => m.map((x) => x.replaceAll(DBS.bma, DBS.pma))
      expect(norm(b.messages)).toEqual(p)
      expect((await snapshot(DBS.bma)).replaceAll(DBS.bma, DBS.pma)).toBe(await snapshot(DBS.pma))
      const [news] = (await root.query(`SHOW DATABASES LIKE '${DBS.pma}_new'`)) as unknown as [unknown[]]
      if (news.length > 0) {
        expect((await snapshot(`${DBS.bma}_new`)).replaceAll(DBS.bma, DBS.pma)).toBe(
          await snapshot(`${DBS.pma}_new`),
        )
      }
    })
  }
})
