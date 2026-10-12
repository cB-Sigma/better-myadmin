import type { Executed } from '@bettermyadmin/contracts'
import type { MetaConn, QueryOutcome } from '@bettermyadmin/metadata'
import mysql, { type FieldPacket, type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2/promise'
import { connectionErrorMessage } from '../auth/failure.ts'
import { type AppConfig, type ServerConfig, getServer } from '../config.ts'
import { isMysqlError } from '../http/errors.ts'
import { type Credentials, connectionOptions } from './pool-manager.ts'

/**
 * Connection parameters of the control link: control user/password, `controlhost` (else the
 * server host), the server's port/socket/SSL/compression only when the host is the same, then
 * `controlport` and every `control_*` override.
 *
 * pma: src/Config.php::getConnectionParams (ConnectionType::ControlUser)
 */
export function controlServer(server: ServerConfig): { server: ServerConfig; creds: Credentials } {
  const host = server.controlhost !== '' ? server.controlhost : server.host
  const same = host === server.host
  const out: ServerConfig = {
    ...server,
    host: host === '' ? 'localhost' : host,
    port: same ? server.port : '',
    socket: same ? server.socket : '',
    compress: same ? server.compress : false,
    ssl: same ? server.ssl : false,
    ssl_key: same ? server.ssl_key : null,
    ssl_cert: same ? server.ssl_cert : null,
    ssl_ca: same ? server.ssl_ca : null,
    ssl_ca_path: same ? server.ssl_ca_path : null,
    ssl_ciphers: same ? server.ssl_ciphers : null,
    ssl_verify: same ? server.ssl_verify : true,
    hide_connection_errors: same ? server.hide_connection_errors : false,
  }
  if (server.controlport !== '') out.port = server.controlport
  if (server.control_socket !== null) out.socket = server.control_socket
  if (server.control_compress !== null) out.compress = server.control_compress
  if (server.control_ssl !== null) out.ssl = server.control_ssl
  if (server.control_ssl_key !== null) out.ssl_key = server.control_ssl_key
  if (server.control_ssl_cert !== null) out.ssl_cert = server.control_ssl_cert
  if (server.control_ssl_ca !== null) out.ssl_ca = server.control_ssl_ca
  if (server.control_ssl_ca_path !== null) out.ssl_ca_path = server.control_ssl_ca_path
  if (server.control_ssl_ciphers !== null) out.ssl_ciphers = server.control_ssl_ciphers
  if (server.control_ssl_verify !== null) out.ssl_verify = server.control_ssl_verify
  if (server.control_hide_connection_errors !== null)
    out.hide_connection_errors = server.control_hide_connection_errors
  return { server: out, creds: { user: server.controluser, password: server.controlpass } }
}

/**
 * One control-link connection for the duration of a request. phpMyAdmin's control link runs no
 * postConnect (no SET NAMES): the charset is negotiated in the handshake.
 */
export class ControlConn implements MetaConn {
  readonly raw: PoolConnection
  readonly log: Executed[]
  lastError = ''
  lastErrno = 0

  constructor(raw: PoolConnection, log: Executed[]) {
    this.raw = raw
    this.log = log
  }

  async #exec(sql: string): Promise<QueryOutcome> {
    const start = performance.now()
    try {
      const [res, fields] = (await this.raw.query({ sql, rowsAsArray: true, typeCast: false })) as [
        unknown,
        unknown,
      ]
      this.lastError = ''
      this.lastErrno = 0
      return toOutcome(res, fields)
    } catch (e) {
      if (isMysqlError(e)) {
        this.lastError = e.sqlMessage ?? e.message
        this.lastErrno = e.errno ?? 0
      } else {
        this.lastError = e instanceof Error ? e.message : String(e)
        this.lastErrno = 0
      }
      throw e
    } finally {
      this.log.push({ sql, ms: performance.now() - start, label: 'pmadb' })
    }
  }

  async query(sql: string): Promise<QueryOutcome> {
    return this.#exec(sql)
  }

  async tryQuery(sql: string): Promise<QueryOutcome | false> {
    try {
      return await this.#exec(sql)
    } catch {
      return false
    }
  }

  /** COM_INIT_DB equivalent (the parity harness renders phpMyAdmin's Init DB as this statement). */
  async selectDb(db: string): Promise<boolean> {
    return (await this.tryQuery(`USE \`${db.replaceAll('`', '``')}\``)) !== false
  }

  async tryMultiQuery(sql: string): Promise<boolean> {
    return (await this.tryQuery(sql)) !== false
  }

  release(): void {
    this.raw.release()
  }
}

function toOutcome(res: unknown, fields: unknown): QueryOutcome {
  const isHeader = (x: unknown): x is ResultSetHeader =>
    typeof x === 'object' && x !== null && !Array.isArray(x) && 'affectedRows' in x
  if (isHeader(res)) return { fields: [], rows: [], affectedRows: res.affectedRows, insertId: res.insertId }
  // multi-statement: take the first result set
  let rows = res as unknown[]
  let fs = fields as Array<FieldPacket | FieldPacket[] | undefined> | undefined
  if (Array.isArray(fs) && Array.isArray(fs[0])) {
    const i = fs.findIndex((f) => Array.isArray(f))
    rows = (Array.isArray(rows[i]) ? rows[i] : []) as unknown[]
    fs = fs[i] as FieldPacket[]
  }
  const names = ((fs ?? []) as FieldPacket[]).map((f) => f.name)
  return {
    fields: names,
    affectedRows: 0,
    rows: (rows as Array<Array<Buffer | null>>).map((r) => {
      const o: Record<string, string | null> = {}
      names.forEach((n, i) => {
        const v = r[i]
        o[n] = v === null || v === undefined ? null : Buffer.isBuffer(v) ? v.toString('utf8') : String(v)
      })
      return o
    }),
  }
}

interface ControlPool {
  pool: Pool
  lastUsed: number
}

export interface AcquiredControl {
  conn: ControlConn
  /** True when the link uses `controluser`; false when it fell back to the user's credentials. */
  viaControlUser: boolean
  /** The control-user connection error, when it fell back. */
  error: string | null
}

/**
 * Control-link pools. With `controluser` configured the pool is shared by every session of that
 * server; when it is not configured, or the control user cannot connect, a second link with the
 * user's own credentials is used (phpMyAdmin opens a separate connection to avoid table locks of
 * the main link), keyed by session.
 *
 * pma: src/Http/Middleware/Authentication.php::connectToDatabaseServer
 */
export class ControlConnections {
  readonly #cfg: AppConfig
  readonly #shared = new Map<number, ControlPool>()
  readonly #perSession = new Map<string, ControlPool>()

  constructor(cfg: AppConfig) {
    this.#cfg = cfg
  }

  #pool(server: ServerConfig, creds: Credentials): ControlPool {
    return {
      pool: mysql.createPool({
        ...connectionOptions(server, creds),
        multipleStatements: true,
        connectionLimit: 2,
        maxIdle: 1,
        idleTimeout: 60_000,
      }),
      lastUsed: Date.now(),
    }
  }

  async acquire(
    sessionId: string,
    serverIndex: number,
    user: Credentials,
    log: Executed[],
  ): Promise<AcquiredControl> {
    const s = getServer(this.#cfg, serverIndex)
    if (s === undefined) throw new Error(`Unknown server ${serverIndex}`)
    let error: string | null = null
    if (s.controluser !== '') {
      const { server, creds } = controlServer(s)
      let entry = this.#shared.get(serverIndex)
      if (entry === undefined) {
        entry = this.#pool(server, creds)
        this.#shared.set(serverIndex, entry)
      }
      try {
        const raw = await entry.pool.getConnection()
        entry.lastUsed = Date.now()
        return { conn: new ControlConn(raw, log), viaControlUser: true, error: null }
      } catch (e) {
        // pma: src/Dbal/DbiMysqli.php::connect (1045 hidden by the control link's hide_connection_errors)
        error =
          isMysqlError(e) && e.errno === 1045 && server.hide_connection_errors
            ? connectionErrorMessage(e, true)
            : isMysqlError(e)
              ? (e.sqlMessage ?? e.message)
              : e instanceof Error
                ? e.message
                : String(e)
        this.#shared.delete(serverIndex)
        await entry.pool.end().catch(() => {})
      }
    }
    const key = `${sessionId}\u0000${serverIndex}\u0000${user.user}`
    let entry = this.#perSession.get(key)
    if (entry === undefined) {
      entry = this.#pool(s, user)
      this.#perSession.set(key, entry)
    }
    entry.lastUsed = Date.now()
    const raw = await entry.pool.getConnection()
    return { conn: new ControlConn(raw, log), viaControlUser: false, error }
  }

  async dropSession(sessionId: string, serverIndex?: number): Promise<void> {
    for (const [key, entry] of this.#perSession) {
      if (!key.startsWith(`${sessionId}\u0000`)) continue
      if (serverIndex !== undefined && !key.startsWith(`${sessionId}\u0000${serverIndex}\u0000`)) continue
      this.#perSession.delete(key)
      await entry.pool.end().catch(() => {})
    }
  }

  async closeAll(): Promise<void> {
    const all = [...this.#shared.values(), ...this.#perSession.values()]
    this.#shared.clear()
    this.#perSession.clear()
    await Promise.all(all.map((e) => e.pool.end().catch(() => {})))
  }
}
