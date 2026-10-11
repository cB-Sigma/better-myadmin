import { type Translator, sprintf } from '@bettermyadmin/i18n'
import { duplicateInfo } from '@bettermyadmin/metadata'
import { backquote } from '@bettermyadmin/sql-gen'
import {
  AlterStatement,
  type CreateDefinition,
  type CreateStatement,
  Expression,
  OptionsArray,
  Parser,
  Context as SqlContext,
} from '@bettermyadmin/sql-lexer'
import type { AdminCtx } from '../server-admin/context.ts'
import { databaseList } from '../server-admin/databases.ts'
import { type DbCtx, selectDb } from './context.ts'
import { isView, tableCache } from './tables.ts'

/**
 * Copying and moving tables: the CREATE definition the SQL export plugin builds (constraints,
 * indexes and AUTO_INCREMENT split out), then CREATE / INSERT … SELECT / ALTER in the target.
 *
 * pma: src/Table/TableMover.php, src/Plugins/Export/ExportSql.php::getTableDef/getTableDefStandIn,
 *      src/Table/Table.php::rename/getNonGeneratedColumns, src/Operations.php
 */

export type MoveScope = 'structure' | 'data' | 'dataonly' | 'move'
export type MoveMode = 'single' | 'database'

/** Current::$sqlQuery / Current::$message as the mover leaves them */
export interface MoveState {
  sqlQuery: string
  sqlConstraintsQuery: string
  /** set when the mover reports an error (Current::$message) */
  error: string | null
  /** Table::rename's success message */
  renamed: string | null
  autoIncrement: boolean
}

export const newMoveState = (autoIncrement = false): MoveState => ({
  sqlQuery: '',
  sqlConstraintsQuery: '',
  error: null,
  renamed: null,
  autoIncrement,
})

const run = <T>(ctx: DbCtx, fn: () => T): T => SqlContext.run(ctx.conn.serverInfo?.context, fn)

/** The DatabaseInterface::getDatabaseList of the request (ListDatabase). */
const adminCtxs = new WeakMap<DbCtx, AdminCtx>()
function adminCtx(ctx: DbCtx): AdminCtx {
  let a = adminCtxs.get(ctx)
  if (a === undefined) {
    a = {
      cfg: ctx.cfg,
      server: ctx.server,
      serverIndex: ctx.serverIndex,
      conn: ctx.conn,
      dbi: ctx.dbi,
      tr: ctx.tr,
      timeZone: 'UTC',
      versionInt: ctx.conn.serverInfo?.versionInt ?? 0,
      isMariaDb: ctx.conn.serverInfo?.isMariaDb ?? false,
    }
    adminCtxs.set(ctx, a)
  }
  return a
}

export function getDatabaseList(ctx: DbCtx, fresh = false): Promise<string[]> {
  return databaseList(adminCtx(ctx), fresh)
}

/** `fetchValue($sql, 'Column')` */
export async function fetchColumn(ctx: DbCtx, sql: string, column: string): Promise<string | null> {
  const rows = await ctx.dbi.fetchResultSimple(sql)
  const v = rows[0]?.[column]
  return v === undefined ? null : v
}

export interface TableDef {
  create: string
  constraintsQuery: string
  indexes: string | null
  autoIncrements: string | null
}

/**
 * ExportSql::getTableDef with the settings TableMover uses (backquotes, no comments, no dates,
 * `sql_auto_increment` from the request).
 */
