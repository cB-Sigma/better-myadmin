/**
 * Row identity: the WHERE clause phpMyAdmin builds to address one result row
 * (edit, delete, copy, grid edit).
 *
 * pma: src/UniqueCondition.php
 */

import {
  type FieldMetadata,
  bitBytesToDecimalString,
  php,
  printableBitValue,
} from '@bettermyadmin/mysql-types'
import { type QuoteOptions, backquote, quoteString } from './quote.ts'

/** A cell value: text as the server sent it, NULL, or raw bytes. */
export type CellValue = string | null | Uint8Array

/** The field metadata the unique condition needs (see createFieldMetadata in mysql-types). */
export type UniqueFieldMeta = Pick<
  FieldMetadata,
  | 'name'
  | 'orgName'
  | 'table'
  | 'orgTable'
  | 'mappedType'
  | 'charsetNr'
  | 'length'
  | 'isPrimaryKey'
  | 'isUniqueKey'
  | 'isNumeric'
  | 'isBinary'
  | 'isMappedTypeBit'
  | 'isMappedTypeGeometry'
>

/** A select expression of the parsed query (sql-parser `Expression` / `CaseExpression`). */
export interface SelectExpression {
  alias: string | null
  column: string | null
  /** a CASE ... END expression: never used to resolve an alias */
  isCaseExpression?: boolean
}

export interface UniqueConditionOptions {
  /** Only build the condition on a primary or unique key (no all-columns fallback). */
  forceUnique?: boolean
  /** Ignore fields whose (resolved) table differs. */
  restrictToTable?: string
  /** Expressions of the SELECT, used to map a column alias back to its column. */
  expressions?: readonly SelectExpression[]
  /**
   * Whether a table alias names a view in the current database. phpMyAdmin
   * replaces a table alias by the original table unless the alias is a view
   * (`Table::isView`, which queries information_schema). Default: never a view.
   */
  isView?: (tableName: string) => boolean
  /** Connection charset / sql_mode for string literals. */
  quote?: QuoteOptions
}

export interface UniqueCondition {
  /** the WHERE clause without the `WHERE` keyword ('' when nothing usable) */
  condition: string
  /** false when the clause falls back to all columns (callers then append `LIMIT 1`) */
  isClauseUnique: boolean
  /** `[conditionKey, conditionValue]` pairs in order, e.g. ['`t`.`id`', '= 1'] */
  conditionArray: [string, string][]
}

/**
 * Builds the unique condition for one row. `row[i]` belongs to `fields[i]`.
 *
 * For BIT fields a string value is the decimal text mysqli returns (e.g. "5"),
 * a Uint8Array value is the raw big-endian bit bytes mysql2 returns; both give
 * the same `= b'0101'`. For every other field a Uint8Array is the raw bytes and
 * a string stands for its UTF-8 bytes.
 *
 * pma: src/UniqueCondition.php::__construct
 */
export function getUniqueCondition(
  fields: readonly UniqueFieldMeta[],
  row: readonly CellValue[],
  options: UniqueConditionOptions = {},
): UniqueCondition {
  const forceUnique = options.forceUnique ?? false
  const restrictToTable = options.restrictToTable ?? ''
  const expressions = options.expressions ?? []
  const isView = options.isView ?? (() => false)
  const fieldsCount = fields.length

  let primaryKey = ''
  let uniqueKey = ''
  let nonPrimaryCondition = ''
  // PHP arrays keyed by condition key: later duplicates overwrite in place
  const primaryKeyArray = new Map<string, string>()
  const uniqueKeyArray = new Map<string, string>()
  const nonPrimaryConditionArray = new Map<string, string>()

  // the fields of the condition with their key: the value of a non-key field is built only when
  // no key condition is found (it is the all-columns fallback; a 500 KB text would be quoted per row)
  const entries: Array<{
    meta: UniqueFieldMeta
    i: number
    conKey: string
    value?: [string | null, string]
  }> = []
  fields.forEach((meta, i) => {
    let orgName = meta.orgName
    let table = meta.table
    // do not use a column alias in a condition
    if (orgName === '') {
      orgName = meta.name
      for (const expression of expressions) {
        if (
          expression.alias === null ||
          expression.alias === '' ||
          expression.isCaseExpression === true ||
          expression.column === null ||
          expression.column === ''
        ) {
          continue
        }
        if (meta.name.toLowerCase() === expression.alias.toLowerCase()) {
          orgName = expression.column
          break
        }
      }
    }

    // do not use a table alias in a condition (unless the alias is an updatable view)
    if (table !== meta.orgTable && !(table !== '' && isView(table))) {
      table = meta.orgTable
    }

    if (restrictToTable !== '' && restrictToTable !== table) return

    // float fields can't be compared exactly: CONCAT() compares their text form
    const conKey =
      meta.mappedType === 'real'
        ? `CONCAT(${backquote(table)}.${backquote(orgName)})`
        : `${backquote(table)}.${backquote(orgName)}`
    entries.push({ meta, i, conKey })
  })
  const conditionValueOf = (e: (typeof entries)[number]): [string | null, string] => {
    e.value ??= getConditionValue(
      row[e.i] ?? null,
      e.meta,
      fieldsCount,
      e.conKey,
      ` ${e.conKey} `,
      options.quote,
    )
    return e.value
  }

  for (const e of entries) {
    if (!e.meta.isPrimaryKey && !e.meta.isUniqueKey) continue
    const [conVal, newCondition] = conditionValueOf(e)
    if (conVal === null) continue
    const condition = `${newCondition}${conVal} AND`
    if (e.meta.isPrimaryKey) {
      primaryKey += condition
      primaryKeyArray.set(e.conKey, conVal)
    } else {
      uniqueKey += condition
      uniqueKeyArray.set(e.conKey, conVal)
    }
  }
  if (primaryKey === '' && uniqueKey === '' && !forceUnique) {
    for (const e of entries) {
      const [conVal, newCondition] = conditionValueOf(e)
      if (conVal === null) continue
      nonPrimaryCondition += `${newCondition}${conVal} AND`
      nonPrimaryConditionArray.set(e.conKey, conVal)
    }
  }

  let preferredCondition = ''
  let conditionArray = new Map<string, string>()
  let isClauseUnique = true
  if (primaryKey !== '') {
    preferredCondition = primaryKey
    conditionArray = primaryKeyArray
  } else if (uniqueKey !== '') {
    preferredCondition = uniqueKey
    conditionArray = uniqueKeyArray
  } else if (!forceUnique) {
    preferredCondition = nonPrimaryCondition
    conditionArray = nonPrimaryConditionArray
    isClauseUnique = false
  }

  return {
    condition: php.trim(preferredCondition.replace(/\s?AND$/, '')),
    isClauseUnique,
    conditionArray: [...conditionArray.entries()],
  }
}

