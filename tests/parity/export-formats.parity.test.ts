import { writeFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { readZip } from '../../packages/export/src/zip.ts'
import {
  type Dump,
  type Pairs,
  ROOT,
  bmaDump,
  comparable,
  createAccounts,
  pmaDump,
  pmaExportForm,
  seedDatabase,
  withFields,
} from './lib/export.ts'
import { PmaClient } from './lib/pma.ts'

/**
 * Golden parity of the non-SQL export plugins (docs/features/07-export-import.md): the same
 * scraped form, switched to each format and its options, is posted to phpMyAdmin and to
 * BetterMyAdmin. Text formats are compared byte for byte once tool/version/time lines are removed;
 * OpenDocument files are compared entry by entry after extraction (meta.xml carries the creation
 * time and the generator, so only its shape is compared).
 */
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
const DB = 'f07_fmt'
const USERS = { pma: 'f07_fpma', bma: 'f07_fbma' }

const reachable = await fetch(`${PMA_URL}/index.php`)
  .then((r) => r.ok)
  .catch(() => false)

let root: mysql.Connection
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let bmaStorage: ReturnType<typeof testApp>
let dbForm: Pairs
let tableForm: Pairs
let rowsForm: Pairs

type Changes = Record<string, string | string[] | null>
const custom = (what: string, more: Changes = {}): Changes => ({ what, quick_or_custom: 'custom', ...more })

/** Version / tool strings that differ by design (the JSON header, PHP array doc comment, …). */
function normaliseFormat(s: string): string {
  return s
    .replace(/("version":\s*)"[^"]*"(,\s*"comment":\s*"Export to JSON plugin for )[^"]*"/, '$1"V"$2TOOL"')
    .replace(/^ \* Export to PHP Array plugin for .*$/m, ' * Export to PHP Array plugin for TOOL')
    .replace(/^ \* @version .*$/m, ' * @version V')
}

function compareOpenDocument(d: Dump): string {
  return readZip(d.body)
    .map((e) => {
      let text = e.data.toString('utf8')
      if (e.name === 'meta.xml') text = text.replace(/<office:meta>.*<\/office:meta>/, '<office:meta/>')
      return `== ${e.name}\n${text}`
    })
    .join('\n')
}

const cases: Array<{ name: string; form: () => Pairs; changes: Changes; odf?: true }> = [
  { name: 'csv defaults', form: () => dbForm, changes: custom('csv') },
  {
    name: 'csv options',
    form: () => dbForm,
    changes: custom('csv', {
      csv_separator: ';',
      csv_enclosed: "'",
      csv_escaped: '\\',
      csv_terminated: '\\r\\n',
      csv_null: 'NIL',
      csv_removeCRLF: 'y',
      csv_columns: 'y',
    }),
  },
  {
    name: 'csv table, AUTO terminator, no enclosure',
    form: () => tableForm,
    changes: custom('csv', { csv_enclosed: '', csv_terminated: 'AUTO' }),
  },
  { name: 'excel defaults', form: () => dbForm, changes: custom('excel') },
  {
    name: 'excel mac, columns',
    form: () => tableForm,
    changes: custom('excel', { excel_edition: 'mac_excel2008', excel_columns: 'y', excel_removeCRLF: 'y' }),
  },
  { name: 'json defaults', form: () => dbForm, changes: custom('json') },
  {
    name: 'json pretty unicode',
    form: () => tableForm,
    changes: custom('json', { json_pretty_print: 'y', json_unicode: 'y' }),
  },
  { name: 'json raw query', form: () => rowsForm, changes: custom('json') },
  { name: 'xml defaults', form: () => dbForm, changes: custom('xml') },
  {
    name: 'xml structure only',
    form: () => dbForm,
    changes: custom('xml', { xml_export_contents: null }),
  },
  { name: 'xml table', form: () => tableForm, changes: custom('xml') },
  { name: 'yaml', form: () => dbForm, changes: custom('yaml') },
  { name: 'latex defaults', form: () => dbForm, changes: custom('latex') },
  {
    name: 'latex options',
    form: () => tableForm,
    changes: custom('latex', {
      latex_caption: null,
      latex_structure_or_data: 'structure',
      latex_comments: 'y',
      latex_structure_label: 'tab:__TABLE__-s',
    }),
  },
  {
    name: 'latex data, no column names',
    form: () => tableForm,
    changes: custom('latex', { latex_structure_or_data: 'data', latex_columns: null, latex_null: 'NUL' }),
  },
  { name: 'mediawiki defaults', form: () => dbForm, changes: custom('mediawiki') },
  {
    name: 'mediawiki caption + headers',
    form: () => tableForm,
    changes: custom('mediawiki', { mediawiki_caption: 'y', mediawiki_headers: 'y' }),
  },
  {
    name: 'mediawiki structure',
    form: () => tableForm,
    changes: custom('mediawiki', { mediawiki_structure_or_data: 'structure' }),
  },
  { name: 'php array', form: () => dbForm, changes: custom('phparray') },
  { name: 'texy defaults', form: () => dbForm, changes: custom('texytext') },
  {
    name: 'texy data, columns',
    form: () => tableForm,
    changes: custom('texytext', {
      texytext_structure_or_data: 'data',
      texytext_columns: 'y',
      texytext_null: 'nil',
    }),
  },
  { name: 'htmlword defaults', form: () => dbForm, changes: custom('htmlword') },
  {
    name: 'htmlword columns',
    form: () => tableForm,
    changes: custom('htmlword', { htmlword_columns: 'y', htmlword_null: 'x' }),
  },
  { name: 'codegen C#', form: () => tableForm, changes: custom('codegen') },
  { name: 'codegen XML', form: () => dbForm, changes: custom('codegen', { codegen_format: '1' }) },
  { name: 'toon', form: () => dbForm, changes: custom('toon') },
  // phpMyAdmin's ODS export dies with a TypeError on a TIME it cannot strtotime() ('-838:59:59',
  // '838:59:59': rows 1 and 4 of `types`) and on a NULL geometry (bin2hex(null)), so the ODS
  // cases leave those cells out (BetterMyAdmin writes PT00H00M00S and 0x there)
  {
    name: 'ods defaults',
    form: () => dbForm,
    changes: custom('ods', { 'table_select[]': ['child', 'empty_t', 'many', 'v_types', 'we`ird name'] }),
    odf: true,
  },
  {
    name: 'ods columns, null, every type',
    form: () => rowsForm,
    changes: custom('ods', {
      ods_columns: 'y',
      ods_null: 'nil',
      sql_query:
        'SELECT id, ti, si, mi, bi, zf, `dec`, fl, dbl, bt, bo, d, dt, ts, tm, yr, ch, vc, bn, vb, tt, tx, mt, lt, tb, bl, mb, lb, en, st, js FROM types WHERE id IN (2, 3)',
    }),
    odf: true,
  },
  {
    name: 'ods geometry',
    form: () => rowsForm,
    changes: custom('ods', { sql_query: 'SELECT id, geo, pt, ls, pg FROM types WHERE id = 1' }),
    odf: true,
  },
  // ODT shares the NULL geometry TypeError: `types` data goes through a query without geometry
  {
    name: 'odt defaults',
    form: () => dbForm,
    changes: custom('odt', {
      'table_select[]': ['child', 'empty_t', 'many', 'types', 'v_types', 'we`ird name'],
      'table_data[]': ['child', 'empty_t', 'many', 'v_types', 'we`ird name'],
    }),
    odf: true,
  },
  {
    name: 'odt structure, comments',
    form: () => tableForm,
    changes: custom('odt', { odt_structure_or_data: 'structure', odt_comments: 'y' }),
    odf: true,
  },
  {
    name: 'odt columns, null, every type',
    form: () => rowsForm,
    changes: custom('odt', {
      odt_columns: 'y',
      odt_null: 'nil',
      sql_query:
        'SELECT id, ti, si, mi, bi, zf, `dec`, fl, dbl, bt, bo, d, dt, ts, tm, yr, ch, vc, bn, vb, tt, tx, mt, lt, tb, bl, mb, lb, en, st, js FROM types',
    }),
    odf: true,
  },
]

