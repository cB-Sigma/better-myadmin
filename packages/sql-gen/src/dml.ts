/**
 * INSERT / UPDATE / DELETE generation of the Insert/Edit form, grid edit and
 * row deletion.
 *
 * pma: src/InsertEdit.php (getQueryValueForInsert, getQueryValueForUpdate,
 *      getValueFormattedAsSql, formatAsSqlFunction, formatAsSqlValueBasedOnType)
 *      src/Controllers/Table/ReplaceController.php (statement assembly)
 *      src/Query/Generator.php::buildInsertSqlQuery
 *      src/Display/Results.php::getDeleteAndKillLinks (DELETE)
 */

import {
  FUNC_NO_PARAM,
  FUNC_OPTIONAL_PARAM,
  PHP_PASSWORD_HASH,
  type ServerInfo,
  getGisFromTextFunctions,
  getGisFromWKBFunctions,
  php,
} from '@bettermyadmin/mysql-types'
import { type QuoteOptions, backquote, hexLiteral, quoteString } from './quote.ts'

/**
 * One submitted column of a row (phpMyAdmin's `EditField`).
 *
 * `type` is the `fields_type` hidden input: '' (plain), 'protected' (binary
 * protected by ProtectBinary), 'uuid', 'hex' (binary edited as hex), 'bit',
 * 'datetime', 'timestamp', 'date', ...
 */
export interface EditField {
  columnName: string
  value: string
  type: string
  autoIncrement: boolean
  /** the NULL checkbox is ticked */
  isNull: boolean
  /** the NULL checkbox was ticked when the form was rendered (`fields_null_prev`) */
  wasPreviouslyNull: boolean
  /** selected function ('' = none, 'PHP_PASSWORD_HASH' = application-side hash) */
  function: string
  salt: string | null
  /** value when the form was rendered (`fields_prev`) */
  previousValue: string | null
  /** `value` is an uploaded file already formatted as `0x...` */
  isUploaded: boolean
}

/** Builds an EditField for an uploaded file: phpMyAdmin turns the file into `0x<hex>`. */
export function uploadedEditField(
  columnName: string,
  content: Uint8Array,
  rest: Partial<EditField> = {},
): EditField {
  return {
    columnName,
    type: '',
    autoIncrement: false,
    isNull: false,
    wasPreviouslyNull: false,
    function: '',
    salt: null,
    previousValue: null,
    ...rest,
    value: hexLiteral(content),
    isUploaded: true,
  }
}

/** Server-side effects phpMyAdmin performs while building values, injected by the caller. */
export interface DmlContext {
  server: ServerInfo
  quote?: QuoteOptions
  /** PHP password_hash(value, PASSWORD_DEFAULT) — needed for the PHP_PASSWORD_HASH function */
  passwordHash?: (value: string) => string
  /** result of `SELECT UUID()` — phpMyAdmin pre-evaluates the UUID function so the literal is visible */
  uuid?: () => string
}

/**
 * The query phpMyAdmin runs to fetch the current value of a protected (binary)
 * column before an INSERT that copies a row. Run it and pass the result as
 * `protectedValue` to getQueryValueForInsert.
 *
 * pma: src/InsertEdit.php::getQueryValueForInsert
 */
export function buildProtectedValueQuery(columnName: string, table: string, whereClause: string): string {
  return `SELECT ${backquote(columnName)} FROM ${backquote(table)} WHERE ${whereClause} LIMIT 1;`
}