/** pma: UniqueCondition::getConditionValue */
function getConditionValue(
  row: CellValue,
  meta: UniqueFieldMeta,
  fieldsCount: number,
  conditionKey: string,
  initialCondition: string,
  quote: QuoteOptions | undefined,
): [string | null, string] {
  let condition = initialCondition
  if (row === null) return ['IS NULL', condition]

  let conditionValue: string | null = ''
  const isBinaryString = meta.mappedType === 'string' && meta.isBinary
  // 63 is the binary charset
  const isBlobAndIsBinaryCharset = meta.mappedType === 'blob' && meta.charsetNr === 63
  if (meta.isNumeric) {
    conditionValue = `= ${typeof row === 'string' ? row : new TextDecoder().decode(row)}`
  } else if (isBlobAndIsBinaryCharset || (!php.looseEqualsZero(row) && isBinaryString)) {
    // hexify only if this is a true not empty BLOB or a BINARY
    // do not waste memory building a too big condition
    // (a long value is not counted unless it is the only field: 25 BLOBs of 1 MB a page)
    const rowLength = fieldsCount === 1 || !php.mbStrlenAtLeast(row, 1000) ? php.mbStrlen(row) : 1000
    if (rowLength > 0 && rowLength < 1000) {
      // use a CAST if possible, to avoid problems if the field contains wildcard characters % or _
      conditionValue = `= CAST(0x${php.bin2hex(row)} AS BINARY)`
    } else if (fieldsCount === 1) {
      // when this blob is the only field present try settling with length comparison
      condition = ` CHAR_LENGTH(${conditionKey}) `
      conditionValue = ` = ${rowLength}`
    } else {
      // this blob won't be part of the final condition
      conditionValue = null
    }
  } else if (meta.isMappedTypeGeometry && !php.looseEqualsZero(row)) {
    // do not build a too big condition
    if (php.mbStrlen(row) < 5000) {
      condition += `= CAST(0x${php.bin2hex(row)} AS BINARY)`
    } else {
      condition = ''
    }
  } else if (meta.isMappedTypeBit) {
    const decimal = typeof row === 'string' ? row : bitBytesToDecimalString(row)
    conditionValue = `= b'${printableBitValue(decimal, meta.length)}'`
  } else {
    const text = typeof row === 'string' ? row : new TextDecoder().decode(row)
    conditionValue = `= ${quoteString(text, quote)}`
  }

  return [conditionValue, condition]
}

/** pma: src/InsertEdit.php::isWhereClauseNumeric — `` `tbl`.`col` = <digits> `` */
export function isWhereClauseNumeric(whereClause: string | readonly string[] | null): boolean {
  if (whereClause === null) return false
  const clauses = typeof whereClause === 'string' ? [whereClause] : whereClause
  for (const clause of clauses) {
    // pma: preg_match('@^[\s]*`[^`]*`[\.]`[^`]*` = [0-9]+@', $clause)
    if (/^[ \t\n\r\v\f]*`[^`]*`[.]`[^`]*` = [0-9]+/.test(clause)) return true
  }
  return false
}
