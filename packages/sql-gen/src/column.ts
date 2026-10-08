/**
 * Column definitions, CREATE TABLE and ALTER TABLE ... ADD.
 *
 * pma: src/Table/Table.php::generateFieldSpec, ::generateAlter
 *      src/CreateAddField.php
 *      src/Util.php::getCharsetQueryPart
 */

import {
  type ServerInfo,
  getCharsetQueryPart,
  getIndexTypes,
  isIntegersSupportLength,
  isMariaDb,
  isMySqlOrPerconaDb,
  isVirtualCollationSupported,
  php,
} from '@bettermyadmin/mysql-types'
import { type QuoteOptions, backquote, quoteString } from './quote.ts'

/** Common context of the DDL builders */
export interface DdlContext {
  server: ServerInfo
  quote?: QuoteOptions
}

/** Default kinds of the column form (`field_default_type`). Lower-case function forms are accepted too. */
export type DefaultType =
  | 'NONE'
  | 'USER_DEFINED'
  | 'NULL'
  | 'CURRENT_TIMESTAMP'
  | 'current_timestamp()'
  | 'UUID'
  | 'uuid()'
  | 'UUID_v4'
  | 'uuid_v4()'
  | 'UUID_v7'
  | 'uuid_v7()'
  | (string & {})

export interface FieldSpecInput {
  name: string
  /** 'INT', 'VARCHAR', 'BIT', ... */
  type: string
  /** '2', '5,2', "'a','b'", '' */
  length?: string
  /** '', 'UNSIGNED', 'UNSIGNED ZEROFILL', 'BINARY', 'on update CURRENT_TIMESTAMP', 'COMPRESSED=zlib' */
  attribute?: string
  collation?: string
  /** `false`: no NULL clause; `'YES'`: NULL; any other string: NOT NULL */
  null?: string | false
  defaultType?: DefaultType
  /** raw default for USER_DEFINED (hex digits for BINARY/VARBINARY, 0/1 string for BIT) */
  defaultValue?: string
  /** 'AUTO_INCREMENT' or other extra text, emitted verbatim */
  extra?: string
  comment?: string
  /** '', 'VIRTUAL', 'STORED', 'PERSISTENT' */
  virtuality?: string
  expression?: string
  /** '' (stay), '-first', or the column name to place it AFTER */
  moveTo?: string
  /** columns having a PRIMARY or UNIQUE key; when given, AUTO_INCREMENT adds `, ADD PRIMARY KEY` if missing */
  columnsWithIndex?: readonly (string | number)[] | null
  /** the old name (CHANGE) */
  oldColumnName?: string | null
}

const NO_LENGTH =
  /^(DATE|TINYBLOB|TINYTEXT|BLOB|TEXT|MEDIUMBLOB|MEDIUMTEXT|LONGBLOB|LONGTEXT|SERIAL|BOOLEAN|UUID|JSON)$/i
const COLLATION_TYPES = /^(TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|VARCHAR|CHAR|ENUM|SET)$/i
const TIMESTAMP_LITERAL = /^'\d\d\d\d-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?'(?=\n?$)/

/**
 * Generates the column specification for CREATE TABLE / ALTER TABLE.
 *
 * pma: src/Table/Table.php::generateFieldSpec
 */
