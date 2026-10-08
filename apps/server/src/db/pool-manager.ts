import type { Executed } from '@bettermyadmin/contracts'
import { quoteString } from '@bettermyadmin/sql-gen'
import { createServerContext } from '@bettermyadmin/sql-lexer'
import mysql, { type Pool, type PoolConnection, type PoolOptions } from 'mysql2/promise'
import { type AppConfig, type ServerConfig, getServer } from '../config.ts'
import { Conn, type ServerInfo } from './connection.ts'

export interface Credentials {
  user: string
  password: string
  /** Overrides for an arbitrary server login. */
  host?: string
  port?: number
  /** DefaultConnectionCollation for this login (home page selector); overrides the configured one. */
  collation?: string
}

/** Map Servers[i] to mysql2 options. pma: src/Config.php::getConnectionParams, src/Dbal/DbiMysqli.php::connect */
export function connectionOptions(server: ServerConfig, creds: Credentials): PoolOptions {
  const opts: PoolOptions = {
    user: creds.user,
    password: creds.password,
    charset: 'UTF8MB4_UNICODE_CI',
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    multipleStatements: false,
    // mysqli does not request CLIENT_FOUND_ROWS: UPDATE reports changed rows, not matched rows
    flags: ['-FOUND_ROWS'],
    compress: server.compress,
    connectTimeout: 10000,
  }
  const host = creds.host ?? server.host
  if (server.socket !== '' && (host === '' || host === 'localhost')) {
    opts.socketPath = server.socket
  } else {
    opts.host = host === '' ? 'localhost' : host
    const port = creds.port ?? (server.port === '' ? 3306 : Number(server.port))
    opts.port = Number.isFinite(port) && port > 0 ? port : 3306
  }
  if (server.ssl) {
    const ssl: NonNullable<Exclude<PoolOptions['ssl'], string>> = { rejectUnauthorized: server.ssl_verify }
    if (server.ssl_key) ssl.key = server.ssl_key
    if (server.ssl_cert) ssl.cert = server.ssl_cert
    if (server.ssl_ca) ssl.ca = server.ssl_ca
    if (server.ssl_ciphers) ssl.ciphers = server.ssl_ciphers
    opts.ssl = ssl
  }
  return opts
}

/** "8.4.2-log" → 80402 (DatabaseInterface::setVersion) */
export function versionInt(version: string): number {
  const [maj = 0, min = 0, pat = 0] = version.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0)
  return maj * 10000 + min * 100 + pat
}

/**
 * Connection set-up, in phpMyAdmin's order: postConnect (version probe, SET NAMES with the default
 * collation, lc_messages, time zone) then setCollation with the configured connection collation.
 * pma: src/Dbal/DatabaseInterface.php::postConnect, ::setCollation,
 *      src/Config/UserPreferencesHandler.php::setConnectionCollation
 */
export async function postConnect(
  conn: Conn,
  server: ServerConfig,
  collation: string,
  mysqlLocale = 'en_US',
): Promise<ServerInfo> {
  const row = (await conn.rows('SELECT @@version, @@version_comment, @@sql_mode', 'connect.version'))[0]
  const version = row?.['@@version'] ?? ''
  const versionComment = row?.['@@version_comment'] ?? ''
  const sqlMode = row?.['@@sql_mode'] ?? ''
  const v = versionInt(version)
  const isMariaDb = version.toLowerCase().includes('mariadb')
  const charset = v > 50503 ? 'utf8mb4' : 'utf8'
  await conn.query(
    `SET NAMES '${charset}' COLLATE '${v > 50503 ? 'utf8mb4_general_ci' : 'utf8_general_ci'}';`,
    'connect.names',
  )
  if (mysqlLocale !== '')
    await conn.query(`SET lc_messages = '${mysqlLocale}';`, 'connect.locale').catch(() => {})
  if (server.SessionTimeZone !== '') {
    await conn
      .query(`SET \`time_zone\` = ${quoteString(server.SessionTimeZone)}`, 'connect.tz')
      .catch(() => {})
  }
  // UserPreferencesHandler::setConnectionCollation: nothing to do for '' or the SET NAMES collation
  const defaultCollation = v > 50503 ? 'utf8mb4_general_ci' : 'utf8_general_ci'
  if (collation !== '' && collation !== defaultCollation) {
    // automatically adjust collation if not supported by server
    const coll =
      charset === 'utf8' && collation.startsWith('utf8mb4_') ? `utf8_${collation.slice(8)}` : collation
    await conn.query(`SET collation_connection = ${quoteString(coll)};`, 'connect.collation').catch(() => {})
  }
  return {
    version,
    versionInt: v,
    versionComment,
    isMariaDb,
    isPercona: versionComment.toLowerCase().includes('percona'),
    sqlMode,
    context: createServerContext(v, isMariaDb, sqlMode),
  }
}

