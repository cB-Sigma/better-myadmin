/**
 * Column-spec and value helpers from phpMyAdmin's `Util` class.
 *
 * pma: src/Util.php
 */

import {
  decbin,
  htmlspecialchars,
  htmlspecialcharsDecode,
  intCast,
  mbStrlen,
  rtrim,
  strGetCsv,
  trim,
} from './php.ts'
import { type ServerInfo, isIntegersSupportLength } from './server.ts'
import { getColumns, getTypeDescription } from './types.ts'

/** Code-point aware substring with PHP `mb_substr` semantics (negative length counts from the end). */
function mbSubstr(chars: string[], start: number, length?: number): string {
  const n = chars.length
  let s = start < 0 ? Math.max(0, n + start) : Math.min(start, n)
  if (length === undefined) return chars.slice(s).join('')
  let e = length < 0 ? n + length : s + length
  if (e > n) e = n
  if (e <= s) return ''
  if (s < 0) s = 0
  return chars.slice(s, e).join('')
}

/**
 * pma: Util::parseEnumSetValues — values of an ENUM/SET definition such as
 * `enum('a','b')`. `escapeHtml` applies htmlspecialchars(ENT_QUOTES).
 */
export function parseEnumSetValues(definition: string, escapeHtml = true): string[] {
  const m = /\(([^\n]*)\)/.exec(definition)
  const inner = m?.[1] ?? ''
  return strGetCsv(inner, ',', "'", '\\').map((v) => {
    const value = (v ?? '').replaceAll('\\\\', '\\')
    return escapeHtml ? htmlspecialchars(value, 'quotes') : value
  })
}

/** Result of Util::extractColumnSpec (same keys as phpMyAdmin, snake_case kept for parity). */
export interface ColumnSpec {
  type: string
  spec_in_brackets: string
  enum_set_values: string[]
  print_type: string
  binary: boolean
  unsigned: boolean
  zerofill: boolean
  attribute: string
  can_contain_collation: boolean
  displayed_type: string
}

/**
 * pma: Util::extractColumnSpec — splits `int(10) unsigned zerofill` and the
 * like into its parts. `limitChars` is `$cfg['LimitChars']` (default 50).
 */