export function generateFieldSpec(input: FieldSpecInput, ctx: DdlContext): string {
  const { name, type } = input
  const length = input.length ?? ''
  const attribute = input.attribute ?? ''
  let collation = input.collation ?? ''
  const nullable = input.null ?? false
  const defaultType = input.defaultType ?? 'USER_DEFINED'
  const defaultValue = input.defaultValue ?? ''
  let extra = input.extra ?? ''
  const comment = input.comment ?? ''
  const virtuality = input.virtuality ?? ''
  const expression = input.expression ?? ''
  const moveTo = input.moveTo ?? ''
  const columnsWithIndex = input.columnsWithIndex ?? null
  const oldColumnName = input.oldColumnName ?? null
  const server = ctx.server
  const q = (s: string): string => quoteString(s, ctx.quote)

  const isTimestamp = type.toUpperCase().includes('TIMESTAMP')
  let query = `${backquote(name)} ${type}`

  // a length is allowed for TIME, DATETIME and TIMESTAMP (fsp) and FLOAT/DOUBLE(M,D)
  if (length !== '' && !NO_LENGTH.test(type) && isIntegersSupportLength(type, length, server)) {
    query += `(${length})`
  }

  if (attribute !== '') {
    query += ` ${attribute}`
    if (isTimestamp && attribute.toUpperCase().includes('TIMESTAMP') && length !== '') {
      query += `(${length})`
    }
  }

  // PHP truthiness: '0' is not a virtuality
  const hasVirtuality = php.truthy(virtuality)
  // only MySQL supports extra column properties on generated columns
  const isVirtualColMysql = hasVirtuality && isMySqlOrPerconaDb(server)

  if (collation !== '' && collation !== 'NULL' && COLLATION_TYPES.test(type)) {
    // MariaDB supports only CHARACTER SET on generated text columns before MDEV-12161 fixes
    if (hasVirtuality && isMariaDb(server) && !isVirtualCollationSupported(server)) {
      collation = collation.replace(/_[\s\S]+/, '')
    }
    query += getCharsetQueryPart(collation, true)
  }

  if (virtuality !== '') {
    query += ` AS (${expression}) ${virtuality}`
  }

  if (virtuality === '' || isVirtualColMysql) {
    if (nullable !== false) {
      query += nullable === 'YES' ? ' NULL' : ' NOT NULL'
    }

    if (virtuality === '') {
      switch (defaultType) {
        case 'USER_DEFINED':
          if (isTimestamp && defaultValue === '0') {
            // a TIMESTAMP does not accept DEFAULT '0' but DEFAULT 0 works
            query += ' DEFAULT 0'
          } else if (isTimestamp && TIMESTAMP_LITERAL.test(defaultValue)) {
            query += ` DEFAULT ${defaultValue}`
          } else if (type === 'BIT') {
            query += ` DEFAULT b'${defaultValue.replace(/[^01]/g, '0')}'`
          } else if (type === 'BOOLEAN') {
            // the original patterns are unanchored alternations (^1|T|TRUE|YES$), kept as is
            if (/^1|T|TRUE|YES(?=\n?$)/i.test(defaultValue)) query += ' DEFAULT TRUE'
            else if (/^0|F|FALSE|NO(?=\n?$)/i.test(defaultValue)) query += ' DEFAULT FALSE'
            else query += ` DEFAULT ${q(defaultValue)}` // invalid BOOLEAN value
          } else if (type === 'BINARY' || type === 'VARBINARY') {
            query += ` DEFAULT 0x${defaultValue}`
          } else if (defaultValue === 'uuid_v4()' || defaultValue === 'uuid_v7()') {
            query += ` DEFAULT ${defaultValue}`
          } else if (defaultValue === 'unix_timestamp()' || defaultValue === 'UNIX_TIMESTAMP()') {
            query += ` DEFAULT ${defaultValue}`
          } else if (
            defaultValue.startsWith('current_timestamp') ||
            defaultValue.startsWith('CURRENT_TIMESTAMP')
          ) {
            query += ` DEFAULT CURRENT_TIMESTAMP(${length})`
          } else {
            query += ` DEFAULT ${q(defaultValue)}`
          }
          break
        case 'NULL':
        case 'CURRENT_TIMESTAMP':
        case 'current_timestamp()':
          // NULL: unchecking the NULL box while keeping DEFAULT NULL drops the default
          // (in phpMyAdmin this is a switch fall-through into the CURRENT_TIMESTAMP branch)
          if (defaultType === 'NULL' && nullable !== false && nullable !== 'YES') break
          query += ` DEFAULT ${defaultType}`
          if (length !== '' && isTimestamp && defaultType !== 'NULL') query += `(${length})`
          break
        case 'UUID':
        case 'uuid()':
          query += ' DEFAULT uuid()'
          break
        case 'UUID_v4':
        case 'uuid_v4()':
          query += ' DEFAULT uuid_v4()'
          break
        case 'UUID_v7':
        case 'uuid_v7()':
          query += ' DEFAULT uuid_v7()'
          break
        default:
          break
      }
    }

    if (extra !== '') {
      if (virtuality !== '') {
        extra = php.trim(extra.replace(/^\s*AUTO_INCREMENT\s*/i, ' '))
      }
      query += ` ${extra}`
    }
  }

  if (comment !== '') query += ` COMMENT ${q(comment)}`

  // move column; the dash can't appear as part of a column name
  if (moveTo === '-first') query += ' FIRST'
  else if (moveTo !== '') query += ` AFTER ${backquote(moveTo)}`

  if (virtuality === '' && extra !== '' && columnsWithIndex !== null) {
    const ref = oldColumnName === null ? name : oldColumnName
    if (!php.looseInArray(ref, columnsWithIndex)) {
      query += `, ADD PRIMARY KEY (${backquote(name)})`
    }
  }

  return query
}

