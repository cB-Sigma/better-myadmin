/**
 * The view form: Create view and Edit view (prefilled from INFORMATION_SCHEMA.VIEWS and
 * SHOW CREATE), the CREATE / ALTER VIEW statement, and the browser transformations copied from
 * the underlying columns. Like phpMyAdmin, every statement runs on the user's link (the
 * `pma__column_info` reads and the INSERT included).
 *
 * pma: src/Controllers/View/CreateController.php, src/SystemDatabase.php
 *      (getExistingTransformationData, getColumnMapFromSql, getNewTransformationDataSql)
 */
import type { SqlMessage, ViewFormResponse, ViewSaveRequest } from '@bettermyadmin/contracts'
import {
  VIEW_ALGORITHM_OPTIONS,
  VIEW_SECURITY_OPTIONS,
  VIEW_WITH_OPTIONS,
  backquote,
  getViewSqlQuery,
  quoteString,
} from '@bettermyadmin/sql-gen'
import { CreateStatement, Parser, TokensList } from '@bettermyadmin/sql-lexer'
import type { z } from 'zod'
import type { DbCtx } from '../database/context.ts'
import { MysqlError } from '../http/errors.ts'

type ViewData = ViewFormResponse['view']
type ViewSaveIn = z.output<typeof ViewSaveRequest>

const emptyView = (as: string): ViewData => ({
  orReplace: false,
  algorithm: '',
  definer: '',
  sqlSecurity: '',
  name: '',
  columnNames: '',
  as,
  with: '',
})

/** CreateController (GET): the create form, prefilled with `sql_query`, or the edit form of `table` */
export async function viewForm(
  ctx: DbCtx,
  q: { table?: string | undefined; sql?: string | undefined },
): Promise<ViewFormResponse> {
  let operation: ViewFormResponse['operation'] = 'create'
  let view = emptyView(q.sql ?? '')
  // "Used to prefill the fields when editing a view"
  if (q.table !== undefined && q.table !== '') {
    const item =
      (
        await ctx.dbi.fetchResultSimple(
          `SELECT \`VIEW_DEFINITION\`, \`CHECK_OPTION\`, \`DEFINER\`, \`SECURITY_TYPE\`
                        FROM \`INFORMATION_SCHEMA\`.\`VIEWS\`
                        WHERE TABLE_SCHEMA=${quoteString(ctx.db)}
                        AND TABLE_NAME=${quoteString(q.table)};`,
        )
      )[0] ?? {}
    const createView = await ctx.reader.showCreate(ctx.db, q.table)
    operation = 'alter'
    view = {
      ...view,
      definer: item.DEFINER ?? '',
      sqlSecurity: item.SECURITY_TYPE ?? '',
      name: q.table,
      as: item.VIEW_DEFINITION ?? '',
      with: item.CHECK_OPTION ?? '',
      // CREATE ALGORITHM=<ALGORITHM> DE...
      algorithm: createView.slice(17).split(' ')[0] ?? '',
    }
    // MySQL 8.0+ - issue #16194: the definition is hidden from users without privileges
    if (view.as === '') {
      const stmt = new Parser(createView).statements[0]
      if (stmt instanceof CreateStatement) view.as = TokensList.buildFromArray(stmt.body)
    }
  }
  return {
    db: ctx.db,
    operation,
    view,
    algorithmOptions: [...VIEW_ALGORITHM_OPTIONS],
    securityOptions: [...VIEW_SECURITY_OPTIONS],
    withOptions: [...VIEW_WITH_OPTIONS],
    codemirror: ctx.cfg.CodemirrorEnable,
  }
}

const msg = (type: SqlMessage['type'], text: string, sql?: string): SqlMessage =>
  sql === undefined ? { type, text } : { type, text, sql }

/** CreateController (POST createview / alterview) */
export async function saveView(
  ctx: DbCtx,
  req: ViewSaveIn,
): Promise<{ ok: boolean; messages: SqlMessage[] }> {
  const { tr } = ctx
  const view = req.view
  // View name is a compulsory field
  if (view.name === '')
    return { ok: false, messages: [msg('error', tr.gettext('View name can not be empty!'))] }
  const sql = getViewSqlQuery(req.operation === 'create', view)
  if ((await ctx.dbi.tryQuery(sql, 'view.save')) === null) {
    return { ok: false, messages: [msg('error', ctx.dbi.lastError, sql)] }
  }
  await copyTransformations(ctx, view)
  return {
    ok: true,
    messages: [msg('success', tr.gettext('Your SQL query has been executed successfully.'), sql)],
  }
}

/**
 * CreateController::setSuccessResponse: the transformations of the underlying columns, for the
 * view. As upstream the column map reads the derived table `tmp`, so nothing matches
 * (docs/reference/parity-exceptions.md Q60); the statements are the same.
 */
async function copyTransformations(ctx: DbCtx, view: ViewSaveIn['view']): Promise<void> {
  const f = ctx.rp.browserTransformationFeature
  if (f === null) return
  const table = `${backquote(f.database)}.${backquote(f.columnInfo)}`
  // SystemDatabase::getExistingTransformationData
  const data = await ctx.dbi.tryQuery(`SELECT * FROM ${table} WHERE \`db_name\` = ${quoteString(ctx.db)}`)
  if (data === null) return
  const viewColumns = view.columnNames !== '' ? view.columnNames.split(',') : []
  const columnMap = await columnMapFromSql(ctx, view.as, viewColumns)
  // SystemDatabase::getNewTransformationDataSql
  let sql = `INSERT INTO ${table} (\`db_name\`, \`table_name\`, \`column_name\`, \`comment\`, \`mimetype\`, \`transformation\`, \`transformation_options\`) VALUES`
  let count = 0
  let comma = false
  for (const row of rowsOf(data)) {
    for (const column of columnMap) {
      // loose `!=` on strings
      if (row.table_name !== column.tableName || row.column_name !== column.referringColumn) continue
      sql += `${comma ? ', ' : ''} (${[
        ctx.db,
        view.name,
        column.realColumn ?? column.referringColumn,
        row.comment ?? '',
        row.mimetype ?? '',
        row.transformation ?? '',
        row.transformation_options ?? '',
      ]
        .map((v) => quoteString(v))
        .join(', ')})`
      comma = true
      count++
      break
    }
    if (count === columnMap.length) break
  }
  if (count > 0) await ctx.dbi.tryQuery(sql, 'view.transformations')
}

function rowsOf(data: NonNullable<Awaited<ReturnType<DbCtx['dbi']['tryQuery']>>>) {
  return data.rows.map((r) => Object.fromEntries(data.fields.map((name, i) => [name, r[i] ?? null])))
}

/** SystemDatabase::getColumnMapFromSql: the result columns' tables (FieldMetadata::$table) */
async function columnMapFromSql(
  ctx: DbCtx,
  sqlQuery: string,
  viewColumns: string[],
): Promise<Array<{ tableName: string; referringColumn: string; realColumn: string | null }>> {
  try {
    const r = await ctx.conn.query(`SELECT * FROM (${sqlQuery}) AS tmp LIMIT 0`, 'view.columns')
    return (r.resultSets[0]?.fields ?? []).map((field, i) => ({
      tableName: field.table,
      referringColumn: field.name,
      realColumn: viewColumns[i] ?? null,
    }))
  } catch (e) {
    if (e instanceof MysqlError) return []
    throw e
  }
}
