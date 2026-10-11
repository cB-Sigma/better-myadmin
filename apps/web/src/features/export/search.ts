import { z } from 'zod'

/**
 * The export page's request parameters (links from the results grid, DB structure "With
 * selected: Export", the SQL tab): phpMyAdmin's names.
 */
export const exportSearch = z.object({
  single_table: z.string().optional(),
  sql_query: z.string().optional(),
  raw_query: z.string().optional(),
  unlim_num_rows: z.string().optional(),
  /** rows export: one unique WHERE condition per selected row (pma: rows_to_delete[]) */
  where_clause: z.array(z.string()).optional(),
  /** DB structure "With selected: Export" */
  selected_tbl: z.array(z.string()).optional(),
  what: z.string().optional(),
  format: z.string().optional(),
})
export type ExportSearch = z.infer<typeof exportSearch>

export function searchPairs(s: ExportSearch): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) continue
    if (Array.isArray(v)) for (const x of v) out.push([`${k}[]`, x])
    else out.push([k, v])
  }
  return out
}
