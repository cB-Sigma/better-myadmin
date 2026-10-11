import type {
  CopyFormResponse,
  DbActionResponse,
  MaintenanceResponse,
  ShowCreateResponse,
} from '@bettermyadmin/contracts'
import { relationCleanupTable } from '@bettermyadmin/metadata'
import { mbStrlen } from '@bettermyadmin/mysql-types'
import { backquote } from '@bettermyadmin/sql-gen'
import { MysqlError, ValidationError } from '../http/errors.ts'
import { mbSubstr } from '../navigation/php.ts'
import { getPrivileges } from '../navigation/privileges.ts'
import {
  type DbCtx,
  errorText,
  fkCheckCleanup,
  fkCheckInit,
  msg,
  selectDb,
  successText,
  tryQuery,
} from './context.ts'
import { getDatabaseList, moveCopy, newMoveState } from './table-mover.ts'
import { isView, tableCache } from './tables.ts'

/**
 * The Structure tab's "With selected:" actions.
 * pma: src/Controllers/Database/Structure/*Controller.php, src/Controllers/Table/Maintenance/*,
 *      src/Table/Maintenance.php
 */

function requireTables(ctx: DbCtx, tables: string[]): void {
  if (tables.length === 0) throw new ValidationError(ctx.tr.gettext('No table selected.'))
}

const noChange = (ctx: DbCtx): DbActionResponse => ({
  messages: [msg('success', ctx.tr.gettext('No change'))],
})

/** pma: EmptyTableController */
export async function emptyTables(
  ctx: DbCtx,
  req: { tables: string[]; fkChecks?: boolean | undefined; confirmed: boolean },
): Promise<DbActionResponse> {
  if (!req.confirmed) return noChange(ctx)
  const def = await fkCheckInit(ctx, req.fkChecks)
  let sql = ''
  await selectDb(ctx, ctx.db)
  for (const t of req.tables) {
    if (await isView(ctx, ctx.db, t)) continue
    const q = `TRUNCATE ${backquote(t)}`
    sql += `${q};\n`
    await ctx.conn.query(q, 'structure.truncate')
  }
  await fkCheckCleanup(ctx, def)
  return { messages: [msg('success', successText(ctx.tr), sql)] }
}

/** pma: DropTableController */
export async function dropTables(
  ctx: DbCtx,
  req: { tables: string[]; fkChecks?: boolean | undefined; confirmed: boolean },
): Promise<DbActionResponse> {
  if (!req.confirmed) return noChange(ctx)
  const def = await fkCheckInit(ctx, req.fkChecks)
  let sql = ''
  let views = ''
  for (const t of req.tables) {
    await relationCleanupTable(ctx.control, ctx.rp, ctx.db, t)
    if (await isView(ctx, ctx.db, t)) views += `${views === '' ? 'DROP VIEW ' : ', '}${backquote(t)}`
    else sql += `${sql === '' ? 'DROP TABLE ' : ', '}${backquote(t)}`
  }
  if (sql !== '') sql += ';'
  else if (views !== '') {
    sql = `${views};`
    views = ''
  }
  // issue #14205
  delete ctx.tmpval.table_limit_offset
  delete ctx.tmpval.table_limit_offset_db
  await selectDb(ctx, ctx.db)
  let error = await tryQuery(ctx, sql, 'structure.drop')
  if (error === null && views !== '') {
    sql += ` ${views};`
    error = await tryQuery(ctx, views, 'structure.drop')
  }
  await fkCheckCleanup(ctx, def)
  tableCache(ctx).forget(ctx.db)
  return { messages: [error === null ? msg('success', successText(ctx.tr), sql) : msg('error', error, sql)] }
}

/** pma: AddPrefixTableController */
export async function addPrefix(
  ctx: DbCtx,
  req: { tables: string[]; prefix: string },
): Promise<DbActionResponse> {
  let sql = ''
  await selectDb(ctx, ctx.db)
  for (const t of req.tables) {
    const q = `ALTER TABLE ${backquote(t)} RENAME ${backquote(req.prefix + t)}`
    sql += `${q};\n`
    await ctx.conn.query(q, 'structure.prefix')
  }
  return { messages: [msg('success', successText(ctx.tr), sql)] }
}

