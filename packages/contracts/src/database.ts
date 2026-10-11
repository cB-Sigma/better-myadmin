import { z } from 'zod'
import type { SqlMessage } from './table-structure.ts'

/**
 * Database level pages (docs/features/05-database-level.md): Structure, Operations, Search,
 * Routines, Events, Triggers, multi-table query, central columns, data dictionary, privileges,
 * tracking. Messages are phpMyAdmin's msgids, translated with the request language.
 */

/** A mutation's answer: the message cards (with the SQL that ran) and, when asked, the statements. */
export interface DbActionResponse {
  messages: SqlMessage[]
}

/** Generator::getListNavigator (list_navigator.twig) for a page of `maxCount` items. */
export interface DbPager {
  pos: number
  total: number
  maxCount: number
  begin: number | null
  prev: number | null
  next: number | null
  end: number | null
  pages: Array<{ value: number; page: number; selected: boolean }>
}

// ---------------------------------------------------------------- Structure

export const DbStructureQuery = z.object({
  pos: z.string().optional(),
  sort: z.string().optional(),
  sort_order: z.string().optional(),
  tbl_group: z.string().optional(),
  tbl_type: z.string().optional(),
})

export interface DbStructureTable {
  name: string
  isView: boolean
  /** TABLE_COMMENT (the name link's title) */
  comment: string
  /** the rows cell: null when phpMyAdmin renders the "in use"/view degenerate row */
  rows: number | null
  /** format_number(TABLE_ROWS, 0) */
  rowsText: string
  /** `~N` with the exact-count link */
  approx: boolean
  /** views at MaxExactCountViews: "This view has at least this number of rows." */
  viewHint: boolean
  /** Browse/Search/Empty icons not greyed (TABLE_ROWS > 0 or a view) */
  mayHaveRows: boolean
  /** the Type cell: ENGINE, or '' (the UI shows "View" for views) */
  engine: string
  collation: { name: string; description: string } | null
  charset: string
  /** Size cell: [value, unit]; `text` for "-", " - " (MERGE) and "unknown" */
  size: { value: string; unit: string } | { text: string }
  /** Overhead cell: null renders "-" */
  overhead: { value: string; unit: string } | null
  /** raw numbers for client-side adjustTotals */
  bytes: number
  dataFree: number
  isMerge: boolean
  createTime: string
  updateTime: string
  checkTime: string
  favorite: boolean
  /** tracking eye: null when not tracked or tracking off */
  tracking: 'active' | 'inactive' | null
  replication: { do: boolean; ignored: boolean }
  /** degenerate row: the comment or "in use" spanning the remaining cells */
  inUse: string | null
}

export interface DbStructureResponse {
  db: string
  isSystemSchema: boolean
  /** null: no tables found ("No tables found in database.") */
  tables: DbStructureTable[]
  pager: DbPager | null
  /** the sort/sort_order the page was requested with (sortable header links) */
  sort: string
  sortOrder: string
  config: {
    showStats: boolean
    showDbDetails: boolean
    numFavoriteTables: number
    showCharset: boolean
    showComment: boolean
    showCreation: boolean
    showLastUpdate: boolean
    showLastCheck: boolean
    limitChars: number
    disableMultiTableMaintenance: boolean
    propertiesNumColumns: number
    /** pmadb central_columns configured (bulk "Central columns" group) */
    centralColumns: boolean
  }
  replicaStatus: boolean
  overheadCheck: boolean
  summary: {
    numTables: number
    rowsText: string
    approx: boolean
    defaultStorageEngine: string
    collation: { name: string; description: string } | null
    charset: string
    size: [string, string]
    overhead: [string, string]
    createTime: string
    updateTime: string
    checkTime: string
  } | null
  /** the redirect phpMyAdmin issues when pos is past the end */
  redirectPos?: number
}

export interface RealRowCountResponse {
  realRowCount?: string
  realRowCountAll?: Array<{ table: string; rowCount: string }>
}

const tables = z.array(z.string()).default([])

export const BulkTablesRequest = z.object({ tables })

export const BulkFkRequest = z.object({
  tables,
  /** "Enable foreign key checks" (fk_checks), omitted = not posted */
  fkChecks: z.boolean().optional(),
  /** mult_btn: Yes (true) / No (false) */
  confirmed: z.boolean().default(true),
})

export const AddPrefixRequest = z.object({ tables, prefix: z.string().default('') })

export const ReplacePrefixRequest = z.object({
  tables,
  fromPrefix: z.string().default(''),
  toPrefix: z.string().default(''),
  /** copy-table-with-prefix only */
  dropIfExists: z.boolean().default(false),
})

export const CopyTablesRequest = z.object({
  tables,
  targetDb: z.string(),
  what: z.enum(['structure', 'data', 'dataonly']).default('data'),
  dropIfExists: z.boolean().default(false),
  autoIncrement: z.boolean().default(false),
  addConstraints: z.boolean().default(true),
  adjustPrivileges: z.boolean().default(false),
})

export const MaintenanceRequest = z.object({
  tables,
  op: z.enum(['analyze', 'check', 'checksum', 'optimize', 'repair']),
})

export interface MaintenanceResponse {
  title: string
  docPage: string
  messages: SqlMessage[]
  /** analyze/check/optimize/repair: Msg rows grouped by table */
  groups: Array<{ table: string; rows: Array<{ operation: string; type: string; text: string }> }>
  /** checksum */
  checksums: Array<{ table: string; checksum: string | null }>
  warnings: string[]
}

export interface ShowCreateResponse {
  tables: Array<{ name: string; sql: string }>
  views: Array<{ name: string; sql: string }>
}

export interface CopyFormResponse {
  databases: string[]
  hasAdjustPrivileges: boolean
}
