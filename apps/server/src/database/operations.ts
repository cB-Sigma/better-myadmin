import type { DbActionResponse, DbOperationsResponse } from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import { getDbComment, hasAllFeatures, relationCleanupDatabase, setDbComment } from '@bettermyadmin/metadata'
import { getCharsetQueryPart } from '@bettermyadmin/mysql-types'
import { backquote } from '@bettermyadmin/sql-gen'
import { ValidationError } from '../http/errors.ts'
import { getPrivileges } from '../navigation/privileges.ts'
import { isSuperUser } from '../server-admin/context.ts'
import { type DbCtx, getDbCollation, isSystemSchema, listTables, msg, selectDb } from './context.ts'
import {
  duplicateStorageInfo,
  fetchColumn,
  getDatabaseList,
  getTableDefStandIn,
  getTriggers,
  moveCopy,
  newMoveState,
  triggerCreateSql,
} from './table-mover.ts'
import { isMerge, isView, tableCache } from './tables.ts'

/**
 * Database Operations: comment, rename, copy, drop, collation.
 * pma: src/Controllers/Operations/DatabaseController.php, Operations/Database/CollationController.php,
 *      src/Operations.php, templates/database/operations/index.twig
 */

/** UserPrivileges: everything rename/copy need to adjust privileges */
const canAdjust = (p: Awaited<ReturnType<typeof getPrivileges>>) =>
  p.database && p.table && p.column && p.routines && p.isReload

export async function operationsPage(ctx: DbCtx): Promise<DbOperationsResponse> {
  const { tr, db, rp } = ctx
  const dbCollation = await getDbCollation(ctx)
  const system = isSystemSchema(db)
  const p = await getPrivileges(ctx.dbi)
  let notice: DbOperationsResponse['storageNotice'] = null
  if (!hasAllFeatures(rp) && !ctx.cfg.PmaNoRelation_DisableWarning) {
    notice = {
      type: ctx.server.pmadb !== '' ? 'error' : 'notice',
      text: tr.gettext('The phpMyAdmin configuration storage has been deactivated. %sFind out why%s.'),
    }
  }
  const charsets = await ctx.reader.getCharsets()
  const collations = await ctx.reader.getCollations()
  return {
    db,
    isSystemSchema: system,
    hasComment: rp.columnCommentsFeature !== null,
    comment: rp.columnCommentsFeature !== null ? await getDbComment(ctx.control, rp, db) : '',
    dbCollation,
    hasAdjustPrivileges: canAdjust(p),
    isDropDatabaseAllowed: ((await isSuperUser(ctx.dbi)) || ctx.cfg.AllowUserDropDatabase) && db !== 'mysql',
    switchToNew: ctx.tmpval.pma_switch_to_new === true,
    charsets: charsets.map((cs) => ({
      name: cs.name,
      description: cs.description,
      collations: [...(collations.get(cs.name)?.values() ?? [])].map((c) => ({
        name: c.name,
        description: c.description,
        isSelected: c.name === dbCollation,
      })),
    })),
    storageNotice: notice,
  }
}

/** pma: Relation::setDbComment via POST comment */
export async function saveComment(ctx: DbCtx, comment: string): Promise<DbActionResponse> {
  await setDbComment(ctx.control, ctx.rp, ctx.db, comment)
  return { messages: [] }
}

/** pma: Operations\Database\CollationController */
export async function changeCollation(
  ctx: DbCtx,
  req: { collation: string; changeAllTables: boolean; changeAllColumns: boolean },
): Promise<DbActionResponse> {
  if (req.collation === '') throw new ValidationError(ctx.tr.gettext('No collation provided.'))
  await ctx.conn.query(
    `ALTER DATABASE ${backquote(ctx.db)} DEFAULT${getCharsetQueryPart(req.collation)}`,
    'operations.collation',
  )
  if (req.changeAllTables) {
    for (const t of await listTables(ctx)) {
      if (await isView(ctx, ctx.db, t)) continue
      await ctx.conn.query(
        `ALTER TABLE ${backquote(ctx.db)}.${backquote(t)} DEFAULT ${getCharsetQueryPart(req.collation)}`,
        'operations.collation',
      )
      if (!req.changeAllColumns) continue
      // Operations::changeAllColumnsCollation
      await selectDb(ctx, ctx.db)
      const [charset = ''] = req.collation.split('_')
      await ctx.conn.query(
        `ALTER TABLE ${backquote(t)} CONVERT TO CHARACTER SET ${charset}${charset === req.collation ? '' : ` COLLATE ${req.collation}`}`,
        'operations.collation',
      )
    }
  }
  return { messages: [msg('success', ctx.tr.gettext('Your SQL query has been executed successfully.'))] }
}

export interface RenameCopyRequest {
  move: boolean
  newName: string
  collation?: string | undefined
  what: 'structure' | 'data' | 'dataonly'
  createDatabase: boolean
  dropIfExists: boolean
  autoIncrement: boolean
  addConstraints: boolean
  adjustPrivileges: boolean
  switchToNew: boolean
}

