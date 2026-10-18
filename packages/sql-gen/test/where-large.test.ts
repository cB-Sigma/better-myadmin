import { createFieldMetadata } from '@bettermyadmin/mysql-types'
import { describe, expect, it } from 'vitest'
import { getUniqueCondition } from '../src/index.ts'

/**
 * UniqueCondition on a browse page of large values (docs/architecture/17-large-data.md): the same
 * clause as phpMyAdmin's, without building the condition of the long columns a key makes unused.
 */
const PRI = 2
const NOT_NULL = 1
const BLOB = 16
const BINARY = 128
const field = (orgName: string, type: number, flags: number, charsetNr = 33) =>
  createFieldMetadata({
    name: orgName,
    orgName,
    table: 't',
    orgTable: 't',
    type,
    flags,
    charsetNr,
    length: 0,
  })
const id = (pk: boolean) => field('id', 3, NOT_NULL | (pk ? PRI : 0), 63)
const blob = field('b', 252, BLOB | BINARY, 63)
const text = field('t', 252, BLOB, 255)
const bytes = (n: number, v = 0x61) => new Uint8Array(n).fill(v)

describe('getUniqueCondition with large values', () => {
  it('a primary key: only the key, whatever the other columns hold', () => {
    const uc = getUniqueCondition([id(true), blob, text], ['7', bytes(1 << 20), 'x'.repeat(500_000)])
    expect(uc).toEqual({
      condition: '`t`.`id` = 7',
      isClauseUnique: true,
      conditionArray: [['`t`.`id`', '= 7']],
    })
  })

  it('no key: every column, a BLOB of 1000 characters or more left out (one of 999 hexified)', () => {
    const euro = (n: number) => new TextEncoder().encode('€'.repeat(n))
    const long = getUniqueCondition([id(false), blob, text], ['7', euro(1000), 'abc'])
    expect(long.condition).toBe("`t`.`id` = 7 AND `t`.`t` = 'abc'")
    expect(long.isClauseUnique).toBe(false)
    const short = getUniqueCondition([id(false), blob, text], ['7', euro(999), 'abc'])
    expect(short.condition).toBe(
      `\`t\`.\`id\` = 7 AND \`t\`.\`b\` = CAST(0x${'e282ac'.repeat(999)} AS BINARY) AND \`t\`.\`t\` = 'abc'`,
    )
    const huge = getUniqueCondition([id(false), blob, text], ['7', bytes(1 << 20), 'abc'])
    expect(huge.conditionArray.map(([k]) => k)).toEqual(['`t`.`id`', '`t`.`t`'])
  })

  it('the only field a long BLOB: its exact length (CHAR_LENGTH)', () => {
    const uc = getUniqueCondition([blob], [bytes(1 << 20)])
    expect(uc.condition).toBe(`CHAR_LENGTH(\`t\`.\`b\`)  = ${1 << 20}`)
  })
})
