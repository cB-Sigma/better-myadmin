import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Executed } from '@bettermyadmin/contracts'
import { quoteString } from '@bettermyadmin/sql-gen'
import { createServerContext } from '@bettermyadmin/sql-lexer'
import mysql, { type Pool, type PoolConnection, type PoolOptions } from 'mysql2/promise'
import { type AppConfig, type ServerConfig, getServer } from '../config.ts'
import { type BudgetedPool, ConnectionBudget } from './budget.ts'
import { Conn, type ServerInfo } from './connection.ts'
import { ControlConnections } from './control.ts'
import { type SharedLink, requestScope } from './request-scope.ts'

export interface Credentials {
  user: string
  password: string
  /** Overrides for an arbitrary server login. */
  host?: string
  port?: number
  /** DefaultConnectionCollation for this login (home page selector); overrides the configured one. */
  collation?: string
  /** Server settings merged over Servers[i] for this login (signon `PMA_single_signon_cfgupdate`). */
  overrides?: Record<string, unknown>
}

/** Map Servers[i] to mysql2 options. pma: src/Config.php::getConnectionParams, src/Dbal/DbiMysqli.php::connect */
export function connectionOptions(configured: ServerConfig, creds: Credentials): PoolOptions {
  const server = creds.overrides === undefined ? configured : { ...configured, ...creds.overrides }
  const opts: PoolOptions = {
    user: creds.user,
    password: creds.password,
    charset: 'UTF8MB4_UNICODE_CI',
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    multipleStatements: false,
    // mysqli does not request CLIENT_FOUND_ROWS (UPDATE reports changed rows, not matched rows) nor
    // CLIENT_IGNORE_SPACE (which adds IGNORE_SPACE to the session sql_mode)
    flags: ['-FOUND_ROWS', '-IGNORE_SPACE'],
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
    // mysqli::ssl_set(key, cert, ca, capath, cipher) takes file paths
    if (server.ssl_key) ssl.key = pemOf(server.ssl_key)
    if (server.ssl_cert) ssl.cert = pemOf(server.ssl_cert)
    const ca = [
      ...(server.ssl_ca ? [pemOf(server.ssl_ca)] : []),
      ...(server.ssl_ca_path ? caDirectory(server.ssl_ca_path) : []),
    ]
    if (ca.length > 0) ssl.ca = ca
    if (server.ssl_ciphers) ssl.ciphers = server.ssl_ciphers
    opts.ssl = ssl
  }
  return opts
}

/** A PEM given as a file path (phpMyAdmin's ssl_* directives) is read; anything else is the PEM itself. */
export function pemOf(value: string): string {
  if (value.includes('-----BEGIN')) return value
  try {
    return readFileSync(value, 'utf8')
  } catch {
    return value
  }
}

/** `ssl_ca_path` (mysqli's capath): every certificate file of the directory. */
export function caDirectory(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => /\.(pem|crt|cer)$/i.test(f))
      .sort()
      .map((f) => readFileSync(join(dir, f), 'utf8'))
  } catch {
    return []
  }
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
  const userErrors: ServerInfo['userErrors'] = []
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
      .catch(() => userErrors.push('timezone'))
  }
  // UserPreferencesHandler::setConnectionCollation: nothing to do for '' or the SET NAMES collation
  const defaultCollation = v > 50503 ? 'utf8mb4_general_ci' : 'utf8_general_ci'
  if (collation !== '' && collation !== defaultCollation) {
    // automatically adjust collation if not supported by server
    const coll =
      charset === 'utf8' && collation.startsWith('utf8mb4_') ? `utf8_${collation.slice(8)}` : collation
    await conn
      .query(`SET collation_connection = ${quoteString(coll)};`, 'connect.collation')
      .catch(() => userErrors.push('collation'))
  }
  return {
    version,
    versionInt: v,
    versionComment,
    isMariaDb,
    isPercona: versionComment.toLowerCase().includes('percona'),
    sqlMode,
    context: createServerContext(v, isMariaDb, sqlMode),
    userErrors,
  }
}

/** mysql2's connectionLimit when the budget enforces the limit */
export const UNLIMITED = 1000