/**
 * `` `old` <spec of new> `` for `ALTER TABLE ... CHANGE`.
 *
 * pma: src/Table/Table.php::generateAlter
 */
export function generateAlter(
  oldColumnName: string,
  input: Omit<FieldSpecInput, 'oldColumnName'>,
  ctx: DdlContext,
): string {
  return `${backquote(oldColumnName)} ${generateFieldSpec({ ...input, oldColumnName }, ctx)}`
}

/** One column row of the create-table / add-columns form. */
export interface ColumnDefinition {
  /** rows with an empty name are skipped (but keep their position for index col_index) */
  name: string
  type: string
  length?: string
  attribute?: string
  collation?: string
  /** 'YES' when the NULL checkbox is ticked; default 'NO' */
  null?: string
  defaultType?: DefaultType
  defaultValue?: string
  extra?: string
  comment?: string
  virtuality?: string
  expression?: string
}

/** An index of the create-table / add-columns form (the JSON in `primary_indexes`, `indexes`, ...). */
export interface IndexDefinition {
  /** Key_name ('' / 'PRIMARY' = unnamed) */
  keyName?: string
  comment?: string
  /** Index_choice: PRIMARY, INDEX, UNIQUE, FULLTEXT, SPATIAL */
  choice: string
  keyBlockSize?: string | number
  parser?: string
  /** Index_type: BTREE / HASH (others are ignored) */
  type?: string
  /** colIndex refers to the position in the column list (including skipped rows); size is the prefix length */
  columns: { colIndex: number | string; size?: string | number }[]
}

export interface IndexSet {
  /** only the first primary index is used */
  primary?: readonly IndexDefinition[]
  index?: readonly IndexDefinition[]
  unique?: readonly IndexDefinition[]
  fulltext?: readonly IndexDefinition[]
  spatial?: readonly IndexDefinition[]
}

/** A partition / sub-partition of the partition editor. */
export interface PartitionDefinition {
  name: string
  /** '', 'LESS THAN', 'LESS THAN MAXVALUE', 'IN' */
  valueType?: string
  value?: string
  engine?: string
  comment?: string
  dataDirectory?: string
  indexDirectory?: string
  maxRows?: string
  minRows?: string
  tablespace?: string
  nodeGroup?: string
  subpartitions?: readonly PartitionDefinition[]
}

export interface PartitioningInput {
  partitionBy?: string
  partitionExpr?: string
  partitionCount?: string | number
  subpartitionBy?: string
  subpartitionExpr?: string
  subpartitionCount?: string | number
  partitions?: readonly PartitionDefinition[]
}

const truthy = (v: string | number | null | undefined): boolean =>
  v !== undefined && v !== null && (typeof v === 'number' ? v !== 0 : php.truthy(v))
const greaterThanOne = (v: string | number): boolean =>
  typeof v === 'number' ? v > 1 : php.looseGreaterThanInt(v, 1)

/**
 * pma: src/CreateAddField.php::getPartitionsDefinition
 * Note: comment and directory values are inserted verbatim between quotes,
 * exactly like phpMyAdmin (no escaping).
 */
export function getPartitionsDefinition(p: PartitioningInput): string {
  let sql = ''
  if (
    truthy(p.partitionBy) &&
    truthy(p.partitionExpr) &&
    truthy(p.partitionCount) &&
    greaterThanOne(p.partitionCount ?? 0)
  ) {
    sql += ` PARTITION BY ${p.partitionBy} (${p.partitionExpr}) PARTITIONS ${p.partitionCount}`
  }
  if (
    truthy(p.subpartitionBy) &&
    truthy(p.subpartitionExpr) &&
    truthy(p.subpartitionCount) &&
    greaterThanOne(p.subpartitionCount ?? 0)
  ) {
    sql += ` SUBPARTITION BY ${p.subpartitionBy} (${p.subpartitionExpr}) SUBPARTITIONS ${p.subpartitionCount}`
  }
  if (p.partitions !== undefined && p.partitions.length > 0) {
    sql += ` (${p.partitions.map((x) => getPartitionDefinition(x, false)).join(', ')})`
  }
  return sql
}

