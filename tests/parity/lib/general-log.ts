import mysql from 'mysql2/promise'
import { liveHolders, registerHolder, withRegistryLock } from './log-holders.ts'

/** Rotate (TRUNCATE) the log when it is larger than this and nobody holds a marker into it. */
export const ROTATE_AT = Number(process.env.BMA_GENERAL_LOG_ROTATE_AT ?? 100_000)
const INDEX = 'bma_event_time'

/**
 * Makes the log table cheap to read: MyISAM with an index on event_time (the default CSV engine
 * cannot be indexed, so every since()/settle() scanned the whole log), and truncates it when large.
 * Only called while no suite holds a marker (the log is switched off for the ALTER).
 */
async function prepare(conn: mysql.Connection): Promise<void> {
  const [t] = (await conn.query(
    "SELECT ENGINE AS engine, TABLE_ROWS AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'mysql' AND TABLE_NAME = 'general_log'",
  )) as unknown as [Array<{ engine: string; n: number | null }>]
  const [idx] = (await conn.query('SHOW INDEX FROM mysql.general_log WHERE Key_name = ?', [
    INDEX,
  ])) as unknown as [unknown[]]
  const engine = t[0]?.engine ?? ''
  if (engine.toUpperCase() !== 'MYISAM' || idx.length === 0) {
    const [[on]] = (await conn.query({
      sql: 'SELECT @@GLOBAL.general_log',
      rowsAsArray: true,
    })) as unknown as [[[number]]]
    await conn.query("SET GLOBAL general_log = 'OFF'")
    try {
      if (engine.toUpperCase() !== 'MYISAM') await conn.query('ALTER TABLE mysql.general_log ENGINE = MyISAM')
      if (idx.length === 0) await conn.query(`ALTER TABLE mysql.general_log ADD INDEX ${INDEX} (event_time)`)
    } finally {
      if (Number(on) !== 0) await conn.query("SET GLOBAL general_log = 'ON'")
    }
  }
  const [[count]] = (await conn.query({
    sql: 'SELECT COUNT(*) FROM mysql.general_log',
    rowsAsArray: true,
  })) as unknown as [[[number]]]
  if (Number(count) > ROTATE_AT) await conn.query('TRUNCATE TABLE mysql.general_log')
}

export interface LogEntry {
  command: string
  sql: string
}

/**
 * Reads MySQL's general log (log_output=TABLE) for one account since a marker, so each tool's
 * statements can be isolated by the MySQL user it logged in as. The log table is MyISAM with an
 * event_time index (prepare), so reading a window costs the window, not the whole log; it is
 * rotated when large and unheld (lib/log-holders.ts, docs/architecture/14-development-setup.md).
 */
export class GeneralLog {
  readonly #conn: mysql.Connection
  readonly #release: () => void

  private constructor(conn: mysql.Connection, release: () => void) {
    this.#conn = conn
    this.#release = release
  }

  static async open(opts: {
    host: string
    port: number
    user: string
    password: string
  }): Promise<GeneralLog> {
    const conn = await mysql.createConnection({ ...opts, dateStrings: true })
    // A connection-level 'error' (socket reset / server closed the link under 2-core CI load) is
    // emitted on the connection, not rejected from a query; with no listener Node throws it as an
    // unhandled event and crashes the worker (even after the test body). Swallow it — query failures
    // still reject normally, so this hides nothing the tests assert.
    conn.on('error', () => {})
    // index / rotate only while no other suite (any worktree) holds a marker, then register
    const release = await withRegistryLock(async () => {
      if (liveHolders().length === 0) await prepare(conn)
      return registerHolder()
    })
    await conn.query("SET GLOBAL log_output = 'TABLE'")
    await conn.query("SET GLOBAL general_log = 'ON'")
    return new GeneralLog(conn, release)
  }

  async marker(): Promise<string> {
    const [rows] = await this.#conn.query({ sql: 'SELECT NOW(6)', rowsAsArray: true })
    return String((rows as unknown[][])[0]![0])
  }

  async #count(user: string, since: string): Promise<number> {
    const [rows] = await this.#conn.query({
      sql: `SELECT COUNT(*) FROM mysql.general_log WHERE user_host LIKE ? AND event_time > ? AND command_type IN ('Query', 'Init DB')`,
      values: [`${user}[%`, since],
      rowsAsArray: true,
    })
    return Number((rows as unknown[][])[0]![0])
  }

  /**
   * Waits until no new statement of `user` has reached the log for two polls in a row: a request that
   * already answered can still be finishing (php -S, a busy shared server) and its last statements
   * land late. `since` limits the window (default: the last 30 s).
   */
  async settle(user: string, since?: string): Promise<void> {
    const from =
      since ??
      String(
        (
          (
            await this.#conn.query({ sql: 'SELECT NOW(6) - INTERVAL 30 SECOND', rowsAsArray: true })
          )[0] as unknown[][]
        )[0]![0],
      )
    let last = -1
    let stable = 0
    for (let i = 0; i < 40 && stable < 2; i++) {
      await new Promise((r) => setTimeout(r, 150))
      const n = await this.#count(user, from)
      stable = n === last ? stable + 1 : 0
      last = n
    }
  }

  /** Entries for `user` after `since`, oldest first; Init DB is rendered as `USE \`db\`` like a Query. */
  async since(user: string, since: string): Promise<LogEntry[]> {
    // the log is written asynchronously relative to the client: wait until the count is stable
    await this.settle(user, since)
    const [rows] = await this.#conn.query(
      `SELECT command_type, CONVERT(argument USING utf8mb4) AS argument FROM mysql.general_log
       WHERE user_host LIKE ? AND event_time > ? AND command_type IN ('Query', 'Init DB') ORDER BY event_time, thread_id`,
      [`${user}[%`, since],
    )
    return (rows as Array<{ command_type: string; argument: string }>).map((r) =>
      r.command_type === 'Init DB'
        ? { command: 'Query', sql: `USE \`${r.argument}\`` }
        : { command: r.command_type, sql: r.argument },
    )
  }

  async close(): Promise<void> {
    this.#release()
    await this.#conn.end()
  }
}
