import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type SchemaRequest, type SchemaTableData, exportSchema, getStringWidth } from '../src/index.ts'

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

  it('SVG (no relation drawn: the referencing table has no internal relation)', () => {
    const r = exportSchema('svg', request({ svg_show_table_dimension: 'on' }), data)
    expect(r.data).toBe(fixture('svg'))
    expect(r.fileName).toBe('f05d_probe.svg')
  })

  it('EPS', () => {
    const r = exportSchema('eps', request({ eps_orientation: 'L', eps_show_table_dimension: 'on' }), data)
    expect(r.data).toBe(fixture('eps'))
  })

  it('Dia (only keys, portrait)', () => {
    const r = exportSchema(
      'dia',
      request({ dia_orientation: 'P', dia_paper: 'A4', dia_show_keys: 'on' }),
      data,
    )
    expect(r.data).toBe(fixture('dia'))
  })
})
