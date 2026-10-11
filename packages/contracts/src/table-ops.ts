import { z } from 'zod'
import { SqlMessage } from './table-structure.ts'

/**
 * Table Operations tab, maintenance, view operations (docs/features/04-table-level.md#operations-tab).
 * Mounted at /api/servers/:s/databases/:db/tables/:t/operations…
 */

const Named = z.object({ name: z.string(), description: z.string() })

export const OperationsPageResponse = z.object({
  db: z.string(),
  table: z.string(),
  isView: z.boolean(),
  isSystemSchema: z.boolean(),
  columns: z.array(z.string()),
  /** InnoDB with a PRIMARY KEY or NOT NULL UNIQUE index: no "Alter table order by" card */
  hideOrderTable: z.boolean(),
  comment: z.string(),
  /** upper-cased engine ('View' for views) */
  storageEngine: z.string(),
  storageEngines: z.array(z.object({ name: z.string(), comment: z.string(), isDefault: z.boolean() })),
  charsets: z.array(Named.extend({ collations: z.array(Named) })),
  collation: z.string(),
  rowFormats: z.array(z.string()),
  rowFormatCurrent: z.string(),
  hasAutoIncrement: z.boolean(),
  autoIncrement: z.string(),
  hasPackKeys: z.boolean(),
  packKeys: z.string(),
  hasChecksumAndDelayKeyWrite: z.boolean(),
  checksum: z.string(),
  delayKeyWrite: z.string(),
  hasTransactionalAndPageChecksum: z.boolean(),
  transactional: z.string(),
  pageChecksum: z.string(),
  /** null when there are more databases than MaxDbList (text input) */
  databaseList: z.array(z.string()).nullable(),
  hasForeignKeys: z.boolean(),
  hasPrivileges: z.boolean(),
  switchToNew: z.boolean(),
  partitions: z.array(z.string()),
  partitionChoices: z.array(z.object({ value: z.string(), label: z.string() })),
  /** "Check referential integrity" links (signed SQL for /sql) */
  foreigners: z.array(
    z.object({
      master: z.string(),
      db: z.string(),
      table: z.string(),
      field: z.string(),
      sql: z.string(),
      sig: z.string(),
    }),
  ),
})
export type OperationsPageResponse = z.infer<typeof OperationsPageResponse>

export const OrderByRequest = z.object({ field: z.string(), order: z.enum(['asc', 'desc']).default('asc') })
export type OrderByRequest = z.input<typeof OrderByRequest>

export const MoveCopyRequest = z.object({
  op: z.enum(['move', 'copy']),
  targetDb: z.string().default(''),
  newName: z.string(),
  /** copy: structure | data | dataonly */
  what: z.enum(['structure', 'data', 'dataonly']).default('data'),
  dropIfExists: z.boolean().default(false),
  autoIncrement: z.boolean().default(false),
  addConstraints: z.boolean().default(false),
  adjustPrivileges: z.boolean().default(false),
  switchToNew: z.boolean().default(false),
})
export type MoveCopyRequest = z.input<typeof MoveCopyRequest>

/** The "Table options" form; an omitted field = not posted (phpMyAdmin hides it for the engine). */
export const TableOptionsRequest = z.object({
  newName: z.string().optional(),
  adjustPrivileges: z.boolean().default(false),
  comment: z.string().optional(),
  prevComment: z.string().default(''),
  engine: z.string().default(''),
  collation: z.string().default(''),
  changeAllCollations: z.boolean().default(false),
  packKeys: z.string().optional(),
  checksum: z.boolean().default(false),
  delayKeyWrite: z.boolean().default(false),
  transactional: z.boolean().default(false),
  pageChecksum: z.boolean().default(false),
  autoIncrement: z.string().optional(),
  hiddenAutoIncrement: z.string().optional(),
  rowFormat: z.string().optional(),
})
export type TableOptionsRequest = z.input<typeof TableOptionsRequest>

export const MaintenanceOp = z.enum(['analyze', 'check', 'checksum', 'optimize', 'repair'])
export const MaintenanceRequest = z.object({
  op: MaintenanceOp,
  /** selected_tbl[] (defaults to the current table) */
  tables: z.array(z.string()).optional(),
})
export type MaintenanceRequest = z.input<typeof MaintenanceRequest>

/** The /sql links of the page (Defragment, Flush, Truncate, Delete, Drop, Drop view). */
export const SqlActionRequest = z.object({
  action: z.enum(['defragment', 'flush', 'truncate', 'delete', 'drop', 'dropView']),
  /** fk_checks of the confirmation dialog; omitted = not posted */
  fkChecks: z.boolean().optional(),
})
export type SqlActionRequest = z.input<typeof SqlActionRequest>

export const PartitionOpsRequest = z.object({
  operation: z.enum(['ANALYZE', 'CHECK', 'OPTIMIZE', 'REBUILD', 'REPAIR', 'TRUNCATE', 'DROP', 'COALESCE']),
  partitions: z.array(z.string()).min(1),
})
export type PartitionOpsRequest = z.input<typeof PartitionOpsRequest>

export const RenameViewRequest = z.object({ newName: z.string() })
export type RenameViewRequest = z.input<typeof RenameViewRequest>

export const MaintenanceResult = z.object({
  op: MaintenanceOp,
  /** Analyze table / Check table / … */
  title: z.string(),
  rows: z.array(z.object({ table: z.string(), op: z.string(), msgType: z.string(), msgText: z.string() })),
  /** checksum: Table | Checksum (null in italics) */
  checksums: z.array(z.object({ table: z.string(), checksum: z.string().nullable() })).optional(),
  /** checksum warnings / check index problems */
  notices: z.array(z.string()).optional(),
})
export type MaintenanceResult = z.infer<typeof MaintenanceResult>

export const OperationsResponse = z.object({
  messages: z.array(SqlMessage),
  maintenance: MaintenanceResult.optional(),
  /** the table after the action (renamed / moved / switched to) */
  db: z.string().optional(),
  table: z.string().optional(),
  /** the table no longer exists (DROP) */
  dropped: z.boolean().optional(),
})
export type OperationsResponse = z.infer<typeof OperationsResponse>
