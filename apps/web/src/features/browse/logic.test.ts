import { describe, expect, it } from 'vitest'
import {
  clauseOf,
  headerLayout,
  isValidHex,
  rewriteCondition,
  rowMatchesFilter,
  rowsOptions,
  truncateForDisplay,
  validRowNumbers,
} from './logic'

const parts = {
  editLink: true,
  deleteLink: 'delete' as const,
  sortLink: true,
  navigation: true,
  bookmarkForm: true,
  textButton: true,
  printLink: true,
}

describe('results grid logic', () => {
  it('header layout per RowActionLinks (getFieldVisibilityParams / getColumnAtRightSide) [p02-31ba46]', () => {
    expect(headerLayout(parts, 'left')).toMatchObject({
      before: 'toggle',
      after: 'empty-td',
      colspan: 4,
      emptyBefore: 4,
      left: true,
      right: false,
    })
    expect(headerLayout(parts, 'right')).toMatchObject({ before: 'none', after: 'toggle', right: true })
    expect(headerLayout(parts, 'both')).toMatchObject({
      before: 'toggle',
      after: 'toggle',
      left: true,
      right: true,
    })
    expect(headerLayout(parts, 'none')).toMatchObject({ before: 'empty-th', checkboxOnly: true })
    const noLinks = { ...parts, editLink: false, deleteLink: 'none' as const }
    expect(headerLayout(noLinks, 'left')).toMatchObject({ before: 'none', after: 'empty-td', colspan: 1 })
  })

  it('Number of rows options include the current custom value [p02-1e3bfc]', () => {
    expect(rowsOptions(25)).toEqual([25, 50, 100, 250, 500])
    expect(rowsOptions(30)).toEqual([25, 30, 50, 100, 250, 500])
    expect(rowsOptions('all')).toEqual([25, 50, 100, 250, 500])
    expect(validRowNumbers(0, 0, 10)).toBe(false)
    expect(validRowNumbers(25, 10, 10)).toBe(false)
    expect(validRowNumbers(25, 9, 10)).toBe(true)
  })

  it('rewrites the condition of an edited key column (makegrid postEditedCell) [p02-ae4d44]', () => {
    const cond: Array<[string, string]> = [
      ['`t`.`a`', '= 1'],
      ['`t`.`b`', "= 'x'"],
    ]
    const next = rewriteCondition(cond, 't', 'b', "it's")
    expect(clauseOf(next)).toBe("`t`.`a` = 1 AND `t`.`b` = 'it''s'")
    expect(clauseOf(rewriteCondition(cond, 't', 'b', null))).toBe('`t`.`a` = 1 AND `t`.`b` IS NULL')
  })

  it('filter rows, hex validation, re-truncation [p02-fbe95b p02-b9d7d4 p02-784009]', () => {
    expect(rowMatchesFilter('Item1 Alpha', 'alpha item')).toBe(true)
    expect(rowMatchesFilter('Item1 Alpha', 'beta')).toBe(false)
    expect(isValidHex('0xAbC0')).toBe(true)
    expect(isValidHex('0xZZ')).toBe(false)
    expect(truncateForDisplay('abcdef', 'P', 3)).toBe('abc...')
    expect(truncateForDisplay('abcdef', 'F', 3)).toBe('abcdef')
  })
})
