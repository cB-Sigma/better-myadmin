import { z } from 'zod'
import { qs } from '../../../lib/search'

/**
 * The search of the query results' Display chart and Visualize GIS data links: sql_query,
 * unlim_num_rows, and the grid's pos / session_max_rows (phpMyAdmin's $_SESSION['tmpval']).
 */
export const visualizationSearch = z.object({
  sql: qs.strOr(''),
  /** the signature of `sql` (Core::signSqlQuery): an unsigned query is not run */
  sig: qs.strOr(''),
  unlim_num_rows: qs.intOr(0),
  pos: qs.int(),
  session_max_rows: qs.int(),
})
