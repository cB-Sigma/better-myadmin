import type { Translator } from '@bettermyadmin/i18n'
import { KB_MARIADB, KB_MYSQL, getDocLinkByName } from '@bettermyadmin/kbs'
import type { Context } from 'hono'
import { type AppConfig, type ServerConfig, getServer } from '../config.ts'
import type { Conn } from '../db/connection.ts'
import { ValidationError } from '../http/errors.ts'
import { NavDbi } from '../navigation/dbi.ts'
import type { ServerEnv } from '../routes/server.ts'

/**
 * What a server-level page needs: the configuration, the session's connection, the "try" flavoured
 * DatabaseInterface subset, the per-server session cache (SessionCache) and the request translator.
 */
export interface AdminCtx {
  cfg: AppConfig
  server: ServerConfig
  serverIndex: number
  conn: Conn
  dbi: NavDbi
  tr: Translator
  /** PHP's date.timezone for localisedDate (the server process time zone) */
  timeZone: string
  versionInt: number
  isMariaDb: boolean
}

/** Runs `fn` with a pooled connection of the session for the request's server. */
export async function withAdmin<T>(c: Context<ServerEnv>, fn: (ctx: AdminCtx) => Promise<T>): Promise<T> {
  const { cfg, pools } = c.get('deps')
  const session = c.get('session')
  const serverIndex = c.get('serverIndex')
  const server = getServer(cfg, serverIndex)
  const login = session.servers[String(serverIndex)]
  if (server === undefined || login === undefined) throw new ValidationError('Invalid server index!')
  login.cache ??= {}
  const conn = await pools.acquire(
    session.id,
    serverIndex,
    c.get('creds'),
    c.get('executed'),
    undefined,
    c.get('language').mysqlLocale,
  )
  try {
    return await fn({
      cfg,
      server,
      serverIndex,
      conn,
      dbi: new NavDbi(conn, login.cache),
      tr: c.get('tr'),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      versionInt: conn.serverInfo?.versionInt ?? 0,
      isMariaDb: conn.serverInfo?.isMariaDb ?? false,
    })
  } finally {
    conn.raw.release()
  }
}

/** pma: DatabaseInterface::isSuperUser (SessionCache `is_superuser`) */
export async function isSuperUser(dbi: NavDbi): Promise<boolean> {
  const cached = dbi.cache.is_superuser
  if (typeof cached === 'boolean') return cached
  const v = await dbi.fetchValue('SELECT 1 FROM mysql.user LIMIT 1')
  const is = v !== false && v !== null && v !== '' && v !== '0'
  dbi.cache.is_superuser = is
  return is
}

/** pma: Util::getMySQLDocuURL (without Core::linkURL: the SPA links the documentation directly) */
export function mysqlDocuUrl(link0: string, anchor: string, versionInt: number): string {
  let link = link0.toLowerCase().replaceAll('_', '-')
  if (link === '') link = 'index'
  const mysql = versionInt >= 90000 ? '9.0' : versionInt >= 80000 ? '8.0' : '5.7'
  const section = link === 'server-error-reference' ? 'mysql-errors' : 'refman'
  return `https://dev.mysql.com/doc/${section}/${mysql}/en/${link}.html${anchor !== '' ? `#${anchor}` : ''}`
}

/**
 * pma: Generator::linkToVarDocumentation — the knowledge base link of a variable (MySQL or MariaDB
 * documentation), else MySQLDocumentation::show's fallback getMySQLDocuURL($name).
 */
export function varDocUrl(name: string, ctx: Pick<AdminCtx, 'isMariaDb' | 'versionInt'>): string {
  return (
    getDocLinkByName(name, ctx.isMariaDb ? KB_MARIADB : KB_MYSQL) ?? mysqlDocuUrl(name, '', ctx.versionInt)
  )
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

/** fetchResult($sql, 0, 1) — a key/value pair list (fetchAllKeyPair) as an ordered record. */
export async function keyPairs(dbi: NavDbi, sql: string): Promise<Record<string, string> | null> {
  const r = await dbi.tryQuery(sql, 'server.keyPairs')
  if (r === null) return null
  const out: Record<string, string> = {}
  for (const row of r.rows) out[row[0] ?? ''] = row[1] ?? ''
  return out
}
