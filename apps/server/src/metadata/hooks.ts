import { validIdentifier } from '@bettermyadmin/metadata'
import type { Context } from 'hono'
import { requestScope } from '../db/request-scope.ts'
import type { ServerEnv } from '../routes/server.ts'
import { type MetaRequest, withMeta } from './service.ts'

/** `Current::$database`, `Current::$table` and `Current::$sqlQuery` when the SQL-box request ends. */
export interface CurrentQuery {
  db: string
  table: string
  sqlQuery: string
}

/**
 * What phpMyAdmin's StatementHistory middleware records after an SQL-box request:
 * `Current::$sqlQuery` (the last statement the import loop handed to the goSql path, with its `;`, or
 * the import-mode transcript) with `Current::$database` / `Current::$table` as ParseAnalyze left them.
 * The pipeline (query/pipeline.ts runSqlBox) tracks the three values exactly like ImportController,
 * so they are taken from its result; nothing is recorded when `no_history` is posted or the query is ''.
 *
 * pma: src/Http/Middleware/StatementHistory.php, src/Controllers/Import/ImportController.php (goSql loop)
 */
export async function recordSqlBoxHistory(
  m: MetaRequest,
  input: { current: CurrentQuery; noHistory?: boolean },
): Promise<void> {
  if (input.noHistory === true || input.current.sqlQuery === '') return
  const { db, table, sqlQuery } = input.current
  await (await m.meta()).history().setHistory(db, table, m.user, sqlQuery)
}

/**
 * StatementHistory for every other request: phpMyAdmin's middleware runs after each one and records
 * `Current::$sqlQuery` whatever set it (the POSTed `sql_query`, or the statements a controller ran:
 * dropping or emptying tables, operations, privileges, structure changes, find and replace, …), so
 * each route that mirrors such a request passes the same value here. Nothing is recorded for ''.
 * Metadata failures never fail the request.
 *
 * pma: src/Http/Middleware/StatementHistory.php, src/Http/Middleware/SqlQueryGlobalSetting.php
 */
export async function recordHistory(c: Context<ServerEnv>, current: CurrentQuery): Promise<void> {
  if (current.sqlQuery === '') return
  announceQuery(current)
  try {
    await withMeta(c, { db: current.db }, (m) => recordSqlBoxHistory(m, { current }))
  } catch (e) {
    console.error('metadata history:', e)
  }
}

/**
 * The statement the console shows for a request outside the SQL box (phpMyAdmin's console appends
 * every AJAX response's `reloadQuerywindow.sql_query`; "Show current browsing query" hides them).
 * Sent with the response as the X-BMA-Query header (app.ts). The /query route does not announce: its
 * caller (features/sql/runner.ts) tells the console itself.
 */
export function announceQuery(current: CurrentQuery): void {
  const scope = requestScope()
  if (scope !== undefined && current.sqlQuery !== '') scope.query = current
}

/** The statement an action showed in its message (Generator::getMessage of `Current::$sqlQuery`). */
export const shownSql = (r: { messages?: ReadonlyArray<{ sql?: string | undefined }> | undefined }): string =>
  r.messages?.find((m) => m.sql !== undefined && m.sql !== '')?.sql ?? ''

/**
 * After an SQL-box request: StatementHistory (inner middleware) then RecentTableHandling (outer, with
 * the request's own db/table parameters). Metadata failures never fail the query.
 */
export async function afterSqlBox(
  c: Context<ServerEnv>,
  input: {
    db: string
    table: string
    current: CurrentQuery
    noHistory?: boolean
    /** bkm_label / bkm_replace / bkm_all_users with the posted sql_query, when the run allows it */
    bookmark?: { label: string; shared: boolean; replace: boolean; sql: string } | undefined
  },
): Promise<void> {
  try {
    await withMeta(c, { db: input.db }, async (m) => {
      // ImportController: "only one bookmark has to be added for all the queries submitted through
      // the SQL tab", in Current::$database, with the posted (unbound) sql_query
      const bkm = input.bookmark
      if (bkm !== undefined && bkm.label !== '' && bkm.sql !== '') {
        await (await m.meta())
          .bookmarks()
          .storeTheQueryAsBookmark(input.current.db, m.user, bkm.sql, bkm.label, bkm.replace, bkm.shared)
      }
      await recordSqlBoxHistory(m, input)
      // pma: src/Http/Middleware/RecentTableHandling.php (the request's db/table parameters)
      const settings = await m.settings()
      if (settings.NumRecentTables !== 0 && validIdentifier(input.db) && validIdentifier(input.table)) {
        const meta = await m.meta()
        const recent = await meta.recentFavorite('recent')
        await recent.add({ db: input.db, table: input.table })
        meta.storeRecentFavorite(recent)
      }
    })
  } catch (e) {
    console.error('metadata after query:', e)
  }
}
