import type { SqlMessage } from '@bettermyadmin/contracts'
import { type Translator, sprintf } from '@bettermyadmin/i18n'
import type { MetaConn, RelationParameters } from '@bettermyadmin/metadata'
import { backquote } from '@bettermyadmin/sql-gen'
import type { Context } from 'hono'
import type { z } from 'zod'
import { type AppConfig, type ServerConfig, getServer } from '../config.ts'
import type { Conn } from '../db/connection.ts'
import { MysqlError, NotFoundError, ValidationError } from '../http/errors.ts'
import { MetaRequest } from '../metadata/service.ts'
import type { NavDbi } from '../navigation/dbi.ts'
import { strnatcasecmp } from '../navigation/php.ts'
import type { ServerEnv } from '../routes/server.ts'
import { TableReader } from '../table/read.ts'
import type { MoverCtx } from '../table/table-mover.ts'

/**
 * What a database-level page or action needs: the user's connection (TableReader / NavDbi, the
 * "try" flavoured DatabaseInterface), the configuration with the user's preferences applied, the
 * configuration storage (control link + relation parameters) and the request translator.
 */
export interface DbCtx {
  c: Context<ServerEnv>
  cfg: AppConfig
  server: ServerConfig
  serverIndex: number
  tr: Translator
  db: string
  reader: TableReader
  dbi: NavDbi
  conn: Conn
  meta: MetaRequest
  rp: RelationParameters
  /** the control link, or null when no configuration storage is in use */
  control: MetaConn | null
  /** `$_SESSION['tmpval']` of this server login */
  tmpval: Record<string, unknown>
  /** the per-server session cache (SessionCache) */
  cache: Record<string, unknown>
  /** the logged-in MySQL user */
  user: string
}

/**
 * Runs `fn` for the database of the request (`:db`). `select` checks the database like
 * DbTableExists::selectDatabase and answers "No databases selected." when it does not exist.
 */
export async function withDb<T>(
  c: Context<ServerEnv>,
  fn: (ctx: DbCtx) => Promise<T>,
  opts: { select?: boolean; db?: string } = {},
): Promise<T> {
  const { pools } = c.get('deps')
  const session = c.get('session')
  const serverIndex = c.get('serverIndex')
  const login = session.servers[String(serverIndex)]
  const server = getServer(c.get('deps').cfg, serverIndex)
  if (login === undefined || server === undefined) throw new ValidationError('Invalid server index!')
  login.cache ??= {}
  const cache = login.cache as Record<string, unknown>
  cache.tmpval ??= {}
  const tmpval = cache.tmpval as Record<string, unknown>
  const db = opts.db ?? c.req.param('db') ?? ''
  const tr = c.get('tr')
  const meta = new MetaRequest(c, { db })
  const conn = await pools.acquire(
    session.id,
    serverIndex,
    c.get('creds'),
    c.get('executed'),
    undefined,
    c.get('language').mysqlLocale,
  )
  try {
    const reader = new TableReader(conn, login.cache, tr)
    if (opts.select !== false) {
      if (db === '' || !(await reader.selectDb(db)))
        throw new NotFoundError(tr.gettext('No databases selected.'))
    }
    const rp = await meta.relationParameters()
    const cfg = await meta.settings()
    return await fn({
      c,
      cfg,
      server,
      serverIndex,
      tr,
      db,
      reader,
      dbi: reader.dbi,
      conn,
      meta,
      rp,
      control: rp.db === null ? null : meta.control,
      tmpval,
      cache,
      user: login.user,
    })
  } finally {
    conn.raw.release()
    meta.close()
  }
}

