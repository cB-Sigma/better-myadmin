import type { ColumnNamesResponse, TableNamesResponse } from '@bettermyadmin/contracts'
import { columnNamesAndTypesQuery } from '@bettermyadmin/sql-gen'
import { listTables } from '../database/context.ts'
import type { AdminCtx } from './context.ts'

/**
 * The name lists of the pickers: the tables of a database, the columns of a table (the export
 * page's aliases dialog).
 * pma: src/Controllers/TableController.php, src/Controllers/ColumnController.php,
 *      src/Dbal/DatabaseInterface.php::getTables, ::getColumnNames
 */

/** pma: TableController — `db` missing: setRequestStatus(false) + Message::error() */
export async function tableNames(ctx: AdminCtx, db: string | undefined): Promise<TableNamesResponse> {
  if (db === undefined) return { success: false, tables: [], message: ctx.tr.gettext('Error') }
  // DatabaseInterface::getTables: '' → []
  return { success: true, tables: db === '' ? [] : await listTables(ctx, db) }
}

/** pma: ColumnController */
export async function columnNames(
  ctx: AdminCtx,
  db: string | undefined,
  table: string | undefined,
): Promise<ColumnNamesResponse> {
  if (db === undefined || table === undefined) {
    return { success: false, columns: [], message: ctx.tr.gettext('Error') }
  }
  const rows = await ctx.dbi.tryQuery(
    columnNamesAndTypesQuery(await ctx.dbi.collateForIS(), db, table),
    'name-lists.columns',
  )
  // only the COLUMN_NAME column
  return { success: true, columns: rows === null ? [] : rows.rows.map((r) => r[0] ?? '') }
}
