import { z } from 'zod'
import { SqlMessage } from './table-structure.ts'

/**
 * The normalization wizard (docs/features/04-table-level.md#normalization-wizard). Mounted at
 * /api/servers/:s/databases/:db/tables/:t/normalization…  The steps' texts are msgids rendered by
 * the client; the server answers the data phpMyAdmin's step controllers compute.
 *
 * pma: src/Controllers/Normalization/**, src/Normalization.php
 */

export const NormalizationColumn = z.object({ name: z.string(), type: z.string() })
export type NormalizationColumn = z.infer<typeof NormalizationColumn>

/** GET …/normalization: the table's columns and primary key (steps 1.1–1.4, 2.1) */
export const NormalizationTableResponse = z.object({
  /** all columns `name [type]` (steps 1.3, 1.4) */
  columns: z.array(NormalizationColumn),
  /** the String-category columns (step 1.1 select, /normalization/get-columns) */
  stringColumns: z.array(NormalizationColumn),
  /** PRIMARY KEY columns ([] without a primary key) */
  primaryKey: z.array(z.string()),
})
export type NormalizationTableResponse = z.infer<typeof NormalizationTableResponse>

/** POST …/normalization/3nf/step1 — the tables formed by 2NF (or the table itself) */
export const Normalization3NFStepRequest = z.object({ tables: z.array(z.string()).min(1) })
export const Normalization3NFStepResponse = z.object({
  /** the tables with transitive-dependency candidates: each non-PK column and the others */
  tables: z.array(
    z.object({ table: z.string(), primaryKey: z.array(z.string()), nonPk: z.array(z.string()) }),
  ),
})
export type Normalization3NFStepResponse = z.infer<typeof Normalization3NFStepResponse>

/** POST …/normalization/partial-dependencies — based on the first 500 rows */
export const PartialDependenciesResponse = z.object({
  dependencies: z.array(z.object({ determinants: z.string(), dependents: z.array(z.string()) })),
})
export type PartialDependenciesResponse = z.infer<typeof PartialDependenciesResponse>

/** determinant → dependents, in the wizard's order (normalization.js `pd`) */
const Dependencies = z.array(z.tuple([z.string(), z.array(z.string())]))

export const MoveRepeatingGroupRequest = z.object({
  /** `a, b` */
  repeatingColumns: z.string().min(1),
  newTable: z.string().min(1),
  newColumn: z.string().min(1),
  /** primary key columns joined with `,` (primaryKey.toString()) */
  primaryColumns: z.string(),
})
export type MoveRepeatingGroupRequest = z.infer<typeof MoveRepeatingGroupRequest>

export const NormalizationResult = z.object({
  messages: z.array(SqlMessage),
  queryError: z.boolean(),
})
export type NormalizationResult = z.infer<typeof NormalizationResult>

/** POST …/normalization/2nf/new-tables: the proposed tables (getHtmlForNewTables2NF) */
export const NewTables2NFRequest = z.object({ pd: Dependencies })
export const NewTables2NFResponse = z.object({
  tables: z.array(z.object({ key: z.string(), dependents: z.array(z.string()), name: z.string() })),
})
export type NewTables2NFResponse = z.infer<typeof NewTables2NFResponse>

export const CreateTables2NFRequest = z.object({
  pd: Dependencies,
  /** the name typed for each determinant */
  newTablesName: z.record(z.string(), z.string()),
})
export type CreateTables2NFRequest = z.infer<typeof CreateTables2NFRequest>

const NewTables3NF = z.array(
  z.tuple([z.string(), z.array(z.tuple([z.string(), z.object({ pk: z.string(), nonpk: z.string() })]))]),
)

/** POST …/normalization/3nf/new-tables (getHtmlForNewTables3NF) */
export const NewTables3NFRequest = z.object({
  pd: z.record(z.string(), z.array(z.string())),
  /** normalization.js tablesTds: per table, the table itself then each determinant */
  tables: z.array(z.tuple([z.string(), z.array(z.string())])),
})
export const NewTables3NFResponse = z.object({ newTables: NewTables3NF })
export type NewTables3NFResponse = z.infer<typeof NewTables3NFResponse>

export const CreateTables3NFRequest = z.object({ newTables: NewTables3NF })
export type CreateTables3NFRequest = z.infer<typeof CreateTables3NFRequest>
