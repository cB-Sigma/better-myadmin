import { describe, expect, it } from 'vitest'
import {
  type ColumnSpec,
  addMicroseconds,
  bitBytesToDecimalString,
  convertBitDefaultValue,
  extractColumnSpec,
  getCharsetQueryPart,
  parseEnumSetValues,
  php,
  printableBitValue,
  typeAcceptsLength,
  typeTakesCollation,
  unQuote,
  unquoteDefaultValue,
} from '../src/index.ts'
import { loadFixture } from './fixtures.ts'

interface UtilFixture {
  strGetCsv: [string, (string | null)[]][]
  extractColumnSpec: Record<string, ColumnSpec>
  extractColumnSpecLimitChars: { limitChars: number; cases: Record<string, ColumnSpec> }
  parseEnumSetValues: [string, string[], string[]][]
  printableBitValue: [string, number, string][]
  convertBitDefaultValue: [string | null, string][]
  unQuote: [string, string | null, string][]
  unquoteDefaultValue: [string, string][]
  getCharsetQueryPart: [string, boolean, string][]
  addMicroseconds: [string, string][]
}

const f = loadFixture<UtilFixture>('util.json')

describe('Util (golden, executed phpMyAdmin)', () => {
  it('str_getcsv emulation', () => {
    for (const [line, expected] of f.strGetCsv) {
      expect(php.strGetCsv(line, ',', "'", '\\'), JSON.stringify(line)).toEqual(expected)
    }
  })

  it('extractColumnSpec', () => {
    for (const [spec, expected] of Object.entries(f.extractColumnSpec)) {
      expect(extractColumnSpec(spec), spec).toEqual(expected)
    }
    const { limitChars, cases } = f.extractColumnSpecLimitChars
    for (const [spec, expected] of Object.entries(cases)) {
      expect(extractColumnSpec(spec, limitChars), spec).toEqual(expected)
    }
  })

  it('parseEnumSetValues', () => {
    for (const [def, raw, escaped] of f.parseEnumSetValues) {
      expect(parseEnumSetValues(def, false), def).toEqual(raw)
      expect(parseEnumSetValues(def, true), def).toEqual(escaped)
    }
  })

  it('printableBitValue', () => {
    for (const [value, length, expected] of f.printableBitValue) {
      expect(printableBitValue(BigInt(value), length), `${value}/${length}`).toBe(expected)
    }
  })

  it('convertBitDefaultValue', () => {
    for (const [value, expected] of f.convertBitDefaultValue) {
      expect(convertBitDefaultValue(value), String(value)).toBe(expected)
    }
  })

  it('unQuote / unquoteDefaultValue', () => {
    for (const [value, quote, expected] of f.unQuote) {
      expect(unQuote(value, quote), `${value} ${quote}`).toBe(expected)
    }
    for (const [value, expected] of f.unquoteDefaultValue) {
      expect(unquoteDefaultValue(value), value).toBe(expected)
    }
  })

  it('getCharsetQueryPart / addMicroseconds', () => {
    for (const [collation, override, expected] of f.getCharsetQueryPart) {
      expect(getCharsetQueryPart(collation, override)).toBe(expected)
    }
    for (const [value, expected] of f.addMicroseconds) {
      expect(addMicroseconds(value), value).toBe(expected)
    }
  })
})

describe('Util extras', () => {
  it('BIT bytes from mysql2 become the decimal text mysqli returns', () => {
    expect(bitBytesToDecimalString(new Uint8Array([0x0a, 0x01]))).toBe('2561')
    expect(printableBitValue(bitBytesToDecimalString(new Uint8Array([0x05])), 4)).toBe('0101')
    // PHP (int) saturates: BIT(64) with the top bit set prints as PHP_INT_MAX
    expect(printableBitValue(bitBytesToDecimalString(new Uint8Array(8).fill(0xff)), 64)).toBe(
      '0'.padEnd(64, '1'),
    )
  })

  it('length / collation rules of the column form', () => {
    const mysql8 = { vendor: 'mysql', version: 80400 } as const
    expect(typeAcceptsLength('INT', '11', mysql8)).toBe(false)
    expect(typeAcceptsLength('TINYINT', '1', mysql8)).toBe(true)
    expect(typeAcceptsLength('VARCHAR', '20', mysql8)).toBe(true)
    expect(typeAcceptsLength('TEXT', '20', mysql8)).toBe(false)
    expect(typeAcceptsLength('INT', '11', { vendor: 'mariadb', version: 110400 })).toBe(true)
    expect(typeTakesCollation('enum')).toBe(true)
    expect(typeTakesCollation('BLOB')).toBe(false)
  })

  it('mb_strlen emulation counts ill-formed UTF-8 like PHP 8.3', () => {
    const cases: [string, number][] = [
      ['c080', 2],
      ['eda080', 3],
      ['f4908080', 4],
      ['e282', 1],
      ['808080', 3],
      ['c327', 2],
      ['f09f9880', 1],
      ['ffc3a9', 2],
    ]
    for (const [hex, n] of cases) {
      expect(php.mbStrlen(Uint8Array.from(Buffer.from(hex, 'hex'))), hex).toBe(n)
    }
  })
})
