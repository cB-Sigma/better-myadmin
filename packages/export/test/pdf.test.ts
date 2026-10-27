import { englishTranslator } from '@bettermyadmin/i18n'
import { MysqlType, createFieldMetadata } from '@bettermyadmin/mysql-types'
import { Tcpdf, inspectPdf } from '@bettermyadmin/pdf'
import { describe, expect, it, vi } from 'vitest'
import {
  type ExportField,
  type ExportPdf,
  type ExportResult,
  Params,
  type PluginContext,
  createPlugin,
  encodeBytes,
} from '../src/index.ts'

/**
 * The PDF export (ExportPdf + Helpers/Pdf on the TCPDF port) against an in-memory database: the
 * document is a PDF, its pages carry phpMyAdmin's header lines, the column titles and the cells
 * (Unicode text included), long tables continue on further pages.
 */
const field = (name: string, type: number, binary = false): ExportField => ({
  ...createFieldMetadata({
    name,
    orgName: name,
    table: 't',
    orgTable: 't',
    type,
    flags: binary ? 128 : 0,
    charsetNr: binary ? 63 : 255,
    length: 10,
  }),
  type,
  db: 'shop',
})

const TABLES: Record<string, { fields: ExportField[]; rows: Array<Array<string | null>> }> = {
  customers: {
    fields: [
      field('id', MysqlType.LONG),
      field('name', MysqlType.VAR_STRING),
      field('photo', MysqlType.BLOB, true),
    ],
    rows: [
      ['1', 'Иван Петров', 'xx'],
      ['2', 'Ελένη', null],
      ['3', null, null],
    ],
  },
  orders: {
    fields: [field('order_id', MysqlType.LONG), field('note', MysqlType.VAR_STRING)],
    rows: Array.from({ length: 400 }, (_, i) => [String(i + 1), `order note number ${i + 1}`]),
  },
}

function context(): { ctx: PluginContext; output: () => Buffer } {
  const chunks: string[] = []
  const select = async (sql: string): Promise<ExportResult> => {
    const name = /`(\w+)`$/.exec(sql)?.[1] ?? ''
    const t = TABLES[name]
    if (t === undefined) throw new Error(`unexpected query ${sql}`)
    return {
      fields: t.fields,
      rows: (async function* () {
        yield* t.rows
      })(),
    }
  }
  const ctx = {
    dbi: {
      select,
      selectDb: async () => true,
      getError: () => '',
    },
    out: { addLine: async (s: string) => void chunks.push(s) },
    relation: {
      relationFeature: false,
      browserTransformationFeature: false,
      getForeignersInternal: async () => ({}),
      getForeignKeysData: async () => [],
      getMime: async () => null,
    },
    tables: {
      getColumns: async () => [
        { field: 'id', type: 'int(11)', isNull: false, default: null, extra: 'auto_increment', comment: '' },
        { field: 'name', type: 'varchar(50)', isNull: true, default: null, extra: '', comment: 'full name' },
      ],
      getComments: async () => ({ name: 'full name' }),
      getTriggers: async () => [],
    },
    tr: englishTranslator(),
    exportType: 'database',
    singleTable: false,
    settings: {},
    tool: { name: 'BetterMyAdmin', version: '1.0.0', url: '', runtime: '', runtimeLabel: '' },
    db: 'shop',
    table: '',
    timeZone: 'UTC',
    now: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
  } as unknown as PluginContext
  return { ctx, output: () => encodeBytes(chunks.join('')) }
}

async function dump(params: Array<[string, string]>, run: (p: ExportPdf) => Promise<void>) {
  const { ctx, output } = context()
  const plugin = createPlugin('pdf', ctx) as ExportPdf
  plugin.setExportOptions(new Params(params), {})
  await run(plugin)
  await plugin.exportFooter()
  const bytes = output()
  const pdf = await inspectPdf(bytes)
  return { bytes, pdf, pages: pdf.pages.map((p) => p.text), count: pdf.pages.length }
}

