import { englishTranslator } from '@bettermyadmin/i18n'
import { collationDescription } from '@bettermyadmin/mysql-types'
import { describe, expect, it } from 'vitest'
import { StatusData, calculateValues, cleanDeprecated } from '../../src/server-admin/status-data.ts'
import { formatStatusValue, queryName } from '../../src/server-admin/status.ts'
import { setVariableValue } from '../../src/server-admin/variables.ts'
import fixture from './fixtures/server-admin.json' with { type: 'json' }

/** Golden fixtures from scripts/gen-server-admin-fixtures.php (phpMyAdmin code executed by PHP). */
const tr = englishTranslator()

describe('Collation::buildDescription [p06-b19775]', () => {
  for (const [name, description] of Object.entries(fixture.collations)) {
    it(name, () => expect(collationDescription(name, tr)).toBe(description))
  }
})

describe('query statistics names (mb_convert_case MB_CASE_TITLE)', () => {
  for (const [key, title] of Object.entries(fixture.titles)) {
    it(key, () => expect(queryName(key)).toBe(title))
  }
})

describe('Server\\Status\\Data', () => {
  it('cleanDeprecated, calculateValues, sortVariables [p06-3399cc]', () => {
    const status = new Map<string, string | number>(Object.entries(fixture.status.input))
    cleanDeprecated(status)
    calculateValues(status, fixture.status.variables)
    const expected = Object.entries(fixture.status.calculated).map(([k, v]) => [
      k,
      typeof v === 'object' ? (v as { float: number }).float : v,
    ])
    expect([...status].map(([k, v]) => [k, typeof v === 'number' ? v : v])).toEqual(
      expected.map(([k, v]) => [k, typeof v === 'number' ? v : v]),
    )
    const d = new StatusData()
    d.status = status
    d.sortVariables()
    d.usedQueries.delete('Com_admin_commands')
    expect(Object.fromEntries(d.allocationMap)).toEqual(fixture.status.allocationMap)
    expect([...d.sectionUsed]).toEqual(fixture.status.sectionUsed)
    expect([...d.usedQueries.keys()]).toEqual(fixture.status.usedQueries)
  })
})

describe('status variable formatting (status/variables/index.twig)', () => {
  it('formats per name and value [p06-fa0c8f]', () => {
    expect(formatStatusValue(tr, 'Key_read_ratio_%', 7)).toEqual({ text: '7.00 %' })
    expect(formatStatusValue(tr, 'Uptime', '3725')).toEqual({
      text: '0 days, 1 hours, 2 minutes and 5 seconds',
    })
    expect(formatStatusValue(tr, 'Uptime_since_flush_status', '61')).toEqual({
      text: '0 days, 0 hours, 1 minutes and 1 seconds',
    })
    expect(formatStatusValue(tr, 'Bytes_sent', '1234567')).toEqual({ text: '1.2 M', title: '1,234,567' })
    expect(formatStatusValue(tr, 'Threads_running', '7')).toEqual({ text: '7' })
    expect(formatStatusValue(tr, 'Ssl_cipher', 'TLS_AES_128')).toEqual({ text: 'TLS_AES_128' })
  })
})

describe('SET GLOBAL values (SetVariableController)', () => {
  it('parses units for byte variables [p06-d139b2]', () => {
    expect(setVariableValue('byte', '1.5 MB')).toBe('1572864')
    expect(setVariableValue('byte', '2gib')).toBe('2147483648')
    expect(setVariableValue('byte', ' 16 KiB ')).toBe('16384')
    expect(setVariableValue('byte', '0.1kb')).toBe('102.4')
    // no unit: quoted
    expect(setVariableValue('byte', '1024')).toBe("'1024'")
  })
  it('casts integers like (int)', () => {
    expect(setVariableValue('integer', '1e3')).toBe('1000')
    expect(setVariableValue('integer', '12.9')).toBe('12')
    expect(setVariableValue('integer', 'abc')).toBe('0')
    expect(setVariableValue('integer', ' 42x')).toBe('42')
    expect(setVariableValue('integer', '-7')).toBe('-7')
    expect(setVariableValue('integer', '99999999999999999999')).toBe('9223372036854775807')
  })
  it('quotes anything else', () => {
    expect(setVariableValue('string', "a'b")).toBe("'a\\'b'")
    expect(setVariableValue(null, 'ON')).toBe("'ON'")
  })
})