export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value ?? {})
  if (!r.success) {
    throw new ValidationError(
      'Invalid request.',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  return r.data
}

export const msg = (type: SqlMessage['type'], text: string, sql?: string): SqlMessage =>
  sql === undefined || sql === '' ? { type, text } : { type, text, sql }

/** Message::success() without a text: "Your SQL query has been executed successfully." */
export const successText = (tr: Translator) => tr.gettext('Your SQL query has been executed successfully.')

/** DatabaseInterface::getError formatting of a failed statement. */
export const errorText = (e: MysqlError) => `#${e.extra.errno ?? 0} - ${e.message}`

/** DatabaseInterface::query — the error ends the request (MysqlError carries the SQL). */
export async function query(ctx: DbCtx, sql: string, label = 'db.query'): Promise<void> {
  await ctx.conn.query(sql, label)
}

/** DatabaseInterface::tryQuery — the formatted error, or null. */
export async function tryQuery(ctx: DbCtx, sql: string, label = 'db.query'): Promise<string | null> {
  try {
    await ctx.conn.query(sql, label)
    return null
  } catch (e) {
    if (e instanceof MysqlError) return errorText(e)
    throw e
  }
}

/** DatabaseInterface::selectDb (USE) */
export async function selectDb(ctx: DbCtx, db: string): Promise<boolean> {
  return ctx.reader.selectDb(db)
}

/** DatabaseInterface::getVariable('X') session scope */
export async function getVariable(ctx: DbCtx, name: string): Promise<string | null> {
  return ctx.reader.getSessionVariable(name)
}

/** DatabaseInterface::setVariable: SET only when the value changes. */
export async function setVariable(ctx: DbCtx, name: string, value: string): Promise<void> {
  const current = await getVariable(ctx, name)
  if (current === value) return
  await ctx.conn.query(`SET ${name} = ${value};`, 'var.set')
}

/** ForeignKey::handleDisableCheckInit: the default value, then fk_checks applied when posted. */
export async function fkCheckInit(ctx: DbCtx, fkChecks: boolean | undefined): Promise<boolean> {
  const def = (await getVariable(ctx, 'FOREIGN_KEY_CHECKS')) === 'ON'
  if (fkChecks !== undefined) await setVariable(ctx, 'FOREIGN_KEY_CHECKS', fkChecks ? 'ON' : 'OFF')
  return def
}

/** ForeignKey::handleDisableCheckCleanup */
export async function fkCheckCleanup(ctx: DbCtx, def: boolean): Promise<void> {
  await setVariable(ctx, 'FOREIGN_KEY_CHECKS', def ? 'ON' : 'OFF')
}

/** ForeignKey::isCheckEnabled */
export async function isFkCheckEnabled(ctx: DbCtx): Promise<boolean> {
  if (ctx.cfg.DefaultForeignKeyChecks === 'enable') return true
  if (ctx.cfg.DefaultForeignKeyChecks === 'disable') return false
  return (await getVariable(ctx, 'FOREIGN_KEY_CHECKS')) === 'ON'
}

/** DatabaseInterface::listTables (SHOW TABLES FROM `db`;, natural order) */
export async function listTables(
  ctx: Pick<DbCtx, 'dbi' | 'cfg'> & { db?: string },
  db = ctx.db ?? '',
): Promise<string[]> {
  const r = await ctx.dbi.tryQuery(`SHOW TABLES FROM ${backquote(db)};`, 'db.tables')
  if (r === null) return []
  const names = r.rows.map((row) => row[0] ?? '')
  if (ctx.cfg.NaturalOrder) names.sort(strnatcasecmp)
  return names
}

/** pma: Query/Utilities.php::isSystemSchema */
export function isSystemSchema(name: string, testForMysqlSchema = false): boolean {
  const s = name.toLowerCase()
  return (
    s === 'information_schema' ||
    s === 'performance_schema' ||
    (s === 'mysql' && testForMysqlSchema) ||
    s === 'sys'
  )
}

/** sprintf with msgid translation */
export const tf = (tr: Translator, msgid: string, ...args: Array<string | number>) =>
  sprintf(tr.gettext(msgid), ...args)

/** DatabaseInterface::getDbCollation (information_schema) */
export async function getDbCollation(ctx: DbCtx, db = ctx.db): Promise<string> {
  const v = await ctx.dbi.fetchValue(
    `SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${ctx.dbi.quoteString(db)} LIMIT 1`,
  )
  return typeof v === 'string' ? v : ''
}

/** `fetchValue($sql, 'Column')` */
export async function fetchColumn(ctx: DbCtx, sql: string, column: string): Promise<string | null> {
  const rows = await ctx.dbi.fetchResultSimple(sql)
  const v = rows[0]?.[column]
  return v === undefined ? null : v
}

const movers = new WeakMap<DbCtx, MoverCtx>()
/** The request as the TableMover sees it (one per request: the database list is cached on it). */
export function moverCtx(ctx: DbCtx, forget?: (db: string, table: string) => void): MoverCtx {
  let m = movers.get(ctx)
  if (m === undefined) {
    m = {
      reader: ctx.reader,
      cfg: ctx.cfg,
      tr: ctx.tr,
      server: ctx.server,
      serverIndex: ctx.serverIndex,
      rp: ctx.rp,
      control: ctx.control,
      ...(forget !== undefined ? { forget } : {}),
    }
    movers.set(ctx, m)
  }
  return m
}
