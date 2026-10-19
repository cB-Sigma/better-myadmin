import { writeFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { convertToUtf8 } from '../../packages/export/src/charset.ts'
import {
  type Pairs,
  ROOT,
  bmaDump,
  comparable,
  compareOpenDocument,
  createAccounts,
  maskExportHost,
  normaliseFormat,
  normaliseText,
  pmaDump,
  pmaExportForm,
  seedDatabase,
  withFields,
} from './lib/export.ts'
import { PmaClient } from './lib/pma.ts'
import { PMA_STORAGE, PMA_URL, pmaReachable } from './lib/server-setup.ts'

/**
 * Every option of every export format, at server, database and table level, against phpMyAdmin
 * (docs/features/07-export-import.md). Each case starts from phpMyAdmin's scraped form (so its
 * defaults) and changes one option: a checkbox ticked or unticked, a text set, each radio or
 * select value; the dumps must be byte-identical once the tool/version/time lines are removed
 * (OpenDocument: entry by entry). The general options (output charset, compression, one file per
 * table, file name template, rows of a table) are crossed with a few formats. The SQL format's
 * options are in export-sql.parity.test.ts; its remaining compatibility modes are here.
 *
 * phpMyAdmin's ODS / ODT export dies on rows of `types` (a TIME it cannot strtotime(), a NULL
 * geometry), so those formats leave the `types` data out, as export-formats.parity.test.ts does.
 */
const DB = 'f07_opt'
const SMALL = `${DB}_s`
const USERS = { pma: 'f07_opma', bma: 'f07_obma' }

let root: mysql.Connection
let pma: PmaClient
let bma: ReturnType<typeof testApp>
const forms: Record<'server' | 'database' | 'table' | 'tableChild', Pairs> = {
  server: [],
  database: [],
  table: [],
  tableChild: [],
}

type Changes = Record<string, string | string[] | null>
type Opt =
  | { name: string; kind: 'checkbox' }
  | { name: string; kind: 'text'; value: string }
  | { name: string; kind: 'choice'; values: string[] }
  /** an option the table-level form does not have */
  | { name: string; kind: 'checkbox' | 'text'; value?: string; dbOnly: true }

const cb = (name: string): Opt => ({ name, kind: 'checkbox' })
const text = (name: string, value: string): Opt => ({ name, kind: 'text', value })
const choice = (name: string, values: string[]): Opt => ({ name, kind: 'choice', values })
const SOD = (f: string) => choice(`${f}_structure_or_data`, ['structure', 'data', 'structure_and_data'])

const FORMATS: Record<string, { opts: Opt[]; odf?: true; noServer?: true; noTable?: true }> = {
  csv: {
    opts: [
      text('csv_separator', '|'),
      text('csv_enclosed', '~'),
      text('csv_escaped', '^'),
      text('csv_terminated', '\\n\\r'),
      text('csv_null', 'NIL'),
      cb('csv_removeCRLF'),
      cb('csv_columns'),
    ],
  },
  excel: {
    opts: [
      text('excel_null', 'NIL'),
      cb('excel_removeCRLF'),
      cb('excel_columns'),
      choice('excel_edition', ['win', 'mac_excel2003', 'mac_excel2008']),
    ],
  },
  json: { opts: [cb('json_pretty_print'), cb('json_unicode')] },
  latex: {
    opts: [
      cb('latex_caption'),
      SOD('latex'),
      { name: 'latex_structure_caption', kind: 'text', value: 'S __TABLE__ x', dbOnly: true },
      { name: 'latex_structure_continued_caption', kind: 'text', value: 'S cont __TABLE__', dbOnly: true },
      { name: 'latex_structure_label', kind: 'text', value: 'tab:s-__TABLE__', dbOnly: true },
      { name: 'latex_comments', kind: 'checkbox', dbOnly: true },
      cb('latex_columns'),
      text('latex_data_caption', 'D __TABLE__ x'),
      text('latex_data_continued_caption', 'D cont __TABLE__'),
      text('latex_data_label', 'tab:d-__TABLE__'),
      text('latex_null', 'NUL'),
    ],
  },
  mediawiki: { opts: [SOD('mediawiki'), cb('mediawiki_caption'), cb('mediawiki_headers')] },
  htmlword: { opts: [SOD('htmlword'), text('htmlword_null', 'NIL'), cb('htmlword_columns')] },
  ods: { opts: [text('ods_null', 'NIL'), cb('ods_columns')], odf: true },
  odt: {
    opts: [
      SOD('odt'),
      { name: 'odt_comments', kind: 'checkbox', dbOnly: true },
      cb('odt_columns'),
      text('odt_null', 'NIL'),
    ],
    odf: true,
  },
  phparray: { opts: [] },
  texytext: { opts: [SOD('texytext'), cb('texytext_columns'), text('texytext_null', 'NIL')] },
  toon: { opts: [text('toon_separator', '|'), text('toon_indent', '4')] },
  xml: {
    opts: [
      cb('xml_export_events'),
      cb('xml_export_functions'),
      cb('xml_export_procedures'),
      cb('xml_export_tables'),
      cb('xml_export_triggers'),
      cb('xml_export_views'),
      cb('xml_export_contents'),
    ],
    noServer: true,
  },
  yaml: { opts: [] },
  codegen: { opts: [choice('codegen_format', ['0', '1'])] },
}

/** the changes of one option: a checkbox ticked and unticked, a text set, every choice */
function variants(o: Opt): Array<[string, Changes]> {
  if (o.kind === 'checkbox')
    return [
      [`${o.name} on`, { [o.name]: 'y' }],
      [`${o.name} off`, { [o.name]: null }],
    ]
  if (!('values' in o)) return [[`${o.name}=${o.value ?? ''}`, { [o.name]: o.value ?? '' }]]
  return o.values.map((v) => [`${o.name}=${v}`, { [o.name]: v }])
}

/** the tables an OpenDocument case exports (phpMyAdmin dies on the `types` data) */
const ODF_DB: Changes = {
  'table_select[]': ['child', 'empty_t', 'many', 'v_types', 'we`ird name'],
  'table_structure[]': ['child', 'empty_t', 'many', 'types', 'v_types', 'we`ird name'],
  'table_data[]': ['child', 'empty_t', 'many', 'v_types', 'we`ird name'],
}

interface Case {
  name: string
  form: () => Pairs
  changes: Changes
  odf: boolean
}
const cases: Case[] = []
const custom = (what: string, more: Changes = {}): Changes => ({ what, quick_or_custom: 'custom', ...more })

for (const [what, f] of Object.entries(FORMATS)) {
  const odf = f.odf === true
  const dbBase = odf ? ODF_DB : {}
  const tableForm = () => (odf ? forms.tableChild : forms.table)
  cases.push({
    name: `${what} database defaults`,
    form: () => forms.database,
    changes: custom(what, dbBase),
    odf,
  })
  if (f.noTable !== true)
    cases.push({ name: `${what} table defaults`, form: tableForm, changes: custom(what), odf })
  if (f.noServer !== true)
    cases.push({
      name: `${what} server defaults`,
      form: () => forms.server,
      changes: custom(what, { 'db_select[]': [SMALL] }),
      odf,
    })
  for (const o of f.opts) {
    for (const level of ['database', 'table'] as const) {
      if (level === 'table' && 'dbOnly' in o) continue
      const form = level === 'database' ? () => forms.database : tableForm
      for (const [label, change] of variants(o)) {
        cases.push({
          name: `${what} ${level} ${label}`,
          form,
          changes: custom(what, { ...(level === 'database' ? dbBase : {}), ...change }),
          odf,
        })
      }
    }
  }
}

// SQL compatibility modes export-sql.parity.test.ts does not cover
for (const mode of ['DB2', 'MAXDB', 'MYSQL323', 'ORACLE']) {
  cases.push({
    name: `sql database sql_compatibility=${mode}`,
    form: () => forms.database,
    changes: { quick_or_custom: 'custom', sql_compatibility: mode },
    odf: false,
  })
}

// general options crossed with formats
for (const charset of ['iso-8859-1', 'windows-1251', 'utf-16', 'SJIS-win', 'euc-jp', 'utf-7']) {
  for (const what of ['csv', 'json']) {
    cases.push({
      name: `${what} database charset=${charset}`,
      form: () => forms.database,
      changes: custom(what, { charset }),
      odf: false,
    })
  }
}
for (const what of ['csv', 'xml', 'latex', 'htmlword', 'yaml']) {
  for (const compression of ['zip', 'gzip']) {
    cases.push({
      name: `${what} database compression=${compression}`,
      form: () => forms.database,
      changes: custom(what, { compression }),
      odf: false,
    })
  }
}
for (const what of ['csv', 'json', 'mediawiki', 'sql']) {
  cases.push({
    name: `${what} database one file per table (zip)`,
    form: () => forms.database,
    changes: custom(what, { compression: 'zip', as_separate_files: 'database' }),
    odf: false,
  })
}
for (const what of ['csv', 'excel', 'json', 'xml', 'texytext', 'htmlword', 'latex', 'mediawiki', 'yaml']) {
  cases.push({
    name: `${what} table rows 1..2 (limit_from / limit_to)`,
    form: () => forms.table,
    changes: custom(what, { allrows: '0', limit_from: '1', limit_to: '2' }),
    odf: false,
  })
}
for (const [level, tpl] of [
  ['database', '@DATABASE@-@SERVER@-x'],
  ['table', '@TABLE@_%Y'],
  ['server', 'srv-@SERVER@'],
] as const) {
  cases.push({
    name: `csv ${level} filename_template=${tpl}`,
    form: () => forms[level],
    changes: custom('csv', {
      filename_template: tpl,
      ...(level === 'server' ? { 'db_select[]': [SMALL] } : {}),
    }),
    odf: false,
  })
}

describe.skipIf(!pmaReachable)('export options parity', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    await createAccounts(root, [USERS.pma, USERS.bma])
    await seedDatabase(root, DB)
    await root.query(`DROP DATABASE IF EXISTS \`${SMALL}\`; CREATE DATABASE \`${SMALL}\`;
      CREATE TABLE \`${SMALL}\`.many LIKE \`${DB}\`.many; INSERT INTO \`${SMALL}\`.many SELECT * FROM \`${DB}\`.many WHERE n < 6;
      CREATE TABLE \`${SMALL}\`.empty_t LIKE \`${DB}\`.empty_t;`)
    pma = new PmaClient(PMA_URL)
    await pma.login(USERS.pma, USERS.pma)
    bma = testApp(testConfig({}, PMA_STORAGE))
    await bma.login(USERS.bma, USERS.bma)
    forms.server = await pmaExportForm(pma, 'server')
    forms.database = await pmaExportForm(pma, 'database', { db: DB })
    forms.table = await pmaExportForm(pma, 'table', { db: DB, table: 'types', single_table: 'true' })
    forms.tableChild = await pmaExportForm(pma, 'table', { db: DB, table: 'child', single_table: 'true' })
  }, 60000)

  afterAll(async () => {
    await bma?.close()
    if (root !== undefined) {
      await root.query(`DROP DATABASE IF EXISTS \`${DB}\`; DROP DATABASE IF EXISTS \`${SMALL}\``)
      for (const u of Object.values(USERS)) await root.query(`DROP USER IF EXISTS '${u}'@'%'`)
      await root.end()
    }
  })

  for (const c of cases) {
    it(c.name, async () => {
      const pairs = withFields(c.form(), c.changes)
      const p = await pmaDump(pma, pairs)
      const b = await bmaDump(bma, pairs)
      expect(b.status).toBe(p.status)
      // the filename and the dump "Host:" header carry the env-determined server host/port
      expect(maskExportHost(b.filename)).toBe(maskExportHost(p.filename))
      expect(b.contentType).toBe(p.contentType.split(';')[0])
      // a UTF-16 dump is compared as text (the version strings are normalised in the decoded text)
      const text = (d: typeof p) =>
        c.name.includes('utf-16') && c.name.startsWith('json')
          ? normaliseFormat(normaliseText(d.body.toString('utf16le')))
          : c.name.includes('utf-7') && c.name.startsWith('json')
            ? // the decoded text (the tool strings differ in length; csv compares the bytes)
              normaliseFormat(normaliseText(convertToUtf8(d.body, 'utf-7').toString('utf8')))
            : normaliseFormat(comparable(d))
      const pt = maskExportHost(c.odf ? compareOpenDocument(p) : text(p))
      const bt = maskExportHost(c.odf ? compareOpenDocument(b) : text(b))
      if (process.env.F07_DUMP !== undefined && pt !== bt) {
        const n = c.name.replace(/[^a-z0-9]+/gi, '_')
        writeFileSync(`${process.env.F07_DUMP}/${n}.pma`, pt)
        writeFileSync(`${process.env.F07_DUMP}/${n}.bma`, bt)
      }
      expect(bt).toBe(pt)
    })
  }
})
