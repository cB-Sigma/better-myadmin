/**
 * "Change" of one or more columns (the column definition form posted to /table/structure/save).
 *
 * pma: src/Controllers/Table/Structure/SaveController.php::updateColumns, ::columnNeedsAlterTable
 */

import { php } from '@bettermyadmin/mysql-types'
import { type DdlContext, generateAlter } from './column.ts'
import { backquote } from './quote.ts'

/** The `*_orig` hidden inputs of one column row (ColumnsDefinition::displayForm, is_backup). */
export interface ColumnOrigValues {
  type: string
  length: string
  defaultValue: string
  defaultType: string
  collation: string
  attribute: string
  null: string
  extra: string
  comments: string
  virtuality: string
  expression: string
}

/** One posted row of the change form. Absent values are absent from the POST (unchecked boxes, empty selects). */
export interface ChangeColumnInput {
  /** field_orig */
  orig: string
  /** field_name */
  name: string
  type: string
  length: string
  attribute: string
  /** absent when the collation select had no options */
  collation?: string | null
  /** 'YES' when the Null box is ticked, absent otherwise */
  null?: string | null
  defaultType: string
  defaultValue: string
  /** 'AUTO_INCREMENT' when the A_I box is ticked, absent otherwise */
  extra?: string | null
  comments: string
  /** absent when the server has no virtual columns (no Virtuality cell) */
  virtuality?: string | null
  expression?: string | null
  /** '' (stay), '-first' or a column name */
  moveTo?: string | null
  /** field_adjust_privileges: the box is ticked */
  adjustPrivileges?: boolean
  origValues: ColumnOrigValues
}

/**
 * PHP 8 loose `==` between two posted values (strings, or null for an absent key): numeric strings
 * compare as numbers, null equals ''.
 */
export function looseEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = a ?? null
  const y = b ?? null
  if (x === null || y === null) return (x ?? '') === (y ?? '')
  if (x === y) return true
  if (php.isNumericString(x) && php.isNumericString(y)) return Number(x) === Number(y)
  return false
}

/**
 * Whether a posted column differs from its `_orig` snapshot (or is moved).
 *
 * pma: src/Controllers/Table/Structure/SaveController.php::columnNeedsAlterTable
 */
export function columnNeedsAlterTable(c: ChangeColumnInput): boolean {
  if (!looseEquals(c.name, c.orig)) return true
  const pairs: Array<[string | null | undefined, string]> = [
    [c.attribute, c.origValues.attribute],
    [c.collation, c.origValues.collation],
    [c.comments, c.origValues.comments],
    [c.defaultValue, c.origValues.defaultValue],
    [c.defaultType, c.origValues.defaultType],
    [c.extra ?? '', c.origValues.extra],
    [c.length, c.origValues.length],
    [c.null ?? 'NO', c.origValues.null],
    [c.type, c.origValues.type],
    [c.virtuality, c.origValues.virtuality],
  ]
  for (const [posted, orig] of pairs) if (!looseEquals(posted, orig)) return true
  return php.truthy(c.moveTo ?? '')
}

export interface ChangeColumnsInput {
  table: string
  columns: readonly ChangeColumnInput[]
  /** columns with a PRIMARY or UNIQUE key (A_I without one adds `, ADD PRIMARY KEY`) */
  columnsWithPrimaryOrUnique: readonly (string | number)[]
  /** `online_transaction` */
  onlineTransaction?: boolean
}

/**
 * The CHANGE clauses and the full ALTER TABLE; `sql` is null when nothing changed (preview then shows '').
 *
 * pma: SaveController::updateColumns ($changes, $sqlQuery)
 */