describe.skipIf(!reachable)('export formats parity', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    await createAccounts(root, [USERS.pma, USERS.bma])
    await seedDatabase(root, DB)
    pma = new PmaClient(PMA_URL)
    await pma.login(USERS.pma, USERS.pma)
    bma = testApp(testConfig({}))
    await bma.login(USERS.bma, USERS.bma)
    bmaStorage = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }))
    await bmaStorage.login(USERS.bma, USERS.bma)
    dbForm = await pmaExportForm(pma, 'database', { db: DB })
    tableForm = await pmaExportForm(pma, 'table', { db: DB, table: 'types', single_table: 'true' })
    rowsForm = withFields(tableForm, {
      export_type: 'raw',
      table: '',
      single_table: null,
      raw_query: 'true',
      sql_query: 'SELECT id, vc, dt FROM types WHERE id < 3',
    })
  }, 60000)

  afterAll(async () => {
    await bma?.close()
    await bmaStorage?.close()
    if (root !== undefined) {
      await root.query(`DROP DATABASE IF EXISTS \`${DB}\``)
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
      expect(b.filename).toBe(p.filename)
      // PHP appends its default_charset to text/* types; the dump itself may be in another charset
      expect(b.contentType).toBe(p.contentType.split(';')[0])
      if (process.env.F07_DUMP !== undefined) {
        writeFileSync(
          `${process.env.F07_DUMP}/pma.out`,
          c.odf === true ? compareOpenDocument(p) : normaliseFormat(comparable(p)),
        )
        writeFileSync(
          `${process.env.F07_DUMP}/bma.out`,
          c.odf === true ? compareOpenDocument(b) : normaliseFormat(comparable(b)),
        )
      }
      if (c.odf === true) expect(compareOpenDocument(b)).toBe(compareOpenDocument(p))
      else expect(normaliseFormat(comparable(b))).toBe(normaliseFormat(comparable(p)))
    })
  }

  it('relations and media types (htmlword, odt, latex)', async () => {
    for (const what of ['htmlword', 'odt', 'latex']) {
      const pairs = withFields(
        tableForm,
        custom(what, {
          [`${what}_structure_or_data`]: 'structure',
          [`${what}_relation`]: 'y',
          [`${what}_mime`]: 'y',
          [`${what}_comments`]: 'y',
        }),
      )
      const p = await pmaDump(pma, pairs)
      const b = await bmaDump(bmaStorage, pairs)
      if (what === 'odt') expect(compareOpenDocument(b)).toBe(compareOpenDocument(p))
      else expect(normaliseFormat(comparable(b))).toBe(normaliseFormat(comparable(p)))
    }
  })
})