/** pma: ReplacePrefixController */
export async function replacePrefix(
  ctx: DbCtx,
  req: { tables: string[]; fromPrefix: string; toPrefix: string },
): Promise<DbActionResponse> {
  let sql = ''
  await selectDb(ctx, ctx.db)
  const len = mbStrlen(req.fromPrefix)
  for (const t of req.tables) {
    const newName = mbSubstr(t, 0, len) === req.fromPrefix ? req.toPrefix + mbSubstr(t, len) : t
    const q = `ALTER TABLE ${backquote(t)} RENAME ${backquote(newName)}`
    sql += `${q};\n`
    await ctx.conn.query(q, 'structure.prefix')
  }
  return { messages: [msg('success', successText(ctx.tr), sql)] }
}

/** pma: CopyTableWithPrefixController */
export async function copyWithPrefix(
  ctx: DbCtx,
  req: { tables: string[]; fromPrefix: string; toPrefix: string; dropIfExists: boolean },
): Promise<DbActionResponse> {
  const st = newMoveState(false)
  for (const t of req.tables) {
    const newName = req.toPrefix + mbSubstr(t, mbStrlen(req.fromPrefix))
    await moveCopy(ctx, st, ctx.db, t, ctx.db, newName, 'data', 'single', req.dropIfExists)
  }
  return {
    messages: [st.error !== null ? msg('error', st.error) : msg('success', successText(ctx.tr), st.sqlQuery)],
  }
}

/** pma: CopyFormController (databases except the current one) */
export async function copyForm(ctx: DbCtx): Promise<CopyFormResponse> {
  const p = await getPrivileges(ctx.dbi)
  return {
    databases: (await getDatabaseList(ctx)).filter((d) => d !== ctx.db),
    hasAdjustPrivileges: p.table && p.column && p.isReload,
  }
}

/** pma: CopyTableController + Operations::adjustPrivilegesCopyTable */
export async function copyTables(
  ctx: DbCtx,
  req: {
    tables: string[]
    targetDb: string
    what: 'structure' | 'data' | 'dataonly'
    dropIfExists: boolean
    autoIncrement: boolean
    addConstraints: boolean
    adjustPrivileges: boolean
  },
): Promise<DbActionResponse> {
  const st = newMoveState(req.autoIncrement)
  const privileges = await getPrivileges(ctx.dbi)
  for (const t of req.tables) {
    await moveCopy(ctx, st, ctx.db, t, req.targetDb, t, req.what, 'single', req.dropIfExists)
    if (!req.adjustPrivileges) continue
    await adjustPrivilegesCopyTable(ctx, privileges, ctx.db, t, req.targetDb, t)
  }
  return {
    messages: [st.error !== null ? msg('error', st.error) : msg('success', successText(ctx.tr), st.sqlQuery)],
  }
}

/** Operations::adjustPrivilegesCopyTable */
export async function adjustPrivilegesCopyTable(
  ctx: DbCtx,
  p: { table: boolean; column: boolean; isReload: boolean },
  oldDb: string,
  oldTable: string,
  newDb: string,
  newTable: string,
): Promise<void> {
  if (!p.table || !p.column || !p.isReload) return
  await selectDb(ctx, 'mysql')
  const tp = await ctx.dbi.tryQuery(
    `SELECT * FROM ${backquote('tables_priv')} where Db = "${oldDb}" AND Table_name = "${oldTable}";`,
  )
  for (const r of tp?.rows ?? []) {
    await ctx.conn.query(
      `INSERT INTO ${backquote('tables_priv')} VALUES("${r[0]}", "${newDb}", "${r[2]}", "${newTable}", "${r[4]}", "${r[5]}", "${r[6]}", "${r[7]}");`,
      'privileges.copy',
    )
  }
  const cp = await ctx.dbi.tryQuery(
    `SELECT * FROM ${backquote('columns_priv')} WHERE Db = "${oldDb}" AND Table_name = "${oldTable}";`,
  )
  for (const r of cp?.rows ?? []) {
    await ctx.conn.query(
      `INSERT INTO ${backquote('columns_priv')} VALUES("${r[0]}", "${newDb}", "${r[2]}", "${newTable}", "${r[4]}", "${r[5]}", "${r[6]}");`,
      'privileges.copy',
    )
  }
  await ctx.dbi.tryQuery('FLUSH PRIVILEGES;')
}

