import { z } from 'zod'
import type { ColumnFormOptions, SqlMessage } from './table-structure.ts'

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

export interface ShowCreateResponse {
  tables: Array<{ name: string; sql: string }>
  views: Array<{ name: string; sql: string }>
}

export interface CopyFormResponse {
  databases: string[]
  hasAdjustPrivileges: boolean
}

// ---------------------------------------------------------------- Operations

export interface DbOperationsResponse {
  db: string
  isSystemSchema: boolean
  /** column_info configured: the "Database comment" card */
  hasComment: boolean
  comment: string
  dbCollation: string
  hasAdjustPrivileges: boolean
  isDropDatabaseAllowed: boolean
  /** $_SESSION['pma_switch_to_new'] */
  switchToNew: boolean
  charsets: Array<{
    name: string
    description: string
    collations: Array<{ name: string; description: string; isSelected: boolean }>
  }>
  /** "The phpMyAdmin configuration storage has been deactivated. %sFind out why%s." */
  storageNotice: { type: 'notice' | 'error'; text: string } | null
}

export const DbCommentRequest = z.object({ comment: z.string().default('') })

export const DbCollationRequest = z.object({
  collation: z.string().default(''),
  changeAllTables: z.boolean().default(false),
  changeAllColumns: z.boolean().default(false),
})

export const DbRenameCopyRequest = z.object({
  newName: z.string(),
  /** db_collation (hidden field with the current collation) */
  collation: z.string().optional(),
  what: z.enum(['structure', 'data', 'dataonly']).default('data'),
  createDatabase: z.boolean().default(true),
  dropIfExists: z.boolean().default(false),
  autoIncrement: z.boolean().default(true),
  addConstraints: z.boolean().default(true),
  adjustPrivileges: z.boolean().default(false),
  switchToNew: z.boolean().default(false),
})

export interface DbRenameCopyResponse extends DbActionResponse {
  newName: string
  /** the database to continue in (the new one after a rename, or a copy with "Switch to copied database") */
  db: string
}

// ---------------------------------------------------------------- Search

export interface DbSearchFormResponse {
  tables: string[]
}

export const DbSearchRequest = z.object({
  /** criteriaSearchString */
  searchString: z.string().default(''),
  /** criteriaSearchType: '1'..'5' */
  searchType: z.string().default('1'),
  /** criteriaTables[] */
  tables: z.array(z.string()).default([]),
  /** criteriaColumnName */
  columnName: z.string().default(''),
  /** criteriaSearchOptionIncludeHex */
  includeHex: z.boolean().default(false),
})

export interface DbSearchResponse {
  searchString: string
  /** the search type description ('' for an invalid type) */
  description: string
  rows: Array<{ table: string; count: number; selectSql: string; deleteSql: string }>
  total: number
  tablesSearched: number
}

// ---------------------------------------------------------------- Routines / Events / Triggers

/** The export modal of a routine, event or trigger. */
export interface DbExportResponse {
  title: string
  sql: string
}

export interface RoutinesListResponse {
  items: Array<{
    name: string
    type: string
    /** DTD_IDENTIFIER */
    returns: string
    definer: string
    dropSql: string
    canEdit: boolean
    canExport: boolean
    canExecute: boolean
  }>
  /** CREATE ROUTINE on the database */
  canCreate: boolean
  pager: DbPager | null
}

export const RoutineParam = z.object({
  dir: z.string().default(''),
  name: z.string().default(''),
  type: z.string().default(''),
  length: z.string().default(''),
  optsText: z.string().default(''),
  optsNum: z.string().default(''),
})

export const RoutineSaveRequest = z.object({
  name: z.string().default(''),
  type: z.string().default('PROCEDURE'),
  /** edit mode: item_original_name / item_original_type */
  originalName: z.string().optional(),
  originalType: z.string().optional(),
  params: z.array(RoutineParam).default([]),
  returnType: z.string().default(''),
  returnLength: z.string().default(''),
  returnOptsText: z.string().default(''),
  returnOptsNum: z.string().default(''),
  definition: z.string().default(''),
  isDeterministic: z.boolean().default(false),
  adjustPrivileges: z.boolean().default(false),
  definer: z.string().default(''),
  securityType: z.string().default(''),
  sqlDataAccess: z.string().default(''),
  comment: z.string().default(''),
})
export type RoutineSaveRequest = z.output<typeof RoutineSaveRequest>

