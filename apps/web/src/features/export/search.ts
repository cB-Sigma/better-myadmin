import { z } from 'zod'
import { qs } from '../../lib/search'

/**
 * The export page's request parameters (links from the results grid, DB structure "With
 * selected: Export", the SQL tab): phpMyAdmin's names.
 */
// read like $_GET (lib/search.ts): strings, `k[]=` lists
export const exportSearch = z.object({
  single_table: qs.str(),
  sql_query: qs.str(),
  /** the signature of sql_query (Core::signSqlQuery): an unsigned query of the URL is not exported */
  sql_signature: qs.str(),
  raw_query: qs.str(),
  unlim_num_rows: qs.str(),
  /** rows export: one unique WHERE condition per selected row (pma: rows_to_delete[]) */
  where_clause: qs.list(),
  /** DB structure "With selected: Export" (pma: selected_tbl[]; our bulk action sends table_select[]) */
  selected_tbl: qs.list(),
  table_select: qs.list(),
  what: qs.str(),
  format: qs.str(),
})
export type ExportSearch = z.infer<typeof exportSearch>

export function searchPairs(s: ExportSearch): Array<[string, string]> {
  const out: Array<[string, string]> = []
  // a query of the URL always goes with a signature ('' never verifies)
  if (s.sql_query !== undefined && s.sql_signature === undefined) out.push(['sql_signature', ''])
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) continue
    if (Array.isArray(v)) for (const x of v) out.push([`${k}[]`, x])
    else out.push([k, v])
  }
  return out
}
