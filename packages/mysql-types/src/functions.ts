/**
 * The function dropdown of the Insert/Edit form.
 *
 * pma: src/Html/Generator.php::getDefaultFunctionForField, ::getFunctionsForField
 *      src/InsertEdit.php::isColumnBinary, getHtmlForInsertEditFormColumn (function cell)
 *      src/Config/Settings.php::setDefaultFunctions
 */

import type { ServerInfo } from './server.ts'
import { getAllFunctions, getTypeClass } from './types.ts'

/** `$cfg['DefaultFunctions']` */
export type DefaultFunctions = Record<string, string>

/** pma: src/Config/Settings.php::setDefaultFunctions defaults */
export const DEFAULT_FUNCTIONS: Readonly<DefaultFunctions> = Object.freeze({
  FUNC_CHAR: '',
  FUNC_DATE: '',
  FUNC_NUMBER: '',
  FUNC_SPATIAL: 'GeomFromText',
  FUNC_UUID: 'UUID',
  first_timestamp: 'NOW',
})

/** Merges user settings over the defaults (string keys only, values cast to string) like Settings.php. */
export function resolveDefaultFunctions(settings?: Record<string, unknown> | null): DefaultFunctions {
  const out: DefaultFunctions = { ...DEFAULT_FUNCTIONS }
  if (settings === null || settings === undefined) return out
  for (const [k, v] of Object.entries(settings)) {
    if (/^\d+$/.test(k)) continue
    out[k] = v === null || v === undefined || v === false ? '' : v === true ? '1' : String(v)
  }
  return out
}

export interface DefaultFunctionInput {
  /** type without length/attributes, e.g. `timestamp` (InsertEditColumn::$trueType) */
  trueType: string
  /** InsertEditColumn::$firstTimestamp (phpMyAdmin sets it for every timestamp column) */
  firstTimestamp?: boolean
  defaultValue: string | null
  extra: string
  isNull: boolean
  /** `PRI`, `UNI`, `MUL` or '' */
  key: string
  /** full column type, e.g. `char(36)` */
  type: string
  insertMode: boolean
}

/** pma: src/Html/Generator.php::getDefaultFunctionForField */
export function getDefaultFunctionForField(
  input: DefaultFunctionInput,
  server: ServerInfo,
  defaultFunctions: DefaultFunctions = DEFAULT_FUNCTIONS,
): string {
  const { trueType, defaultValue, extra, isNull, key, type, insertMode } = input
  const firstTimestamp = input.firstTimestamp ?? trueType === 'timestamp'
  if (trueType === 'uuid') return ''

  let defaultFunction = ''
  const currentClass = getTypeClass(trueType)
  const configured = defaultFunctions[`FUNC_${currentClass}`]
  if (currentClass !== '' && configured !== undefined) {
    defaultFunction = configured
    if (
      currentClass === 'SPATIAL' &&
      server.version >= 50600 &&
      defaultFunction.slice(0, 3).toLowerCase() !== 'st_'
    ) {
      defaultFunction = `ST_${defaultFunction}`
    }
  }

  if (
    trueType === 'timestamp' &&
    firstTimestamp &&
    (defaultValue === null || defaultValue === '') &&
    extra !== 'on update CURRENT_TIMESTAMP' &&
    !isNull
  ) {
    defaultFunction = defaultFunctions.first_timestamp ?? ''
  }

  if (insertMode && key === 'PRI' && (type === 'char(36)' || type === 'varchar(36)')) {
    return defaultFunctions.FUNC_UUID ?? ''
  }

  return defaultFunction
}

/** One `<option>` of the function dropdown. */
export interface FunctionOption {
  /** submitted value; equals the label except for the password_hash() entry */
  value: string
  label: string
  selected: boolean
  title?: string
}

/** Value of the extra option that hashes the value in the application (PHP password_hash()). */
export const PHP_PASSWORD_HASH = 'PHP_PASSWORD_HASH'

/**
 * The function dropdown as data: an empty option, every function from
 * Types::getAllFunctions (not filtered by column type), the default one
 * selected unless the column has a foreign key, and the password_hash() entry.
 *
 * pma: src/Html/Generator.php::getFunctionsForField
 */
