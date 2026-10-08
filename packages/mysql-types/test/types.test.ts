import { describe, expect, it } from 'vitest'
import {
  displayOfOperator,
  getEnumOperators,
  getFloatTypes,
  getIntegerRange,
  getIntegerTypes,
  getNumberOperators,
  getTextOperators,
  getTypeClass,
  getTypeDescription,
  getTypeDescriptionMsgid,
  getTypeOperators,
  getTypeOperatorsHtml,
  getUUIDOperators,
  isUnaryOperator,
  mapAliasToMysqlType,
} from '../src/index.ts'
import { loadFixture } from './fixtures.ts'

interface TypesFixture {
  descriptions: Record<string, string>
  classes: Record<string, string>
  operators: [string, boolean, string[]][]
  unary: Record<string, boolean>
  displayOfOperator: Record<string, string>
  integerTypes: string[]
  floatTypes: string[]
  integerRanges: [string, boolean, [string, string]][]
  aliases: Record<string, string>
  operatorsHtml: [string, boolean, string | null, string][]
}

const f = loadFixture<TypesFixture>('types.json')

describe('Types (golden, executed phpMyAdmin)', () => {
  it('getTypeDescription', () => {
    for (const [type, desc] of Object.entries(f.descriptions)) {
      expect(getTypeDescription(type), type).toBe(desc)
    }
  })

  it('getTypeClass', () => {
    for (const [type, cls] of Object.entries(f.classes)) {
      expect(getTypeClass(type), type).toBe(cls)
    }
  })

  it('getTypeOperators', () => {
    for (const [type, nullable, ops] of f.operators) {
      expect(getTypeOperators(type, nullable), `${type} ${nullable}`).toEqual(ops)
    }
  })

  it('getTypeOperatorsHtml', () => {
    for (const [type, nullable, selected, html] of f.operatorsHtml) {
      expect(getTypeOperatorsHtml(type, nullable, selected)).toBe(html)
    }
  })

  it('isUnaryOperator / displayOfOperator', () => {
    for (const [op, unary] of Object.entries(f.unary)) expect(isUnaryOperator(op), op).toBe(unary)
    for (const [op, d] of Object.entries(f.displayOfOperator)) expect(displayOfOperator(op), op).toBe(d)
  })

  it('integer / float types and ranges', () => {
    expect(getIntegerTypes()).toEqual(f.integerTypes)
    expect(getFloatTypes()).toEqual(f.floatTypes)
    for (const [type, signed, range] of f.integerRanges) {
      expect(getIntegerRange(type, signed), `${type} ${signed}`).toEqual(range)
    }
  })

  it('mapAliasToMysqlType', () => {
    for (const [alias, type] of Object.entries(f.aliases))
      expect(mapAliasToMysqlType(alias), alias).toBe(type)
  })
})

describe('Types extras', () => {
  it('exposes the operator families', () => {
    expect(getTextOperators()).toContain('REGEXP ^...$')
    expect(getNumberOperators()).toContain('>=')
    expect(getEnumOperators()).toEqual(['=', '!='])
    expect(getUUIDOperators()).not.toContain('>')
  })

  it('translates descriptions through the msgid hook', () => {
    expect(getTypeDescriptionMsgid('date')).toBe('A date, supported range is %1$s to %2$s')
    expect(getTypeDescription('DATE', (m) => m.replace('A date', 'Ein Datum'))).toBe(
      'Ein Datum, supported range is 1000-01-01 to 9999-12-31',
    )
    expect(displayOfOperator("= ''", (m) => (m === 'empty' ? 'leer' : m))).toBe("= '' (leer)")
  })
})
