/**
 * SQL data types definition: the port of phpMyAdmin's `Types` class.
 *
 * pma: src/Types.php, src/TypeClass.php
 */

import { strtolower, strtoupper } from './php.ts'
import {
  type ServerInfo,
  isJsonSupported,
  isMariaDB,
  isUUIDSupported,
  isVectorSupported,
  isXmlTypeSupported,
  supportsCompressedColumns,
} from './server.ts'

/** pma: src/TypeClass.php */
export type TypeClass = 'NUMBER' | 'DATE' | 'CHAR' | 'SPATIAL' | 'JSON' | 'UUID' | ''

export const TYPE_CLASSES: readonly TypeClass[] = ['NUMBER', 'DATE', 'CHAR', 'SPATIAL', 'JSON', 'UUID', '']

const UNARY_OPERATORS = ['IS NULL', 'IS NOT NULL', "= ''", "!= ''"] as const
const NULL_OPERATORS = ['IS NULL', 'IS NOT NULL'] as const
export const ENUM_OPERATORS: readonly string[] = ['=', '!=']
export const TEXT_OPERATORS: readonly string[] = [
  'LIKE',
  'LIKE %...%',
  'NOT LIKE',
  'NOT LIKE %...%',
  '=',
  '!=',
  'REGEXP',
  'REGEXP ^...$',
  'NOT REGEXP',
  "= ''",
  "!= ''",
  'IN (...)',
  'NOT IN (...)',
  'BETWEEN',
  'NOT BETWEEN',
]
export const NUMBER_OPERATORS: readonly string[] = [
  '=',
  '>',
  '>=',
  '<',
  '<=',
  '!=',
  'LIKE',
  'LIKE %...%',
  'NOT LIKE',
  'NOT LIKE %...%',
  'IN (...)',
  'NOT IN (...)',
  'BETWEEN',
  'NOT BETWEEN',
]
export const UUID_OPERATORS: readonly string[] = [
  '=',
  '!=',
  'LIKE',
  'LIKE %...%',
  'NOT LIKE',
  'NOT LIKE %...%',
  'IN (...)',
  'NOT IN (...)',
]

/** pma: Types::isUnaryOperator */
export function isUnaryOperator(op: string): boolean {
  return (UNARY_OPERATORS as readonly string[]).includes(op)
}

/**
 * pma: Types::displayOfOperator. `t` is the gettext hook (msgids "empty", "not empty").
 */
export function displayOfOperator(operator: string, t: (msgid: string) => string = (s) => s): string {
  if (operator === "= ''") return `= '' (${t('empty')})`
  if (operator === "!= ''") return `!= '' (${t('not empty')})`
  return operator
}

/** Text operators (old `Types::getTextOperators`) */
export const getTextOperators = (): string[] => [...TEXT_OPERATORS]
/** Number operators (old `Types::getNumberOperators`) */
export const getNumberOperators = (): string[] => [...NUMBER_OPERATORS]
/** Enum operators (old `Types::getEnumOperators`) */
export const getEnumOperators = (): string[] => [...ENUM_OPERATORS]
/** UUID operators (old `Types::getUUIDOperators`) */
export const getUUIDOperators = (): string[] => [...UUID_OPERATORS]
/** NULL operators (old `Types::getNullOperators`) */
export const getNullOperators = (): string[] => [...NULL_OPERATORS]
/** Unary operators (old `Types::getUnaryOperators`) */
export const getUnaryOperators = (): string[] => [...UNARY_OPERATORS]

/** pma: Types::getTypeOperators */
export function getTypeOperators(type: string, nullable: boolean): string[] {
  let operators: readonly string[]
  if (strtolower(type.slice(0, 4)) === 'enum') {
    operators = ENUM_OPERATORS
  } else {
    const cls = getTypeClass(type)
    operators = cls === 'CHAR' ? TEXT_OPERATORS : cls === 'UUID' ? UUID_OPERATORS : NUMBER_OPERATORS
  }
  return nullable ? [...operators, ...NULL_OPERATORS] : [...operators]
}

