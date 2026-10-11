/**
 * Copying and moving tables — the one TableMover of the app (table Operations, database
 * copy/rename, the database Structure bulk copy): rename first for a move, else the CREATE
 * definition of the export SQL plugin (constraints, indexes, AUTO_INCREMENT split out), the data
 * through INSERT … SELECT, then the configuration storage.
 *
 * pma: src/Table/TableMover.php, src/Table/Table.php::rename/getNonGeneratedColumns,
 *      src/Triggers/Triggers.php::getDetails, src/Database/Routines… (Trigger::getCreateSql)
 */
import { type Translator, sprintf } from '@bettermyadmin/i18n'
import {
  type MetaConn,
  type RelationParameters,
  duplicateTableInfo,
  renameTableInStorage,
} from '@bettermyadmin/metadata'
import { backquote } from '@bettermyadmin/sql-gen'
import {
  AlterStatement,
  type CreateStatement,
  Expression,
  Parser,
  Context as SqlContext,
} from '@bettermyadmin/sql-lexer'
import type { AppConfig, ServerConfig } from '../config.ts'
import type { AdminCtx } from '../server-admin/context.ts'
import { databaseList } from '../server-admin/databases.ts'
import type { TableReader } from './read.ts'
import { getTableDef } from './table-def.ts'

/** What the mover needs of a request (a table-scope or a database-scope context). */
export interface MoverCtx {
  reader: TableReader
  cfg: AppConfig
  tr: Translator
  server: ServerConfig
  serverIndex: number
  /** the configuration storage (null: none in use) */
  rp: RelationParameters | null
  control: MetaConn | null
  /** a table of the caller's caches changed (created, dropped, renamed) */
  forget?: (db: string, table: string) => void
}

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
  /** the plugin's setAutoIncrement (`sql_auto_increment`) */
  autoIncrement: boolean
}

export const newMoveState = (autoIncrement = false): MoveState => ({
  sqlQuery: '',
  sqlConstraintsQuery: '',
  error: null,
  renamed: null,
  autoIncrement,
})

const run = <T>(ctx: MoverCtx, fn: () => T): T => SqlContext.run(ctx.reader.conn.serverInfo?.context, fn)

const adminCtxs = new WeakMap<MoverCtx, AdminCtx>()
/** DatabaseInterface::getDatabaseList (ListDatabase) of the request */
export function getDatabaseList(ctx: MoverCtx, fresh = false): Promise<string[]> {
  let a = adminCtxs.get(ctx)
  if (a === undefined) {
    const conn = ctx.reader.conn
    a = {
      cfg: ctx.cfg,
      server: ctx.server,
      serverIndex: ctx.serverIndex,
      conn,
      dbi: ctx.reader.dbi,
      tr: ctx.tr,
      timeZone: 'UTC',
      versionInt: conn.serverInfo?.versionInt ?? 0,
      isMariaDb: conn.serverInfo?.isMariaDb ?? false,
    }
    adminCtxs.set(ctx, a)
  }
  return databaseList(a, fresh)
}

/** Triggers::getDetails rows (name, timing, event, table, statement, definer) */
export interface TriggerInfo {
  name: string
  timing: string
  event: string
  table: string
  statement: string
  definer: string
}

