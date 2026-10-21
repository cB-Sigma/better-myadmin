import { readFileSync } from 'node:fs'
import type {
  DatabaseScope,
  DbTabKey,
  ServerScope,
  ServerTabKey,
  TableScope,
  TableTabKey,
} from '@bettermyadmin/contracts'
import type { Translator } from '@bettermyadmin/i18n'
import { phpEmpty } from '@bettermyadmin/metadata'
import { getDbComment } from '@bettermyadmin/metadata'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import type { AppConfig, ServerConfig } from '../config.ts'
import type { Conn } from '../db/connection.ts'
import { NotFoundError } from '../http/errors.ts'
import type { MetaRequest } from '../metadata/service.ts'
import { type StorageInfo, deniedTabs, storageInfo } from '../pmadb/storage.ts'
import { PrivilegeProbe, isSystemSchema } from './privileges.ts'

/** BMA_VERSION when set (a build stamping its own version), else the server package's version */
export const APP_VERSION =
  process.env.BMA_VERSION ??
  (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string })
    .version

/**
 * What a shell request needs: the user connection, the configuration-storage request (metadata
 * layer: discovery cached per session, its control link) and the session cache.
 */
export interface ShellCtx {
  cfg: AppConfig
  server: ServerConfig
  serverIndex: number
  /** The login name (selectedServer['user'] — used for pma__users lookups) */
  username: string
  conn: Conn
  meta: MetaRequest | null
  cache: Record<string, unknown>
  /** The request's catalogue (phpMyAdmin msgids) and language code (Current::$lang). */
  tr: Translator
  lang: string
}

const NO_STORAGE: StorageInfo = {
  db: '',
  features: {
    columnComments: false,
    configurableMenus: false,
    userPreferences: false,
    tracking: false,
    centralColumns: false,
  },
  allFeatures: false,
  rp: null as unknown as StorageInfo['rp'],
}

/** Relation parameters from the metadata layer (discovered once per session, X26). */
export async function storage(ctx: ShellCtx): Promise<StorageInfo> {
  if (ctx.meta === null) return NO_STORAGE
  return storageInfo(await ctx.meta.relationParameters())
}

/** Menu::getAllowedTabs, cached as `menu-levels-<level>` (session cache). */
async function allowed<K extends string>(
  ctx: ShellCtx,
  level: 'server' | 'db' | 'table',
  keys: K[],
): Promise<K[]> {
  const cacheKey = `menu-levels-${level}`
  let denied = ctx.cache[cacheKey] as string[] | undefined
  if (denied === undefined) {
    const info = await storage(ctx)
    denied = await deniedTabs(controlFor(ctx), info, ctx.username, level)
    ctx.cache[cacheKey] = denied
  }
  return keys.filter((k) => !denied.includes(k))
}

/** The control link (the user's credentials when no controluser is configured). */
function controlFor(ctx: ShellCtx) {
  return ctx.meta?.control ?? null
}

function info(ctx: ShellCtx) {
  const si = ctx.conn.serverInfo
  return { versionInt: si?.versionInt ?? 0, isMariaDb: si?.isMariaDb ?? false }
}

/** Breadcrumb server name: verbose or host, then `:port` (Menu::getBreadcrumbs). */
export function breadcrumbServerName(s: ServerConfig): string {
  let name = !phpEmpty(s.verbose) ? s.verbose : s.host
  if (!phpEmpty(s.port)) name += `:${s.port}`
  return name
}

