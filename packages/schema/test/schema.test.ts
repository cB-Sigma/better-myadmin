import { readFileSync } from 'node:fs'
import { inspectPdf } from '@bettermyadmin/pdf'
import { describe, expect, it } from 'vitest'
import {
  type SchemaRequest,
  type SchemaTableData,
  type SchemaTableDoc,
  exportSchema,
  getStringWidth,
  schemaPlugins,
} from '../src/index.ts'

/**
 * The plugins against files the reference phpMyAdmin exported for the same tables and
 * positions (parent, child with a FOREIGN KEY to parent, Wide_Table_Name).
 */
const fixture = (ext: string) => readFileSync(new URL(`./fixtures/probe.${ext}`, import.meta.url), 'utf8')

const data = new Map<string, SchemaTableData>([
  [
    'parent',
    {
      name: 'parent',
      columns: ['id', 'name'],
      indexColumns: ['id', 'name'],
      primary: ['id'],
      displayField: '',
      internal: [],
      foreignKeys: [],
    },
  ],
  [
    'child',
    {
      name: 'child',
      columns: ['id', 'parent_id', 'note_text'],
      indexColumns: ['id', 'parent_id'],
      primary: ['id'],
      displayField: '',
      internal: [],
      foreignKeys: [{ refTableName: 'parent', indexList: ['parent_id'], refIndexList: ['id'] }],
    },
  ],
  [
    'Wide_Table_Name',
    {
      name: 'Wide_Table_Name',
      columns: ['x'],
      indexColumns: [],
      primary: [],
      displayField: '',
      internal: [],
      foreignKeys: [],
    },
  ],
])

const request = (options: Record<string, string>): SchemaRequest => ({
  db: 'f05d_probe',
  pageNumber: -1,
  tables: ['parent', 'child', 'Wide_Table_Name'],
  coordinates: [
    { db: 'f05d_probe', table: 'parent', x: 20, y: 30 },
    { db: 'f05d_probe', table: 'child', x: 300, y: 120.5 },
    { db: 'f05d_probe', table: 'Wide_Table_Name', x: 50, y: 250 },
  ],
  options,
  fileBase: 'f05d_probe',
  creator: 'phpMyAdmin 6.0.0-dev',
  date: '11 October 2026, 7:19 pm',
  titleFormat: 'Schema of the %s database - Page %s',
})

describe('relational schema export', () => {
  it('Font::getStringWidth', () => {
    // p a e n .56, r .34, t .28: 2.86 × 16 = 45.76
    expect(getStringWidth('parent', 'Arial', 16)).toBe(46)
    expect(getStringWidth('  ', 'Arial', 16)).toBe(9)
    // '_' is one of "all other characters" (0.3); times: × .92
    expect(getStringWidth('a_b', 'times', 10)).toBe(Math.ceil((0.56 + 0.56 + 0.3) * 10 * 0.92))
  })

  it('SVG (no relation drawn: the referencing table has no internal relation)', async () => {
    const r = await exportSchema('svg', request({ svg_show_table_dimension: 'on' }), data)
    expect(r.data).toBe(fixture('svg'))
    expect(r.fileName).toBe('f05d_probe.svg')
  })

  it('EPS', async () => {
    const r = await exportSchema(
      'eps',
      request({ eps_orientation: 'L', eps_show_table_dimension: 'on' }),
      data,
    )
    expect(r.data).toBe(fixture('eps'))
  })

  it('Dia (only keys, portrait)', async () => {
    const r = await exportSchema(
      'dia',
      request({ dia_orientation: 'P', dia_paper: 'A4', dia_show_keys: 'on' }),
      data,
    )
    expect(r.data).toBe(fixture('dia'))
  })
})

/** the data dictionary of a table (what the server collects for pdf_with_doc) */
const doc = (columns: string[], foreigners: SchemaTableDoc['foreigners'] = {}): SchemaTableDoc => ({
  columns: columns.map((field) => ({
    field,
    printType: field === 'id' ? 'int(11)' : 'varchar(20)',
    attribute: ' ',
    isNull: field !== 'id',
    default: null,
    extra: field === 'id' ? 'auto_increment' : '',
  })),
  comments: { id: 'the key' },
  mime: null,
  comment: 'a table comment',
  createTime: 'Oct 11, 2026 at 07:19 PM',
  updateTime: '',
  checkTime: '',
  foreigners,
})