/** DatabaseName::from */
function validName(tr: DbCtx['tr'], name: string): string | null {
  if (name === '') return tr.gettext('The database name must be a non-empty string.')
  if ([...name].length > 64)
    return sprintf(tr.gettext('The database name cannot be longer than %d characters.'), 64)
  if (/ $/.test(name)) return tr.gettext('The database name cannot end with a space character.')
  return null
}

/**
 * Rename (move) or copy the database: routines → view stand-ins → tables (+triggers) → views →
 * constraints → events → bookmarks → privileges (→ DROP DATABASE for a rename).
 * pma: Operations\DatabaseController::__invoke (db_rename / db_copy)
 */
export async function renameOrCopy(
  ctx: DbCtx,
  req: RenameCopyRequest,
): Promise<DbActionResponse & { newName: string; db: string }> {
  const { tr } = ctx
  const old = ctx.db
  let newName = req.newName
  const invalid = validName(tr, newName)
  if (invalid !== null) return { messages: [msg('error', invalid)], newName: '', db: old }
  if ((await ctx.dbi.getLowerCaseNames()) === 1) newName = newName.toLowerCase()
  if (newName === old) {
    return {
      messages: [
        msg('error', tr.gettext('Cannot copy database to the same name. Change the name and try again.')),
      ],
      newName,
      db: old,
    }
  }
  const p = await getPrivileges(ctx.dbi)
  const st = newMoveState(req.autoIncrement)
  if (req.move || req.createDatabase) {
    // Operations::createDbBeforeCopy
    let q = `CREATE DATABASE IF NOT EXISTS ${backquote(newName)}`
    if (req.collation !== undefined) q += ` DEFAULT${getCharsetQueryPart(req.collation)}`
    q += ';'
    st.sqlQuery += q
    await ctx.conn.query(q, 'operations.create')
    await ctx.conn.query("SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO'", 'operations.mode')
    await getDatabaseList(ctx, true)
  }
  // runProcedureAndFunctionDefinitions
  for (const type of ['PROCEDURE', 'FUNCTION'] as const) {
    const names = await ctx.dbi.fetchSingleColumn(
      `SELECT SPECIFIC_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ${ctx.dbi.quoteString(old)} AND ROUTINE_TYPE = '${type}' AND SPECIFIC_NAME != ''`,
    )
    for (const name of names) {
      await selectDb(ctx, old)
      const def = await fetchColumn(
        ctx,
        `SHOW CREATE ${type} ${backquote(old)}.${backquote(name ?? '')}`,
        type === 'PROCEDURE' ? 'Create Procedure' : 'Create Function',
      )
      if (def === null) continue
      st.sqlQuery += `\n${def}`
      await selectDb(ctx, newName)
      await ctx.conn.query(def, 'operations.routine')
    }
  }
  await selectDb(ctx, old)
  const tables = await listTables(ctx, old)
  // getViewsAndCreateSqlViewStandIn
  const views: string[] = []
  for (const t of tables) {
    if (!(await isView(ctx, old, t))) continue
    if (req.dropIfExists) {
      const drop = `DROP VIEW IF EXISTS ${backquote(newName)}.${backquote(t)}`
      await ctx.conn.query(drop, 'operations.view')
      st.sqlQuery += `\n${drop};`
    }
    views.push(t)
    const standIn = await getTableDefStandIn(ctx, old, t)
    await selectDb(ctx, newName)
    await ctx.conn.query(standIn, 'operations.standin')
    st.sqlQuery += `\n${standIn}`
  }
  tableCache(ctx).forget(newName)
  // copyTables
  const constraints: string[] = []
  for (const t of tables) {
    if (await isView(ctx, old, t)) continue
    let mode: string = req.what
    if (await isMerge(ctx, old, t)) {
      if (mode === 'data') mode = 'structure'
      if (mode === 'dataonly') mode = 'nocopy'
    }
    if (mode === 'nocopy') continue
    const triggers = await getTriggers(ctx, old, t)
    const ok = await moveCopy(
      ctx,
      st,
      old,
      t,
      newName,
      t,
      req.move ? 'move' : (mode as 'structure' | 'data' | 'dataonly'),
      'database',
      req.dropIfExists,
    )
    if (!ok) break
    if (triggers.length > 0) {
      await selectDb(ctx, newName)
      for (const tg of triggers) {
        const create = triggerCreateSql(tg, '')
        await ctx.conn.query(create, 'operations.trigger')
        st.sqlQuery += `\n${create};`
      }
    }
    if (!req.addConstraints || st.sqlConstraintsQuery === '') continue
    constraints.push(st.sqlConstraintsQuery)
    st.sqlConstraintsQuery = ''
  }
  // handleTheViews
  for (const v of views) {
    if (!(await moveCopy(ctx, st, old, v, newName, v, req.move ? 'move' : 'structure', 'database', true)))
      break
  }
  // createAllAccumulatedConstraints
  if (constraints.length > 0) {
    await selectDb(ctx, newName)
    for (const q of constraints) {
      await ctx.conn.query(q, 'operations.constraints')
      st.sqlQuery += `\n${q}`
    }
  }
  // runEventDefinitionsForDb
  const events = await ctx.dbi.fetchSingleColumn(
    `SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA= ${ctx.dbi.quoteString(old)};`,
  )
  for (const e of events) {
    await selectDb(ctx, old)
    const def = await fetchColumn(
      ctx,
      `SHOW CREATE EVENT ${backquote(old)}.${backquote(e ?? '')}`,
      'Create Event',
    )
    st.sqlQuery += `\n${def ?? ''}`
    await selectDb(ctx, newName)
    await ctx.conn.query(def ?? '', 'operations.event')
  }
  await selectDb(ctx, old)
  // duplicateBookmarks
  if (ctx.rp.bookmarkFeature !== null) {
    await duplicateStorageInfo(
      ctx,
      ctx.rp.bookmarkFeature.bookmark,
      ['user', 'label', 'query'],
      { dbase: old },
      { dbase: newName },
    )
  }
  let text: string
  const priv = canAdjust(p)
  if (req.move) {
    if (req.adjustPrivileges && priv) await adjustPrivilegesMoveDb(ctx, old, newName)
    await relationCleanupDatabase(ctx.control, ctx.rp, old)
    const drop = `DROP DATABASE ${backquote(old)};`
    st.sqlQuery += `\n${drop}`
    await ctx.conn.query(drop, 'operations.drop')
    text = sprintf(tr.gettext('Database %1$s has been renamed to %2$s.'), old, newName)
  } else {
    if (req.adjustPrivileges && priv) await adjustPrivilegesCopyDb(ctx, old, newName)
    text = sprintf(tr.gettext('Database %1$s has been copied to %2$s.'), old, newName)
  }
  let current = old
  if (req.move) current = newName
  else if (req.switchToNew) {
    ctx.tmpval.pma_switch_to_new = true
    current = newName
  } else ctx.tmpval.pma_switch_to_new = false
  return { messages: [msg('success', text, st.sqlQuery)], newName, db: current }
}

