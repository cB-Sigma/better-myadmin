import mysql from 'mysql2/promise'

export interface LogEntry {
  command: string
  sql: string
}

/**
 * Reads MySQL's general log (log_output=TABLE) for one account since a marker, so each tool's
 * statements can be isolated by the MySQL user it logged in as.
 */
export class GeneralLog {
  readonly #conn: mysql.Connection

  private constructor(conn: mysql.Connection) {
    this.#conn = conn
  }

  static async open(opts: {
    host: string
    port: number
    user: string
    password: string
  }): Promise<GeneralLog> {
    const conn = await mysql.createConnection({ ...opts, dateStrings: true })
    await conn.query("SET GLOBAL log_output = 'TABLE'")
    await conn.query("SET GLOBAL general_log = 'ON'")
    return new GeneralLog(conn)
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
    await this.#conn.end()
  }
}