/** pma: src/CreateAddField.php::getPartitionDefinition */
function getPartitionDefinition(partition: PartitionDefinition, isSubPartition: boolean): string {
  let sql = ` ${isSubPartition ? 'SUB' : ''}PARTITION ${partition.name}`
  if (truthy(partition.valueType)) {
    sql += ` VALUES ${partition.valueType}`
    if (partition.valueType !== 'LESS THAN MAXVALUE') sql += ` (${partition.value ?? ''})`
  }
  if (truthy(partition.engine)) sql += ` ENGINE = ${partition.engine}`
  if (truthy(partition.comment)) sql += ` COMMENT = '${partition.comment}'`
  if (truthy(partition.dataDirectory)) sql += ` DATA DIRECTORY = '${partition.dataDirectory}'`
  if (truthy(partition.indexDirectory)) sql += ` INDEX_DIRECTORY = '${partition.indexDirectory}'`
  if (truthy(partition.maxRows)) sql += ` MAX_ROWS = ${partition.maxRows}`
  if (truthy(partition.minRows)) sql += ` MIN_ROWS = ${partition.minRows}`
  if (truthy(partition.tablespace)) sql += ` TABLESPACE = ${partition.tablespace}`
  if (truthy(partition.nodeGroup)) sql += ` NODEGROUP = ${partition.nodeGroup}`
  if (partition.subpartitions !== undefined && partition.subpartitions.length > 0) {
    sql += ` (${partition.subpartitions.map((x) => getPartitionDefinition(x, true)).join(', ')})`
  }
  return sql
}

/** pma: src/CreateAddField.php::buildIndexStatement */
function buildIndexStatement(
  index: IndexDefinition,
  indexChoice: string,
  columns: readonly ColumnDefinition[],
  isCreateTable: boolean,
  ctx: DdlContext,
): string {
  let sql = (isCreateTable ? '' : 'ADD ') + indexChoice
  if (truthy(index.keyName) && index.keyName !== 'PRIMARY') sql += ` ${backquote(index.keyName)}`
  const fields = index.columns.map((column) => {
    const colIndex =
      typeof column.colIndex === 'number' ? column.colIndex : Number(php.intCast(column.colIndex))
    let f = backquote(php.rtrim(columns[colIndex]?.name ?? ''))
    if (truthy(column.size)) f += `(${column.size})`
    return f
  })
  sql += ` (${fields.join(', ')})`
  if (truthy(index.keyBlockSize)) {
    const kbs =
      typeof index.keyBlockSize === 'number'
        ? Math.trunc(index.keyBlockSize)
        : php.intCast(index.keyBlockSize ?? '')
    sql += ` KEY_BLOCK_SIZE = ${kbs}`
  }
  // specifying an index type is allowed only for primary, unique and index
  if (
    index.choice !== 'SPATIAL' &&
    index.choice !== 'FULLTEXT' &&
    getIndexTypes().includes(index.type ?? '')
  ) {
    sql += ` USING ${index.type}`
  }
  if (index.choice === 'FULLTEXT' && truthy(index.parser)) sql += ` WITH PARSER ${index.parser}`
  if (truthy(index.comment)) sql += ` COMMENT ${quoteString(index.comment ?? '', ctx.quote)}`
  return sql
}

/** Where added columns go: phpMyAdmin's `field_where` + `after_field`. */
export interface ColumnPosition {
  /** 'last' (default), 'first' or 'after' */
  where?: string
  afterField?: string
}

/** pma: CreateAddField::buildColumnCreationStatement + setColumnCreationStatementSuffix */
function buildColumnCreationStatement(
  columns: readonly ColumnDefinition[],
  isCreateTable: boolean,
  position: ColumnPosition,
  ctx: DdlContext,
): string[] {
  const definitions: string[] = []
  let previousField = -1
  columns.forEach((c, i) => {
    if (c.name === '') return
    let definition =
      (isCreateTable ? '' : 'ADD ') +
      generateFieldSpec(
        {
          name: php.rtrim(c.name),
          type: c.type,
          length: c.length ?? '',
          attribute: c.attribute ?? '',
          collation: c.collation ?? '',
          null: c.null ?? 'NO',
          defaultType: c.defaultType ?? '',
          defaultValue: c.defaultValue ?? '',
          extra: c.extra ?? '',
          comment: c.comment ?? '',
          virtuality: c.virtuality ?? '',
          expression: c.expression ?? '',
        },
        ctx,
      )
    definition += columnSuffix(previousField, isCreateTable, position, columns)
    previousField = i
    definitions.push(definition)
  })
  return definitions
}

