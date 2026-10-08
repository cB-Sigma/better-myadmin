import type { Executed } from '@bettermyadmin/contracts'
import mysql, { type Pool } from 'mysql2/promise'
import type { AppConfig, ServerConfig } from '../config.ts'
import { getServer } from '../config.ts'
import { Conn } from '../db/connection.ts'
import { connectionOptions } from '../db/pool-manager.ts'

/**
 * Connection parameters of the control user (controlhost/controlport/controluser/controlpass,
 * sharing the user connection's port/socket/SSL settings when the host is the same, then the
 * `control_*` overrides).
 * pma: src/Config.php::getConnectionParams (ConnectionType::ControlUser)
 */
export function controlServer(s: ServerConfig): ServerConfig {
  const host = s.controlhost !== '' ? s.controlhost : s.host
  const same = host === s.host
  const c: ServerConfig = {
    ...s,
    host,
    port: same ? s.port : '',
    socket: same ? s.socket : '',
    compress: same ? s.compress : false,
    ssl: same ? s.ssl : false,
    ssl_key: same ? s.ssl_key : null,
    ssl_cert: same ? s.ssl_cert : null,
    ssl_ca: same ? s.ssl_ca : null,
    ssl_ca_path: same ? s.ssl_ca_path : null,
    ssl_ciphers: same ? s.ssl_ciphers : null,
    ssl_verify: same ? s.ssl_verify : true,
  }
  if (s.controlport !== '') c.port = s.controlport
  if (s.control_socket !== null) c.socket = s.control_socket
  if (s.control_compress !== null) c.compress = s.control_compress
  if (s.control_ssl !== null) c.ssl = s.control_ssl
  if (s.control_ssl_key !== null) c.ssl_key = s.control_ssl_key
  if (s.control_ssl_cert !== null) c.ssl_cert = s.control_ssl_cert
  if (s.control_ssl_ca !== null) c.ssl_ca = s.control_ssl_ca
  if (s.control_ssl_ca_path !== null) c.ssl_ca_path = s.control_ssl_ca_path
  if (s.control_ssl_ciphers !== null) c.ssl_ciphers = s.control_ssl_ciphers
  if (s.control_ssl_verify !== null) c.ssl_verify = s.control_ssl_verify
  return c
}

/**
 * Pools for the control user, one per configured server (the credentials come from the
 * configuration, so the pool is shared by every session). Without a controluser, phpMyAdmin uses
 * the user's own connection as control connection; callers then pass that connection instead.
 * This module is the seam the pmadb layer (packages/metadata) takes over later.
 */
export class ControlConnections {
  readonly #cfg: AppConfig
  readonly #pools = new Map<number, Pool>()

  constructor(cfg: AppConfig) {
    this.#cfg = cfg
  }

  /** `null` when the server has no control user configured. */
  async acquire(serverIndex: number, log: Executed[]): Promise<Conn | null> {
    const s = getServer(this.#cfg, serverIndex)
    if (s === undefined || s.controluser === '') return null
    let pool = this.#pools.get(serverIndex)
    if (pool === undefined) {
      pool = mysql.createPool({
        ...connectionOptions(controlServer(s), { user: s.controluser, password: s.controlpass }),
        connectionLimit: 2,
        maxIdle: 1,
        idleTimeout: 60_000,
      })
      this.#pools.set(serverIndex, pool)
    }
    try {
      return new Conn(await pool.getConnection(), log)
    } catch {
      // a broken control user disables the configuration storage, it never blocks the page
      return null
    }
  }

  async closeAll(): Promise<void> {
    for (const p of this.#pools.values()) await p.end().catch(() => {})
    this.#pools.clear()
  }
}