/** pma: src/Menu.php::getServerTabs */
export async function serverScope(ctx: ShellCtx): Promise<ServerScope> {
  const { versionInt, isMariaDb } = info(ctx)
  const p = new PrivilegeProbe(ctx.conn, ctx.server, ctx.cache)
  const { superUser, grant, create } = await p.canManageUsers(versionInt, isMariaDb)
  const binlogs = await p.hasBinaryLogs()
  const keys: ServerTabKey[] = ['databases', 'sql', 'status']
  if (superUser || grant || create) keys.push('rights')
  keys.push('export', 'import', 'settings')
  if (binlogs) keys.push('binlog')
  if (superUser) keys.push('replication')
  keys.push('vars', 'charset', 'engine', 'plugins')
  const st = await storage(ctx)
  const tabs = await allowed(ctx, 'server', keys)
  const si = ctx.conn.serverInfo
  ctx.cache.server_version = si?.version ?? ''
  return {
    index: ctx.serverIndex,
    name: breadcrumbServerName(ctx.server),
    host: ctx.server.host,
    verbose: ctx.server.verbose,
    authType: ctx.server.auth_type as ServerScope['authType'],
    version: si?.version ?? '',
    versionInt,
    versionComment: si?.versionComment ?? '',
    isMariaDb,
    capabilities: {
      isSuperUser: superUser,
      isGrantUser: grant,
      isCreateUser: create,
      hasBinaryLogs: binlogs,
      trackerActive: st.features.tracking,
      centralColumns: st.features.centralColumns,
      columnComments: st.features.columnComments,
      configurableMenus: st.features.configurableMenus,
      currentUser: await p.currentUserAndHost(),
    },
    tabs: tabs.map((key) => ({ key })),
    appVersion: APP_VERSION,
  }
}

/** DatabaseInterface::getTables — `SHOW TABLES FROM `db`;`, an error gives no tables. */
async function getTables(conn: Conn, db: string): Promise<string[] | null> {
  try {
    const r = await conn.query(`SHOW TABLES FROM ${backquote(db)};`, 'scope.tables')
    return (r.resultSets[0]?.rows ?? []).map((row) => row[0]?.toString('utf8') ?? '')
  } catch {
    return null
  }
}

/** pma: src/Menu.php::getDbTabs (+ the database comment of getBreadcrumbs) */
export async function databaseScope(ctx: ShellCtx, db: string): Promise<DatabaseScope> {
  const { versionInt, isMariaDb } = info(ctx)
  const st = await storage(ctx)
  // breadcrumb first, as Menu::getDisplay does
  const comment = st.features.columnComments ? await getDbComment(controlFor(ctx), st.rp, db) : ''
  const system = isSystemSchema(db)
  const tables = await getTables(ctx.conn, db)
  if (tables === null && !(await databaseExists(ctx.conn, db))) {
    throw new NotFoundError(ctx.tr.gettext('No database selected.'))
  }
  const numTables = tables?.length ?? 0
  const p = new PrivilegeProbe(ctx.conn, ctx.server, ctx.cache)
  const { superUser, grant, create } = await p.canManageUsers(versionInt, isMariaDb)
  const empty = ctx.tr.gettext('Database seems to be empty!')
  const tabs: DatabaseScope['tabs'] = [{ key: 'structure' }, { key: 'sql' }]
  for (const key of ['search', 'query', 'export'] as const)
    tabs.push(numTables === 0 ? { key, warning: empty } : { key })
  if (!system) {
    tabs.push({ key: 'import' }, { key: 'operation' })
    if (superUser || grant || create) tabs.push({ key: 'privileges' })
    tabs.push({ key: 'routines' })
    if (await p.hasPrivilege('EVENT', db)) tabs.push({ key: 'events' })
    if (await p.hasPrivilege('TRIGGER', db)) tabs.push({ key: 'triggers' })
  }
  if (st.features.tracking && !system) tabs.push({ key: 'tracking' })
  if (!system) tabs.push({ key: 'designer' })
  if (!system && st.features.centralColumns) tabs.push({ key: 'central_columns' })
  const keep = await allowed<DbTabKey>(
    ctx,
    'db',
    tabs.map((t) => t.key),
  )
  return { db, comment, isSystemSchema: system, numTables, tabs: tabs.filter((t) => keep.includes(t.key)) }
}

