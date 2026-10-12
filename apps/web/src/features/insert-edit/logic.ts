import type { InsertCell, InsertColumn, InsertFormResponse, SaveField } from '@bettermyadmin/contracts'

/**
 * Client-side state and rules of the Insert/Edit form.
 * pma: resources/js/table/change.ts (verificationsAfterFieldChange, nullify, validators,
 *      addNewContinueInsertionFields), resources/js/modules/keyhandler.ts
 */

export interface CellState {
  value: string | string[]
  isNull: boolean
  fn: string
  /** salt input (AES_*, DES_*, ENCRYPT, SHA2) */
  salt: string | null
  /** uploaded file, base64 */
  upload: string | null
  uploadLocal: string
}

export interface RowState {
  whereClause: string | null
  /** Ignore checkbox (null = not shown) */
  ignore: boolean | null
  cells: CellState[]
}

/** What the browser would submit for an untouched cell. */
export function initialCell(col: InsertColumn, cell: InsertCell): CellState {
  const w = cell.widget
  let value: string | string[] = cell.value
  if (w.kind === 'set') value = w.selected
  else if (w.kind === 'enum-radio' || w.kind === 'enum-select') value = w.selected
  else if (w.kind === 'foreign-select') value = w.options[w.selected]?.value ?? w.options[0]?.value ?? ''
  else if (w.kind === 'foreign-link') value = cell.data
  else if (w.kind === 'protected') value = ''
  else if (w.kind === 'transformed') value = w.value
  return {
    value,
    isNull: col.isNull && cell.isNull,
    fn: col.functionCell === 'select' ? col.defaultFunction : '',
    salt: null,
    upload: null,
    uploadLocal: '',
  }
}

export function initialRows(f: InsertFormResponse): RowState[] {
  return f.rows.map((r) => ({
    whereClause: r.whereClause,
    ignore: r.ignore,
    cells: r.cells.map((c, i) => initialCell(f.columns[i] as InsertColumn, c)),
  }))
}

/** Functions that reveal the "Encryption key" input. */
export const SALT_FUNCTIONS = ['AES_ENCRYPT', 'AES_DECRYPT', 'DES_ENCRYPT', 'DES_DECRYPT', 'ENCRYPT', 'SHA2']

/**
 * verificationsAfterFieldChange: a value or function change unticks the NULL box and the row's
 * Ignore box; the salt input appears/disappears with the function.
 */
export function changeCell(row: RowState, i: number, patch: Partial<CellState>): RowState {
  const cells = row.cells.map((c, j) => {
    if (j !== i) return c
    const next = { ...c, ...patch, isNull: patch.isNull ?? false }
    if (patch.fn !== undefined) next.salt = SALT_FUNCTIONS.includes(patch.fn) ? (c.salt ?? '') : null
    return next
  })
  return { ...row, cells, ignore: row.ignore === null ? null : false }
}

/** nullify(): NULL ticked → function reset, value cleared; untick only clears the box. */
export function toggleNull(row: RowState, i: number, checked: boolean): RowState {
  const cells = row.cells.map((c, j) =>
    j !== i
      ? c
      : checked
        ? { ...c, isNull: true, fn: '', salt: null, value: Array.isArray(c.value) ? [] : '' }
        : { ...c, isNull: false },
  )
  return { ...row, cells }
}

/** The posted fields of one row (fields*, funcs, salt, …). */
export function toSaveFields(f: InsertFormResponse, rowIndex: number, row: RowState): SaveField[] {
  const serverRow = f.rows[Math.min(rowIndex, f.rows.length - 1)]
  return f.columns.map((col, i) => {
    const cell = serverRow?.cells[i] as InsertCell
    const s = row.cells[i] as CellState
    const value = cell.widget.kind === 'enum-radio' && s.value === '' ? null : s.value
    return {
      name: col.field,
      value,
      type: cell.fieldsType,
      isNull: col.isNull && s.isNull,
      nullPrev: col.isNull && cell.nullPrev,
      function: s.fn,
      salt: s.salt,
      prev: row.whereClause === null && rowIndex >= f.rows.length ? null : cell.prev,
      autoIncrement: cell.autoIncrement,
      virtual: cell.virtual,
      upload: s.upload,
      uploadLocal: s.uploadLocal === '' ? null : s.uploadLocal,
    }
  })
}

// ------------------------------------------------------------------ validators

const INT = /^([+-]|0x)?([0-9]*\.?[0-9]+|[0-9]+\.?[0-9]*)([eE][+-]?[0-9]+)?$/i

