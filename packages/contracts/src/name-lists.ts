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

/**
 * GET /api/servers/:s/command-palette?q=…&db=… — the command palette's navigation targets
 * (BetterMyAdmin only, parity exception X61): the visible databases and the tables / views of every
 * visible database whose name contains the letters of `q` in order (case-insensitive; `db.table`
 * narrows both parts), best matches first and capped. An empty `q` lists the tables of `db`.
 */
export const PaletteSearchQuery = z.object({
  q: z.string().max(256).default(''),
  db: z.string().optional(),
})
export type PaletteSearchQuery = z.input<typeof PaletteSearchQuery>
export const PaletteTarget = z.object({ db: z.string(), table: z.string(), view: z.boolean() })
export type PaletteTarget = z.infer<typeof PaletteTarget>
export const PaletteSearchResponse = z.object({
  databases: z.array(z.string()),
  tables: z.array(PaletteTarget),
  /** more databases or tables matched than were returned */
  truncated: z.boolean(),
})
export type PaletteSearchResponse = z.infer<typeof PaletteSearchResponse>
