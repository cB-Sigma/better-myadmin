import type { DisplayParts } from '@bettermyadmin/contracts'

/**
 * Where the row-action columns go in the header (Results::getFieldVisibilityParams +
 * getColumnAtRightSide) and how many cells they span.
 */
export interface HeaderLayout {
  before: 'none' | 'toggle' | 'empty-td' | 'empty-th'
  after: 'none' | 'toggle' | 'empty-td'
  colspan: number
  /** numEmptyColumnsBefore / After (repeated header rows) */
  emptyBefore: number
  emptyAfter: number
  /** body cells: actions on the left / right */
  left: boolean
  right: boolean
  /** RowActionLinks=none still renders the checkbox column */
  checkboxOnly: boolean
}

export function headerLayout(dp: DisplayParts, rowActionLinks: string): HeaderLayout {
  const links = dp.editLink || dp.deleteLink !== 'none'
  const both = dp.editLink && dp.deleteLink !== 'none'
  const colspan = both ? 4 : 1
  const leftOrBoth = rowActionLinks === 'left' || rowActionLinks === 'both'
  let before: HeaderLayout['before'] = 'none'
  let emptyBefore = 0
  if (!dp.editLink && dp.deleteLink === 'none' && dp.textButton) {
    before = 'none'
  } else if (leftOrBoth && dp.textButton) {
    before = 'toggle'
    emptyBefore = both ? 4 : 0
  } else if (leftOrBoth && links) {
    before = 'empty-td'
    emptyBefore = both ? 4 : 0
  } else if (rowActionLinks === 'none') {
    before = 'empty-th'
  }
  let after: HeaderLayout['after'] = 'none'
  let emptyAfter = 0
  if (rowActionLinks === 'right' || (rowActionLinks === 'both' && links && dp.textButton)) {
    after = 'toggle'
    emptyAfter = both ? 4 : 1
  } else if (rowActionLinks === 'left' || (rowActionLinks === 'both' && !links)) {
    after = 'empty-td'
    emptyAfter = both ? 4 : 1
  }
  return {
    before,
    after,
    colspan,
    emptyBefore,
    emptyAfter,
    left: links && leftOrBoth,
    right: links && (rowActionLinks === 'right' || rowActionLinks === 'both'),
    checkboxOnly: links && rowActionLinks === 'none',
  }
}

/** The "Number of rows" options (table.twig navigation_goto). */
export function rowsOptions(maxRows: number | 'all'): Array<number | 'all'> {
  const base = [25, 50, 100, 250, 500]
  if (maxRows === 'all') return base
  if (!base.includes(maxRows)) return [...base, maxRows].sort((a, b) => a - b)
  return base
}

/** sql.ts `.maxRowsForm` submit: a positive row count and 0 ≤ pos ≤ total − 1. */
export function validRowNumbers(maxRows: number, pos: number, unlimNumRows: number): boolean {
  if (Number.isNaN(maxRows) || maxRows < 1) return false
  if (Number.isNaN(pos) || pos < 0 || (unlimNumRows > 0 && pos > unlimNumRows - 1)) return false
  return true
}

/**
 * makegrid.ts postEditedCell: an edited column that is part of the WHERE clause gets its condition
 * rewritten, and the new clause is the conditions joined with AND.
 */
export function rewriteCondition(
  cond: ReadonlyArray<readonly [string, string]>,
  table: string,
  field: string,
  value: string | null,
): Array<[string, string]> {
  const fieldStr = `\`${table}\`.\`${field}\``
  let done = false
  return cond.map(([k, v]) => {
    if (!done && k.includes(fieldStr)) {
      done = true
      return [k, value === null ? 'IS NULL' : `= '${value.replace(/'/g, "''")}'`]
    }
    return [k, v]
  })
}

export const clauseOf = (cond: ReadonlyArray<readonly [string, string]>) =>
  cond.map(([k, v]) => `${k} ${v}`).join(' AND ')

/** $.uiTableFilter: every space-separated word must appear in the row text (case-insensitive). */
export function rowMatchesFilter(rowText: string, phrase: string): boolean {
  const words = phrase
    .toLowerCase()
    .split(' ')
    .filter((w) => w !== '')
  const text = rowText.toLowerCase()
  return words.every((w) => text.includes(w))
}

/** JSON.stringify(value, null, 4) when the value parses (makegrid stringifyJSON). */
export function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 4)
  } catch {
    return value
  }
}

/** makegrid saveEditedCell: hex cells accept `^(0x)?[a-f0-9]*$`. */
export const isValidHex = (v: string) => /^(0x)?[a-f0-9]*$/i.test(v)

/** Re-truncation of a saved value (hideEditCell: LimitChars in Partial texts mode). */
export function truncateForDisplay(value: string, pftext: 'P' | 'F', limitChars: number): string {
  const cps = Array.from(value)
  return pftext === 'P' && cps.length > limitChars ? `${cps.slice(0, limitChars).join('')}...` : value
}