const escUnderscore = (s: string) => s.replaceAll('_', '\\_')

/** Operations::adjustPrivilegesMoveDb */
async function adjustPrivilegesMoveDb(ctx: DbCtx, oldDb: string, newDb: string): Promise<void> {
  await selectDb(ctx, 'mysql')
  const n = ctx.dbi.quoteString(escUnderscore(newDb))
  const o = ctx.dbi.quoteString(escUnderscore(oldDb))
  for (const t of ['db', 'tables_priv', 'columns_priv', 'procs_priv']) {
    await ctx.conn.query(`UPDATE ${backquote(t)}SET Db = ${n} where Db = ${o};`, 'privileges.move')
  }
  await ctx.dbi.tryQuery('FLUSH PRIVILEGES;')
}

/** Operations::adjustPrivilegesCopyDb */
async function adjustPrivilegesCopyDb(ctx: DbCtx, oldDb0: string, newDb: string): Promise<void> {
  await selectDb(ctx, 'mysql')
  const newName = escUnderscore(newDb)
  const oldDb = escUnderscore(oldDb0)
  const rows = async (t: string) =>
    (await ctx.dbi.tryQuery(`SELECT * FROM ${backquote(t)} WHERE Db = "${oldDb}";`))?.rows ?? []
  for (const r of await rows('db')) {
    let q = `INSERT INTO ${backquote('db')} VALUES("${r[0]}", "${newName}"`
    for (let i = 2; i < r.length; i++) q += `, "${r[i] ?? ''}"`
    await ctx.conn.query(`${q})`, 'privileges.copy')
  }
  for (const r of await rows('tables_priv')) {
    await ctx.conn.query(
      `INSERT INTO ${backquote('tables_priv')} VALUES("${r[0]}", "${newName}", "${r[2]}", "${r[3]}", "${r[4]}", "${r[5]}", "${r[6]}", "${r[7]}");`,
      'privileges.copy',
    )
  }
  for (const r of await rows('columns_priv')) {
    await ctx.conn.query(
      `INSERT INTO ${backquote('columns_priv')} VALUES("${r[0]}", "${newName}", "${r[2]}", "${r[3]}", "${r[4]}", "${r[5]}", "${r[6]}");`,
      'privileges.copy',
    )
  }
  for (const r of await rows('procs_priv')) {
    await ctx.conn.query(
      `INSERT INTO ${backquote('procs_priv')} VALUES("${r[0]}", "${newName}", "${r[2]}", "${r[3]}", "${r[4]}", "${r[5]}", "${r[6]}", "${r[7]}");`,
      'privileges.copy',
    )
  }
  await ctx.dbi.tryQuery('FLUSH PRIVILEGES;')
}