export function getFunctionsForField(
  server: ServerInfo,
  defaultFunction: string,
  hasForeignField = false,
  t: (msgid: string) => string = (s) => s,
): FunctionOption[] {
  const out: FunctionOption[] = [{ value: '', label: '', selected: false }]
  for (const fn of getAllFunctions(server)) {
    out.push({ value: fn, label: fn, selected: fn === defaultFunction && !hasForeignField })
  }
  out.push({
    value: PHP_PASSWORD_HASH,
    label: t('password_hash() PHP function'),
    selected: false,
    title: t('The PHP function password_hash() with default options.'),
  })
  return out
}

/** `$cfg['ProtectBinary']` */
export type ProtectBinary = false | 'blob' | 'noblob' | 'all'

export interface FunctionCellInput {
  trueType: string
  /** type starts with binary/varbinary (InsertEdit::isColumn) */
  isBinary: boolean
  /** type starts with blob/tinyblob/mediumblob/longblob */
  isBlob: boolean
  /** file upload enabled */
  isUpload: boolean
}

/**
 * What the function cell shows: 'binary' (the text "Binary"), 'none' ("--" for
 * ENUM/SET) or 'select' (the dropdown). Returns null when ShowFunctionFields is off.
 *
 * pma: src/InsertEdit.php::isColumnBinary + resources/templates/table/insert/column_row.twig
 */
export function getFunctionCellKind(
  input: FunctionCellInput,
  config: { showFunctionFields: boolean; protectBinary: ProtectBinary },
): 'binary' | 'none' | 'select' | null {
  if (!config.showFunctionFields) return null
  const pb = config.protectBinary
  const isColumnBinary =
    (pb === 'blob' && input.isBlob && !input.isUpload) ||
    (pb === 'all' && input.isBinary) ||
    (pb === 'noblob' && input.isBinary)
  if (isColumnBinary) return 'binary'
  if (input.trueType.includes('enum') || input.trueType.includes('set')) return 'none'
  return 'select'
}

/** InsertEdit::isColumn — case-insensitive "type starts with one of" */
export function isColumnOfType(columnType: string, types: readonly string[]): boolean {
  const lower = columnType.toLowerCase()
  return types.some((t) => lower.startsWith(t.toLowerCase()))
}

/** InsertEditColumn::$trueType — type up to the first bracket or ` /` comment */
export function getTrueType(type: string): string {
  return type.replace(/(\([\s\S]*)|(\s\/[\s\S]*)/, '')
}

/** Functions that take no argument (unless optional). pma: InsertEdit::FUNC_NO_PARAM */
export const FUNC_NO_PARAM: readonly string[] = [
  'CONNECTION_ID',
  'CURRENT_USER',
  'CURDATE',
  'CURTIME',
  'CURRENT_DATE',
  'CURRENT_TIME',
  'DATABASE',
  'LAST_INSERT_ID',
  'NOW',
  'PI',
  'RAND',
  'SYSDATE',
  'UNIX_TIMESTAMP',
  'USER',
  'UTC_DATE',
  'UTC_TIME',
  'UTC_TIMESTAMP',
  'UUID',
  'UUID_SHORT',
  'UUID_v4',
  'UUID_v7',
  'VERSION',
]

/** pma: InsertEdit::FUNC_OPTIONAL_PARAM */
export const FUNC_OPTIONAL_PARAM: readonly string[] = ['NOW', 'RAND', 'UNIX_TIMESTAMP']

/** pma: InsertEdit::getGisFromTextFunctions */
export function getGisFromTextFunctions(server: ServerInfo): string[] {
  const base = [
    'GeomFromText',
    'GeomCollFromText',
    'LineFromText',
    'MLineFromText',
    'PointFromText',
    'MPointFromText',
    'PolyFromText',
    'MPolyFromText',
  ]
  return server.version >= 50600 ? base.map((f) => `ST_${f}`) : base
}

/** pma: InsertEdit::getGisFromWKBFunctions */
export function getGisFromWKBFunctions(server: ServerInfo): string[] {
  const base = [
    'GeomFromWKB',
    'GeomCollFromWKB',
    'LineFromWKB',
    'MLineFromWKB',
    'PointFromWKB',
    'MPointFromWKB',
    'PolyFromWKB',
    'MPolyFromWKB',
  ]
  return server.version >= 50600 ? base.map((f) => `ST_${f}`) : base
}