/** pma: Types::getTypeOperatorsHtml */
export function getTypeOperatorsHtml(
  type: string,
  nullable: boolean,
  selectedOperator: string | null = null,
  t: (msgid: string) => string = (s) => s,
): string {
  const esc = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  let html = ''
  for (const fc of getTypeOperators(type, nullable)) {
    const selected = selectedOperator !== null && selectedOperator === fc ? ' selected' : ''
    html += `<option value="${esc(fc)}"${selected}>${esc(displayOfOperator(fc, t))}</option>`
  }
  return html
}

const DESCRIPTIONS: Record<string, string> = {
  TINYINT: 'A 1-byte integer, signed range is -128 to 127, unsigned range is 0 to 255',
  SMALLINT: 'A 2-byte integer, signed range is -32,768 to 32,767, unsigned range is 0 to 65,535',
  MEDIUMINT: 'A 3-byte integer, signed range is -8,388,608 to 8,388,607, unsigned range is 0 to 16,777,215',
  INT: 'A 4-byte integer, signed range is -2,147,483,648 to 2,147,483,647, unsigned range is 0 to 4,294,967,295',
  BIGINT:
    'An 8-byte integer, signed range is -9,223,372,036,854,775,808 to 9,223,372,036,854,775,807, unsigned range is 0 to 18,446,744,073,709,551,615',
  DECIMAL:
    'A fixed-point number (M, D) - the maximum number of digits (M) is 65 (default 10), the maximum number of decimals (D) is 30 (default 0)',
  FLOAT:
    'A small floating-point number, allowable values are -3.402823466E+38 to -1.175494351E-38, 0, and 1.175494351E-38 to 3.402823466E+38',
  DOUBLE:
    'A double-precision floating-point number, allowable values are -1.7976931348623157E+308 to -2.2250738585072014E-308, 0, and 2.2250738585072014E-308 to 1.7976931348623157E+308',
  REAL: 'Synonym for DOUBLE (exception: in REAL_AS_FLOAT SQL mode it is a synonym for FLOAT)',
  BIT: 'A bit-field type (M), storing M of bits per value (default is 1, maximum is 64)',
  BOOLEAN:
    'A synonym for TINYINT(1), a value of zero is considered false, nonzero values are considered true',
  SERIAL: 'An alias for BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE',
  TIMESTAMP:
    'A timestamp, range is 1970-01-01 00:00:01 UTC to 2038-01-19 03:14:07 UTC on 32-bit platforms (MariaDB 11.3 and earlier), and up to 2106-02-07 06:28:15 UTC on 64-bit platforms (MariaDB 11.5 and later), stored as the number of seconds since the epoch (1970-01-01 00:00:00 UTC)',
  YEAR: 'A year in four-digit (4, default) or two-digit (2) format, the allowable values are 70 (1970) to 69 (2069) or 1901 to 2155 and 0000',
  CHAR: 'A fixed-length (0-255, default 1) string that is always right-padded with spaces to the specified length when stored',
  TINYTEXT:
    'A TEXT column with a maximum length of 255 (2^8 - 1) characters, stored with a one-byte prefix indicating the length of the value in bytes',
  TEXT: 'A TEXT column with a maximum length of 65,535 (2^16 - 1) characters, stored with a two-byte prefix indicating the length of the value in bytes',
  MEDIUMTEXT:
    'A TEXT column with a maximum length of 16,777,215 (2^24 - 1) characters, stored with a three-byte prefix indicating the length of the value in bytes',
  LONGTEXT:
    'A TEXT column with a maximum length of 4,294,967,295 or 4GiB (2^32 - 1) characters, stored with a four-byte prefix indicating the length of the value in bytes',
  BINARY: 'Similar to the CHAR type, but stores binary byte strings rather than non-binary character strings',
  VARBINARY:
    'Similar to the VARCHAR type, but stores binary byte strings rather than non-binary character strings',
  TINYBLOB:
    'A BLOB column with a maximum length of 255 (2^8 - 1) bytes, stored with a one-byte prefix indicating the length of the value',
  MEDIUMBLOB:
    'A BLOB column with a maximum length of 16,777,215 (2^24 - 1) bytes, stored with a three-byte prefix indicating the length of the value',
  BLOB: 'A BLOB column with a maximum length of 65,535 (2^16 - 1) bytes, stored with a two-byte prefix indicating the length of the value',
  LONGBLOB:
    'A BLOB column with a maximum length of 4,294,967,295 or 4GiB (2^32 - 1) bytes, stored with a four-byte prefix indicating the length of the value',
  ENUM: "An enumeration, chosen from the list of up to 65,535 values or the special '' error value",
  SET: 'A single value chosen from a set of up to 64 members',
  GEOMETRY: 'A type that can store a geometry of any type',
  POINT: 'A point in 2-dimensional space',
  LINESTRING: 'A curve with linear interpolation between points',
  POLYGON: 'A polygon',
  MULTIPOINT: 'A collection of points',
  MULTILINESTRING: 'A collection of curves with linear interpolation between points',
  MULTIPOLYGON: 'A collection of polygons',
  GEOMETRYCOLLECTION: 'A collection of geometry objects of any type',
  JSON: 'Stores and enables efficient access to data in JSON (JavaScript Object Notation) documents',
  INET4: 'Intended for storage of IPv4 addresses',
  INET6:
    'Intended for storage of IPv6 addresses, as well as IPv4 addresses assuming conventional mapping of IPv4 addresses into IPv6 addresses',
  UUID: '128-bit UUID (Universally Unique Identifier)',
  VECTOR:
    'Stores vector data optimized for operations such as similarity search and machine learning applications',
  XMLTYPE: 'Intended for storage of XML data',
}