/** The shell needs an existence check only when SHOW TABLES failed (no privilege vs. missing database). */
async function databaseExists(conn: Conn, db: string): Promise<boolean> {
  try {
    const v = await conn.value(
      `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${quoteString(db)}`,
      'scope.dbExists',
    )
    return v !== null
  } catch {
    return false
  }
}

/**
 * Table::isView / getComment from the TABLE_TYPE and TABLE_COMMENT phpMyAdmin has cached from
 * getTablesFull (one narrow information_schema read here, `SHOW TABLE STATUS` with DisableIS).
 */
async function tableStatus(
  ctx: ShellCtx,
  db: string,
  table: string,
): Promise<{ type: string; comment: string } | null> {
  if (ctx.server.DisableIS) {
    try {
      const rows = await ctx.conn.rows(
        `SHOW TABLE STATUS FROM ${backquote(db)} WHERE \`Name\` = ${quoteString(table)}`,
        'scope.tableStatus',
      )
      const r = rows[0]
      if (r === undefined) return null
      const isView = r.Engine === null && (r.Comment ?? '').toUpperCase() === 'VIEW'
      return { type: isView ? 'VIEW' : 'BASE TABLE', comment: r.Comment ?? '' }
    } catch {
      return null
    }
  }
  try {
    const rows = await ctx.conn.rows(
      `SELECT TABLE_TYPE, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quoteString(db)} AND TABLE_NAME = ${quoteString(table)}`,
      'scope.tableStatus',
    )
    const r = rows[0]
    return r === undefined ? null : { type: r.TABLE_TYPE ?? '', comment: r.TABLE_COMMENT ?? '' }
  } catch {
    return null
  }
}

/** pma: src/Menu.php::getTableTabs (+ the table part of getBreadcrumbs) */
export async function tableScope(ctx: ShellCtx, db: string, table: string): Promise<TableScope> {
  const { versionInt, isMariaDb } = info(ctx)
  const status = await tableStatus(ctx, db, table)
  if (status === null) throw new NotFoundError(ctx.tr.gettext('No tables selected.'))
  // information_schema tables are 'SYSTEM VIEW's
  const isView = status.type === 'VIEW' || status.type === 'SYSTEM VIEW'
  let comment = isView ? '' : status.comment
  if (comment.includes('; InnoDB free')) comment = comment.replace(/; InnoDB free:.*?$/, '')
  const system = isSystemSchema(db)
  let updatable = false
  if (isView) {
    // Table::isUpdatableView
    try {
      const v = await ctx.conn.value(
        `SELECT 1 FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ${quoteString(db)} AND TABLE_NAME = ${quoteString(table)} AND IS_UPDATABLE = 'YES'`,
        'scope.updatableView',
      )
      updatable = v !== null && v !== '0' && v !== ''
    } catch {
      updatable = false
    }
  }
  const p = new PrivilegeProbe(ctx.conn, ctx.server, ctx.cache)
  const { superUser, grant, create } = await p.canManageUsers(versionInt, isMariaDb)
  const st = await storage(ctx)
  const keys: TableTabKey[] = ['browse', 'structure', 'sql', 'search']
  if (!system && (!isView || updatable)) keys.push('insert')
  keys.push('export')
  if (!isView && !system) keys.push('import')
  if ((superUser || grant || create) && !system) keys.push('privileges')
  if (!system) keys.push('operation')
  if (st.features.tracking && !system) keys.push('tracking')
  // `! $isSystemSchema && currentUserHasPrivilege(...) && ! $tableIsView`: the probe runs for views too
  if (!system && (await p.hasPrivilege('TRIGGER', db, table)) && !isView) keys.push('triggers')
  const tabs = await allowed(ctx, 'table', keys)
  return {
    db,
    table,
    isView,
    isUpdatableView: updatable,
    comment,
    isSystemSchema: system,
    tabs: tabs.map((key) => ({ key })),
  }
}
