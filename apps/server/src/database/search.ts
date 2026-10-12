import type { DbSearchFormResponse, DbSearchResponse } from '@bettermyadmin/contracts'
import { backquote } from '@bettermyadmin/sql-gen'
import { ValidationError } from '../http/errors.ts'
import { type DbCtx, listTables } from './context.ts'

/**
 * Database Search.
 * pma: src/Controllers/Database/SearchController.php, src/Database/Search.php,
 *      templates/database/search/{main,results}.twig
 */

const SEARCH_TYPES = [
  'at least one of the words',
  'all of the words',
  'the exact phrase as substring',
  'the exact phrase as whole field',
  'as regular expression',
] as const

function checkEnabled(ctx: DbCtx): void {
  if (!ctx.cfg.UseDbSearch) {
    throw new ValidationError(
      ctx.tr.gettext(
        "Searching inside the database is disabled by the [code]$cfg['UseDbSearch'][/code] configuration.",
      ),
    )
  }
}

export async function searchForm(ctx: DbCtx): Promise<DbSearchFormResponse> {
  checkEnabled(ctx)
  return { tables: await listTables(ctx) }
}

export interface SearchParams {
  searchString: string
  searchType: string
  tables: string[]
  columnName: string
  includeHex: boolean
}

/** Search::getSearchResults */
export async function search(ctx: DbCtx, req: SearchParams): Promise<DbSearchResponse> {
  checkEnabled(ctx)
  const all = await listTables(ctx)
  const n = Number(req.searchType)
  const type = Number.isInteger(n) && n >= 1 && n <= 5 && String(n) === req.searchType ? n : 1
  const description =
    Number.isInteger(n) && n >= 1 && n <= 5 && String(n) === req.searchType
      ? ctx.tr.gettext(SEARCH_TYPES[type - 1] as string)
      : ''
  // array_intersect keeps the posted order
  const tables = req.tables.filter((t) => all.includes(t))
  const rows: DbSearchResponse['rows'] = []
  let total = 0
  for (const table of tables) {
    const where = await whereClause(ctx, table, req, type)
    const from = ` FROM ${backquote(ctx.db)}.${backquote(table)}`
    const sql = {
      select: `SELECT *${from}${where}`,
      count: `SELECT COUNT(*) AS \`count\`${from}${where}`,
      delete: `DELETE${from}${where}`,
    }
    const count = Number((await ctx.dbi.fetchValue(sql.count)) || 0)
    total += count
    rows.push({ table, count, selectSql: sql.select, deleteSql: sql.delete })
  }
  return { searchString: req.searchString, description, rows, total, tablesSearched: tables.length }
}

/** Search::getWhereClause */
async function whereClause(ctx: DbCtx, table: string, req: SearchParams, type: number): Promise<string> {
  const columns = await ctx.reader.getColumns(ctx.db, table)
  const op = type === 5 ? 'REGEXP' : 'LIKE'
  const wild = type < 4 ? '%' : ''
  const words = type > 2 ? [req.searchString] : req.searchString.split(' ')
  const clauses: string[] = []
  for (const word of words) {
    if (word === '') continue
    const perColumn: string[] = []
    for (const c of columns) {
      if (req.columnName !== '' && c.Field !== req.columnName) continue
      const v = ctx.dbi.quoteString(wild + word + wild)
      perColumn.push(`CONVERT(${backquote(c.Field)} USING utf8) ${op} ${v}`)
      if (req.includeHex) perColumn.push(`HEX(${backquote(c.Field)}) ${op} ${v}`)
    }
    if (perColumn.length === 0) continue
    clauses.push(perColumn.join(' OR '))
  }
  if (clauses.length === 0) return ' WHERE FALSE'
  return ` WHERE (${clauses.join(`) ${type === 1 ? ' OR ' : ' AND '} (`)})`
}
