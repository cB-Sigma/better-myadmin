import type {
  CentralColumn,
  CentralColumnsActionResponse,
  CentralColumnsRequest,
  CentralColumnsResponse,
  DbActionResponse,
  SqlMessage,
} from '@bettermyadmin/contracts'
import type { Translator } from '@bettermyadmin/i18n'
import {
  type CentralColumnDef,
  type CentralColumnRow,
  type CentralResult,
  centralColumnsCount,
  centralColumnsCountPage,
  centralColumnsList,
  centralColumnsListRaw,
  deleteColumnsFromList,
  findExistingColNames,
  findExistingColumns,
  getColumnFromForeignKeysData,
  getForeignKeysData,
  syncUniqueColumns,
  updateOneColumn,
} from '@bettermyadmin/metadata'
import { convertBitDefaultValue } from '@bettermyadmin/mysql-types'
import { backquote } from '@bettermyadmin/sql-gen'
import { columnFormOptions } from '../table/forms.ts'
import { type DbCtx, listTables, msg, selectDb, tf } from './context.ts'

/**
 * Database → Central columns, and the Structure bulk actions on the central list.
 * pma: src/Controllers/Database/CentralColumnsController.php, CentralColumns/PopulateColumnsController.php,
 *      src/Controllers/Database/Structure/CentralColumns/{Add,Remove,MakeConsistent}Controller.php,
 *      src/Database/CentralColumns.php, templates/database/central_columns/main.twig
 */

/** CentralColumns message of a repository result (null: success). */
export function centralMessage(ctx: { tr: Translator }, r: CentralResult): SqlMessage | null {
  const { tr } = ctx
  if (r.ok) return null
  switch (r.kind) {
    case 'storage':
      return msg(
        'error',
        tr.gettext('The configuration storage is not ready for the central list of columns feature.'),
      )
    case 'exists':
      // the second sentence is not translated in phpMyAdmin
      return msg(
        'notice',
        `${tf(tr, 'Could not add %1$s as they already exist in central list!', r.columns)} Please remove them first from central list if you want to update above columns`,
      )
    case 'addError':
      return msg('error', `${tr.gettext('Could not add columns!')} ${r.error}`)
    case 'notExist':
      return msg(
        'notice',
        tf(tr, "Couldn't remove Column(s) %1$s as they don't exist in central columns list!", r.columns),
      )
    case 'removeError':
      return msg('error', `${tr.gettext('Could not remove columns!')}\n${r.columns}\n ${r.error}`)
    case 'error':
      return msg('error', r.error)
  }
}

/** DatabaseInterface::getColumns as `Column` objects. */
async function columnDefs(ctx: DbCtx, table: string): Promise<CentralColumnDef[]> {
  return (await ctx.reader.getColumns(ctx.db, table)).map((c) => ({
    field: c.Field,
    type: c.Type,
    collation: c.Collation,
    isNull: c.Null === 'YES',
    extra: c.Extra,
    default: c.Default,
  }))
}

const columnNames = async (ctx: DbCtx, table: string) =>
  (await ctx.reader.getColumns(ctx.db, table)).map((c) => c.Field)

/** The rows_meta / default_values of getTemplateVariablesForMain and getHtmlForEditTableRow. */
function toColumn(row: CentralColumnRow): CentralColumn {
  const d = row.col_default
  let defaultType = 'USER_DEFINED'
  if (d === null || d === '') defaultType = 'NONE'
  else if (d === 'CURRENT_TIMESTAMP' || d === 'current_timestamp()') defaultType = 'CURRENT_TIMESTAMP'
  else if (d === 'NULL') defaultType = 'NULL'
  let defaultValue = ''
  if (defaultType === 'USER_DEFINED' && d !== null) {
    const upper = row.col_type.toUpperCase()
    if (upper === 'BIT') defaultValue = convertBitDefaultValue(d)
    else if (upper === 'BINARY' || upper === 'VARBINARY')
      defaultValue = Buffer.from(d, 'utf8').toString('hex')
    else defaultValue = d
  }
  const isNull = row.col_isNull
  return {
    name: row.col_name,
    type: row.col_type,
    length: row.col_length,
    collation: row.col_collation,
    isNull: isNull !== '' && isNull !== 'NO' && isNull !== 'NOT NULL' && isNull !== '0',
    extra: row.col_extra,
    attribute: row.col_attribute,
    default: d,
    defaultType,
    defaultValue,
  }
}

