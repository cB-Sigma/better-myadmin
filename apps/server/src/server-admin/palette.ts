import type { PaletteSearchResponse, PaletteTarget } from '@bettermyadmin/contracts'
import { backquote, escapeMysqlWildcards, quoteString } from '@bettermyadmin/sql-gen'
import type { AdminCtx } from './context.ts'
import { databaseList } from './databases.ts'

/**
 * The command palette's navigation targets (BetterMyAdmin only, parity exception X61). The browser
 * ranks with its fuzzy matcher (apps/web/src/features/shell/palette/fuzzy.ts); the server only
 * pre-filters, so a server with thousands of databases and tables never sends them all: a name
 * matches when it contains the query's letters in order, and the best `limit` candidates (exact,
 * prefix, substring, then any subsequence; shorter first) are returned.
 * The databases are ListDatabase's (only_db / hide_db applied, as the navigation); the tables come
 * from one information_schema.TABLES query (or SHOW FULL TABLES of the named databases with DisableIS).
 */

export const PALETTE_DATABASE_LIMIT = 50
export const PALETTE_TABLE_LIMIT = 100

/** The query's letters in order, case-insensitively, anywhere in `name`. */
export function isSubsequence(query: string, name: string): boolean {
  const q = query.toLowerCase()
  const n = name.toLowerCase()
  let i = 0
  for (let j = 0; j < n.length && i < q.length; j++) if (n[j] === q[i]) i++
  return i === q.length
}

/** 0 exact, 1 prefix, 2 substring, 3 subsequence (case-insensitive); callers checked isSubsequence. */
export function matchRank(query: string, name: string): number {
  const q = query.toLowerCase()
  const n = name.toLowerCase()
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  return n.includes(q) ? 2 : 3
}

/** `abc` → `%a%b%c%` with LIKE wildcards in the query escaped (MySQL's default `\` escape). */
export function subsequenceLike(query: string): string {
  let out = '%'
  for (const ch of query.toLowerCase()) out += `${escapeMysqlWildcards(ch)}%`
  return out
}

/** Splits `db.table` at the first dot and drops white space (`sak act` = `sakact`). */
export function parsePaletteQuery(q: string): { db: string | null; table: string } {
  const s = q.replace(/\s+/g, '')
  const dot = s.indexOf('.')
  return dot < 0 ? { db: null, table: s } : { db: s.slice(0, dot), table: s.slice(dot + 1) }
}

function byRank<T>(query: string, name: (x: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const na = name(a)
    const nb = name(b)
    return matchRank(query, na) - matchRank(query, nb) || na.length - nb.length || (na < nb ? -1 : 1)
  }
}

export async function paletteSearch(
  ctx: AdminCtx,
  req: { q: string; db?: string | undefined },
): Promise<PaletteSearchResponse> {
  const visible = await databaseList(ctx)
  const visibleSet = new Set(visible)
  const parsed = parsePaletteQuery(req.q)
  const dbQuery = parsed.db ?? parsed.table
  let truncated = false

  let databases = visible.filter((d) => isSubsequence(dbQuery, d))
  if (dbQuery !== '') databases.sort(byRank(dbQuery, (d) => d))
  if (databases.length > PALETTE_DATABASE_LIMIT) {
    truncated = true
    databases = databases.slice(0, PALETTE_DATABASE_LIMIT)
  }

  let tables: PaletteTarget[] = []
  const current = req.db !== undefined && visibleSet.has(req.db) ? req.db : null
  if (req.q.trim() === '') {
    // nothing typed: the current database's tables
    if (current !== null) tables = await showTables(ctx, current, '')
  } else if (!ctx.server.DisableIS) {
    // one more row than kept tells whether there were more
    const fetch = PALETTE_TABLE_LIMIT * 4
    const t = parsed.table.toLowerCase()
    const where = [`LOWER(\`TABLE_NAME\`) LIKE ${quoteString(subsequenceLike(parsed.table))}`]
    if (parsed.db !== null && parsed.db !== '')
      where.push(`LOWER(\`TABLE_SCHEMA\`) LIKE ${quoteString(subsequenceLike(parsed.db))}`)
    const sql =
      'SELECT `TABLE_SCHEMA`, `TABLE_NAME`, `TABLE_TYPE` FROM `information_schema`.`TABLES`' +
      ` WHERE ${where.join(' AND ')}` +
      ` ORDER BY LOWER(\`TABLE_NAME\`) = ${quoteString(t)} DESC,` +
      ` LOWER(\`TABLE_NAME\`) LIKE ${quoteString(`${escapeMysqlWildcards(t)}%`)} DESC,` +
      ` LOCATE(${quoteString(t)}, LOWER(\`TABLE_NAME\`)) > 0 DESC,` +
      ` CHAR_LENGTH(\`TABLE_NAME\`), \`TABLE_SCHEMA\`, \`TABLE_NAME\` LIMIT ${fetch + 1}`
    const r = await ctx.dbi.tryQuery(sql, 'palette.tables')
    const rows = r?.rows ?? []
    if (rows.length > fetch) truncated = true
    tables = rows
      .filter((row) => visibleSet.has(row[0] ?? ''))
      .map((row) => ({ db: row[0] ?? '', table: row[1] ?? '', view: (row[2] ?? '').includes('VIEW') }))
  } else {
    // DisableIS: no cross-database search; the current database and the named one (`db.`)
    const dbs = new Set<string>()
    if (current !== null) dbs.add(current)
    if (parsed.db !== null)
      for (const d of visible) if (d.toLowerCase() === parsed.db.toLowerCase()) dbs.add(d)
    for (const d of dbs) tables.push(...(await showTables(ctx, d, parsed.table)))
    tables.sort(byRank(parsed.table, (x) => x.table))
  }
  if (tables.length > PALETTE_TABLE_LIMIT) {
    truncated = true
    tables = tables.slice(0, PALETTE_TABLE_LIMIT)
  }
  return { databases, tables, truncated }
}

/** SHOW FULL TABLES FROM `db`, the names containing `query`'s letters in order. */
async function showTables(ctx: AdminCtx, db: string, query: string): Promise<PaletteTarget[]> {
  const r = await ctx.dbi.tryQuery(`SHOW FULL TABLES FROM ${backquote(db)}`, 'palette.tables')
  return (r?.rows ?? [])
    .filter((row) => isSubsequence(query, row[0] ?? ''))
    .map((row) => ({ db, table: row[0] ?? '', view: (row[1] ?? '').includes('VIEW') }))
}
