import { z } from 'zod'

/**
 * The search of the query results' Display chart and Visualize GIS data links: sql_query,
 * unlim_num_rows, and the grid's pos / session_max_rows (phpMyAdmin's $_SESSION['tmpval']).
 */
export const visualizationSearch = z.object({
  sql: z.coerce.string().default(''),
  unlim_num_rows: z.coerce.number().int().default(0),
  pos: z.coerce.number().int().optional(),
  session_max_rows: z.coerce.number().int().optional(),
})
