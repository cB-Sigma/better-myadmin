import { z } from 'zod'
import { Cell } from './common.ts'

/** POST /api/servers/:s/query (replaces /import for typed queries and /sql for browse). */
export const QueryRequest = z.object({
  sql: z.string(),
  db: z.string().optional(),
  table: z.string().optional(),
  pos: z.number().int().min(0).default(0),
  /** session_max_rows: a positive number or 'all'. Omitted → MaxRows. */
  maxRows: z.union([z.number().int().positive(), z.literal('all')]).optional(),
  delimiter: z.string().min(1).default(';'),
  /** true when the query was typed in the SQL box ($_SESSION['sql_from_query_box']). */
  fromQueryBox: z.boolean().default(false),
  /** Signature for re-running a query that came from a URL (Core::checkSqlQuerySignature). */
  sig: z.string().optional(),
  fkChecks: z.boolean().optional(),
  profiling: z.boolean().optional(),
  rollback: z.boolean().optional(),
  params: z.record(z.string()).optional(),
})
export type QueryRequest = z.input<typeof QueryRequest>

export const FieldFlags = z.object({
  primaryKey: z.boolean(),
  uniqueKey: z.boolean(),
  multipleKey: z.boolean(),
  notNull: z.boolean(),
  unsigned: z.boolean(),
  zerofill: z.boolean(),
  numeric: z.boolean(),
  blob: z.boolean(),
  binary: z.boolean(),
  enum: z.boolean(),
  set: z.boolean(),
})

/** Port of src/FieldMetadata.php, plus wire-only extras. */
export const Field = z.object({
  name: z.string(),
  orgName: z.string(),
  table: z.string(),
  orgTable: z.string(),
  db: z.string(),
  /** FieldMetadata::getMappedType(): geometry|bit|json|real|int|blob|unknown|null|string|date|time|timestamp|datetime|year|'' */
  mappedType: z.string(),
  /** Raw MYSQLI_TYPE_* number. */
  type: z.number().int(),
  flags: FieldFlags,
  charsetNr: z.number().int(),
  length: z.number(),
  decimals: z.number().int(),
})
export type Field = z.infer<typeof Field>

export const StatementKind = z.enum(['resultset', 'affected', 'error', 'empty'])

export const MessageType = z.enum(['success', 'notice', 'error'])

export const Warning = z.object({ level: z.string(), code: z.number().int(), message: z.string() })
export type Warning = z.infer<typeof Warning>

export const Executed = z.object({ sql: z.string(), ms: z.number(), label: z.string().optional() })
export type Executed = z.infer<typeof Executed>

export const StatementResult = z.object({
  /** The statement as typed (one piece of the split input). */
  sql: z.string(),
  /** The SQL actually sent, e.g. with the appended LIMIT. */
  executedSql: z.string(),
  sig: z.string(),
  kind: StatementKind,
  queryType: z.string().nullable(),
  message: z.object({
    type: MessageType,
    text: z.string(),
    errno: z.number().int().optional(),
    docUrl: z.string().optional(),
  }),
  affectedRows: z.number().int().optional(),
  insertId: z.string().optional(),
  /** Query took … seconds, wall clock around the query (4 decimals in the UI). */
  queryTime: z.number(),
  result: z
    .object({
      fields: z.array(Field),
      rows: z.array(z.array(Cell)),
      numRows: z.number().int(),
      /** unlimNumRows: total rows the query would return without our LIMIT; -1 for an uncounted view. */
      totalRows: z.number().int(),
      approximate: z.boolean(),
      pos: z.number().int(),
      maxRows: z.union([z.number().int(), z.literal('all')]),
      limitAppended: z.boolean(),
    })
    .optional(),
  warnings: z.array(Warning),
  /** Database selected after the statement (changes after USE). */
  db: z.string().nullable(),
  reload: z.boolean(),
})
export type StatementResult = z.infer<typeof StatementResult>

export const QueryResponse = z.object({
  statements: z.array(StatementResult),
  executed: z.array(Executed),
  db: z.string().nullable(),
  table: z.string().nullable(),
})
export type QueryResponse = z.infer<typeof QueryResponse>
