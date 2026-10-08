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

  /** Entries for `user` after `since`, oldest first; Init DB is rendered as `USE \`db\`` like a Query. */
  async since(user: string, since: string): Promise<LogEntry[]> {
    // the log is written asynchronously relative to the client; give it a moment
    await new Promise((r) => setTimeout(r, 150))
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
