import { describe, expect, it } from 'vitest'
import { columnNameTitle } from './ColumnForm'

/** columns_definitions/column_name.twig: the name input's title (change form before MySQL 5.6.6). */
describe('columnNameTitle', () => {
  const status = { isEditable: false, isReferenced: false, isForeignKey: false, references: [] as string[] }

  it('"Column" without a status, or for a free column', () => {
    expect(columnNameTitle(undefined)).toBe('Column')
    expect(columnNameTitle({ ...status, isEditable: true })).toBe('Column')
  })

  it('who references the column, then that it is a foreign key, one per line', () => {
    expect(columnNameTitle({ ...status, isReferenced: true, references: ['`d`.`a`', '`d`.`b`'] })).toBe(
      'Referenced by `d`.`a`,`d`.`b`.',
    )
    expect(columnNameTitle({ ...status, isForeignKey: true })).toBe('Is a foreign key.')
    expect(
      columnNameTitle({ ...status, isReferenced: true, isForeignKey: true, references: ['`d`.`a`'] }),
    ).toBe('Referenced by `d`.`a`.\nIs a foreign key.')
  })
})
