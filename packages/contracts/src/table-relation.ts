import { z } from 'zod'
import { SqlMessage } from './table-structure.ts'

/**
 * Relation view (docs/features/04-table-level.md#relation-view).
 * GET/POST /api/servers/:s/databases/:db/tables/:t/relation
 */

export const RelationForeignKey = z.object({
  constraint: z.string().nullable(),
  indexList: z.array(z.string()),
  refDb: z.string(),
  refTable: z.string(),
  refIndexList: z.array(z.string()),
  /** form values: RESTRICT | NO_ACTION | CASCADE | SET_NULL */
  onDelete: z.string(),
  onUpdate: z.string(),
  /** tables of refDb with the same engine (Relation::getTables) */
  tables: z.array(z.string()),
  /** single-column unique columns of the referenced table (Table::getUniqueColumns) */
  uniqueColumns: z.array(z.string()),
})
export type RelationForeignKey = z.infer<typeof RelationForeignKey>

export const RelationPageResponse = z.object({
  engine: z.string(),
  isForeignKeySupported: z.boolean(),
  /** local columns offered for a constraint ('' first; non-InnoDB: indexed only) */
  columns: z.array(z.string()),
  /** every column of the table (internal relations, display column) */
  allColumns: z.array(z.string()),
  databases: z.array(z.string()),
  actions: z.array(z.object({ value: z.string(), label: z.string() })),
  foreignKeys: z.array(RelationForeignKey),
  /** tables of the current database for the blank row */
  newRowTables: z.array(z.string()),
  relationFeature: z.boolean(),
  internal: z.array(
    z.object({
      field: z.string(),
      foreignDb: z.string(),
      foreignTable: z.string(),
      foreignColumn: z.string(),
      tables: z.array(z.string()),
      uniqueColumns: z.array(z.string()),
    }),
  ),
  displayFeature: z.boolean(),
  displayField: z.string(),
  slidersState: z.enum(['open', 'closed', 'disabled']),
})
export type RelationPageResponse = z.infer<typeof RelationPageResponse>

/** getDropdownValues: tables of a database, or the indexed columns of a table */
export const RelationDropdownResponse = z.object({
  tables: z.array(z.string()).optional(),
  columns: z.array(z.string()).optional(),
  primary: z.array(z.string()).optional(),
})
export type RelationDropdownResponse = z.infer<typeof RelationDropdownResponse>

export const RelationSaveRequest = z.object({
  /** one row per existing constraint (same order as the page) plus the new ones */
  foreignKeys: z
    .array(
      z.object({
        constraintName: z.string().default(''),
        onDelete: z.string().default('RESTRICT'),
        onUpdate: z.string().default('RESTRICT'),
        columns: z.array(z.string()),
        refDb: z.string().default(''),
        refTable: z.string().default(''),
        refColumns: z.array(z.string()),
      }),
    )
    .optional(),
  internal: z
    .array(z.object({ field: z.string(), db: z.string(), table: z.string(), column: z.string() }))
    .optional(),
  displayField: z.string().optional(),
  preview: z.boolean().default(false),
})
export type RelationSaveRequest = z.input<typeof RelationSaveRequest>

export const RelationSaveResponse = z.object({
  messages: z.array(SqlMessage),
  preview: z.string().optional(),
})
export type RelationSaveResponse = z.infer<typeof RelationSaveResponse>

export const DropForeignKeyRequest = z.object({ constraint: z.string() })
export type DropForeignKeyRequest = z.input<typeof DropForeignKeyRequest>
