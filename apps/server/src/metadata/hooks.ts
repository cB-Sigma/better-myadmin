import type { StatementResult } from '@bettermyadmin/contracts'
import { validIdentifier } from '@bettermyadmin/metadata'
import { parseAnalyze } from '@bettermyadmin/sql-lexer'
import type { Context } from 'hono'
import type { ServerEnv } from '../routes/server.ts'
import { type MetaRequest, withMeta } from './service.ts'

/**
 * What phpMyAdmin's StatementHistory middleware records after an SQL-box request: the last
 * statement the import loop ran (as split, with its `;`), and `Current::$database` /
 * `Current::$table` as ParseAnalyze left them (the posted table, replaced by each statement's
 * own table when it names one).
 *
 * pma: src/Http/Middleware/StatementHistory.php, src/Controllers/Import/ImportController.php (goSql loop)
 */
export async function recordSqlBoxHistory(
  m: MetaRequest,
  input: { db: string; table: string; statements: readonly StatementResult[]; noHistory?: boolean },
): Promise<void> {
  if (input.noHistory === true) return
  const last = input.statements.at(-1)
  if (last === undefined || last.sql === '') return
  let db = input.db
  let table = input.table
  for (const st of input.statements) {
    const [, d, t] = parseAnalyze(st.sql, db, true)
    db = d
    if (t !== '') table = t
  }
  await (await m.meta()).history().setHistory(db, table, m.user, last.sql)
}

/**
 * After an SQL-box request: StatementHistory (inner middleware) then RecentTableHandling (outer).
 * Metadata failures never fail the query.
 */
export async function afterSqlBox(
  c: Context<ServerEnv>,
  input: { db: string; table: string; statements: readonly StatementResult[]; noHistory?: boolean },
): Promise<void> {
  try {
    await withMeta(c, { db: input.db }, async (m) => {
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
