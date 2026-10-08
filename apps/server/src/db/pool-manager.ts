import type { Executed } from '@bettermyadmin/contracts'
import mysql, { type Pool, type PoolConnection, type PoolOptions } from 'mysql2/promise'
import { quoteString } from '@bettermyadmin/sql-gen'
import { type AppConfig, type ServerConfig, getServer } from '../config.ts'
import { Conn } from './connection.ts'

export interface Credentials {
  user: string
  password: string
  /** Overrides for an arbitrary server login. */
  host?: string
  port?: number
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

/**
 * Statements run on every new connection.
 * pma: src/Dbal/DatabaseInterface.php::postConnect
 */
export function postConnectStatements(server: ServerConfig, collation: string): string[] {
  const charset = collation.split('_')[0] ?? 'utf8mb4'
  const stmts = [`SET NAMES '${charset}' COLLATE '${collation}';`]
  if (server.SessionTimeZone !== '') stmts.push(`SET \`time_zone\` = ${quoteString(server.SessionTimeZone)}`)
  return stmts
}

interface PoolEntry {
  pool: Pool
  lastUsed: number
  initialised: WeakSet<object>
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
    collation = this.#cfg.DefaultConnectionCollation,
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
      for (const sql of postConnectStatements(this.server(serverIndex), collation)) {
        await conn.query(sql, 'connect.post')
      }
      entry.initialised.add(marker)
    }
    return conn
  }

  /** KILL QUERY on a separate connection of the same pool (Cancel button). */
  async killQuery(sessionId: string, serverIndex: number, threadId: number, creds: Credentials): Promise<void> {
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