/** Descriptions built with sprintf in phpMyAdmin: [msgid, ...args] */
const SPRINTF_DESCRIPTIONS: Record<string, [string, ...string[]]> = {
  DATE: ['A date, supported range is %1$s to %2$s', '1000-01-01', '9999-12-31'],
  DATETIME: [
    'A date and time combination, supported range is %1$s to %2$s',
    '1000-01-01 00:00:00',
    '9999-12-31 23:59:59',
  ],
  TIME: ['A time, range is %1$s to %2$s', '-838:59:59', '838:59:59'],
  VARCHAR: [
    'A variable-length (%s) string, the effective maximum length is subject to the maximum row size',
    '0-65,535',
  ],
}

/** The untranslated msgid (gettext key) of a type description, for i18n lookups. */
export function getTypeDescriptionMsgid(type: string): string {
  const up = strtoupper(type)
  return SPRINTF_DESCRIPTIONS[up]?.[0] ?? DESCRIPTIONS[up] ?? ''
}

/**
 * pma: Types::getTypeDescription. `t` is the gettext hook applied to the msgid
 * before sprintf-style argument substitution.
 */
export function getTypeDescription(type: string, t: (msgid: string) => string = (s) => s): string {
  const up = strtoupper(type)
  const sp = SPRINTF_DESCRIPTIONS[up]
  if (sp !== undefined) {
    const [msgid, ...args] = sp
    let i = 0
    return t(msgid).replace(
      /%(?:(\d+)\$)?s/g,
      (_m, pos) => args[pos !== undefined ? Number(pos) - 1 : i++] ?? '',
    )
  }
  const d = DESCRIPTIONS[up]
  return d === undefined ? '' : t(d)
}

const CLASS_BY_TYPE: Record<string, TypeClass> = {}
for (const t of [
  'TINYINT',
  'SMALLINT',
  'MEDIUMINT',
  'INT',
  'BIGINT',
  'DECIMAL',
  'FLOAT',
  'DOUBLE',
  'REAL',
  'BIT',
  'BOOLEAN',
  'SERIAL',
])
  CLASS_BY_TYPE[t] = 'NUMBER'