/** pma: ShowCreateController */
export async function showCreate(ctx: DbCtx, tables: string[]): Promise<ShowCreateResponse> {
  requireTables(ctx, tables)
  const out: ShowCreateResponse = { tables: [], views: [] }
  for (const t of tables) {
    const view = await isView(ctx, ctx.db, t)
    const r = await ctx.dbi.tryQuery(`SHOW CREATE TABLE ${backquote(ctx.db)}.${backquote(t)}`)
    ;(view ? out.views : out.tables).push({ name: t, sql: r?.rows[0]?.[1] ?? '' })
  }
  return out
}

const MAINT = {
  analyze: ['ANALYZE TABLE', 'Analyze table', 'ANALYZE_TABLE'],
  check: ['CHECK TABLE', 'Check table', 'CHECK_TABLE'],
  checksum: ['CHECKSUM TABLE', 'Checksum table', 'CHECKSUM_TABLE'],
  optimize: ['OPTIMIZE TABLE', 'Optimize table', 'OPTIMIZE_TABLE'],
  repair: ['REPAIR TABLE', 'Repair table', 'REPAIR_TABLE'],
} as const

/** pma: Controllers/Table/Maintenance/*Controller + Table/Maintenance */
export async function maintenance(
  ctx: DbCtx,
  req: { tables: string[]; op: keyof typeof MAINT },
): Promise<MaintenanceResponse> {
  requireTables(ctx, req.tables)
  if (ctx.cfg.DisableMultiTableMaintenance && req.tables.length > 1) {
    throw new ValidationError(ctx.tr.gettext('Maintenance operations on multiple tables are disabled.'))
  }
  const [stmt, title, doc] = MAINT[req.op]
  const sql = `${stmt} ${req.tables.map((t) => backquote(t)).join(', ')};`
  await selectDb(ctx, ctx.db)
  let rows: Array<Record<string, string | null>>
  try {
    rows = await ctx.conn.rows(sql, 'maintenance')
  } catch (e) {
    if (e instanceof MysqlError) {
      return {
        title: ctx.tr.gettext(title),
        docPage: doc,
        messages: [msg('error', errorText(e), sql)],
        groups: [],
        checksums: [],
        warnings: [],
      }
    }
    throw e
  }
  const res: MaintenanceResponse = {
    title: ctx.tr.gettext(title),
    docPage: doc,
    messages: [msg('success', successText(ctx.tr), sql)],
    groups: [],
    checksums: [],
    warnings: [],
  }
  if (req.op === 'checksum') {
    res.checksums = rows.map((r) => ({ table: r.Table ?? '', checksum: r.Checksum ?? null }))
    const w = await ctx.dbi.tryQuery('SHOW WARNINGS')
    res.warnings = (w?.rows ?? []).map((r) => `${r[0] ?? ''}: #${r[1] ?? ''} ${r[2] ?? ''}`)
    return res
  }
  for (const r of rows) {
    // Message::fromArray: table without the database prefix
    const full = r.Table ?? ''
    const table = full.includes('.') ? full.slice(full.indexOf('.') + 1) : full
    let g = res.groups.find((x) => x.table === table)
    if (g === undefined) {
      g = { table, rows: [] }
      res.groups.push(g)
    }
    g.rows.push({ operation: r.Op ?? '', type: r.Msg_type ?? '', text: r.Msg_text ?? '' })
  }
  return res
}
