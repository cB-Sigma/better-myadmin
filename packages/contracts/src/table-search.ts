import { z } from 'zod'
import { SqlMessage } from './table-structure.ts'

/**
 * Table Search, Zoom search, Find and replace (docs/features/04-table-level.md#search-tab).
 * /api/servers/:s/databases/:db/tables/:t/search…
 */

export const SearchColumn = z.object({
  name: z.string(),
  /** the display type of the form (lower-cased, BINARY/UNSIGNED/ZEROFILL stripped) */
  type: z.string(),
  collation: z.string(),
  nullable: z.boolean(),
  operators: z.array(z.object({ value: z.string(), label: z.string() })),
  /** INT | FLOAT | upper-cased clean type (input_box.twig column_data_type) */
  dataType: z.string(),
  input: z.object({
    kind: z.enum(['text', 'number', 'enum', 'foreign', 'gis']),
    /** textfield datefield / datetimefield / bit */
    className: z.string().optional(),
    min: z.string().optional(),
    max: z.string().optional(),
    /** ENUM values / SET values */
    values: z.array(z.string()).optional(),
    /** foreign values (foreignDropdown): value + text */
    foreign: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  }),
  /** Function column for GIS types: names, ' ' and '--------' separators */
  geomFunctions: z.array(z.string()).optional(),
})
export type SearchColumn = z.infer<typeof SearchColumn>

export const SearchPageResponse = z.object({
  columns: z.array(SearchColumn),
  geomColumnFlag: z.boolean(),
  maxRows: z.number().int(),
  maxPlotLimit: z.number().int(),
  slidersState: z.enum(['open', 'closed', 'disabled']),
  /** Relation::getDisplayField (Zoom search label default) */
  displayField: z.string(),
  /** Find and replace: Char-class columns with their index */
  charColumns: z.array(z.object({ index: z.number().int(), name: z.string() })),
})
export type SearchPageResponse = z.infer<typeof SearchPageResponse>

export const SearchCriterion = z.object({
  name: z.string(),
  type: z.string(),
  operator: z.string(),
  value: z.union([z.string(), z.array(z.string())]).default(''),
  geomFunc: z.string().optional(),
})

export const SearchRequest = z.object({
  distinct: z.boolean().default(false),
  /** null = displayAllColumns */
  columns: z.array(z.string()).nullable().default(null),
  customWhere: z.string().default(''),
  criteria: z.array(SearchCriterion).default([]),
  orderBy: z.string().default('--nil--'),
  order: z.enum(['ASC', 'DESC']).default('ASC'),
})
export type SearchRequest = z.input<typeof SearchRequest>

/** the query to run as a signed /sql link (results open in the table's SQL / Browse view) */
export const SearchResponse = z.object({ sql: z.string(), sig: z.string() })
export type SearchResponse = z.infer<typeof SearchResponse>

export const RangeResponse = z.object({ min: z.string().nullable(), max: z.string().nullable() })
export type RangeResponse = z.infer<typeof RangeResponse>

export const ZoomRequest = z.object({
  criteria: z.array(SearchCriterion),
  x: z.string(),
  y: z.string(),
  dataLabel: z.string().default(''),
  maxPlotLimit: z.number().int().min(1),
})
export type ZoomRequest = z.input<typeof ZoomRequest>

export const ZoomResponse = z.object({
  sql: z.string(),
  dataLabel: z.string(),
  points: z.array(
    z.object({
      x: z.string().nullable(),
      y: z.string().nullable(),
      label: z.string().nullable(),
      whereClause: z.string(),
      sig: z.string(),
    }),
  ),
})
export type ZoomResponse = z.infer<typeof ZoomResponse>

export const ZoomRowRequest = z.object({ whereClause: z.string(), sig: z.string() })
export const ZoomRowResponse = z.object({ row: z.record(z.string().nullable()).nullable() })
export type ZoomRowResponse = z.infer<typeof ZoomRowResponse>

export const FindReplaceRequest = z.object({
  columnIndex: z.number().int().min(0),
  find: z.string(),
  replaceWith: z.string().default(''),
  useRegex: z.boolean().default(false),
})
export type FindReplaceRequest = z.input<typeof FindReplaceRequest>

export const FindReplacePreviewResponse = z.object({
  /** null when no regex delimiter fits the pattern (getRegexReplaceRows returns false) */
  rows: z
    .array(z.object({ original: z.string().nullable(), replaced: z.string().nullable(), count: z.string() }))
    .nullable(),
})
export type FindReplacePreviewResponse = z.infer<typeof FindReplacePreviewResponse>

export const FindReplaceResponse = z.object({ messages: z.array(SqlMessage) })
export type FindReplaceResponse = z.infer<typeof FindReplaceResponse>