for (const t of ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR']) CLASS_BY_TYPE[t] = 'DATE'
for (const t of [
  'CHAR',
  'VARCHAR',
  'TINYTEXT',
  'TEXT',
  'MEDIUMTEXT',
  'LONGTEXT',
  'BINARY',
  'VARBINARY',
  'TINYBLOB',
  'MEDIUMBLOB',
  'BLOB',
  'LONGBLOB',
  'ENUM',
  'SET',
  'INET4',
  'INET6',
])
  CLASS_BY_TYPE[t] = 'CHAR'
for (const t of [
  'GEOMETRY',
  'POINT',
  'LINESTRING',
  'POLYGON',
  'MULTIPOINT',
  'MULTILINESTRING',
  'MULTIPOLYGON',
  'GEOMETRYCOLLECTION',
])
  CLASS_BY_TYPE[t] = 'SPATIAL'
CLASS_BY_TYPE.JSON = 'JSON'
CLASS_BY_TYPE.UUID = 'UUID'

/** pma: Types::getTypeClass (type name without length, case-insensitive) */
export function getTypeClass(type: string): TypeClass {
  return CLASS_BY_TYPE[strtoupper(type)] ?? ''
}

const CHAR_FUNCTIONS = [
  'AES_DECRYPT',
  'AES_ENCRYPT',
  'BIN',
  'CHAR',
  'COMPRESS',
  'CURRENT_USER',
  'DATABASE',
  'DAYNAME',
  'DES_DECRYPT',
  'DES_ENCRYPT',
  'ENCRYPT',
  'HEX',
  'INET6_NTOA',
  'INET_NTOA',
  'LOAD_FILE',
  'LOWER',
  'LTRIM',
  'MD5',
  'MONTHNAME',
  'OLD_PASSWORD',
  'PASSWORD',
  'QUOTE',
  'REVERSE',
  'RTRIM',
  'SHA1',
  'SHA2',
  'SOUNDEX',
  'SPACE',
  'TRIM',
  'UNCOMPRESS',
  'UNHEX',
  'UPPER',
  'USER',
  'UUID',
  'UUID_v4',
  'UUID_v7',
  'VERSION',
]

const DATE_FUNCTIONS = [
  'CURRENT_DATE',
  'CURRENT_TIME',
  'DATE',
  'FROM_DAYS',
  'FROM_UNIXTIME',
  'LAST_DAY',
  'NOW',
  'SEC_TO_TIME',
  'SYSDATE',
  'TIME',
  'TIMESTAMP',
  'UTC_DATE',
  'UTC_TIME',
  'UTC_TIMESTAMP',
  'YEAR',
]

const NUMBER_FUNCTIONS = [
  'ABS',
  'ACOS',
  'ASCII',
  'ASIN',
  'ATAN',
  'BIT_LENGTH',
  'BIT_COUNT',
  'CEILING',
  'CHAR_LENGTH',
  'CONNECTION_ID',
  'COS',
  'COT',
  'CRC32',
  'DAYOFMONTH',
  'DAYOFWEEK',
  'DAYOFYEAR',
  'DEGREES',
  'EXP',
  'FLOOR',
  'HOUR',
  'INET6_ATON',
  'INET_ATON',
  'LENGTH',
  'LN',
  'LOG',
  'LOG2',
  'LOG10',
  'MICROSECOND',
  'MINUTE',
  'MONTH',
  'OCT',
  'ORD',
  'PI',
  'QUARTER',
  'RADIANS',
  'RAND',
  'ROUND',
  'SECOND',
  'SIGN',
  'SIN',
  'SQRT',
  'TAN',
  'TO_DAYS',
  'TO_SECONDS',
  'TIME_TO_SEC',
  'UNCOMPRESSED_LENGTH',
  'UNIX_TIMESTAMP',
  'UUID_SHORT',
  'WEEK',
  'WEEKDAY',
  'WEEKOFYEAR',
  'YEARWEEK',
]

const SPATIAL_FUNCTION_SUFFIXES = [
  'GeomFromText',
  'GeomFromWKB',
  'GeomCollFromText',
  'LineFromText',
  'MLineFromText',
  'PointFromText',
  'MPointFromText',
  'PolyFromText',
  'MPolyFromText',
  'GeomCollFromWKB',
  'LineFromWKB',
  'MLineFromWKB',
  'PointFromWKB',
  'MPointFromWKB',
  'PolyFromWKB',
  'MPolyFromWKB',
]

/** pma: Types::getFunctionsClass */
export function getFunctionsClass(cls: TypeClass, server: ServerInfo): string[] {
  const mariadb = isMariaDB(server)
  const v = server.version
  switch (cls) {
    case 'CHAR': {
      let ret = CHAR_FUNCTIONS
      if ((mariadb && v < 100012) || v < 50603) ret = ret.filter((f) => f !== 'INET6_NTOA')
      if (!mariadb || v < 110700) ret = ret.filter((f) => f !== 'UUID_v4' && f !== 'UUID_v7')
      return [...ret]
    }
    case 'DATE':
      return [...DATE_FUNCTIONS]
    case 'NUMBER': {
      if ((mariadb && v < 100012) || v < 50603) return NUMBER_FUNCTIONS.filter((f) => f !== 'INET6_ATON')
      return [...NUMBER_FUNCTIONS]
    }
    case 'SPATIAL':
      return v >= 50600 ? SPATIAL_FUNCTION_SUFFIXES.map((f) => `ST_${f}`) : [...SPATIAL_FUNCTION_SUFFIXES]
    default:
      return []
  }
}

/** PHP `sort()` on strings: byte-wise comparison */
function phpSortStrings(list: string[]): string[] {
  return list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** pma: Types::getAllFunctions (sorted union of CHAR, NUMBER, DATE, SPATIAL; duplicates kept) */
export function getAllFunctions(server: ServerInfo): string[] {
  return phpSortStrings([
    ...getFunctionsClass('CHAR', server),
    ...getFunctionsClass('NUMBER', server),
    ...getFunctionsClass('DATE', server),
    ...getFunctionsClass('SPATIAL', server),
  ])
}

/** Same as getAllFunctions; alias matching the old phpMyAdmin name `Types::getFunctions` */
export const getFunctions = getAllFunctions

/** pma: Types::getAttributes */
export function getAttributes(server: ServerInfo): string[] {
  const attributes = ['', 'BINARY', 'UNSIGNED', 'UNSIGNED ZEROFILL', 'on update CURRENT_TIMESTAMP']
  if (supportsCompressedColumns(server)) attributes.push('COMPRESSED=zlib')
  return attributes
}

/** A dropdown group from Types::getColumns; `'-'` entries are separators. */
export interface TypeGroup {
  /** untranslated label: Numeric, Date and time, String, Spatial, JSON, UUID, VECTOR, XML */
  group: string
  types: string[]
}

/** An entry of Types::getColumns: a top-level type ("most used") or a group. */
export type TypeCatalogEntry = string | TypeGroup

/**
 * pma: Types::getColumns. Ordered list: the "most used" plain types first,
 * then groups. Group labels are the untranslated msgids (`_pgettext` contexts:
 * "numeric types", "date and time types", "string types", "spatial types").
 */
export function getColumns(server: ServerInfo): TypeCatalogEntry[] {
  const mariadb = isMariaDB(server)
  const v = server.version
  const ret: TypeCatalogEntry[] = ['INT', 'VARCHAR', 'TEXT', 'DATE']
  if (isUUIDSupported(server)) ret.push('UUID')
  ret.push({
    group: 'Numeric',
    types: [
      'TINYINT',
      'SMALLINT',
      'MEDIUMINT',
      'INT',
      'BIGINT',
      '-',
      'DECIMAL',
      'FLOAT',
      'DOUBLE',
      'REAL',
      '-',
      'BIT',
      'BOOLEAN',
      'SERIAL',
    ],
  })
  ret.push({ group: 'Date and time', types: ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR'] })
  const stringTypes = [
    'CHAR',
    'VARCHAR',
    '-',
    'TINYTEXT',
    'TEXT',
    'MEDIUMTEXT',
    'LONGTEXT',
    '-',
    'BINARY',
    'VARBINARY',
    '-',
    'TINYBLOB',
    'BLOB',
    'MEDIUMBLOB',
    'LONGBLOB',
    '-',
    'ENUM',
    'SET',
  ]
  if (mariadb && v >= 100500) {
    stringTypes.push('-')
    if (v >= 101000) stringTypes.push('INET4')
    stringTypes.push('INET6')
  }
  ret.push({ group: 'String', types: stringTypes })
  ret.push({
    group: 'Spatial',
    types: [
      'GEOMETRY',
      'POINT',
      'LINESTRING',
      'POLYGON',
      'MULTIPOINT',
      'MULTILINESTRING',
      'MULTIPOLYGON',
      'GEOMETRYCOLLECTION',
    ],
  })
  if (isJsonSupported(server)) ret.push({ group: 'JSON', types: ['JSON'] })
  if (isUUIDSupported(server)) ret.push({ group: 'UUID', types: ['UUID'] })
  if (isVectorSupported(server)) ret.push({ group: 'VECTOR', types: ['VECTOR'] })
  if (isXmlTypeSupported(server)) ret.push({ group: 'XML', types: ['XMLTYPE'] })
  return ret
}

/** pma: Types::getIntegerTypes */
export const getIntegerTypes = (): string[] => ['tinyint', 'smallint', 'mediumint', 'int', 'bigint']

/** pma: Types::getFloatTypes */
export const getFloatTypes = (): string[] => ['decimal', 'float', 'double', 'real']

/** pma: Types::mapAliasToMysqlType */
export function mapAliasToMysqlType(alias: string): string {
  const map: Record<string, string> = {
    BOOL: 'TINYINT',
    BOOLEAN: 'TINYINT',
    'CHARACTER VARYING': 'VARCHAR',
    FIXED: 'DECIMAL',
    FLOAT4: 'FLOAT',
    FLOAT8: 'DOUBLE',
    INT1: 'TINYINT',
    INT2: 'SMALLINT',
    INT3: 'MEDIUMINT',
    INT4: 'INT',
    INT8: 'BIGINT',
    'LONG VARBINARY': 'MEDIUMBLOB',
    'LONG VARCHAR': 'MEDIUMTEXT',
    LONG: 'MEDIUMTEXT',
    MIDDLEINT: 'MEDIUMINT',
    NUMERIC: 'DECIMAL',
  }
  return Object.hasOwn(map, alias) ? (map[alias] as string) : alias
}

/** pma: Types::getIntegerRange — [min, max] as strings (never parsed) */
export function getIntegerRange(type: string, signed = true): [string, string] {
  const signedRanges: Record<string, [string, string]> = {
    tinyint: ['-128', '127'],
    smallint: ['-32768', '32767'],
    mediumint: ['-8388608', '8388607'],
    int: ['-2147483648', '2147483647'],
    bigint: ['-9223372036854775808', '9223372036854775807'],
  }
  const unsignedRanges: Record<string, [string, string]> = {
    tinyint: ['0', '255'],
    smallint: ['0', '65535'],
    mediumint: ['0', '16777215'],
    int: ['0', '4294967295'],
    bigint: ['0', '18446744073709551615'],
  }
  const table = signed ? signedRanges : unsignedRanges
  return Object.hasOwn(table, type) ? [...(table[type] as [string, string])] : ['', '']
}