interface PoolEntry extends BudgetedPool {
  initialised: WeakSet<object>
  /** lc_messages each physical connection was last set to. */
  locales: WeakMap<object, string>
  serverInfo: ServerInfo | null
  serverIndex: number
  collation: string
}

/**
 * mysql2 options that keep no free connection for longer than `idleSeconds` (0: close each one
 * within a second). mysql2 checks every second and closes the free connections beyond `maxIdle`
 * at once and any free connection idle for longer than `idleTimeout`; it only checks while
 * `maxIdle < connectionLimit`.
 */
export function idleOptions(
  idleSeconds: number,
  connectionLimit: number,
): Pick<PoolOptions, 'maxIdle' | 'idleTimeout'> {
  if (idleSeconds <= 0) return { maxIdle: 0, idleTimeout: 1000 }
  return { maxIdle: Math.max(connectionLimit - 1, 0), idleTimeout: idleSeconds * 1000 }
}

/**
 * One mysql2 pool per (session, server), its idle connections closed after
 * `ConnectionPool.idleTimeout`, the pool itself dropped once idle (and on logout, inactivity logout
 * and the session sweep), every connection counted against `ConnectionPool.maxTotal` (X24).
 */
export class PoolManager {
  readonly #pools = new Map<string, PoolEntry>()
  readonly #cfg: AppConfig
  readonly budget: ConnectionBudget
  /** The configuration-storage (control user) links. */
  readonly control: ControlConnections
  readonly #sweep: ReturnType<typeof setInterval>

