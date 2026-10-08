import { createFieldMetadata } from '@bettermyadmin/mysql-types'
import { describe, expect, it } from 'vitest'
import { type CellValue, getUniqueCondition, isWhereClauseNumeric } from '../src/index.ts'
import { type Bytes, asText, cell, loadFixture } from './fixtures.ts'

type FieldSpec = [string, string, string, string, number, number?, number?, number?]

interface UniqueCase {
  label: string
  fields: FieldSpec[]
  row: (Bytes | null)[]
  forceUnique: boolean
  restrictToTable: string
  expressions: [string | null, string | null, boolean?][]
  views: string[]
  expected: { whereClause: Bytes; isClauseUnique: boolean; conditionArray: [Bytes, Bytes][] }
}

const { cases } = loadFixture<{ cases: UniqueCase[] }>('unique-condition.json')

const toFields = (specs: FieldSpec[]) =>
  specs.map(([name, orgName, table, orgTable, type, flags, charsetNr, length]) =>
    createFieldMetadata({
      name,
      orgName,
      table,
      orgTable,
      type,
      flags: flags ?? 0,
      charsetNr: charsetNr ?? 33,
      length: length ?? 0,
    }),
  )

function run(c: UniqueCase, row: CellValue[]) {
  return getUniqueCondition(toFields(c.fields), row, {
    forceUnique: c.forceUnique,
    restrictToTable: c.restrictToTable,
    expressions: c.expressions.map(([alias, column, isCase]) => ({
      alias,
      column,
      isCaseExpression: isCase === true,
    })),
    isView: (t) => c.views.includes(t),
  })
}

const expectedOf = (c: UniqueCase) => ({
  condition: asText(c.expected.whereClause),
  isClauseUnique: c.expected.isClauseUnique,
  conditionArray: c.expected.conditionArray.map(([k, v]) => [asText(k), asText(v)]),
})

describe('getUniqueCondition (golden, executed phpMyAdmin UniqueCondition)', () => {
  it('has the PHPUnit cases and a large generated matrix', () => {
    expect(cases.filter((c) => c.label.startsWith('phpunit')).length).toBe(12)
    expect(cases.length).toBeGreaterThan(1000)
  })

  const groups = new Map<string, UniqueCase[]>()
  for (const c of cases) {
    const key = c.label.startsWith('single ') ? c.label.split(' ').slice(0, 2).join(' ') : c.label
    groups.set(key, [...(groups.get(key) ?? []), c])
  }

  for (const [name, list] of groups) {
    it(name, () => {
      for (const c of list) {
        // a BIT value given as raw bytes means the mysql2 bit bytes, not mysqli's decimal text
        if (c.fields.some((f) => f[4] === 16) && c.row.some((v) => v !== null && typeof v === 'object'))
          continue
        expect(run(c, c.row.map(cell)), c.label).toEqual(expectedOf(c))
      }
    })
  }

  it('gives the same result when non-BIT values arrive as raw bytes', () => {
    for (const c of cases) {
      if (c.fields.some((f) => f[4] === 16) && c.row.some((v) => v !== null && typeof v === 'object'))
        continue
      const fields = toFields(c.fields)
      const row = c.row.map((v, i) => {
        const value = cell(v)
        if (typeof value === 'string' && fields[i]?.mappedType !== 'bit')
          return new TextEncoder().encode(value)
        return value
      })
      expect(run(c, row), c.label).toEqual(expectedOf(c))
    }
  })
})

describe('getUniqueCondition extras', () => {
  it('BIT values from mysql2 (raw bytes) match the mysqli decimal text', () => {
    const fields = [
      createFieldMetadata({
        name: 'b',
        orgName: 'b',
        table: 't',
        orgTable: 't',
        type: 16,
        flags: 0,
        charsetNr: 63,
        length: 12,
      }),
    ]
    expect(getUniqueCondition(fields, [Uint8Array.from([0x0a, 0x01])]).condition).toBe(
      "`t`.`b` = b'101000000001'",
    )
    expect(getUniqueCondition(fields, ['2561']).condition).toBe("`t`.`b` = b'101000000001'")
  })

  it('isWhereClauseNumeric', () => {
    expect(isWhereClauseNumeric('`t`.`id` = 12')).toBe(true)
    expect(isWhereClauseNumeric(["`t`.`n` = 'a'", ' `t`.`id` = 3'])).toBe(true)
    expect(isWhereClauseNumeric('`t`.`id` = -1')).toBe(false)
    expect(isWhereClauseNumeric(null)).toBe(false)
  })
})