/** CentralColumnsController::main (+ the "Showing rows" message) */
export async function centralColumnsPage(
  ctx: DbCtx,
  q: { pos?: string | undefined; totalRows?: string | undefined },
  message: SqlMessage | null = null,
): Promise<CentralColumnsResponse> {
  const maxRows = ctx.cfg.MaxRows
  // phpMyAdmin calls main($pos, $total_rows) with the parameters swapped: the posted `pos`
  // becomes the total and `total_rows` the position
  const totalParam = q.pos ?? ''
  const posParam = q.totalRows ?? ''
  const totalRows =
    totalParam !== '' && totalParam !== '0' && /^\d+$/.test(totalParam)
      ? Number.parseInt(totalParam, 10)
      : await centralColumnsCount(ctx.control, ctx.rp, ctx.db)
  const pos = /^\d+$/.test(posParam) ? Number.parseInt(posParam, 10) : 0
  const tables = await listTables(ctx)
  const rows = await centralColumnsList(ctx.control, ctx.rp, ctx.db, pos, maxRows)
  const requestPos = /^\d+$/.test(q.pos ?? '') ? Number.parseInt(q.pos ?? '0', 10) : 0
  const n = await centralColumnsCountPage(ctx.control, ctx.rp, ctx.db, requestPos, maxRows)
  return {
    db: ctx.db,
    enabled: ctx.rp.centralColumnsFeature !== null,
    totalRows,
    pos,
    maxRows,
    columns: rows.map(toColumn),
    tables,
    message:
      message ?? msg('success', tf(ctx.tr, 'Showing rows %1$s - %2$s.', requestPos + 1, requestPos + n)),
    options: await columnFormOptions(ctx.reader, ctx.cfg, ctx.tr, ctx.db, ''),
  }
}

/** The stored default of an editor row (CentralColumnsController::editSave / addNewColumn, updateMultipleColumn). */
function storedDefault(c: { defaultType: string; defaultValue: string }): string {
  if (c.defaultType === 'NONE') return ''
  if (c.defaultType === 'USER_DEFINED') return c.defaultValue
  return c.defaultType
}

type ColumnInput = Extract<CentralColumnsRequest, { action: 'add-new' }>['column']

const updateArgs = (origColName: string, c: ColumnInput) => ({
  origColName,
  colName: c.name,
  colType: c.type,
  colAttribute: c.attribute,
  colLength: c.length,
  colIsNull: c.isNull,
  collation: c.collation,
  colExtra: c.autoIncrement ? 'auto_increment' : '',
  colDefault: storedDefault(c),
})

/** POST /database/central-columns */
export async function centralColumnsAction(
  ctx: DbCtx,
  req: CentralColumnsRequest,
): Promise<CentralColumnsActionResponse> {
  const { control: conn, rp, db } = ctx
  let r: CentralResult
  switch (req.action) {
    case 'add-new':
      r = await updateOneColumn(conn, rp, db, updateArgs('', req.column))
      break
    case 'edit':
      r = await updateOneColumn(conn, rp, db, updateArgs(req.origName, req.column))
      break
    case 'multi-edit':
      r = { ok: true }
      for (const c of req.columns) {
        r = await updateOneColumn(conn, rp, db, updateArgs(c.origName, c))
        if (!r.ok) break
      }
      break
    case 'add-from-table':
      r = await syncUniqueColumns(conn, rp, db, {
        columns: [req.column],
        getColumn: async (column) =>
          (await columnDefs(ctx, req.table)).find((c) => c.field === column) ?? null,
      })
      break
    case 'delete':
      r = await deleteColumnsFromList(conn, rp, db, { columns: req.columns })
      break
  }
  return { ok: r.ok, message: centralMessage(ctx, r) }
}

/** CentralColumns::getHtmlForEditingPage: the selected columns for the multi-edit form. */
export async function centralColumnsEditRows(ctx: DbCtx, columns: string[]): Promise<CentralColumn[]> {
  return (await findExistingColumns(ctx.control, ctx.rp, ctx.db, columns)).map(toColumn)
}

/** PopulateColumnsController: the columns of a table that are not in the central list. */
export async function centralColumnsPopulate(ctx: DbCtx, table: string): Promise<string[]> {
  const names = await columnNames(ctx, table)
  const existing = await findExistingColNames(ctx.control, ctx.rp, ctx.db, names)
  return names.filter((n) => !existing.includes(n))
}