const pdfOf = async (options: Record<string, string>, withDoc = false) => {
  const d = new Map([...data].map(([k, v]) => [k, { ...v }]))
  if (withDoc) {
    for (const [k, v] of d) v.doc = doc(v.columns)
    ;(d.get('child') as SchemaTableData).doc = doc(['id', 'parent_id', 'note_text'], {
      parent_id: {
        db: 'f05d_probe',
        table: 'parent',
        field: 'id',
        onUpdate: 'RESTRICT',
        onDelete: 'CASCADE',
      },
    })
  }
  const r = await exportSchema(
    'pdf',
    { ...request(options), localisedDate: 'Oct 11, 2026 at 07:19 PM', now: new Date(0) },
    d,
  )
  expect(r).toMatchObject({ fileName: 'f05d_probe.pdf', mediaType: 'application/pdf', encoding: 'base64' })
  const bytes = Buffer.from(r.data, 'base64')
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  return inspectPdf(bytes)
}

describe('PDF relational schema', () => {
  it('the plugin is listed between EPS and SVG with phpMyAdmin’s options', () => {
    const plugins = schemaPlugins((m) => m, ['A3', 'A4'])
    expect(plugins.map((p) => p.name)).toEqual(['dia', 'eps', 'pdf', 'svg'])
    expect(plugins[2]?.options.map((o) => o.name)).toEqual([
      'pdf_show_color',
      'pdf_show_keys',
      'pdf_all_tables_same_width',
      'pdf_orientation',
      'pdf_paper',
      'pdf_show_grid',
      'pdf_with_doc',
      'pdf_table_order',
    ])
  })

  it('one page with the tables and their columns', async () => {
    const pdf = await pdfOf({
      pdf_orientation: 'L',
      pdf_paper: 'A4',
      pdf_show_color: 'on',
      pdf_show_grid: 'on',
    })
    expect(pdf.pages).toHaveLength(1)
    expect(pdf.title).toBe('Schema of the f05d_probe database')
    const page = pdf.pages[0] as { width: number; height: number; text: string }
    // A4 landscape
    expect([Math.round(page.width), Math.round(page.height)]).toEqual([842, 595])
    const lines = page.text.split('\n')
    for (const s of [
      ' parent',
      ' child',
      ' Wide_Table_Name',
      ' id',
      ' name',
      ' parent_id',
      ' note_text',
      ' x',
    ])
      expect(lines).toContain(s)
    // grid labels in the designer's coordinates
    expect(lines).toContain('20')
    // no data dictionary: no header nor footer
    expect(page.text).not.toContain('Page number:')
  })

  it('only keys, portrait A5', async () => {
    const pdf = await pdfOf({ pdf_orientation: 'P', pdf_paper: 'A5', pdf_show_keys: 'on' })
    const page = pdf.pages[0] as { width: number; height: number; text: string }
    expect([Math.round(page.width), Math.round(page.height)]).toEqual([420, 595])
    expect(page.text.split('\n')).not.toContain(' note_text')
    expect(page.text.split('\n')).toContain(' parent_id')
  })

  it('the data dictionary: contents, a page per table, bookmarks and links [p07-076972]', async () => {
    const pdf = await pdfOf(
      { pdf_orientation: 'L', pdf_paper: 'A4', pdf_with_doc: 'on', pdf_table_order: 'name_asc' },
      true,
    )
    // contents, Wide_Table_Name, child, parent (byte order), the schema
    expect(pdf.pages).toHaveLength(5)
    const [toc, wide, child] = pdf.pages.map((p) => p.text) as [string, string, string]
    expect(toc).toContain('Table of contents')
    for (const s of ['1 Wide_Table_Name', '2 child', '3 parent', '4 Relational schema'])
      expect(toc).toContain(s)
    // the page-number aliases are resolved
    for (const n of [2, 3, 4, 5]) expect(toc).toContain(`Page number: ${n}`)
    expect(toc).not.toContain('{0')
    expect(wide).toContain('1 Wide_Table_Name')
    expect(child).toContain('Table comments: a table comment')
    expect(child).toContain('Creation: Oct 11, 2026 at 07:19 PM')
    for (const s of ['Column', 'Attributes', 'Links to', 'MIME', 'parent_id', 'the key', 'auto_increment'])
      expect(child).toContain(s)
    expect(child).toContain('-> parent.id')
    expect(child).toContain('ON DELETE CASCADE')
    expect(child).toContain('PDF export page')
    expect(child).toContain('Page number: 3/5')
    expect(pdf.pages[4]?.text).toContain(' parent_id')
    expect(pdf.outline).toEqual([
      'Wide_Table_Name',
      '  x',
      'child',
      '  id',
      '  parent_id',
      '  note_text',
      'parent',
      '  id',
      '  name',
      'Relational schema',
    ])
    // contents → table pages, dictionary rows → schema boxes, schema boxes → dictionary rows
    expect(pdf.pages[0]?.links).toBeGreaterThanOrEqual(8)
    expect(pdf.pages[2]?.links).toBeGreaterThanOrEqual(4)
    expect(pdf.pages[4]?.links).toBeGreaterThanOrEqual(9)
  })
})
