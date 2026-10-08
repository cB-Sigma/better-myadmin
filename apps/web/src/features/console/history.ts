import type { HistoryEntry } from '@bettermyadmin/contracts'
import { api } from '../../lib/api'

/**
 * Where the console reads the query history shown at start (History::getHistory). The default reads
 * GET /sql/history (the session history); the pma__history store can replace it.
 */
export interface HistoryProvider {
  /** Newest first, like History::getHistory. */
  list(server: number): Promise<HistoryEntry[]>
}

const sessionHistory: HistoryProvider = {
  list: async (server) => (await api.sqlHistory(server)).entries,
}

let provider: HistoryProvider = sessionHistory

export function registerHistoryProvider(p: HistoryProvider | null): void {
  provider = p ?? sessionHistory
}

export function historyProvider(): HistoryProvider {
  return provider
}