/** pma: InsertEdit::formatAsSqlFunction */
function formatAsSqlFunction(f: EditField, ctx: DmlContext): string {
  const q = (s: string): string => quoteString(s, ctx.quote)
  if (f.function === PHP_PASSWORD_HASH) {
    if (ctx.passwordHash === undefined) throw new Error('PHP_PASSWORD_HASH needs ctx.passwordHash')
    return q(ctx.passwordHash(f.value))
  }
  if (f.function === 'UUID') {
    if (ctx.uuid === undefined) throw new Error('the UUID function needs ctx.uuid (SELECT UUID())')
    return q(ctx.uuid())
  }
  if (
    getGisFromTextFunctions(ctx.server).includes(f.function) ||
    getGisFromWKBFunctions(ctx.server).includes(f.function)
  ) {
    // preg_match('/^(\'?)(.*?)\1(?:,(\d+))?$/', ...): no /s, so a multi-line value does not match
    const m = /^('?)(.*?)\1(?:,(\d+))?(?=\n?$)/.exec(f.value)
    if (m === null) {
      // phpMyAdmin fails with a TypeError here (quoteString(null))
      throw new TypeError(`invalid value for ${f.function}`)
    }
    return `${f.function}(${q(m[2] ?? '')}${m[3] !== undefined ? `,${m[3]}` : ''})`
  }
  if (!FUNC_NO_PARAM.includes(f.function) || (f.value !== '' && FUNC_OPTIONAL_PARAM.includes(f.function))) {
    if (
      (f.salt !== null && ['AES_ENCRYPT', 'AES_DECRYPT', 'SHA2'].includes(f.function)) ||
      (php.truthy(f.salt) && ['DES_ENCRYPT', 'DES_DECRYPT', 'ENCRYPT'].includes(f.function))
    ) {
      return `${f.function}(${q(f.value)},${q(f.salt ?? '')})`
    }
    if (f.function === 'NOW' && php.isNumericString(f.value)) {
      const n = Number(f.value)
      if (n >= 0 && n <= 6) return `${f.function}(${php.intCast(f.value)})`
    }
    return `${f.function}(${q(f.value)})`
  }
  return `${f.function}()`
}

/** pma: InsertEdit::formatAsSqlValueBasedOnType */
function formatAsSqlValueBasedOnType(
  f: EditField,
  protectedValue: string | Uint8Array,
  ctx: DmlContext,
): string {
  if (f.type === 'protected') {
    // keep the stored value when copying; insert NULL / '' / nothing otherwise
    if (protectedValue.length > 0) return hexLiteral(protectedValue)
    if (f.isNull) return 'NULL'
    if (f.wasPreviouslyNull) return "''"
    return ''
  }
  if (f.type === 'uuid' && !f.isNull && ["''", '', "'uuid()'", 'uuid()'].includes(f.value)) return 'uuid()'
  if (f.type === 'uuid' && !f.isNull && f.value === "'uuid_v4()'") return 'uuid_v4()'
  if (f.type === 'uuid' && !f.isNull && f.value === "'uuid_v7()'") return 'uuid_v7()'
  if (f.value === '') {
    // NULL for auto-increment (strict mode safe) or when the NULL box is ticked
    return f.autoIncrement || f.isNull ? 'NULL' : "''"
  }
  if (f.type === 'hex') return f.value.startsWith('0x') ? f.value : `0x${f.value}`
  if (f.type === 'bit') return `b${quoteString(f.value.replace(/[^01]/g, '0'), ctx.quote)}`
  if (
    (f.type !== 'datetime' && f.type !== 'timestamp' && f.type !== 'date') ||
    !/^current_timestamp(\([0-6]?\))?(?=\n?$)/i.test(f.value)
  ) {
    return quoteString(f.value, ctx.quote)
  }
  return f.value
}

/** pma: InsertEdit::getValueFormattedAsSql */
function getValueFormattedAsSql(f: EditField, protectedValue: string | Uint8Array, ctx: DmlContext): string {
  if (f.isUploaded) return f.value
  if (f.function !== '') return formatAsSqlFunction(f, ctx)
  return formatAsSqlValueBasedOnType(f, protectedValue, ctx)
}

export interface InsertValueOptions {
  /** editing existing rows (a where clause was posted) */
  usingKey?: boolean
  whereClause?: string
  /**
   * Current value of a protected column (result of buildProtectedValueQuery);
   * only used when `type === 'protected'`, `usingKey` and a where clause are set.
   */
  protectedValue?: string | Uint8Array | null
}

/**
 * The SQL value of one column for INSERT ('' = column omitted).
 * pma: src/InsertEdit.php::getQueryValueForInsert
 */
export function getQueryValueForInsert(
  f: EditField,
  ctx: DmlContext,
  options: InsertValueOptions = {},
): string {
  let protectedValue: string | Uint8Array = ''
  if (f.type === 'protected' && options.usingKey === true && (options.whereClause ?? '') !== '') {
    protectedValue = options.protectedValue ?? ''
  }
  return getValueFormattedAsSql(f, protectedValue, ctx)
}

/**
 * `` `col` = value `` for UPDATE, or '' when the column is unchanged.
 * pma: src/InsertEdit.php::getQueryValueForUpdate
 */
export function getQueryValueForUpdate(f: EditField, ctx: DmlContext): string {
  const current = getValueFormattedAsSql(f, '', ctx)
  // avoid setting a field to NULL when it's already NULL
  if (f.wasPreviouslyNull && f.isNull) return ''
  // a blob field that hasn't been changed has no value
  if (current === '') return ''
  if (f.wasPreviouslyNull || f.isNull || f.function !== '' || f.value !== f.previousValue) {
    return `${backquote(f.columnName)} = ${current}`
  }
  return ''
}

/** pma: src/Query/Generator.php::buildInsertSqlQuery */
export function buildInsertSqlQuery(
  table: string,
  isInsertIgnore: boolean,
  queryFields: readonly string[],
  valueSets: readonly string[],
): string {
  return `${isInsertIgnore ? 'INSERT IGNORE ' : 'INSERT '}INTO ${backquote(table)} (${queryFields.join(', ')}) VALUES (${valueSets.join('), (')})`
}

/** A submitted row of the Insert/Edit form */
export interface EditRow {
  /** the row's unique condition when editing (`where_clause[]`), absent for new rows */
  whereClause?: string
  fields: readonly (EditField & {
    /** generated column: never written */
    virtual?: boolean
    /** current value of a protected column, see buildProtectedValueQuery */
    protectedValue?: string | Uint8Array | null
  })[]
  /** `insert_ignore_<n>` checkbox: skip this new row */
  skip?: boolean
}

export interface InsertEditInput {
  table: string
  rows: readonly EditRow[]
  /**
   * `submit_type`: 'save' (UPDATE when rows have where clauses), 'insert' /
   * 'showinsert' (INSERT even when editing: "Insert as new row"), 'insertignore'.
   */
  submitType?: string
  /** `clause_is_unique`: when falsy UPDATE statements get `LIMIT 1` */
  clauseIsUnique?: boolean
  /**
   * Column defaults from information_schema (InsertEdit::getColumnDefaultValues:
   * quoted unless DEFAULT_GENERATED). An INSERT value equal to its column default
   * is used verbatim.
   */
  columnDefaults?: Readonly<Record<string, string | null>>
}

/**
 * Builds the statements of `/table/replace`: one multi-row INSERT, or one
 * UPDATE per edited row (`... WHERE <clause>[ LIMIT 1]`). Returns [] for "No change".
 *
 * pma: src/Controllers/Table/ReplaceController.php::__invoke
 */
export function buildInsertEditQueries(input: InsertEditInput, ctx: DmlContext): string[] {
  const usingKey = input.rows.some((r) => r.whereClause !== undefined)
  const submitType = input.submitType ?? ''
  const isInsert = !usingKey || ['insert', 'showinsert', 'insertignore'].includes(submitType)
  const isInsertIgnore = submitType === 'insertignore'
  const queries: string[] = []
  const valueSets: string[] = []
  const queryFields: string[] = []

  input.rows.forEach((row, rowNumber) => {
    if (!usingKey && row.skip === true) return
    const whereClause = usingKey ? (row.whereClause ?? '') : String(rowNumber)
    const queryValues: string[] = []
    for (const f of row.fields) {
      if (f.virtual === true) continue
      let queryPart: string
      if (isInsert) {
        if (input.columnDefaults !== undefined && f.value === input.columnDefaults[f.columnName]) {
          queryPart = f.value
        } else {
          queryPart = getQueryValueForInsert(f, ctx, {
            usingKey,
            whereClause,
            protectedValue: f.protectedValue ?? null,
          })
        }
        // first inserted row prepares the list of fields
        if (queryPart !== '' && valueSets.length === 0) queryFields.push(backquote(f.columnName))
      } else {
        queryPart = getQueryValueForUpdate(f, ctx)
      }
      if (queryPart !== '') queryValues.push(queryPart)
    }
    if (queryValues.length === 0) return
    if (isInsert) {
      valueSets.push(queryValues.join(', '))
    } else {
      queries.push(
        `UPDATE ${backquote(input.table)} SET ${queryValues.join(', ')} WHERE ${whereClause}${input.clauseIsUnique ? '' : ' LIMIT 1'}`,
      )
    }
  })

  if (isInsert && valueSets.length > 0)
    return [buildInsertSqlQuery(input.table, isInsertIgnore, queryFields, valueSets)]
  return queries
}

/**
 * `DELETE FROM `t` WHERE <clause>[ LIMIT 1]` for a row action.
 * pma: src/Display/Results.php::getDeleteAndKillLinks
 */
export function buildDeleteRowQuery(table: string, whereClause: string, clauseIsUnique: boolean): string {
  return `DELETE FROM ${backquote(table)} WHERE ${whereClause}${clauseIsUnique ? '' : ' LIMIT 1'}`
}

/**
 * Multi-row delete ("Delete" on checked rows): one `DELETE FROM `t` WHERE <clause> LIMIT 1;`
 * per selected row, always with LIMIT 1 and a trailing semicolon.
 * pma: src/Controllers/Table/DeleteRowsController.php
 */
export function buildDeleteRowsQueries(table: string, whereClauses: readonly string[]): string[] {
  return whereClauses.map((w) => `DELETE FROM ${backquote(table)} WHERE ${w} LIMIT 1;`)
}
