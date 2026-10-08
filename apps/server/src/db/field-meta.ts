import type { Cell, Field } from '@bettermyadmin/contracts'

/** MYSQLI_TYPE_* / protocol column types. */
export const T = {
  DECIMAL: 0,
  TINY: 1,
  SHORT: 2,
  LONG: 3,
  FLOAT: 4,
  DOUBLE: 5,
  NULL: 6,
  TIMESTAMP: 7,
  LONGLONG: 8,
  INT24: 9,
  DATE: 10,
  TIME: 11,
  DATETIME: 12,
  YEAR: 13,
  NEWDATE: 14,
  VARCHAR: 15,
  BIT: 16,
  JSON: 245,
  NEWDECIMAL: 246,
  ENUM: 247,
  SET: 248,
  TINY_BLOB: 249,
  MEDIUM_BLOB: 250,
  LONG_BLOB: 251,
  BLOB: 252,
  VAR_STRING: 253,
  STRING: 254,
  GEOMETRY: 255,
} as const

/** MYSQLI_*_FLAG */
export const F = {
  NOT_NULL: 1,
  PRI_KEY: 2,
  UNIQUE_KEY: 4,
  MULTIPLE_KEY: 8,
  BLOB: 16,
  UNSIGNED: 32,
  ZEROFILL: 64,
  BINARY: 128,
  ENUM: 256,
  AUTO_INCREMENT: 512,
  TIMESTAMP: 1024,
  SET: 2048,
} as const

/** pma: src/FieldMetadata.php::getMappedInternalType + getMappedType */
export function mappedType(type: number): string {
  switch (type) {
    case T.DECIMAL:
    case T.NEWDECIMAL:
    case T.FLOAT:
    case T.DOUBLE:
      return 'real'
    case T.TINY:
    case T.SHORT:
    case T.LONG:
    case T.LONGLONG:
    case T.INT24:
      return 'int'
    case T.NULL:
      return 'null'
    case T.TIMESTAMP:
      return 'timestamp'
    case T.DATE:
    case T.NEWDATE:
      return 'date'
    case T.TIME:
      return 'time'
    case T.DATETIME:
      return 'datetime'
    case T.YEAR:
      return 'year'
    case T.ENUM:
    case T.SET:
      return 'unknown'
    case T.TINY_BLOB:
    case T.MEDIUM_BLOB:
    case T.LONG_BLOB:
    case T.BLOB:
      return 'blob'
    case T.VAR_STRING:
    case T.STRING:
      return 'string'
    case T.GEOMETRY:
      return 'geometry'
    case T.BIT:
      return 'bit'
    case T.JSON:
      return 'json'
    default:
      return ''
  }
}

/** The subset of mysql2's FieldPacket we read. */
export interface RawField {
  name: string
  orgName?: string
  table?: string
  orgTable?: string
  schema?: string
  db?: string
  columnType?: number
  type?: number
  flags?: number | string[]
  characterSet?: number
  columnLength?: number
  decimals?: number
}

const BINARY_STRING_TYPES = new Set<number>([
  T.TINY_BLOB,
  T.BLOB,
  T.MEDIUM_BLOB,
  T.LONG_BLOB,
  T.VAR_STRING,
  T.STRING,
])

/**
 * mysql2 field packet → FieldMetadata.
 * pma: src/FieldMetadata.php::__construct
 */
export function toField(raw: RawField): Field {
  const type = raw.columnType ?? raw.type ?? -1
  const flags = typeof raw.flags === 'number' ? raw.flags : 0
  const charsetNr = raw.characterSet ?? 0
  const mapped = mappedType(type)
  return {
    name: raw.name,
    orgName: raw.orgName ?? '',
    table: raw.table ?? '',
    orgTable: raw.orgTable ?? '',
    db: raw.schema ?? raw.db ?? '',
    mappedType: mapped,
    type,
    flags: {
      primaryKey: (flags & F.PRI_KEY) !== 0,
      uniqueKey: (flags & F.UNIQUE_KEY) !== 0,
      multipleKey: (flags & F.MULTIPLE_KEY) !== 0,
      notNull: (flags & F.NOT_NULL) !== 0,
      unsigned: (flags & F.UNSIGNED) !== 0,
      zerofill: (flags & F.ZEROFILL) !== 0,
      // flag 32768 can be NUM or GROUP, so phpMyAdmin checks the type instead
      numeric: mapped === 'int' || mapped === 'real',
      blob: (flags & F.BLOB) !== 0,
      // 63 is the number of the MySQL charset "binary"
      binary: BINARY_STRING_TYPES.has(type) && charsetNr === 63,
      enum: (flags & F.ENUM) !== 0,
      set: (flags & F.SET) !== 0,
    },
    charsetNr,
    length: raw.columnLength ?? 0,
    decimals: raw.decimals ?? 0,
  }
}

/**
 * Whether a column's bytes are not text and must travel as base64: binary strings/blobs,
 * BIT and GEOMETRY (mysqli hands these to PHP as raw byte strings).
 */
export function isRawBytes(f: Field): boolean {
  return f.flags.binary || f.mappedType === 'bit' || f.mappedType === 'geometry'
}

/** Raw protocol value → wire cell, never parsing numbers. */
export function toCell(value: Buffer | string | null, f: Field): Cell {
  if (value === null) return null
  if (typeof value === 'string') return value
  if (isRawBytes(f)) return { b64: value.toString('base64'), bytes: value.length }
  return value.toString('utf8')
}