  constructor(cfg: AppConfig) {
    this.#cfg = cfg
    const p = cfg.ConnectionPool
    this.budget = new ConnectionBudget(p.maxTotal, p.waitTimeout, (entry) => this.#endPool(entry))
    this.control = new ControlConnections(cfg, this.budget)
    // pools without a request for idleTimeout are dropped (their timers and objects with them)
    this.#sweep = setInterval(() => void this.evictIdle(), Math.max(p.idleTimeout, 1) * 1000)
    this.#sweep.unref()
  }

  /** the configuration the pools were made for */
  get config(): AppConfig {
    return this.#cfg
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

  /**
   * The request's user link: a second acquire in the same request (withDb, then MetaRequest, the
   * tracker) gets the connection it already holds, like phpMyAdmin's one link per request. Every
   * holder calls `conn.raw.release()`; the connection goes back (or is closed) after the last.
   */
  async acquire(
    sessionId: string,
    serverIndex: number,
    creds: Credentials,
    log: Executed[],
    collation = creds.collation ?? this.#cfg.DefaultConnectionCollation,
    /** The request language's MySQL locale (Language::getMySQLLocale), '' sends nothing. */
    mysqlLocale = 'en_US',
  ): Promise<Conn> {
    const scope = requestScope()
    if (scope === undefined) return this.#open(sessionId, serverIndex, creds, log, collation, mysqlLocale)
    const linkKey = `user\u0000${sessionId}\u0000${serverIndex}\u0000${collation}\u0000${mysqlLocale}`
    const shared = scope.links.get(linkKey) as SharedLink<Promise<Conn>> | undefined
    if (shared !== undefined) {
      shared.refs++
      return shared.conn
    }
    const holdsAny = scope.held > 0
    const link: SharedLink<Promise<Conn>> = { conn: Promise.resolve(null as unknown as Conn), refs: 1 }
    link.conn = this.#open(sessionId, serverIndex, creds, log, collation, mysqlLocale, holdsAny).then(
      (conn) => {
        scope.held++
        const realRelease = conn.raw.release.bind(conn.raw)
        const finish = () => {
          if (--link.refs > 0) return
          scope.links.delete(linkKey)
          scope.held--
          realRelease()
        }
        conn.raw.release = finish
        // a holder's discard (rollback, changed foreign key checks): closed after the last holder
        conn.raw.destroy = () => {
          conn.dirty = true
          finish()
        }
        return conn
      },
      (e: unknown) => {
        scope.links.delete(linkKey)
        throw e
      },
    )
    scope.links.set(linkKey, link as SharedLink<unknown>)
    return link.conn
  }

  async #open(
    sessionId: string,
    serverIndex: number,
    creds: Credentials,
    log: Executed[],
    collation = creds.collation ?? this.#cfg.DefaultConnectionCollation,
    /** The request language's MySQL locale (Language::getMySQLLocale), '' sends nothing. */
    mysqlLocale = 'en_US',
    holdsAny = false,
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
          // the per-session limit is the budget's (it lets a request that holds a connection
          // through); mysql2's own limit would make such a request wait
          connectionLimit: UNLIMITED,
          ...idleOptions(this.#cfg.ConnectionPool.idleTimeout, server.max_connections ?? 4),
        }),
        lastUsed: Date.now(),
        open: 0,
        busy: new Set(),
        ended: false,
        pending: 0,
        initialised: new WeakSet(),
        locales: new WeakMap(),
        serverInfo: null,
        serverIndex,
        collation,
      }
      this.#pools.set(key, entry)
      this.budget.track(entry)
    }
    entry.lastUsed = Date.now()
    const pool = entry.pool
    const limit = this.server(serverIndex).max_connections ?? 4
    const raw: PoolConnection = await this.budget.getConnection(entry, () => pool.getConnection(), {
      limit,
      mayWait: !holdsAny,
    })
    const conn = new Conn(raw, log)
    // a connection whose session state may differ from a fresh one's is closed, not reused
    const release = raw.release.bind(raw)
    const destroy = raw.destroy.bind(raw)
    raw.release = () => (conn.dirty ? destroy() : release())
    raw.destroy = () => destroy()
    const marker = raw.connection as unknown as object
    if (!entry.initialised.has(marker)) {
      entry.serverInfo = await postConnect(conn, this.server(serverIndex), collation, mysqlLocale)
      entry.initialised.add(marker)
      entry.locales.set(marker, mysqlLocale)
    } else if ((entry.locales.get(marker) ?? '') !== mysqlLocale) {
      // phpMyAdmin connects per request, so lc_messages always follows the current language;
      // a pooled connection is switched when the language changed since it was set up
      const sql = mysqlLocale !== '' ? `SET lc_messages = '${mysqlLocale}';` : 'SET lc_messages = DEFAULT;'
      await conn.query(sql, 'connect.locale').catch(() => {})
      entry.locales.set(marker, mysqlLocale)
    }
    conn.serverInfo = entry.serverInfo
    // phpMyAdmin connects (and fails to set them) on every request
    for (const kind of entry.serverInfo?.userErrors ?? []) {
      const server = this.server(serverIndex)
      requestScope()?.userErrors.push(
        kind === 'timezone'
          ? { kind, timeZone: server.SessionTimeZone, server: serverIndex }
          : { kind, server: serverIndex },
      )
    }
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
    await this.control.dropSession(sessionId, serverIndex)
  }

  /** Drops the pools of sessions that are gone (the session sweep). */
  async dropSessionsExcept(alive: (sessionId: string) => boolean): Promise<void> {
    const gone = new Set<string>()
    for (const key of this.#pools.keys()) {
      const id = key.slice(0, key.indexOf('\u0000'))
      if (!alive(id)) gone.add(id)
    }
    for (const id of this.control.sessionIds()) if (!alive(id)) gone.add(id)
    for (const id of gone) await this.dropSession(id)
  }

  /** Drops pools with no request for `ConnectionPool.idleTimeout` and nothing checked out. */
  async evictIdle(now = Date.now()): Promise<void> {
    const max = this.#cfg.ConnectionPool.idleTimeout * 1000
    for (const [key, entry] of this.#pools) {
      if (entry.busy.size === 0 && now - entry.lastUsed > max) await this.#endEntry(key, entry)
    }
    await this.control.evictIdle(now, max)
  }

  async closeAll(): Promise<void> {
    clearInterval(this.#sweep)
    for (const [key, entry] of this.#pools) await this.#endEntry(key, entry)
    await this.control.closeAll()
  }

  /** The budget's reclaim: the pool, whichever map holds it. */
  async #endPool(entry: BudgetedPool): Promise<void> {
    for (const [key, e] of this.#pools) if (e === entry) return this.#endEntry(key, e)
    await this.control.endPool(entry)
  }

  async #endEntry(key: string, entry: PoolEntry): Promise<void> {
    this.#pools.delete(key)
    this.budget.untrack(entry)
    await entry.pool.end().catch(() => {})
  }
}