export interface RoutineEditorData {
  name: string
  type: 'PROCEDURE' | 'FUNCTION'
  params: Array<{
    dir: string
    name: string
    type: string
    length: string
    lengthArray: string[]
    optsText: string
    optsNum: string
  }>
  returnType: string
  returnLength: string
  returnOptsText: string
  returnOptsNum: string
  definition: string
  isDeterministic: boolean
  definer: string
  securityType: '' | 'DEFINER' | 'INVOKER'
  sqlDataAccess: string
  comment: string
}

export interface RoutineEditorOptions {
  datatypes: string[]
  charsets: Array<{ name: string; description: string }>
  numericOptions: string[]
  hasAdjustPrivileges: boolean
}

export interface RoutineExecuteForm {
  name: string
  type: string
  showFunctionFields: boolean
  params: Array<{
    index: number
    name: string
    type: string
    inputType: 'text' | 'radio' | 'checkbox'
    /** ENUM / SET values */
    values: string[]
    dateClass: '' | 'datefield' | 'datetimefield'
    functions: Array<{ value: string; selected: boolean }> | null
  }>
}

export const RoutineExecuteRequest = z.object({
  name: z.string(),
  type: z.string(),
  params: z.record(z.union([z.string(), z.array(z.string())])).default({}),
  funcs: z.record(z.string()).default({}),
})

export interface RoutineExecuteResponse {
  messages: SqlMessage[]
  queries: string[]
  title: string
  resultSets: Array<{ fields: string[]; rows: Array<Array<string | null>> }>
  /** "MySQL returned an empty result set (i.e. zero rows)." */
  empty: boolean
}

export interface EventsListResponse {
  items: Array<{ name: string; type: string; status: string; dropSql: string }>
  schedulerOn: boolean
  canCreate: boolean
}

export const EventSaveRequest = z.object({
  name: z.string().default(''),
  originalName: z.string().optional(),
  status: z.string().default(''),
  type: z.string().default(''),
  executeAt: z.string().default(''),
  intervalValue: z.string().default(''),
  intervalField: z.string().default(''),
  starts: z.string().default(''),
  ends: z.string().default(''),
  definition: z.string().default(''),
  preserve: z.boolean().default(false),
  definer: z.string().default(''),
  comment: z.string().default(''),
})
export type EventSaveRequest = z.output<typeof EventSaveRequest>

export interface EventEditorData {
  name: string
  status: string
  type: string
  executeAt: string
  intervalValue: string
  intervalField: string
  starts: string
  ends: string
  definition: string
  preserve: boolean
  definer: string
  comment: string
}

export interface TriggersListResponse {
  items: Array<{ name: string; table: string; timing: string; event: string; dropSql: string }>
  canCreate: boolean
  /** the editor's table select */
  tables: string[]
}

export const TriggerSaveRequest = z.object({
  name: z.string().default(''),
  originalName: z.string().optional(),
  table: z.string().default(''),
  timing: z.string().default(''),
  event: z.string().default(''),
  definition: z.string().default(''),
  definer: z.string().default(''),
})
export type TriggerSaveRequest = z.output<typeof TriggerSaveRequest>

export interface TriggerEditorData {
  name: string
  table: string
  timing: string
  event: string
  definition: string
  definer: string
}

// ---------------------------------------------------------------- Multi-table query

export interface MultiTableFormResponse {
  tables: Array<{ name: string; columns: string[] }>
  /** default_no_of_columns */
  defaultColumns: number
}

export interface MultiTableKeysResponse {
  foreignKeyConstrains: Array<{
    TABLE_NAME: string
    COLUMN_NAME: string
    REFERENCED_TABLE_NAME: string
    REFERENCED_COLUMN_NAME: string
  }>
}

// ---------------------------------------------------------------- Data dictionary

