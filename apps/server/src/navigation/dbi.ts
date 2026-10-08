import { quoteString } from '@bettermyadmin/sql-gen'
import type { Conn } from '../db/connection.ts'
import { MysqlError } from '../http/errors.ts'

export interface Rows {
  fields: string[]
  rows: Array<Array<string | null>>
}

/**
 * The subset of phpMyAdmin's DatabaseInterface the navigation uses. Every helper is "try" flavoured
 * like phpMyAdmin's (`tryQuery` returns false on a MySQL error and the caller carries on).
 * pma: src/Dbal/DatabaseInterface.php
 */
export class NavDbi {
  readonly conn: Conn
  /** Per-server session cache (SessionCache). */
  readonly cache: Record<string, unknown>
  /** Last MySQL error of a failed `tryQuery`, as `#errno - message` (DatabaseInterface::getError). */
  lastError = ''
  #lowerCaseNames: number | null = null

  constructor(conn: Conn, cache: Record<string, unknown>) {
    this.conn = conn
    this.cache = cache
  }

  /** pma: DatabaseInterface::tryQuery */
  async tryQuery(sql: string, label = 'navigation'): Promise<Rows | null> {
    try {
      const r = await this.conn.query(sql, label)
      const set = r.resultSets[0]
      this.lastError = ''
      if (set === undefined) return { fields: [], rows: [] }
      return {
        fields: set.fields.map((f) => f.name),
        rows: set.rows.map((row) =>
          row.map((v) => (v === null || v === undefined ? null : v.toString('utf8'))),
        ),
      }
    } catch (e) {
      if (e instanceof MysqlError) {
        this.lastError = `#${e.extra.errno ?? 0} - ${e.message}`
        return null
      }
      throw e
    }
  }

  /** pma: DatabaseInterface::fetchValue (first column of the first row; false on error). */
  async fetchValue(sql: string): Promise<string | null | false> {
    const r = await this.tryQuery(sql)
    if (r === null) return false
    const v = r.rows[0]?.[0]
    return v === undefined ? false : v
  }

  /** pma: DatabaseInterface::fetchSingleColumn */
  async fetchSingleColumn(sql: string): Promise<Array<string | null>> {
    const r = await this.tryQuery(sql)
    return r === null ? [] : r.rows.map((row) => row[0] ?? null)
  }

  /** pma: DatabaseInterface::fetchResultSimple (rows keyed by column name) */
  async fetchResultSimple(sql: string): Promise<Array<Record<string, string | null>>> {
    const r = await this.tryQuery(sql)
    if (r === null) return []
    return r.rows.map((row) => Object.fromEntries(r.fields.map((f, i) => [f, row[i] ?? null])))
  }

  quoteString(value: string): string {
    return quoteString(value)
  }

  /**
   * pma: DatabaseInterface::getLowerCaseNames — phpMyAdmin reads it once per request; it is a
   * server fact, so we keep it for the session.
   */
  async getLowerCaseNames(): Promise<number> {
    if (this.#lowerCaseNames !== null) return this.#lowerCaseNames
    const cached = this.cache.lower_case_table_names
    if (typeof cached === 'number') {
      this.#lowerCaseNames = cached
      return cached
    }
    const v = Number.parseInt(String((await this.fetchValue('SELECT @@lower_case_table_names')) || '0'), 10)
    const n = v >= 0 && v <= 2 ? v : 0
    this.#lowerCaseNames = n
    this.cache.lower_case_table_names = n
    return n
  }

  /** pma: Util::getCollateForIS */
  async collateForIS(): Promise<string> {
    const names = await this.getLowerCaseNames()
    if (names === 0) return 'COLLATE utf8_bin'
    if (names === 2) return 'COLLATE utf8_general_ci'
    return ''
  }

  /** pma: DatabaseInterface::getCurrentUser (SessionCache `mysql_cur_user`). */
  async getCurrentUser(): Promise<string> {
    const cached = this.cache.mysql_cur_user
    if (typeof cached === 'string') return cached
    const user = await this.fetchValue('SELECT CURRENT_USER();')
    if (typeof user === 'string') {
      this.cache.mysql_cur_user = user
      return user
    }
    return '@'
  }
}