export function getChangeColumnsQuery(
  input: ChangeColumnsInput,
  ctx: DdlContext,
): { sql: string | null; changes: string[]; changedIndexes: number[] } {
  const changes: string[] = []
  const changedIndexes: number[] = []
  input.columns.forEach((c, i) => {
    if (!columnNeedsAlterTable(c)) return
    changedIndexes.push(i)
    changes.push(
      `CHANGE ${generateAlter(
        c.orig,
        {
          name: c.name,
          type: c.type,
          length: c.length,
          attribute: c.attribute,
          collation: c.collation ?? '',
          null: c.null ?? 'NO',
          defaultType: c.defaultType,
          defaultValue: c.defaultValue,
          extra: c.extra ?? '',
          comment: c.comments,
          virtuality: c.virtuality ?? '',
          expression: c.expression ?? '',
          moveTo: c.moveTo ?? '',
          columnsWithIndex: input.columnsWithPrimaryOrUnique,
        },
        ctx,
      )}`,
    )
  })
  if (changes.length === 0) return { sql: null, changes, changedIndexes }
  let sql = `ALTER TABLE ${backquote(input.table)} ${changes.join(', ')}`
  if (input.onlineTransaction) sql += ', ALGORITHM=INPLACE, LOCK=NONE'
  return { sql: `${sql};`, changes, changedIndexes }
}

/**
 * Before a collation change the column is first turned into BLOB/MEDIUMBLOB/LONGBLOB so the server
 * does not convert (garble) the bytes. Only for columns without any index. Returned in row order
 * with the row index.
 *
 * pma: SaveController::updateColumns ($changedToBlob / $secondaryQuery)
 */
export function getCollationBlobConversions(
  table: string,
  columns: readonly ChangeColumnInput[],
  columnsWithAnyIndex: readonly (string | number)[],
): Array<{ index: number; sql: string }> {
  const out: Array<{ index: number; sql: string }> = []
  columns.forEach((c, i) => {
    if (c.collation === undefined || c.collation === null) return
    if (c.collation === c.origValues.collation) return
    if (php.looseInArray(c.orig, columnsWithAnyIndex)) return
    const blobType =
      c.origValues.type === 'MEDIUMTEXT'
        ? 'MEDIUMBLOB'
        : c.origValues.type === 'LONGTEXT'
          ? 'LONGBLOB'
          : 'BLOB'
    let sql = `ALTER TABLE ${backquote(table)} CHANGE ${backquote(c.orig)} ${backquote(c.orig)} ${blobType}`
    if (
      c.virtuality !== undefined &&
      c.virtuality !== null &&
      c.expression !== undefined &&
      c.expression !== null
    ) {
      if (php.truthy(c.virtuality)) sql += ` AS (${c.expression}) ${c.virtuality}`
    }
    out.push({ index: i, sql: `${sql};` })
  })
  return out
}

/**
 * After a failed ALTER, the columns turned into BLOB are changed back to their original definition.
 *
 * pma: SaveController::updateColumns ($changesRevert / $revertQuery)
 */
export function getChangeRevertQuery(
  table: string,
  columns: readonly ChangeColumnInput[],
  changedToBlob: ReadonlySet<number>,
  ctx: DdlContext,
): string {
  const changes: string[] = []
  columns.forEach((c, i) => {
    if (!changedToBlob.has(i)) return
    const o = c.origValues
    changes.push(
      `CHANGE ${generateAlter(
        c.orig,
        {
          name: c.name,
          type: o.type,
          length: o.length,
          attribute: o.attribute,
          collation: o.collation,
          null: o.null,
          defaultType: o.defaultType,
          defaultValue: o.defaultValue,
          extra: o.extra,
          comment: o.comments,
          virtuality: o.virtuality,
          expression: o.expression,
          moveTo: '',
        },
        ctx,
      )}`,
    )
  })
  return `ALTER TABLE ${backquote(table)} ${changes.join(', ')};`
}

/**
 * Column privileges follow a rename (field_adjust_privileges), run in the `mysql` database.
 *
 * pma: SaveController::adjustColumnPrivileges
 */
export function getAdjustColumnPrivilegesQuery(
  db: string,
  table: string,
  oldCol: string,
  newCol: string,
): string {
  return `UPDATE ${backquote('columns_priv')} SET Column_name = "${newCol}"
                        WHERE Db = "${db}"
                        AND Table_name = "${table}"
                        AND Column_name = "${oldCol}";`
}
