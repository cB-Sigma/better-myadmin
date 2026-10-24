import { gunzipSync } from 'node:zlib'
import { inspectPdf } from '@bettermyadmin/pdf'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * The micro-behaviours checklist of docs/features/07-export-import.md that the API answers: export
 * templates, the export page's lists and directives, the download headers, FULLTEXT keys in the
 * SQL dump, the relational schema files, and the import page's upload / resume fields. Each test
 * names the checklist ids it proves.
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const J = (r: { json: unknown }): Any => r.json
const DB = 'f07_ck'
const STORAGE = { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }
let root: mysql.Connection
const app = testApp(testConfig({ ExecTimeLimit: 300 }, STORAGE))
const custom = testApp(testConfig({ Export: { method: 'custom-no-form' }, UploadDir: '/tmp' }))
const clean = `DELETE FROM phpmyadmin.pma__export_templates WHERE username = 'root' AND template_name LIKE 'f07ck%';
  DELETE FROM phpmyadmin.pma__pdf_pages WHERE db_name = '${DB}';`

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE ft (id INT PRIMARY KEY, a TEXT, b TEXT, FULLTEXT KEY fa (a), FULLTEXT KEY fb (b)) ENGINE=InnoDB;
    INSERT INTO ft VALUES (1, 'x', 'y');
    CREATE TABLE other (id INT PRIMARY KEY);
    ${clean}`)
  await app.login()
  await custom.login()
})
afterAll(async () => {
  await root.query(`${clean} DROP DATABASE IF EXISTS ${DB}`)
  await root.end()
  await app.close()
  await custom.close()
})

const page = (a: typeof app, q: Record<string, string>) =>
  a.req('GET', `/api/servers/1/export/page?${new URLSearchParams(q)}`)

async function download(params: Array<[string, string]>) {
  const prep = await app.req('POST', '/api/servers/1/export', { params })
  const cookie = [...app.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await app.app.request(`/api/servers/1/export/${prep.json.id as string}`, {
    headers: { cookie },
  })
  return { prep, res, bytes: Buffer.from(await res.arrayBuffer()) }
}
const tableDump = (extra: Array<[string, string]> = []): Array<[string, string]> => [
  ['db', DB],
  ['table', 'ft'],
  ['export_type', 'table'],
  ['single_table', '1'],
  ['what', 'sql'],
  ['quick_or_custom', 'custom'],
  ['output_format', 'sendit'],
  ['filename_template', '@TABLE@'],
  ['compression', 'none'],
  ['sql_structure_or_data', 'structure_and_data'],
  ['sql_include_comments', 'y'],
  ['sql_insert_syntax', 'both'],
  ['sql_backquotes', 'y'],
  ['sql_create_table', 'y'],
  ...extra,
]

describe('export page', () => {
  it('templates: created per user and export type, unique names, loaded, updated and deleted [p07-15847a]', async () => {
    const create = (name: string, type = 'database') =>
      app.req('POST', '/api/servers/1/export/templates', {
        exportType: type,
        templateName: name,
        templateData: JSON.stringify({ what: 'csv', sql_drop_table: null }),
      })
    const r = J(await create('f07ck one'))
    expect(r.success).toBe(true)
    const one = r.templates.find((x: { name: string }) => x.name === 'f07ck one')
    expect(one).toBeDefined()
    expect(J(await create('f07ck one')).success).toBe(false)
    const t = J(await create('f07ck table', 'table'))
    expect(t.templates.map((x: { name: string }) => x.name)).not.toContain('f07ck one')
    const loaded = J(await app.req('GET', `/api/servers/1/export/templates/${one.id}`))
    expect(JSON.parse(loaded.data)).toEqual({ what: 'csv', sql_drop_table: null })
    expect(
      J(
        await app.req('POST', `/api/servers/1/export/templates/${one.id}`, {
          templateData: '{"what":"sql"}',
        }),
      ).success,
    ).toBe(true)
    expect(JSON.parse(J(await app.req('GET', `/api/servers/1/export/templates/${one.id}`)).data)).toEqual({
      what: 'sql',
    })
    expect(J(await app.req('POST', `/api/servers/1/export/templates/${one.id}/delete`)).success).toBe(true)
    const list = J(await page(app, { scope: 'database', db: DB })).templates.list
    expect(list.map((x: { name: string }) => x.name)).not.toContain('f07ck one')
  })

  it('formats sorted case-insensitively by their text; an unknown format falls back to sql [p07-d147db]', async () => {
    const r = J(await page(app, { scope: 'database', db: DB, what: 'nope' }))
    const texts = r.plugins.map((p: { text: string }) => p.text)
    expect(texts).toEqual(
      [...texts].sort((a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase())),
    )
    expect(r.selectedPlugin).toBe('sql')
  })

  it('Export/method custom-no-form: no Quick/Custom choice, custom [p07-6176b4]', async () => {
    const r = J(await page(custom, { scope: 'database', db: DB }))
    expect(r.exportMethod).toBe('custom-no-form')
  })

  it('the page carries ExecTimeLimit; /export/check-time-out answers success [p07-dba95e]', async () => {
    expect(J(await page(app, { scope: 'database', db: DB })).execTimeLimit).toBe(300)
    expect(J(await app.req('GET', '/api/servers/1/export/check-time-out'))).toEqual({ message: 'success' })
  })
})

describe('export file name template', () => {
  it('"Use this for future exports" keeps the template of that scope for the user [p07-b71369]', async () => {
    const before = J(await page(app, { scope: 'table', db: DB, table: 'ft' })).filenameTemplate
    await download(
      tableDump([
        ['remember_template', 'on'],
        ['filename_template', 'f07ck_@TABLE@'],
      ]).filter(
        (p, i, all) =>
          !(p[0] === 'filename_template' && all.findIndex((x) => x[0] === 'filename_template') === i),
      ),
    )
    expect(J(await page(app, { scope: 'table', db: DB, table: 'ft' })).filenameTemplate).toBe('f07ck_@TABLE@')
    // the database scope keeps its own
    expect(J(await page(app, { scope: 'database', db: DB })).filenameTemplate).not.toBe('f07ck_@TABLE@')
    await download(
      tableDump([
        ['remember_template', 'on'],
        ['filename_template', before],
      ]).filter(
        (p, i, all) =>
          !(p[0] === 'filename_template' && all.findIndex((x) => x[0] === 'filename_template') === i),
      ),
    )
  })
})

describe('export output', () => {
  it('each FULLTEXT key gets its own ALTER TABLE [p07-b70b31]', async () => {
    const { bytes } = await download(tableDump())
    const sql = bytes.toString('utf8')
    expect(sql).toContain(
      'ALTER TABLE `ft`\n  ADD PRIMARY KEY (`id`);\nALTER TABLE `ft` ADD FULLTEXT KEY `fa` (`a`);\nALTER TABLE `ft` ADD FULLTEXT KEY `fb` (`b`);',
    )
  })

  it('a gzip download is a gzip attachment without Content-Encoding (CompressOnFly applies to gzip only) [p07-cf608f p07-95720d]', async () => {
    const { res, bytes } = await download(tableDump().map(([k, v]) => [k, k === 'compression' ? 'gzip' : v]))
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('content-disposition')).toContain('ft.sql.gz')
    expect(bytes.subarray(0, 2).toString('hex')).toBe('1f8b')
    expect(gunzipSync(bytes).toString('utf8')).toContain('CREATE TABLE `ft`')
  })
})

describe('relational schema export', () => {
  const pos = [
    { x: '10', y: '20', v: true, h: true, db: DB, table: 'ft' },
    { x: '300', y: '40', v: true, h: true, db: DB, table: 'other' },
  ]
  const schema = (body: Record<string, unknown>) =>
    app.req('POST', `/api/servers/1/databases/${DB}/schema-export`, body)

  it('the dialog lists Dia, EPS, PDF and SVG with their options (PDF needs no TCPDF here) [p07-8281fd]', async () => {
    const r = J(await app.req('GET', `/api/servers/1/databases/${DB}/designer/export?page=-1&format=svg`))
    expect(r.plugins.map((p: { name: string }) => p.name)).toEqual(['dia', 'eps', 'pdf', 'svg'])
    for (const p of r.plugins) expect(p.options.length).toBeGreaterThan(0)
    expect(r.choice).toBe('svg')
    // $cfg['Schema']['format'] defaults to pdf, and its options to $cfg['Schema']['pdf_*']
    const d = J(await app.req('GET', `/api/servers/1/databases/${DB}/designer/export?page=-1`))
    expect(d.choice).toBe('pdf')
    const pdf = d.plugins.find((p: { name: string }) => p.name === 'pdf')
    expect(
      Object.fromEntries(
        pdf.options[0].items.map((i: { name: string; checked?: boolean; value?: string }) => [
          i.name,
          i.checked ?? i.value,
        ]),
      ),
    ).toEqual({
      pdf_show_color: true,
      pdf_show_keys: false,
      pdf_all_tables_same_width: false,
      pdf_orientation: 'L',
      pdf_paper: 'A4',
      pdf_show_grid: false,
      pdf_with_doc: true,
      pdf_table_order: '',
    })
  })

  it('the PDF schema with its data dictionary [p07-076972]', async () => {
    await root.query(`CREATE TABLE ${DB}.kid (id INT PRIMARY KEY, other_id INT COMMENT 'the other one',
      FOREIGN KEY (other_id) REFERENCES ${DB}.other (id) ON DELETE CASCADE) COMMENT 'kid table' ENGINE=InnoDB`)
    try {
      const r = J(
        await schema({
          page_number: '-1',
          export_type: 'pdf',
          offline_export: true,
          options: { pdf_with_doc: 'on', pdf_show_color: 'on', pdf_orientation: 'L', pdf_paper: 'A4' },
          tables: [...pos, { x: '100', y: '200', v: true, h: true, db: DB, table: 'kid' }],
        }),
      )
      expect(r).toMatchObject({ fileName: `${DB}.pdf`, mediaType: 'application/pdf', encoding: 'base64' })
      const bytes = Buffer.from(r.data, 'base64')
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      const pdf = await inspectPdf(bytes)
      // contents, ft, other, kid, the relational schema
      expect(pdf.pages).toHaveLength(5)
      expect(pdf.title).toBe(`Schema of the ${DB} database`)
      const [toc, , , kid, rt] = pdf.pages.map((p) => p.text) as [string, string, string, string, string]
      for (const s of ['1 ft', '2 other', '3 kid', '4 Relational schema']) expect(toc).toContain(s)
      expect(kid).toContain('PDF export page')
      expect(kid).toContain('Table comments: kid table')
      expect(kid).toContain('the other one')
      expect(kid).toContain('-> other.id')
      expect(kid).toContain('ON DELETE CASCADE')
      for (const s of [' ft', ' other', ' kid', ' other_id']) expect(rt.split('\n')).toContain(s)
      expect(pdf.outline).toContain('kid')
      expect(pdf.outline).toContain('Relational schema')
    } finally {
      await root.query(`DROP TABLE ${DB}.kid`)
    }
  })

  it('the file is named after the database, or after the saved page [p07-164735]', async () => {
    const off = J(await schema({ page_number: '-1', export_type: 'svg', offline_export: true, tables: pos }))
    expect(off.fileName).toBe(`${DB}.svg`)
    await root.query(
      `INSERT INTO phpmyadmin.pma__pdf_pages (db_name, page_descr) VALUES ('${DB}', 'f07ck page')`,
    )
    const [rows] = await root.query(`SELECT page_nr FROM phpmyadmin.pma__pdf_pages WHERE db_name = '${DB}'`)
    const nr = String((rows as Array<{ page_nr: number }>)[0]?.page_nr)
    const saved = J(await schema({ page_number: nr, export_type: 'svg', offline_export: false, tables: pos }))
    // Sanitize::sanitizeFilename: the space becomes "_"
    expect(saved.fileName).toBe('f07ck_page.svg')
  })

  it('the tables and their places come from the posted canvas state [p07-a8542e]', async () => {
    const one = J(
      await schema({ page_number: '-1', export_type: 'svg', offline_export: true, tables: pos.slice(0, 1) }),
    )
    expect(one.data).toContain('ft')
    expect(one.data).not.toContain('>other<')
  })
})

describe('PDF export', () => {
  it('a table as a PDF report: structure and data', async () => {
    const { res, bytes } = await download([
      ...tableDump().filter(([k]) => k !== 'what' && !k.startsWith('sql_')),
      ['what', 'pdf'],
      ['pdf_report_title', 'FT report'],
      ['pdf_structure_or_data', 'structure_and_data'],
    ])
    expect(res.headers.get('content-type')).toContain('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('ft.pdf')
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const pdf = await inspectPdf(bytes)
    expect(pdf.pages).toHaveLength(2)
    const [structure, data] = pdf.pages.map((p) => p.text) as [string, string]
    expect(structure).toContain('FT report')
    expect(structure).toContain(`Database: ${DB},  Table: ft,  Purpose: Table structure`)
    expect(data).toContain(`Database: ${DB},  Table: ft,  Purpose: Dumping data`)
    // the column titles twice (TCPDF's header draws them, then again over the grey band), the id;
    // the TEXT cells would print "[BLOB]", but their columns are narrower than its widest glyph
    expect(data.split('\n').slice(2, 9)).toEqual(['id', 'a', 'b', 'id', 'a', 'b', '1'])
    expect(data).toContain('Page number: 2/2')
  })
})

describe('import page', () => {
  const imp = (a: typeof app, q: string) => a.req('GET', `/api/servers/1/import/page?${q}`)

  it('"Browse your computer" shows the maximal upload size [p07-e0cbaa]', async () => {
    expect(J(await imp(app, `scope=database&db=${DB}`)).maxUploadSize).toMatch(
      /^\(Max: \d+(\.\d+)?[KMG]iB\)$/,
    )
  })

  it('both upload tabs only with uploads and an UploadDir [p07-f1893a]', async () => {
    expect(J(await imp(app, `scope=database&db=${DB}`))).toMatchObject({ isUpload: true, uploadDir: '' })
    const withDir = J(await imp(custom, `scope=database&db=${DB}`))
    expect(withDir.isUpload).toBe(true)
    expect(withDir.uploadDir).not.toBe('')
  })

  it('resuming after a timeout: offset, skipped queries, the local file and allow-interrupt carried over [p07-5a8804 p07-ca9144 p07-89e7c9]', async () => {
    const r = J(
      await imp(
        custom,
        `scope=database&db=${DB}&timeout_passed=1&offset=1234&skip=7&local_import_file=x.sql&allow_interrupt=yes`,
      ),
    )
    expect(r).toMatchObject({ timeoutPassed: true, offset: 1234, allowInterrupt: true })
    expect(J(await imp(app, `scope=database&db=${DB}`))).toMatchObject({ timeoutPassed: false, offset: null })
  })
})
