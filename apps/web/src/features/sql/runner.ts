import type { QueryRequest, QueryResponse } from '@bettermyadmin/contracts'
import { api } from '../../lib/api'

/**
 * Query runs, observable by the console: phpMyAdmin's console sees every AJAX response
 * (console_message_id for its own queries, reloadQuerywindow for the others).
 */
export interface QueryEvent {
  id: string
  phase: 'start' | 'done' | 'error'
  source: 'page' | 'console'
  server: number
  sql: string
  db: string
  table: string
  response?: QueryResponse
  error?: unknown
}

type Listener = (e: QueryEvent) => void
const listeners = new Set<Listener>()

export function onQueryEvent(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function emit(e: QueryEvent) {
  for (const l of listeners) l(e)
}

/** Random 12 digits, like the console's message ids. */
export const newQueryId = () => String(Math.floor(Math.random() * 1e12)).padStart(12, '0')

/** POST /query with a cancellable id, announced to the console. */
export async function runQuery(
  server: number,
  req: QueryRequest,
  source: QueryEvent['source'],
  id = newQueryId(),
): Promise<QueryResponse> {
  const base = { id, source, server, sql: req.sql, db: req.db ?? '', table: req.table ?? '' }
  emit({ ...base, phase: 'start' })
  try {
    const response = await api.query(server, { ...req, queryId: id })
    emit({ ...base, phase: 'done', response })
    return response
  } catch (error) {
    emit({ ...base, phase: 'error', error })
    throw error
  }
}

/**
 * Results produced elsewhere (the console) for the SQL page to show, like phpMyAdmin putting the
 * /import response into the main panel.
 */
let pendingResults: { key: string; response: QueryResponse } | null = null

export function setPendingResults(key: string, response: QueryResponse) {
  pendingResults = { key, response }
  window.dispatchEvent(new CustomEvent('bma:pending-results', { detail: key }))
}

export function takePendingResults(key: string): QueryResponse | null {
  if (pendingResults === null || pendingResults.key !== key) return null
  const r = pendingResults.response
  pendingResults = null
  return r
}

/** Scope key of a page (server/db/table). */
export const scopeKey = (server: number, db: string, table: string) => `${server}\u0000${db}\u0000${table}`
