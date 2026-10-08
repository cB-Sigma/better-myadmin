import type { HistoryEntry } from '@bettermyadmin/contracts'
import type { AppConfig } from '../config.ts'
import type { SessionData } from '../session/store.ts'

/**
 * Where query history goes besides the session. phpMyAdmin also writes pma__history when the
 * history feature is configured and QueryHistoryDB is on; that store registers itself here.
 */
export interface HistoryStore {
  /**
   * RelationParameters->sqlHistoryFeature !== null. phpMyAdmin's getHistory returns nothing at all
   * without it; until a store is installed the session history is always shown.
   */
  featureEnabled(): boolean
  /** History::setHistory's pmadb part (insert + purgeHistory). */
  add(entry: { username: string; db: string; table: string; sqlquery: string }): Promise<void>
  /** History::getHistory's pmadb part (`ORDER BY id DESC`). */
  list(username: string): Promise<HistoryEntry[]>
}

let store: HistoryStore | null = null

/** Installs the pmadb-backed history (QueryHistoryDB); null restores session-only history. */
export function setHistoryStore(s: HistoryStore | null): void {
  store = s
}

/**
 * Records the request's query (StatementHistory middleware): skipped above MaxCharactersInDisplayedSQL,
 * the session list is capped at QueryHistoryMax.
 * pma: src/Console/History.php::setHistory
 */
export async function setHistory(
  cfg: AppConfig,
  session: SessionData,
  entry: { db: string; table: string; username: string; sqlquery: string },
): Promise<void> {
  if (entry.sqlquery === '') return
  if (Array.from(entry.sqlquery).length > cfg.MaxCharactersInDisplayedSQL) return
  session.sqlHistory ??= []
  session.sqlHistory.push({ db: entry.db, table: entry.table, sqlquery: entry.sqlquery })
  while (session.sqlHistory.length > cfg.QueryHistoryMax) session.sqlHistory.shift()
  if (store?.featureEnabled() && cfg.QueryHistoryDB) await store.add(entry)
}

/**
 * History::getHistory: newest first; session entries have no timestamp ("During current session").
 * pma: src/Console/History.php::getHistory
 */
export async function getHistory(
  cfg: AppConfig,
  session: SessionData,
  username = '',
): Promise<HistoryEntry[]> {
  if (store !== null && !store.featureEnabled()) return []
  if (store !== null && cfg.QueryHistoryDB) return store.list(username)
  return [...(session.sqlHistory ?? [])].reverse().map((h) => ({ ...h, timevalue: null }))
}