export async function getTableDef(
  ctx: DbCtx,
  db: string,
  table: string,
  view: boolean,
  autoIncrement: boolean,
): Promise<TableDef> {
  const out: TableDef = { create: '', constraintsQuery: '', indexes: null, autoIncrements: null }
  await isView(ctx, db, table)
  await ctx.conn.query('SET SQL_QUOTE_SHOW_CREATE = 1', 'export.quote')
  await ctx.dbi.tryQuery(`USE ${backquote(db)}`)
  const r = await ctx.dbi.tryQuery(`SHOW CREATE TABLE ${backquote(db)}.${backquote(table)}`)
  if (r === null) {
    throw new Error(
      `${sprintf(ctx.tr.gettext('Error reading structure for table %s:'), `${db}.${table}`)} ${ctx.dbi.lastError}`,
    )
  }
  const row = r.rows[0]
  if (row === undefined) return out
  let createQuery = row[1] ?? ''
  if (createQuery.includes('(\r\n ')) createQuery = createQuery.replaceAll('\r\n', '\n')
  else if (createQuery.includes('(\r ')) createQuery = createQuery.replaceAll('\r', '\n')
  return run(ctx, () => {
    if (view) {
      createQuery = createQuery.replaceAll(`${backquote(db)}.`, '')
      const st = new Parser(createQuery).statements[0] as CreateStatement
      if (ctx.cfg.Export.remove_definer_from_definitions) (st.options as OptionsArray).remove('DEFINER')
      createQuery = st.build()
    }
    // ExportSql::replaceWithAliases (no aliases): the statement is rebuilt by the parser
    const rebuilt = new Parser(createQuery).statements[0]
    if (rebuilt !== undefined) createQuery = rebuilt.build()
    const st = new Parser(createQuery).statements[0] as CreateStatement
    const engine =
      st.entityOptions instanceof OptionsArray ? String(st.entityOptions.get('ENGINE') ?? '') : ''
    if (
      Array.isArray(st.fields) &&
      st.fields.length > 0 &&
      (engine === '' || engine.toUpperCase() !== 'ARCHIVE')
    ) {
      const constraints: string[] = []
      const indexes: string[] = []
      const fulltext: string[] = []
      const autoInc: string[] = []
      const kept: CreateDefinition[] = []
      for (const field of st.fields) {
        let removed = false
        if (field.isConstraint) {
          constraints.push(field.build())
          removed = true
        } else if (field.key !== null) {
          if (field.key.type === 'FULLTEXT KEY') {
            fulltext.push(field.build())
            removed = true
          } else {
            indexes.push(field.build().replaceAll("COMMENT='", "COMMENT '"))
            removed = true
          }
        }
        if (field.key !== null && field.key.type === 'FOREIGN KEY' && field.name !== null) removed = true
        if (field.options?.has('AUTO_INCREMENT')) {
          autoInc.push(field.build())
          field.options?.remove('AUTO_INCREMENT')
        }
        if (!removed) kept.push(field)
      }
      st.fields = kept
      const header = `ALTER TABLE ${backquote(table)}`
      const footer = ';\n'
      if (constraints.length > 0) {
        out.constraintsQuery = `${header}\n  ADD ${constraints.join(',\n  ADD ')}${footer}`
      }
      let indexesQuery = ''
      if (indexes.length > 0) indexesQuery += `${header}\n  ADD ${indexes.join(',\n  ADD ')}${footer}`
      if (fulltext.length > 0) {
        indexesQuery += `${header} ADD ${fulltext.join(`${footer}${header} ADD `)}${footer}`
      }
      if (indexes.length > 0 || fulltext.length > 0) out.indexes = indexesQuery
      if (autoInc.length > 0) {
        let q = `${header}\n  MODIFY ${autoInc.join(',\n  MODIFY ')}`
        if (autoIncrement && st.entityOptions?.has('AUTO_INCREMENT')) {
          q += `, AUTO_INCREMENT=${String(st.entityOptions.get('AUTO_INCREMENT'))}`
        }
        out.autoIncrements = `${q};\n`
      }
      st.entityOptions?.remove('AUTO_INCREMENT')
      createQuery = st.build()
    }
    out.create = createQuery
    return out
  })
}

/** ExportSql::getTableDefStandIn (dropTable/ifNotExists off) */
export async function getTableDefStandIn(ctx: DbCtx, db: string, view: string): Promise<string> {
  const cols = await ctx.reader.getColumns(db, view)
  return `CREATE TABLE ${backquote(view)} (\n${cols.map((c) => `${backquote(c.Field)} ${c.Type}\n`).join(',')});\n`
}

/** Table::getNonGeneratedColumns */
async function nonGeneratedColumns(ctx: DbCtx, db: string, table: string): Promise<string[]> {
  const rows = await ctx.dbi.fetchResultSimple(`SHOW COLUMNS FROM ${backquote(db)}.${backquote(table)}`)
  return rows
    .filter((c) => {
      const extra = c.Extra ?? ''
      return !(
        (extra.includes('GENERATED') || extra.includes('VIRTUAL')) &&
        !extra.includes('DEFAULT_GENERATED')
      )
    })
    .map((c) => backquote(c.Field ?? ''))
}