export function extractColumnSpec(columnSpecification: string, limitChars = 50): ColumnSpec {
  const chars = Array.from(columnSpecification)
  const firstBracketPos = chars.indexOf('(')
  let specInBrackets: string
  let type: string
  // PHP: `if ($firstBracketPos)` — position 0 is falsy
  if (firstBracketPos > 0) {
    const lastClose = chars.lastIndexOf(')')
    // mb_strrpos() === false is used as 0 in the arithmetic
    const close = lastClose === -1 ? 0 : lastClose
    specInBrackets = rtrim(mbSubstr(chars, firstBracketPos + 1, close - firstBracketPos - 1))
    type = rtrim(mbSubstr(chars, 0, firstBracketPos)).toLowerCase()
  } else {
    type = (columnSpecification.split(' ')[0] ?? '').toLowerCase()
    specInBrackets = ''
  }

  let enumSetValues: string[]
  let printType: string
  let binary: boolean
  let unsigned: boolean
  let zerofill: boolean
  let compressed: boolean
  if (type === 'enum' || type === 'set') {
    enumSetValues = parseEnumSetValues(columnSpecification, false)
    printType = `${type}(${specInBrackets.replaceAll("','", "', '")})`
    binary = false
    unsigned = false
    zerofill = false
    compressed = false
  } else {
    enumSetValues = []
    printType = columnSpecification.toLowerCase()
    if (printType.includes('binary') && !/binary[(]/.test(printType)) {
      printType = printType.replaceAll('binary', '')
      binary = true
    } else {
      binary = false
    }
    zerofill = printType.includes('zerofill')
    printType = printType.replaceAll('zerofill', '')
    unsigned = printType.includes('unsigned')
    printType = printType.replaceAll('unsigned', '')
    compressed = /\/\*m?!100301 compressed\*\//.test(printType)
    printType = printType.replace(/\/\*m?!100301 compressed\*\//g, '')
    printType = trim(printType)
  }

  let attribute = ' '
  if (binary) attribute = 'BINARY'
  if (unsigned) attribute = 'UNSIGNED'
  if (zerofill) attribute = 'UNSIGNED ZEROFILL'
  if (compressed) attribute = 'COMPRESSED=zlib'

  const canContainCollation =
    !binary && /^(char|varchar|text|tinytext|mediumtext|longtext|set|enum)/.test(type)

  let displayedType = htmlspecialchars(printType, 'compat')
  const printChars = Array.from(printType)
  if (printChars.length > limitChars) {
    displayedType =
      `<abbr title="${htmlspecialchars(printType)}">` +
      htmlspecialchars(`${mbSubstr(printChars, 0, limitChars)}...`, 'compat') +
      '</abbr>'
  }

  return {
    type,
    spec_in_brackets: specInBrackets,
    enum_set_values: enumSetValues,
    print_type: printType,
    binary,
    unsigned,
    zerofill,
    attribute,
    can_contain_collation: canContainCollation,
    displayed_type: displayedType,
  }
}

/**
 * pma: Util::printableBitValue — a BIT value as a 0/1 string left-padded to `length`.
 * `value` follows PHP `(int)` semantics when given as string (decimal text as
 * mysqli returns BIT columns; saturates at PHP_INT_MAX).
 */
export function printableBitValue(value: bigint | number | string, length: number): string {
  return decbin(intCast(value)).padStart(length, '0')
}

/**
 * Converts the raw bytes mysql2 returns for a BIT column into the decimal text
 * that mysqli (phpMyAdmin) receives, so `printableBitValue` behaves identically.
 */
export function bitBytesToDecimalString(bytes: Uint8Array): string {
  let v = 0n
  for (const b of bytes) v = (v << 8n) | BigInt(b)
  return v.toString()
}

/** pma: Util::convertBitDefaultValue — `b'010'` becomes `010` */
export function convertBitDefaultValue(bitDefaultValue: string | null): string {
  return htmlspecialcharsDecode(bitDefaultValue ?? '').replace(/^b'(\d*)'?(?=\n?$)/, '$1')
}

/** pma: Util::unQuote */
export function unQuote(quotedString: string, quote: string | null = null): string {
  const quotes = quote === null ? ['`', '"', "'"] : [quote]
  for (const q of quotes) {
    if (quotedString.startsWith(q) && quotedString.endsWith(q)) {
      return mbSubstrSimple(quotedString, 1, -1).replaceAll(q + q, q)
    }
  }
  return quotedString
}

function mbSubstrSimple(s: string, start: number, length?: number): string {
  return mbSubstr(Array.from(s), start, length)
}

/** pma: Util::unquoteDefaultValue */
export function unquoteDefaultValue(value: string): string {
  if (!value.startsWith("'")) return value
  // PHP substr($value, 1, -1) on a 1-char string yields ''
  const inner = value.length <= 2 ? '' : value.slice(1, -1)
  // strtr with longest-match-first semantics
  return inner.replace(/''|\\'|\\\\/g, (m) => (m === "''" || m === "\\'" ? "'" : '\\'))
}

/** pma: Util::getCharsetQueryPart */
export function getCharsetQueryPart(collation: string, override = false): string {
  const charset = collation.split('_')[0] ?? ''
  const keyword = override ? ' CHARACTER SET ' : ' CHARSET='
  return keyword + charset + (charset === collation ? '' : ` COLLATE ${collation}`)
}

/** pma: Util::addMicroseconds */
export function addMicroseconds(value: string): string {
  if (value === '' || /^current_timestamp(\([0-6]?\))?(?=\n?$)/i.test(value)) return value
  if (!value.includes('.')) return `${value}.000000`
  const padded = `${value}000000`
  const chars = Array.from(padded)
  return mbSubstr(chars, 0, chars.indexOf('.') + 7)
}

/** pma: Util::getSupportedDatatypes — flat list of the types offered by Types::getColumns */
export function getSupportedDatatypes(server: ServerInfo): string[] {
  const out: string[] = []
  for (const entry of getColumns(server)) {
    if (typeof entry === 'string') {
      if (entry !== '-') out.push(entry)
    } else {
      for (const t of entry.types) if (t !== '-') out.push(t)
    }
  }
  return out
}

/** One `<option>` of the column type dropdown. */
export type DatatypeOption =
  | { group: string | null; separator: true }
  | {
      group: string | null
      type: string
      /** `data-length-restricted="1"`: the length will be dropped (MySQL >= 8.0.18 integers) */
      lengthRestricted: boolean
      selected: boolean
      description: string
    }

/**
 * The type `<select>` content as data (top-level entries have `group: null`).
 * pma: src/Html/Generator.php::getSupportedDatatypes
 */
export function getDatatypeOptions(
  server: ServerInfo,
  selected = '',
  t: (msgid: string) => string = (s) => s,
): DatatypeOption[] {
  const out: DatatypeOption[] = []
  const option = (group: string | null, type: string): DatatypeOption => ({
    group,
    type,
    lengthRestricted: !isIntegersSupportLength(type, '2', server),
    selected: selected === type,
    description: getTypeDescription(type, t),
  })
  for (const entry of getColumns(server)) {
    if (typeof entry === 'string') {
      out.push(option(null, entry))
      continue
    }
    for (const sub of entry.types) {
      out.push(sub === '-' ? { group: entry.group, separator: true } : option(entry.group, sub))
    }
  }
  return out
}

/** Length/values field rules used by the column form (derived from generateFieldSpec). */
const NO_LENGTH_TYPES =
  /^(DATE|TINYBLOB|TINYTEXT|BLOB|TEXT|MEDIUMBLOB|MEDIUMTEXT|LONGBLOB|LONGTEXT|SERIAL|BOOLEAN|UUID|JSON)$/i

/**
 * Whether a length/values entry is emitted for the type in DDL.
 * pma: src/Table/Table.php::generateFieldSpec (length pattern + Compatibility::isIntegersSupportLength)
 */
export function typeAcceptsLength(type: string, length: string, server: ServerInfo): boolean {
  return length !== '' && !NO_LENGTH_TYPES.test(type) && isIntegersSupportLength(type, length, server)
}

/** Types whose length/values field holds a value list (`'a','b'`). */
export const typeTakesValues = (type: string): boolean => /^(ENUM|SET)$/i.test(type)

/** Types for which a COLLATE clause is emitted. pma: Table::generateFieldSpec */
export const typeTakesCollation = (type: string): boolean =>
  /^(TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|VARCHAR|CHAR|ENUM|SET)$/i.test(type)

/** Types requiring a numeric length in the column form. pma: js/src/modules/functions.ts::checkTableEditForm */
export const typeRequiresLength = (type: string): boolean =>
  /^(VARCHAR|CHAR|BIT|VARBINARY|BINARY)$/i.test(type)

/** byte length helper re-exported for callers that need PHP mb_strlen semantics */
export { mbStrlen }
