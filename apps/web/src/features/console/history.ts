import { api } from '../../lib/api'

export interface ConsoleHistoryEntry {
  db: string
  table: string
  sqlquery: string
  /** pma__history.timevalue; null for the session history ("During current session"). */
  timevalue: string | null
}

/**
 * The query history the console renders at start: History::getHistory through the configuration
 * storage (the session list, or the history table with QueryHistoryDB). Newest first; empty when the
 * history feature is off (getHistory() returns false and phpMyAdmin shows no history).
 */
export async function consoleHistory(server: number): Promise<ConsoleHistoryEntry[]> {
  const r = await api.sqlHistory(server)
  if (r.history === false) return []
  return r.history.map((h) => ({
    db: h.db,
    table: h.table,
    sqlquery: h.sqlquery,
    timevalue: h.timevalue ?? null,
  }))
}
