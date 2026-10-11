import { describe, expect, it } from 'vitest'
import {
  Params,
  convertFromUtf8,
  createZip,
  decodeBytes,
  encodeBytes,
  hexBytes,
  mbStrlen,
  mergeAliases,
  readZip,
  sanitizeFilename,
} from '../src/index.ts'

describe('byte-preserving strings', () => {
  it('round-trips invalid UTF-8', () => {
    const raw = Buffer.from([0x61, 0xff, 0xc3, 0xa9, 0x00, 0xe2, 0x82])
    const s = decodeBytes(raw)
    expect(encodeBytes(s).equals(raw)).toBe(true)
    expect(hexBytes(s)).toBe('61ffc3a900e282')
    expect(mbStrlen(s)).toBe(6)
  })
  it('keeps astral characters', () => {
    const raw = Buffer.from('a😀b', 'utf8')
    expect(encodeBytes(decodeBytes(raw)).equals(raw)).toBe(true)
  })
})

describe('Sanitize::sanitizeFilename', () => {
  it('keeps letters, digits, dash and underscore', () => {
    expect(sanitizeFilename('127.0.0.1 db/ü-x_y', true)).toBe('127_0_0_1_db_ü-x_y')
    expect(sanitizeFilename('a.b c')).toBe('a.b_c')
  })
})

describe('Params', () => {
  it('reads scalars, lists and nested aliases', () => {
    const p = new Params([
      ['what', 'sql'],
      ['table_select[]', 'a'],
      ['table_select[]', 'b'],
      ['aliases[db][alias]', 'x'],
      ['aliases[db][tables][t][columns][c]', 'y'],
    ])
    expect(p.get('what')).toBe('sql')
    expect(p.list('table_select')).toEqual(['a', 'b'])
    expect(p.has('aliases')).toBe(true)
    expect(p.tree('aliases')).toEqual({ db: { alias: 'x', tables: { t: { columns: { c: 'y' } } } } })
  })
})

describe('Export::mergeAliases', () => {
  it('prefers the second non-empty value', () => {
    expect(
      mergeAliases(
        { db: { alias: 'a', tables: { t: { alias: 'x' } } } },
        { db: { alias: '', tables: { t: { alias: 'y' } } } },
      ),
    ).toEqual({ db: { alias: 'a', tables: { t: { alias: 'y' } } } })
  })
})

describe('ZipExtension::createFile', () => {
  it('names separate entries after the dump file', () => {
    const zip = createZip(
      new Map([
        ['table_a', Buffer.from('A')],
        ['table_b', Buffer.from('B')],
      ]),
      'db.sql',
    )
    expect(readZip(zip).map((e) => [e.name, e.data.toString()])).toEqual([
      ['db_table_a.sql', 'A'],
      ['db_table_b.sql', 'B'],
    ])
  })
})

describe('charset conversion', () => {
  it('transliterates like iconv //TRANSLIT', () => {
    expect(convertFromUtf8(Buffer.from('é 😀 ✓', 'utf8'), 'windows-1252')).toEqual(
      Buffer.from([0xe9, 0x20, 0x3a, 0x2d, 0x44, 0x20, 0x3f]),
    )
  })
})