function columnSuffix(
  previousField: number,
  isCreateTable: boolean,
  position: ColumnPosition,
  columns: readonly ColumnDefinition[],
): string {
  if (isCreateTable) return ' '
  const where = position.where ?? 'last'
  if (where === 'last') return ' '
  // only the first field can be added somewhere other than at the end
  if (previousField === -1) {
    if (where === 'first') return ' FIRST'
    if (truthy(position.afterField)) return ` AFTER ${backquote(position.afterField)}`
    return ' '
  }
  // phpMyAdmin uses the untrimmed name here
  return ` AFTER ${backquote(columns[previousField]?.name ?? '')}`
}

/** pma: CreateAddField::getColumnCreationStatements */
function getColumnCreationStatements(
  columns: readonly ColumnDefinition[],
  indexes: IndexSet,
  isCreateTable: boolean,
  position: ColumnPosition,
  ctx: DdlContext,
): string {
  const definitions = buildColumnCreationStatement(columns, isCreateTable, position, ctx)
  const primary = indexes.primary?.[0]
  if (primary !== undefined)
    definitions.push(buildIndexStatement(primary, 'PRIMARY KEY', columns, isCreateTable, ctx))
  for (const i of indexes.index ?? [])
    definitions.push(buildIndexStatement(i, 'INDEX', columns, isCreateTable, ctx))
  for (const i of indexes.unique ?? [])
    definitions.push(buildIndexStatement(i, 'UNIQUE', columns, isCreateTable, ctx))
  for (const i of indexes.fulltext ?? [])
    definitions.push(buildIndexStatement(i, 'FULLTEXT', columns, isCreateTable, ctx))
  for (const i of indexes.spatial ?? [])
    definitions.push(buildIndexStatement(i, 'SPATIAL', columns, isCreateTable, ctx))
  return definitions.join(', ').replace(/, $/, '')
}

export interface CreateTableInput {
  db: string
  table: string
  columns: readonly ColumnDefinition[]
  indexes?: IndexSet
  /** `tbl_storage_engine`; '' / 'Default' = server default */
  storageEngine?: string
  /** `tbl_collation` */
  collation?: string
  /** FEDERATED connection string */
  connection?: string
  comment?: string
  partitioning?: PartitioningInput
}

export interface CreateTableOptions extends DdlContext {
  /**
   * Engines reported by `SHOW STORAGE ENGINES` (StorageEngine::isValid). An
   * unknown engine is silently left out of the statement. Omit to accept any.
   * `PBMS` is always valid.
   */
  storageEngines?: readonly string[]
}

/**
 * `CREATE TABLE `db`.`table` (...) ENGINE = ... CHARSET=... COMMENT = '...' PARTITION BY ...;`
 *
 * pma: src/CreateAddField.php::getTableCreationQuery
 */
export function getTableCreationQuery(input: CreateTableInput, ctx: CreateTableOptions): string {
  const statement = getColumnCreationStatements(input.columns, input.indexes ?? {}, true, {}, ctx)
  let sql = `CREATE TABLE ${backquote(input.db)}.${backquote(php.trim(input.table))} (${statement})`
  const engine = input.storageEngine ?? ''
  const engineValid =
    engine === 'PBMS' || ctx.storageEngines === undefined || ctx.storageEngines.includes(engine)
  if (truthy(engine) && engine !== 'Default' && engineValid) sql += ` ENGINE = ${engine}`
  if (truthy(input.collation)) sql += getCharsetQueryPart(input.collation ?? '')
  if (truthy(input.connection) && truthy(engine) && engine === 'FEDERATED') {
    sql += ` CONNECTION = ${quoteString(input.connection ?? '', ctx.quote)}`
  }
  if (truthy(input.comment)) sql += ` COMMENT = ${quoteString(input.comment ?? '', ctx.quote)}`
  sql += getPartitionsDefinition(input.partitioning ?? {})
  return `${sql};`
}

export interface AddColumnsInput {
  table: string
  columns: readonly ColumnDefinition[]
  indexes?: IndexSet
  position?: ColumnPosition
  /** `online_transaction`: append `, ALGORITHM=INPLACE, LOCK=NONE` */
  onlineTransaction?: boolean
}

/**
 * `ALTER TABLE `t` ADD ... [FIRST|AFTER ...], ADD INDEX ...;`
 *
 * pma: src/CreateAddField.php::getColumnCreationQuery
 */
export function getColumnCreationQuery(input: AddColumnsInput, ctx: DdlContext): string {
  const statement = getColumnCreationStatements(
    input.columns,
    input.indexes ?? {},
    false,
    input.position ?? {},
    ctx,
  )
  let sql = `ALTER TABLE ${backquote(input.table)} ${statement}`
  if (input.onlineTransaction) sql += ', ALGORITHM=INPLACE, LOCK=NONE'
  return `${sql};`
}