/** CentralColumnsController getColumnList (the "Pick from Central Columns" dialog). */
export async function centralColumnsPick(ctx: DbCtx, table: string): Promise<CentralColumn[]> {
  const cols = table === '' ? null : await columnNames(ctx, table)
  return (await centralColumnsListRaw(ctx.control, ctx.rp, ctx.db, cols)).map(toColumn)
}

// ---------------------------------------------------------------- Structure bulk actions

const structureResult = (ctx: DbCtx, r: CentralResult): DbActionResponse => ({
  messages: [centralMessage(ctx, r) ?? msg('success', ctx.tr.gettext('Success!'))],
})

/** Structure/CentralColumns/AddController */
export async function centralAddTables(ctx: DbCtx, tables: string[]): Promise<DbActionResponse> {
  if (tables.length === 0) return { messages: [msg('error', ctx.tr.gettext('No table selected.'))] }
  const r = await syncUniqueColumns(ctx.control, ctx.rp, ctx.db, {
    tables,
    getColumns: (t) => columnDefs(ctx, t),
  })
  return structureResult(ctx, r)
}

/** Structure/CentralColumns/RemoveController */
export async function centralRemoveTables(ctx: DbCtx, tables: string[]): Promise<DbActionResponse> {
  if (tables.length === 0) return { messages: [msg('error', ctx.tr.gettext('No table selected.'))] }
  const r = await deleteColumnsFromList(ctx.control, ctx.rp, ctx.db, {
    tables,
    getColumnNames: (t) => columnNames(ctx, t),
  })
  return structureResult(ctx, r)
}

/** Relation::getChildReferences + checkChildForeignReferences: may the column be changed? */
async function isEditable(ctx: DbCtx, table: string, column: string): Promise<boolean> {
  const q = (s: string) => ctx.dbi.quoteString(s)
  const keys = getForeignKeysData(await ctx.reader.showCreate(ctx.db, table))
  if (getColumnFromForeignKeysData(keys, column, ctx.db) !== false) return false
  const refs = await ctx.dbi.fetchResultSimple(
    `SELECT \`column_name\`, \`table_name\`, \`table_schema\`, \`referenced_column_name\` FROM \`information_schema\`.\`key_column_usage\` WHERE \`referenced_table_name\` = ${q(table)} AND \`referenced_table_schema\` = ${q(ctx.db)} AND \`referenced_column_name\` = ${q(column)}`,
  )
  return refs.length === 0
}

/** Structure/CentralColumns/MakeConsistentController → CentralColumns::makeConsistentWithList */
export async function centralMakeConsistent(ctx: DbCtx, tables: string[]): Promise<DbActionResponse> {
  if (tables.length === 0) return { messages: [msg('error', ctx.tr.gettext('No table selected.'))] }
  const errors: string[] = []
  await selectDb(ctx, ctx.db)
  for (const table of tables) {
    let sql = `ALTER TABLE ${backquote(table)}`
    const has = await findExistingColumns(ctx.control, ctx.rp, ctx.db, await columnNames(ctx, table))
    for (const c of has) {
      if (!(await isEditable(ctx, table, c.col_name))) continue
      sql += ` MODIFY ${backquote(c.col_name)} ${c.col_type}`
      if (c.col_length !== '' && c.col_length !== '0') sql += `(${c.col_length})`
      sql += ` ${c.col_attribute}`
      sql += c.col_isNull !== '' && c.col_isNull !== '0' ? ' NULL' : ' NOT NULL'
      sql += ` ${c.col_extra}`
      const d = c.col_default
      if (d !== null && d !== '' && d !== '0') {
        sql +=
          d !== 'CURRENT_TIMESTAMP' && d !== 'current_timestamp()'
            ? ` DEFAULT ${ctx.dbi.quoteString(d)}`
            : ` DEFAULT ${d}`
      }
      sql += ','
    }
    sql = `${sql.replace(/^[ ,]+|[ ,]+$/g, '')};`
    if ((await ctx.dbi.tryQuery(sql, 'central.consistent')) === null) errors.push(ctx.dbi.lastError)
  }
  if (errors.length > 0) return { messages: [msg('error', errors.join('\n'))] }
  return { messages: [msg('success', ctx.tr.gettext('Success!'))] }
}
