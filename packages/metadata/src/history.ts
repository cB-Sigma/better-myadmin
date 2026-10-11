import type { HistoryBackend, HistoryRow } from './driver.ts'
import { mbStrlen } from './php.ts'

export interface SessionHistoryEntry {
  db: string
  table: string
  sqlquery: string
}

export interface HistorySettings {
  MaxCharactersInDisplayedSQL: number
  QueryHistoryMax: number
  QueryHistoryDB: boolean
}

/**
 * SQL query history: always kept in the session (`$_SESSION['sql_history']`, capped at
 * `QueryHistoryMax`), and in the history table when `QueryHistoryDB` is on.
 *
 * pma: src/Console/History.php
 */
export class QueryHistory {
  readonly backend: HistoryBackend | null
  readonly cfg: HistorySettings
  /** `$_SESSION['sql_history']`, mutated in place. */
  readonly session: SessionHistoryEntry[]

  constructor(backend: HistoryBackend | null, cfg: HistorySettings, session: SessionHistoryEntry[]) {
    this.backend = backend
    this.cfg = cfg
    this.session = session
  }

  /** pma: History::setHistory (+ purgeHistory) */
  async setHistory(db: string, table: string, username: string, sqlquery: string): Promise<void> {
    if (mbStrlen(sqlquery) > this.cfg.MaxCharactersInDisplayedSQL) return
    this.session.push({ db, table, sqlquery })
    if (this.session.length > this.cfg.QueryHistoryMax) this.session.shift()
    if (this.backend === null || !this.cfg.QueryHistoryDB) return
    await this.backend.add(username, db, table, sqlquery, this.cfg.QueryHistoryMax)
  }

  /**
   * Newest first; `false` when the history feature is unavailable (phpMyAdmin then shows no
   * console history at all, even though the session keeps one).
   * pma: History::getHistory
   */
  async getHistory(username: string): Promise<Array<SessionHistoryEntry | HistoryRow> | false> {
    if (this.backend === null) return false
    if (!this.cfg.QueryHistoryDB) return this.session.length > 0 ? [...this.session].reverse() : false
    return this.backend.list(username)
  }
}