export interface DataDictionaryResponse {
  db: string
  comment: string
  tables: Array<{
    name: string
    comment: string
    hasRelation: boolean
    hasMime: boolean
    columns: Array<{
      name: string
      isPrimary: boolean
      type: string
      printType: string
      isNullable: boolean
      default: string | null
      comment: string
      relation: string
      mime: string
    }>
    indexes: Array<{
      name: string
      type: string
      unique: boolean
      packed: string
      comments: string
      columns: Array<{
        name: string
        subPart: number | null
        cardinality: number | null
        collation: string | null
        null: string
      }>
    }>
  }>
}

// ---------------------------------------------------------------- Privileges (read-only)

export interface DbPrivilegesResponse {
  db: string
  isSuperUser: boolean
  isGrantUser: boolean
  isCreateUser: boolean
  error: string | null
  notice: string | null
  accounts: Array<{
    user: string
    host: string
    privileges: Array<{
      /** g = global, d = database, r = routine */
      type: 'g' | 'd' | 'r'
      database: string
      routine: string | null
      hasGrant: boolean
      privileges: Array<{ name: string; title: string }>
    }>
  }>
}

// ---------------------------------------------------------------- Tracking (database scope)

export interface DbTrackingResponse {
  db: string
  /** the tracking feature of the configuration storage is configured */
  enabled: boolean
  /** "No tables found in database." (no table and no database log) */
  noTables: boolean
  isSystemSchema: boolean
  tracked: Array<{
    table: string
    version: string
    created: string
    updated: string
    active: boolean
  }>
  untracked: string[]
  /** the database log (`# date user\nstatement` per entry), null when empty */
  log: string | null
  /** tracking_default_statements */
  defaultStatements: string
}

export const DbTrackingRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete'), tables: z.array(z.string()).min(1) }),
  /** the Status toggle (phpMyAdmin posts it to /table/tracking toggle_activation) */
  z.object({ action: z.literal('toggle'), table: z.string(), version: z.string(), active: z.boolean() }),
  z.object({
    action: z.literal('create-version'),
    tables: z.array(z.string()).min(1),
    version: z.string(),
    /** the ticked statement checkboxes (alter_table, insert, …) */
    statements: z.array(z.string()).default([]),
  }),
])
export type DbTrackingRequest = z.output<typeof DbTrackingRequest>

// ---------------------------------------------------------------- Central columns

export interface CentralColumn {
  name: string
  type: string
  length: string
  collation: string
  isNull: boolean
  /** 'auto_increment' or '' */
  extra: string
  attribute: string
  /** stored default (null: none) */
  default: string | null
  /** NONE | USER_DEFINED | NULL | CURRENT_TIMESTAMP */
  defaultType: string
  /** the "As defined:" value shown in the editor */
  defaultValue: string
}

export interface CentralColumnsResponse {
  db: string
  /** the central columns feature of the configuration storage is configured */
  enabled: boolean
  totalRows: number
  pos: number
  maxRows: number
  columns: CentralColumn[]
  tables: string[]
  message: SqlMessage | null
  /** type / collation / attribute lists of the editors */
  options: ColumnFormOptions
}

const CentralColumnInput = z.object({
  name: z.string(),
  type: z.string(),
  length: z.string().default(''),
  /** NONE | USER_DEFINED | NULL | CURRENT_TIMESTAMP */
  defaultType: z.string().default('NONE'),
  defaultValue: z.string().default(''),
  collation: z.string().default(''),
  attribute: z.string().default(''),
  isNull: z.boolean().default(false),
  autoIncrement: z.boolean().default(false),
})

export const CentralColumnsRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add-new'), column: CentralColumnInput }),
  z.object({ action: z.literal('edit'), origName: z.string(), column: CentralColumnInput }),
  z.object({
    action: z.literal('multi-edit'),
    columns: z.array(CentralColumnInput.extend({ origName: z.string() })).min(1),
  }),
  z.object({ action: z.literal('add-from-table'), table: z.string(), column: z.string() }),
  z.object({ action: z.literal('delete'), columns: z.array(z.string()).min(1) }),
])
export type CentralColumnsRequest = z.output<typeof CentralColumnsRequest>

export interface CentralColumnsActionResponse {
  ok: boolean
  message: SqlMessage | null
}