describe('ExportPdf', () => {
  it('declares phpMyAdmin’s options', () => {
    const plugin = createPlugin('pdf', context().ctx) as ExportPdf
    expect(plugin.properties).toMatchObject({
      text: 'PDF',
      extension: 'pdf',
      mimeType: 'application/pdf',
      forceFile: true,
    })
    expect(plugin.properties.options?.map((g) => [g.name, g.items.map((i) => i.name)])).toEqual([
      ['pdf_general_opts', ['pdf_report_title']],
      ['pdf_dump_what', ['pdf_structure_or_data']],
    ])
  })

  it('writes the structure and data of a table as a PDF report', async () => {
    const r = await dump(
      [
        ['pdf_report_title', 'Shop report'],
        ['pdf_structure_or_data', 'structure_and_data'],
      ],
      async (p) => {
        await p.exportStructure('shop', 'customers', 'create_table')
        await p.exportData('shop', 'customers', 'SELECT * FROM `shop`.`customers`')
      },
    )
    expect(r.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(r.count).toBe(2)
    const [structure, data] = r.pages as [string, string]
    expect(structure).toContain('Shop report')
    expect(structure).toContain('Database: shop,  Table: customers,  Purpose: Table structure')
    for (const s of ['Column', 'Type', 'Null', 'Default', 'Comments', 'id', 'int(11)', 'varchar(50)'])
      expect(structure.split('\n')).toContain(s)
    expect(structure).toContain('Page number: 1/2')
    expect(data).toContain('Database: shop,  Table: customers,  Purpose: Dumping data')
    // Unicode cells, NULL, the binary BLOB column hidden
    for (const s of ['Иван Петров', 'Ελένη', 'NULL', 'name']) expect(data).toContain(s)
    expect(data).not.toContain('photo')
    expect(data).not.toContain('[BLOB]')
    expect(data).toContain('Page number: 2/2')
    expect(r.pdf.author).toBe('BetterMyAdmin 1.0.0')
    // A3 landscape, in points
    const { width, height } = r.pdf.pages[0] as { width: number; height: number }
    expect([Math.round(width), Math.round(height)]).toEqual([1191, 842])
  })

  it('the structure table: the comments under their title, without relations too (upstream acbb64ea40)', async () => {
    const cells: string[] = []
    const spy = vi.spyOn(Tcpdf.prototype, 'multiCell').mockImplementation(function (
      this: Tcpdf,
      _w,
      _h,
      txt,
    ) {
      cells.push(txt)
    })
    try {
      await dump([['pdf_structure_or_data', 'structure']], (p) =>
        p.exportStructure('shop', 'customers', 'create_table'),
      )
    } finally {
      spy.mockRestore()
    }
    // pma PdfTest::testGetTableDef: the last cells are the row's Column, Type, Null, Default, Comments
    expect(cells.slice(-5)).toEqual(['name', 'varchar(50)', 'Yes', 'NULL', 'full name'])
    expect(cells).toContain('Comments')
  })

  it('continues a long table on further pages, each with the header and column titles', async () => {
    const r = await dump([['pdf_structure_or_data', 'data']], (p) =>
      p.exportData('shop', 'orders', 'SELECT * FROM `shop`.`orders`'),
    )
    expect(r.count).toBeGreaterThan(2)
    expect(r.count).toBeLessThan(20)
    for (const page of r.pages) {
      expect(page).toContain('Database: shop,  Table: orders,  Purpose: Dumping data')
      expect(page.split('\n')).toContain('order_id')
    }
    const all = r.pages.join('\n')
    for (const n of [1, 200, 400]) expect(all).toContain(`order note number ${n}`)
    expect(r.pages.at(-1)).toContain(`Page number: ${r.count}/${r.count}`)
  })

  it('an export without tables is one page', async () => {
    const r = await dump([], async () => undefined)
    expect(r.count).toBe(1)
  })
})