/** change.ts isDate (YYYY-MM-DD, separators normalised; timestamp years 1978–2038) */
export function isDate(value: string, timestamp: boolean): boolean {
  const v = value.replace(/[.*^+/@]/g, '-')
  const m = /^(\d{2}|\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v)
  if (m === null) return false
  let year = Number(m[1])
  if ((m[1] as string).length === 2) year += year < 70 ? 2000 : 1900
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1) return false
  const days = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  if (day > (days[month - 1] as number) && !(year === 0 && day <= 31)) return false
  if (timestamp && (year < 1978 || year > 2038 || (year === 2038 && (month > 1 || day > 19)))) return false
  return true
}

/** change.ts isTime: -?[0-838]:MM:SS[.ffffff] */
export function isTime(value: string): boolean {
  const m = /^-?(\d{1,3}):(\d{1,2}):(\d{1,2})(\.\d{1,6})?$/.exec(value)
  if (m === null) return false
  return Number(m[1]) <= 838 && Number(m[2]) < 60 && Number(m[3]) < 60
}

/** validationFunctionForDateTime */
export function isDateTime(value: string, trueType: string): boolean {
  const v = value.trim()
  if (v === '') return true
  if (trueType === 'time') return isTime(v)
  if (trueType === 'date') return isDate(v, false)
  if (/^(current_timestamp(\(\))?|0000-00-00 00:00:00)$/i.test(v)) return true
  const [d = '', time] = v.split(/\s+/)
  if (!isDate(d, trueType === 'timestamp')) return false
  return time === undefined || isTime(time)
}

/** The validation message of one cell, or null (rules are skipped when a function is selected). */
export function validateCell(
  col: InsertColumn,
  cell: InsertCell,
  s: CellState,
  t: (m: string, ...a: string[]) => string,
): string | null {
  const w = cell.widget
  // the function select's rules (change.ts validationFunctionForMd5 / validationFunctionForAesDesEncrypt)
  if (s.fn === 'MD5') {
    const max = w.kind === 'text' || w.kind === 'textarea' ? w.maxlength : null
    if (max !== null && max < 32) return t('This column can not contain a 32 chars value')
  }
  if (s.fn === 'AES_ENCRYPT' || s.fn === 'DES_ENCRYPT') {
    const dataType =
      w.kind === 'text' || w.kind === 'textarea'
        ? w.dataType
        : w.kind === 'hex-input' || w.kind === 'hex-textarea'
          ? 'HEX'
          : ''
    if (dataType !== 'HEX' && dataType !== 'CHAR')
      return t(
        'These functions are meant to return a binary result; to avoid inconsistent results you should store it in a BINARY, VARBINARY, or BLOB column.',
      )
  }
  if (s.fn !== '' || s.isNull || Array.isArray(s.value) || s.value === '') return null
  const v = s.value
  if (['date', 'datetime', 'timestamp', 'time'].includes(col.trueType) && !isDateTime(v, col.trueType)) {
    return t('Please enter a valid date or time')
  }
  if (w.kind === 'text' && w.dataType === 'INT') {
    if (!INT.test(v)) return t('Please enter a valid number!')
    if (w.min !== null && w.max !== null) {
      const n = Number(v)
      if (n < Number(w.min))
        return t('Please enter a value greater than or equal to {0}').replace('{0}', w.min)
      if (n > Number(w.max)) return t('Please enter a value less than or equal to {0}').replace('{0}', w.max)
    }
  }
  if ((w.kind === 'hex-input' || w.kind === 'hex-textarea') && !/^[a-f0-9]*$/i.test(v)) {
    return t('Please enter a valid HEX input')
  }
  const max = w.kind === 'text' || w.kind === 'textarea' ? w.maxlength : null
  if (max !== null && col.isChar && Array.from(v).length > max) {
    return t('Please enter no more than {0} characters').replace('{0}', String(max))
  }
  return null
}

// ------------------------------------------------------------------ keyboard

/** InsertEdit::$fieldIndex: `field_<idx>_<1 function | 2 null | 3 value>` */
export const fieldIndex = (rowOffset: number, columnCount: number, columnNumber: number) =>
  rowOffset * columnCount + columnNumber + 1

/** keyhandler.ts onKeyDownArrowsHandler: the id Ctrl+arrow moves to, or null */
export function arrowTarget(id: string, key: string): string[] | null {
  const pos = id.split('_')
  if (pos[0] !== 'field' || pos[2] === undefined) return null
  let x = Number(pos[2])
  let y = Number(pos[1])
  if (key === 'ArrowUp') y--
  else if (key === 'ArrowDown') y++
  else if (key === 'ArrowLeft') x--
  else if (key === 'ArrowRight') x++
  else return null
  return [`field_${y}_${x}`, `field_${y}_${x}_0`]
}