interface PoolEntry {
  pool: Pool
  lastUsed: number
  initialised: WeakSet<object>
  serverInfo: ServerInfo | null
  serverIndex: number
  collation: string
}

/** One mysql2 pool per (session, server). */
export class PoolManager {
  readonly #pools = new Map<string, PoolEntry>()
  readonly #cfg: AppConfig

  constructor(cfg: AppConfig) {
    this.#cfg = cfg
  }

  server(index: number): ServerConfig {
    const s = getServer(this.#cfg, index)
    if (s === undefined) throw new Error(`Unknown server ${index}`)
    return s
  }

  /** Opens a single throw-away connection, used to verify credentials at login. */
  async probe(serverIndex: number, creds: Credentials): Promise<{ version: string; versionComment: string }> {
    const server = this.server(serverIndex)
    const conn = await mysql.createConnection(connectionOptions(server, creds))
    try {
      const [rows] = await conn.query({ sql: 'SELECT @@version, @@version_comment', rowsAsArray: true })
      const row = (rows as string[][])[0] ?? []
      return { version: String(row[0] ?? ''), versionComment: String(row[1] ?? '') }
    } finally {
      await conn.end().catch(() => {})
    }
  }

  async acquire(
    sessionId: string,
    serverIndex: number,
    creds: Credentials,
    log: Executed[],
    collation = creds.collation ?? this.#cfg.DefaultConnectionCollation,
  ): Promise<Conn> {
    const key = `${sessionId}\u0000${serverIndex}`
    let entry = this.#pools.get(key)
    if (entry !== undefined && entry.collation !== collation) {
      await this.#endEntry(key, entry)
      entry = undefined
    }
    if (entry === undefined) {
      const server = this.server(serverIndex)
      entry = {
        pool: mysql.createPool({
          ...connectionOptions(server, creds),
          connectionLimit: server.max_connections ?? 4,
          maxIdle: 1,
          idleTimeout: 60_000,
        }),
        lastUsed: Date.now(),
        initialised: new WeakSet(),
        serverInfo: null,
        serverIndex,
        collation,
      }
      this.#pools.set(key, entry)
    }
    entry.lastUsed = Date.now()
    const raw: PoolConnection = await entry.pool.getConnection()
    const conn = new Conn(raw, log)
    const marker = raw.connection as unknown as object
    if (!entry.initialised.has(marker)) {
      entry.serverInfo = await postConnect(conn, this.server(serverIndex), collation)
      entry.initialised.add(marker)
    }
    conn.serverInfo = entry.serverInfo
    return conn
  }

  /** KILL QUERY on a separate connection of the same pool (Cancel button). */
  async killQuery(
    sessionId: string,
    serverIndex: number,
    threadId: number,
    creds: Credentials,
  ): Promise<void> {
    const conn = await mysql.createConnection(connectionOptions(this.server(serverIndex), creds))
    try {
      await conn.query(`KILL QUERY ${Math.trunc(threadId)}`)
    } finally {
      await conn.end().catch(() => {})
    }
  }

  async dropSession(sessionId: string, serverIndex?: number): Promise<void> {
    for (const [key, entry] of this.#pools) {
      if (!key.startsWith(`${sessionId}\u0000`)) continue
      if (serverIndex !== undefined && entry.serverIndex !== serverIndex) continue
      await this.#endEntry(key, entry)
    }
  }

  /** Evicts pools idle for longer than LoginCookieValidity. */
  async evictIdle(now = Date.now()): Promise<void> {
    const max = this.#cfg.LoginCookieValidity * 1000
    for (const [key, entry] of this.#pools) {
      if (now - entry.lastUsed > max) await this.#endEntry(key, entry)
    }
  }

  async closeAll(): Promise<void> {
    for (const [key, entry] of this.#pools) await this.#endEntry(key, entry)
  }

  async #endEntry(key: string, entry: PoolEntry): Promise<void> {
    this.#pools.delete(key)
    await entry.pool.end().catch(() => {})
  }
}
