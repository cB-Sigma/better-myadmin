import { z } from 'zod'

/**
 * The name lists of the pickers (the export page's "Rename exported databases/tables/columns"):
 * the tables of a database and the columns of a table.
 * pma: src/Controllers/TableController.php (/tables), src/Controllers/ColumnController.php (/columns)
 */

/** POST /api/servers/:s/tables — `db` missing answers `success: false` and Message::error() */
export const TableNamesRequest = z.object({ db: z.string().optional() })
export type TableNamesRequest = z.infer<typeof TableNamesRequest>
export const TableNamesResponse = z.object({
  success: z.boolean(),
  tables: z.array(z.string()),
  message: z.string().optional(),
})
export type TableNamesResponse = z.infer<typeof TableNamesResponse>

/** POST /api/servers/:s/columns — `db` or `table` missing answers `success: false` */
export const ColumnNamesRequest = z.object({ db: z.string().optional(), table: z.string().optional() })
export type ColumnNamesRequest = z.infer<typeof ColumnNamesRequest>
export const ColumnNamesResponse = z.object({
  success: z.boolean(),
  columns: z.array(z.string()),
  message: z.string().optional(),
})
export type ColumnNamesResponse = z.infer<typeof ColumnNamesResponse>