/** Triggers::getDetails rows as needed by copies (name, timing, event, table, statement) */
export interface TriggerInfo {
  name: string
  timing: string
  event: string
  table: string
  statement: string
  definer: string
}

/** Triggers::getDetails */
export async function getTriggers(ctx: DbCtx, db: string, table = ''): Promise<TriggerInfo[]> {
  let sql: string
  if (!ctx.server.DisableIS) {
    const collate = await ctx.dbi.collateForIS()
    sql =
      'SELECT TRIGGER_SCHEMA, TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_TIMING, ACTION_STATEMENT, EVENT_OBJECT_SCHEMA, EVENT_OBJECT_TABLE, DEFINER' +
      ` FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA ${collate}= ${ctx.dbi.quoteString(db)}`
    if (table !== '') sql += ` AND EVENT_OBJECT_TABLE ${collate} = ${ctx.dbi.quoteString(table)};`
  } else {
    sql = `SHOW TRIGGERS FROM ${backquote(db)}`
    if (table !== '') sql += ` LIKE ${ctx.dbi.quoteString(table)};`
  }
  const rows = await ctx.dbi.fetchResultSimple(sql)
  const out: TriggerInfo[] = []
  for (const r of rows) {
    const t = {
      name: r.Trigger ?? r.TRIGGER_NAME ?? null,
      timing: r.Timing ?? r.ACTION_TIMING ?? null,
      event: r.Event ?? r.EVENT_MANIPULATION ?? null,
      table: r.Table ?? r.EVENT_OBJECT_TABLE ?? null,
      statement: r.Statement ?? r.ACTION_STATEMENT ?? null,
      definer: r.Definer ?? r.DEFINER ?? null,
    }
    if (Object.values(t).some((v) => v === null || v === '')) continue
    out.push(t as TriggerInfo)
  }
  // array_multisort by name (byte order)
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** Trigger::getCreateSql */
export const triggerCreateSql = (t: TriggerInfo, delimiter = '//') =>
  `CREATE TRIGGER ${backquote(t.name)} ${t.timing} ${t.event} ON ${backquote(t.table)}\n FOR EACH ROW ${t.statement}\n${delimiter}\n`

/** Table::rename (MoveScope::Move) */
async function renameTable(
  ctx: DbCtx,
  st: MoveState,
  db: string,
  table: string,
  newName0: string,
  newDb: string,
): Promise<boolean> {
  const tr: Translator = ctx.tr
  let newName = newName0
  if ((await ctx.dbi.getLowerCaseNames()) === 1) newName = newName.toLowerCase()
  if (newDb !== db && !(await getDatabaseList(ctx)).includes(newDb)) return false
  if (db === newDb && table === newName) return true
  const triggers = await getTriggers(ctx, db, table)
  const handle = db !== newDb && triggers.length > 0
  if (handle) {
    for (const t of triggers) {
      await ctx.conn.query(`DROP TRIGGER IF EXISTS ${backquote(db)}.${backquote(t.name)};`, 'move.trigger')
    }
  }
  st.sqlQuery = `RENAME TABLE ${backquote(db)}.${backquote(table)} TO ${backquote(newDb)}.${backquote(newName)};`
  if ((await ctx.dbi.tryQuery(st.sqlQuery)) === null) {
    if (handle) {
      await selectDb(ctx, db)
      for (const t of triggers) await ctx.conn.query(triggerCreateSql(t, ''), 'move.trigger')
    }
    return false
  }
  tableCache(ctx).forget(db, table)
  await renameInStorage(ctx, db, newDb, table, newName)
  st.renamed = sprintf(tr.gettext('Table %1$s has been renamed to %2$s.'), table, newName)
  return true
}

/** Relation::renameTable (control link) */
async function renameInStorage(ctx: DbCtx, oldDb: string, newDb: string, oldT: string, newT: string) {
  const c = ctx.control
  if (c === null) return
  const rp = ctx.rp
  const q = (s: string) => ctx.dbi.quoteString(s)
  const upd = async (db: string, table: string, dbField: string, tableField: string) => {
    await c.tryQuery(
      `UPDATE ${backquote(rp.db ?? '')}.${backquote(table)} SET ${dbField} = ${q(newDb)}, ${tableField} = ${q(newT)} WHERE ${dbField} = ${q(oldDb)} AND ${tableField} = ${q(oldT)}`,
    )
    void db
  }
  if (rp.columnCommentsFeature !== null)
    await upd('', rp.columnCommentsFeature.columnInfo, 'db_name', 'table_name')
  if (rp.relationFeature !== null) {
    await upd('', rp.relationFeature.relation, 'foreign_db', 'foreign_table')
    await upd('', rp.relationFeature.relation, 'master_db', 'master_table')
  }
  if (rp.displayFeature !== null) await upd('', rp.displayFeature.tableInfo, 'db_name', 'table_name')
}

/** TableMover::duplicateInfo on the control link (one owner: @bettermyadmin/metadata). */
export function duplicateStorageInfo(
  ctx: DbCtx,
  table: string | null | undefined,
  getFields: string[],
  where: Record<string, string>,
  newFields: Record<string, string>,
): Promise<void> {
  return duplicateInfo(ctx.control, ctx.rp.db, table ?? null, getFields, where, newFields)
}

const destination = (db: string, table: string) => new Expression(db, table, '')

/** TableMover::moveCopy */
export async function moveCopy(
  ctx: DbCtx,
  st: MoveState,
  sourceDb: string,
  sourceTable: string,
  targetDb: string,
  targetTable: string,
  what: MoveScope,
  mode: MoveMode,
  addDropIfExists: boolean,
): Promise<boolean> {
  const tr = ctx.tr
  if (what === 'move' && (await renameTable(ctx, st, sourceDb, sourceTable, targetTable, targetDb)))
    return true
  const list = await getDatabaseList(ctx)
  if (!list.includes(sourceDb)) {
    st.error = sprintf(tr.gettext('Source database `%s` was not found!'), sourceDb)
    return false
  }
  if (!list.includes(targetDb)) {
    st.error = sprintf(tr.gettext('Target database `%s` was not found!'), targetDb)
    return false
  }
  await selectDb(ctx, targetDb)
  let maintainRelations = false
  if (what !== 'dataonly') {
    // handleStructureCreation
    const view = await isView(ctx, sourceDb, sourceTable)
    const def = await getTableDef(ctx, sourceDb, sourceTable, view, st.autoIncrement)
    const dest = destination(targetDb, targetTable)
    if (addDropIfExists) {
      const targetIsView = await isView(ctx, targetDb, targetTable)
      const drop = `DROP ${targetIsView ? 'VIEW' : 'TABLE'} IF EXISTS ${run(ctx, () => dest.build())};`
      await ctx.conn.query(drop, 'move.drop')
      st.sqlQuery += `\n${drop}`
      maintainRelations = true
    }
    // createNewStructure
    const created = run(ctx, () => {
      const s = new Parser(def.create).statements[0] as CreateStatement | undefined
      if (s === undefined) return null
      s.name = dest
      return `${s.build()};`
    })
    if (created !== null) {
      if (what === 'move') await selectDb(ctx, targetDb)
      await ctx.conn.query(created, 'move.create')
      st.sqlQuery += `\n${created}`
      tableCache(ctx).forget(targetDb, targetTable)
    }
    st.sqlConstraintsQuery = def.constraintsQuery
    if (what === 'move' && def.constraintsQuery !== '') {
      st.sqlConstraintsQuery = run(ctx, () => {
        const a = new Parser(def.constraintsQuery).statements[0] as AlterStatement
        a.table = dest
        for (const op of a.altered ?? []) if (op.options?.has('CONSTRAINT')) op.field = null
        return `${a.build()};`
      })
      st.sqlQuery += `\n${st.sqlConstraintsQuery}`
      if (mode === 'single') {
        await ctx.conn.query(st.sqlConstraintsQuery, 'move.constraints')
        st.sqlConstraintsQuery = ''
      }
    }
    if (def.indexes !== null) {
      const stmts = run(ctx, () =>
        new Parser(def.indexes as string).statements.map((s) => {
          const a = s as AlterStatement
          a.table = dest
          for (const op of a.altered ?? []) if (op.options?.has('CONSTRAINT')) op.field = null
          return `${a.build()};`
        }),
      )
      for (const s of stmts) await ctx.conn.query(s, 'move.indexes')
      st.sqlQuery += `\n${stmts.join('')}`
    }
    if (def.autoIncrements !== null) {
      const s = run(ctx, () => {
        const a = new Parser(def.autoIncrements as string).statements[0]
        if (!(a instanceof AlterStatement)) return null
        a.table = dest
        return `${a.build()};`
      })
      if (s !== null) {
        await ctx.conn.query(s, 'move.autoincrement')
        st.sqlQuery += `\n${s}`
      }
    }
  } else {
    st.sqlQuery = ''
  }
  if (what !== 'structure' && !(await isView(ctx, targetDb, targetTable))) {
    // copyData
    const mode0 = "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO'"
    await ctx.conn.query(mode0, 'move.mode')
    st.sqlQuery += `\n\n${mode0};`
    const cols = await nonGeneratedColumns(ctx, sourceDb, sourceTable)
    if (cols.length > 0) {
      const ins = `INSERT INTO ${backquote(targetDb)}.${backquote(targetTable)}(${cols.join(', ')}) SELECT ${cols.join(', ')} FROM ${backquote(sourceDb)}.${backquote(sourceTable)}`
      await ctx.conn.query(ins, 'move.data')
      st.sqlQuery += `\n\n${ins};`
    }
  }
  if (what === 'move') {
    await selectDb(ctx, sourceDb)
    const drop = `${(await isView(ctx, sourceDb, sourceTable)) ? 'DROP VIEW ' : 'DROP TABLE '}${backquote(sourceDb)}.${backquote(sourceTable)}`
    await ctx.conn.query(drop, 'move.dropold')
    st.sqlQuery += `\n\n${drop};`
    tableCache(ctx).forget(sourceDb, sourceTable)
    await renameInStorage(ctx, sourceDb, targetDb, sourceTable, targetTable)
    return true
  }
  if (what === 'dataonly' || maintainRelations) return true
  const rp = ctx.rp
  const cc = rp.columnCommentsFeature
  if (cc !== null && ctx.control !== null) {
    const q = (s: string) => ctx.dbi.quoteString(s)
    const mime = rp.browserTransformationFeature !== null
    const r = await ctx.control.query(
      `SELECT column_name, comment${mime ? ', mimetype, transformation, transformation_options' : ''} FROM ${backquote(cc.database)}.${backquote(cc.columnInfo)} WHERE  db_name = ${q(sourceDb)} AND  table_name = ${q(sourceTable)}`,
    )
    for (const row of r.rows) {
      await ctx.control.query(
        `REPLACE INTO ${backquote(cc.database)}.${backquote(cc.columnInfo)} (db_name, table_name, column_name, comment${mime ? ', mimetype, transformation, transformation_options' : ''}) VALUES(${q(targetDb)},${q(targetTable)},${q(row.column_name ?? '')},${q(row.comment ?? '')}${mime ? `,${q(row.mimetype ?? '')},${q(row.transformation ?? '')},${q(row.transformation_options ?? '')}` : ''})`,
      )
    }
  }
  if (rp.displayFeature !== null) {
    await duplicateStorageInfo(
      ctx,
      rp.displayFeature.tableInfo,
      ['display_field'],
      { db_name: sourceDb, table_name: sourceTable },
      {
        db_name: targetDb,
        table_name: targetTable,
      },
    )
  }
  if (rp.relationFeature !== null) {
    await duplicateStorageInfo(
      ctx,
      rp.relationFeature.relation,
      ['master_field', 'foreign_table', 'foreign_field'],
      { master_db: sourceDb, master_table: sourceTable },
      { master_db: targetDb, foreign_db: targetDb, master_table: targetTable },
    )
    await duplicateStorageInfo(
      ctx,
      rp.relationFeature.relation,
      ['foreign_field', 'master_table', 'master_field'],
      { foreign_db: sourceDb, foreign_table: sourceTable },
      { master_db: targetDb, foreign_db: targetDb, foreign_table: targetTable },
    )
  }
  return true
}
