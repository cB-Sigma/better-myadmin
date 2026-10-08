/**
 * Result-set field metadata, derived from the MySQL protocol column definition
 * exactly like phpMyAdmin derives it from mysqli's field objects.
 *
 * pma: src/FieldMetadata.php
 */

/** Column type codes of the client/server protocol (= MYSQLI_TYPE_*, = mysql2 `columnType`). */
export const MysqlType = {
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
  VECTOR: 242,
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

/** Column flags of the protocol (= MYSQLI_*_FLAG). */
export const MysqlFlag = {
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
  NO_DEFAULT_VALUE: 4096,
  ON_UPDATE_NOW: 8192,
  PART_KEY: 16384,
  NUM: 32768,
  GROUP: 32768,
} as const

/** The binary charset/collation number */
export const BINARY_CHARSET_NR = 63

/** phpMyAdmin's internal mapped type (FieldMetadata::getMappedType). '' = not mapped. */
export type MappedType =
  | 'geometry'
  | 'bit'
  | 'json'
  | 'real'
  | 'int'
  | 'blob'
  | 'unknown'
  | 'null'
  | 'string'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'datetime'
  | 'year'
  | ''

/** pma: FieldMetadata::getMappedInternalType */
export function mapMysqlType(type: number): MappedType {
  switch (type) {
    case MysqlType.DECIMAL:
    case MysqlType.NEWDECIMAL:
    case MysqlType.FLOAT:
    case MysqlType.DOUBLE:
      return 'real'
    case MysqlType.TINY:
    case MysqlType.SHORT:
    case MysqlType.LONG:
    case MysqlType.LONGLONG:
    case MysqlType.INT24:
      return 'int'
    case MysqlType.NULL:
      return 'null'
    case MysqlType.TIMESTAMP:
      return 'timestamp'
    case MysqlType.DATE:
    case MysqlType.NEWDATE:
      return 'date'
    case MysqlType.TIME:
      return 'time'
    case MysqlType.DATETIME:
      return 'datetime'
    case MysqlType.YEAR:
      return 'year'
    case MysqlType.ENUM:
    case MysqlType.SET:
      return 'unknown'
    case MysqlType.TINY_BLOB:
    case MysqlType.MEDIUM_BLOB:
    case MysqlType.LONG_BLOB:
    case MysqlType.BLOB:
      return 'blob'
    case MysqlType.VAR_STRING:
    case MysqlType.STRING:
      return 'string'
    case MysqlType.GEOMETRY:
      return 'geometry'
    case MysqlType.BIT:
      return 'bit'
    case MysqlType.JSON:
      return 'json'
    default:
      return ''
  }
}

/** Raw column definition as delivered by the driver (mysqli field object / mysql2 FieldPacket). */
export interface RawField {
  name: string
  /** original column name ('' for expressions) */
  orgName: string
  /** table alias ('' for expressions) */
  table: string
  orgTable: string
  /** protocol type code */
  type: number
  flags: number
  charsetNr: number
  length: number
  decimals?: number
  db?: string
}

/** pma: src/FieldMetadata.php (public properties, camelCase) */
export interface FieldMetadata {
  name: string
  orgName: string
  table: string
  orgTable: string
  charsetNr: number
  decimals: number
  length: number
  mappedType: MappedType
  isMultipleKey: boolean
  isPrimaryKey: boolean
  isUniqueKey: boolean
  isNotNull: boolean
  isUnsigned: boolean
  isZerofill: boolean
  isNumeric: boolean
  isBlob: boolean
  isBinary: boolean
  isEnum: boolean
  isSet: boolean
  isMappedTypeBit: boolean
  isMappedTypeGeometry: boolean
  isMappedTypeTimestamp: boolean
}

/** pma: FieldMetadata::__construct */
export function createFieldMetadata(field: RawField): FieldMetadata {
  const mappedType = mapMysqlType(field.type)
  const flags = field.flags
  const binaryTypes: number[] = [
    MysqlType.TINY_BLOB,
    MysqlType.BLOB,
    MysqlType.MEDIUM_BLOB,
    MysqlType.LONG_BLOB,
    MysqlType.VAR_STRING,
    MysqlType.STRING,
  ]
  return {
    name: field.name,
    orgName: field.orgName,
    table: field.table,
    orgTable: field.orgTable,
    charsetNr: field.charsetNr,
    decimals: field.decimals ?? 0,
    length: field.length,
    mappedType,
    isMultipleKey: (flags & MysqlFlag.MULTIPLE_KEY) !== 0,
    isPrimaryKey: (flags & MysqlFlag.PRI_KEY) !== 0,
    isUniqueKey: (flags & MysqlFlag.UNIQUE_KEY) !== 0,
    isNotNull: (flags & MysqlFlag.NOT_NULL) !== 0,
    isUnsigned: (flags & MysqlFlag.UNSIGNED) !== 0,
    isZerofill: (flags & MysqlFlag.ZEROFILL) !== 0,
    isBlob: (flags & MysqlFlag.BLOB) !== 0,
    isEnum: (flags & MysqlFlag.ENUM) !== 0,
    isSet: (flags & MysqlFlag.SET) !== 0,
    // NUM_FLAG doubles as GROUP_FLAG, so phpMyAdmin checks the type instead
    isNumeric: mappedType === 'int' || mappedType === 'real',
    isMappedTypeBit: mappedType === 'bit',
    isMappedTypeGeometry: mappedType === 'geometry',
    isMappedTypeTimestamp: mappedType === 'timestamp',
    isBinary: binaryTypes.includes(field.type) && field.charsetNr === BINARY_CHARSET_NR,
  }
}

/** pma: FieldMetadata::isDateTimeType */
export const isDateTimeType = (m: Pick<FieldMetadata, 'mappedType'>): boolean =>
  m.mappedType === 'date' ||
  m.mappedType === 'time' ||
  m.mappedType === 'datetime' ||
  m.mappedType === 'timestamp'

/** pma: FieldMetadata::isTimeType */
export const isTimeType = (m: Pick<FieldMetadata, 'mappedType'>): boolean =>
  m.mappedType === 'time' || m.mappedType === 'timestamp' || m.mappedType === 'datetime'
