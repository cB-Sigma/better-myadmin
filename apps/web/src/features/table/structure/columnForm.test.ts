import { describe, expect, it } from 'vitest'
import {
  type ColumnRow,
  checkTableEditForm,
  emptyRow,
  formatEnumValues,
  indexesFromRows,
  parseEnumValues,
} from './ColumnForm'

/** The column definition form's client logic (docs/features/04-table-level.md › Column form). */
const row = (p: Partial<ColumnRow>): ColumnRow => ({ ...emptyRow(), ...p })

describe('checkTableEditForm (functions.ts)', () => {
  it('requires a length for CHAR/VARCHAR/BIT/BINARY/VARBINARY and refuses UNSIGNED on other types [p04-f66062]', () => {
    for (const type of ['CHAR', 'VARCHAR', 'BIT', 'BINARY', 'VARBINARY']) {
      expect(checkTableEditForm([row({ name: 'a', type, length: '' })], 'add', 't'), type).toBe(
        'Please enter a valid length!',
      )
      expect(checkTableEditForm([row({ name: 'a', type, length: '8' })], 'add', 't'), type).toBeNull()
    }
    // a row without a name is skipped
    expect(checkTableEditForm([row({ name: 'a' }), row({ type: 'VARCHAR' })], 'add', 't')).toBeNull()
    expect(
      checkTableEditForm(
        [row({ name: 'a', type: 'VARCHAR', length: '5', attribute: 'UNSIGNED' })],
        'add',
        't',
      ),
    ).toBe('VARCHAR does not support the UNSIGNED attribute.')
    expect(
      checkTableEditForm([row({ name: 'a', type: 'TEXT', attribute: 'UNSIGNED ZEROFILL' })], 'add', 't'),
    ).toBe('TEXT does not support the UNSIGNED attribute.')
    expect(
      checkTableEditForm([row({ name: 'a', type: 'BIGINT', attribute: 'UNSIGNED' })], 'add', 't'),
    ).toBeNull()
  })

  it('needs at least one column name, and a table name when creating [p04-4dc9ab]', () => {
    expect(checkTableEditForm([row({}), row({ name: '  ' })], 'add', 't')).toBe('Missing value in the form!')
    expect(checkTableEditForm([row({ name: 'id' })], 'create', '')).toBe('Missing value in the form!')
    expect(checkTableEditForm([row({ name: 'id' })], 'create', 'items')).toBeNull()
    expect(checkTableEditForm([row({ name: 'id' })], 'add', '')).toBeNull()
  })
})

describe('the ENUM/SET editor (onloadEnumSetEditor)', () => {
  it("reads and writes the value list, escaping quotes and backslashes as 'a','b' [p04-9b95d9]", () => {
    expect(parseEnumValues("'a','b\\'c','d''e','f\\\\g'")).toEqual(['a', "b'c", "d'e", 'f\\g'])
    expect(formatEnumValues(['a', "b'c", '', 'f\\g'])).toBe("'a','b''c','f\\\\g'")
    expect(parseEnumValues(formatEnumValues(['x, y', "it's"]))).toEqual(['x, y', "it's"])
  })
})

describe('the Index selects of the create / add forms', () => {
  it('PRIMARY always composes one key; the other choices make single-column indexes [p04-7f5bf8]', () => {
    const rows = [
      row({ name: 'a', key: 'primary' }),
      row({ name: 'b', key: 'unique' }),
      row({ name: 'c', key: 'primary' }),
      row({ name: '', key: 'index' }),
      row({ name: 'd', key: 'index' }),
    ]
    expect(indexesFromRows(rows)).toEqual([
      {
        choice: 'PRIMARY',
        keyName: 'PRIMARY',
        columns: [
          { colIndex: 0, size: '' },
          { colIndex: 2, size: '' },
        ],
      },
      { choice: 'UNIQUE', keyName: '', columns: [{ colIndex: 1, size: '' }] },
      { choice: 'INDEX', keyName: '', columns: [{ colIndex: 4, size: '' }] },
    ])
  })
})