/** Triggers::getDetails, sorted by name */
export async function getTriggers(
  ctx: { reader: TableReader; server: ServerConfig },
  db: string,
  table = '',
): Promise<TriggerInfo[]> {
  const dbi = ctx.reader.dbi
  let sql: string
  if (!ctx.server.DisableIS) {
    const collate = await dbi.collateForIS()
    sql =
      'SELECT TRIGGER_SCHEMA, TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_TIMING, ACTION_STATEMENT, EVENT_OBJECT_SCHEMA, EVENT_OBJECT_TABLE, DEFINER' +
      ` FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA ${collate}= ${dbi.quoteString(db)}`
    if (table !== '') sql += ` AND EVENT_OBJECT_TABLE ${collate} = ${dbi.quoteString(table)};`
  } else {
    sql = `SHOW TRIGGERS FROM ${backquote(db)}`
    if (table !== '') sql += ` LIKE ${dbi.quoteString(table)};`
  }
  const rows = await dbi.fetchResultSimple(sql)
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

/** Table::rename (MoveScope::Move): RENAME TABLE, the triggers recreated across databases */
async function renameTable(
  ctx: MoverCtx,
  st: MoveState,
  db: string,
  table: string,
  newName0: string,
  newDb: string,
): Promise<boolean> {
  const { reader } = ctx
  let newName = newName0
  if ((await reader.dbi.getLowerCaseNames()) === 1) newName = newName.toLowerCase()
  if (newDb !== db && !(await getDatabaseList(ctx)).includes(newDb)) return false
  if (db === newDb && table === newName) return true
  const triggers = await getTriggers(ctx, db, table)
  const handle = db !== newDb && triggers.length > 0
  if (handle) {
    for (const t of triggers) {
      await reader.conn.query(`DROP TRIGGER IF EXISTS ${backquote(db)}.${backquote(t.name)};`, 'move.trigger')
    }
  }
  st.sqlQuery = `RENAME TABLE ${backquote(db)}.${backquote(table)} TO ${backquote(newDb)}.${backquote(newName)};`
  if ((await reader.dbi.tryQuery(st.sqlQuery)) === null) {
    if (handle) {
      await reader.selectDb(db)
      for (const t of triggers) await reader.conn.query(triggerCreateSql(t, ''), 'move.trigger')
    }
    return false
  }
  reader.invalidate()
  ctx.forget?.(db, table)
  if (ctx.rp !== null) await renameTableInStorage(ctx.control, ctx.rp, db, newDb, table, newName)
  st.renamed = sprintf(ctx.tr.gettext('Table %1$s has been renamed to %2$s.'), table, newName)
  return true
}

/** Table::getNonGeneratedColumns */
async function nonGeneratedColumns(ctx: MoverCtx, db: string, table: string): Promise<string[]> {
  const rows = await ctx.reader.dbi.fetchResultSimple(
    `SHOW COLUMNS FROM ${backquote(db)}.${backquote(table)}`,
  )
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

const destination = (db: string, table: string) => new Expression(db, table, '')

/** TableMover::moveCopy */
export async function moveCopy(
  ctx: MoverCtx,
  st: MoveState,
  sourceDb: string,
  sourceTable: string,
  targetDb: string,
  targetTable: string,
  what: MoveScope,
  mode: MoveMode,
  addDropIfExists: boolean,
): Promise<boolean> {
  const { tr, reader } = ctx
  const conn = reader.conn
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
  await reader.selectDb(targetDb)
  let maintainRelations = false
  if (what !== 'dataonly') {
    // handleStructureCreation
    const view = await reader.isView(sourceDb, sourceTable)
    const def = await getTableDef(ctx, sourceDb, sourceTable, view, st.autoIncrement)
    const dest = destination(targetDb, targetTable)
    if (addDropIfExists) {
      const targetIsView = await reader.isView(targetDb, targetTable)
      const drop = `DROP ${targetIsView ? 'VIEW' : 'TABLE'} IF EXISTS ${run(ctx, () => dest.build())};`
      await conn.query(drop, 'move.drop')
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
      if (what === 'move') await reader.selectDb(targetDb)
      await conn.query(created, 'move.create')
      st.sqlQuery += `\n${created}`
      reader.invalidate()
      ctx.forget?.(targetDb, targetTable)
    }
    st.sqlConstraintsQuery = def.constraints
    if (what === 'move' && def.constraints !== '') {
      st.sqlConstraintsQuery = run(ctx, () => {
        const a = new Parser(def.constraints).statements[0]
        if (!(a instanceof AlterStatement)) return def.constraints
        a.table = dest
        for (const op of a.altered ?? []) if (op.options?.has('CONSTRAINT')) op.field = null
        return `${a.build()};`
      })
      st.sqlQuery += `\n${st.sqlConstraintsQuery}`
      if (mode === 'single') {
        await conn.query(st.sqlConstraintsQuery, 'move.constraints')
        st.sqlConstraintsQuery = ''
      }
    }
    if (def.indexes !== null) {
      const stmts = run(ctx, () =>
        new Parser(def.indexes as string).statements.map((s) => {
          if (s instanceof AlterStatement) {
            s.table = dest
            for (const op of s.altered ?? []) if (op.options?.has('CONSTRAINT')) op.field = null
          }
          return `${s.build()};`
        }),
      )
      for (const s of stmts) await conn.query(s, 'move.indexes')
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
        await conn.query(s, 'move.autoincrement')
        st.sqlQuery += `\n${s}`
      }
    }
  } else {
    st.sqlQuery = ''
  }
  if (what !== 'structure' && !(await reader.isView(targetDb, targetTable))) {
    // copyData
    const mode0 = "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO'"
    await conn.query(mode0, 'move.mode')
    st.sqlQuery += `\n\n${mode0};`
    const cols = await nonGeneratedColumns(ctx, sourceDb, sourceTable)
    if (cols.length > 0) {
      const ins = `INSERT INTO ${backquote(targetDb)}.${backquote(targetTable)}(${cols.join(', ')}) SELECT ${cols.join(', ')} FROM ${backquote(sourceDb)}.${backquote(sourceTable)}`
      await conn.query(ins, 'move.data')
      st.sqlQuery += `\n\n${ins};`
    }
  }
  if (what === 'move') {
    await reader.selectDb(sourceDb)
    const drop = `${(await reader.isView(sourceDb, sourceTable)) ? 'DROP VIEW ' : 'DROP TABLE '}${backquote(sourceDb)}.${backquote(sourceTable)}`
    await conn.query(drop, 'move.dropold')
    st.sqlQuery += `\n\n${drop};`
    reader.invalidate()
    ctx.forget?.(sourceDb, sourceTable)
    if (ctx.rp !== null) {
      await renameTableInStorage(ctx.control, ctx.rp, sourceDb, targetDb, sourceTable, targetTable)
    }
    return true
  }
  if (what === 'dataonly' || maintainRelations) return true
  if (ctx.rp !== null) {
    await duplicateTableInfo(ctx.control, ctx.rp, sourceDb, sourceTable, targetDb, targetTable)
  }
  return true
}
