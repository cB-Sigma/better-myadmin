import { z } from 'zod'

/**
 * Server › Status › Dashboard and Slow queries: BetterMyAdmin-only pages (parity exceptions X64,
 * X65). The dashboard endpoint returns raw counters and the server clock; the browser computes the
 * rates from two consecutive samples. The slow-queries endpoints read
 * performance_schema.events_statements_summary_by_digest (or mysql.slow_log) and EXPLAIN a
 * representative statement on request, nothing else.
 * docs/features/06-server-level.md#bettermyadmin-additions-dashboard-and-slow-queries
 */

// ------------------------------------------------------------------ Dashboard (/status/dashboard)

export const DashboardSample = z.object({
  /** server clock of the reading (ms, `UNIX_TIMESTAMP(NOW(3))`) */
  serverTime: z.number(),
  /** `SHOW GLOBAL STATUS` restricted to the dashboard counters (null: not readable) */
  status: z.record(z.string(), z.string()).nullable(),
  /** the few `SHOW GLOBAL VARIABLES` the cards need (max_connections, version, …) */
  variables: z.record(z.string(), z.string()),
  isMariaDb: z.boolean(),
  /**
   * The replica status: null when the server is not a replica; `denied` when the account may not
   * read it (REPLICATION CLIENT / REPLICA MONITOR missing).
   */
  replica: z
    .union([
      z.object({
        /** Seconds_Behind_Source (Seconds_Behind_Master); null while the SQL thread is stopped */
        lag: z.number().nullable(),
        ioRunning: z.string(),
        sqlRunning: z.string(),
      }),
      z.literal('denied'),
    ])
    .nullable(),
})
export type DashboardSample = z.infer<typeof DashboardSample>

// ------------------------------------------------------------------ Slow queries (/status/slow-queries)

export const SLOW_QUERY_SORTS = [
  'total',
  'count',
  'avg',
  'max',
  'rowsExamined',
  'rowsSent',
  'errors',
  'lastSeen',
] as const
export type SlowQuerySort = (typeof SLOW_QUERY_SORTS)[number]

export const SlowQueriesQuery = z.object({
  source: z.enum(['digest', 'slowlog']).catch('digest').default('digest'),
  db: z.string().max(64).optional().default(''),
  sort: z.enum(SLOW_QUERY_SORTS).catch('total').default('total'),
  order: z.enum(['asc', 'desc']).catch('desc').default('desc'),
})
export type SlowQueriesQuery = z.input<typeof SlowQueriesQuery>

/** One statement digest (performance_schema) or one normalized slow-log query. Times in ms. */
export const SlowQueryRow = z.object({
  /** the digest hash; for the slow log a hash of the normalized text */
  digest: z.string(),
  schema: z.string().nullable(),
  /** normalized text (placeholders `?`; DIGEST_TEXT may be truncated by max_digest_length) */
  text: z.string(),
  count: z.number(),
  totalMs: z.number(),
  avgMs: z.number(),
  maxMs: z.number(),
  rowsExamined: z.number(),
  rowsSent: z.number(),
  errors: z.number(),
  warnings: z.number(),
  firstSeen: z.string().nullable(),
  lastSeen: z.string().nullable(),
  /** a statement with its values (QUERY_SAMPLE_TEXT, the slow log's latest sql_text) */
  sample: z.string().nullable(),
})
export type SlowQueryRow = z.infer<typeof SlowQueryRow>

/** Why a source cannot be read: shown with the way to enable it. */
export const SlowQueriesUnavailable = z.enum([
  /** performance_schema = OFF (MariaDB's default) */
  'pfs-off',
  /** the account has no SELECT on performance_schema */
  'pfs-denied',
  /** the statements_digest consumer is disabled */
  'digest-consumer-off',
  /** log_output does not include TABLE */
  'log-not-table',
  /** slow_query_log = OFF (the table may still hold older rows) */
  'slow-log-off',
  /** no SELECT on mysql.slow_log */
  'slow-log-denied',
])
export type SlowQueriesUnavailable = z.infer<typeof SlowQueriesUnavailable>

export const SlowQueriesResponse = z.object({
  source: z.enum(['digest', 'slowlog']),
  /** false: nothing could be read, see `reasons` */
  available: z.boolean(),
  /** problems with the source (with `available` true they are warnings: e.g. slow log now off) */
  reasons: z.array(SlowQueriesUnavailable),
  /** the user may TRUNCATE the digest table (DROP on it, through *.*, the schema or the table) */
  canReset: z.boolean(),
  /** the schemas seen in the source (database filter) */
  databases: z.array(z.string()),
  rows: z.array(SlowQueryRow),
  /** rows before LIMIT (the list shows the top 100) */
  total: z.number(),
  /** variables worth showing next to the list: long_query_time, log_output, … */
  settings: z.record(z.string(), z.string()),
  isMariaDb: z.boolean(),
})
export type SlowQueriesResponse = z.infer<typeof SlowQueriesResponse>

export const SlowQueryDetailQuery = z.object({
  source: z.enum(['digest', 'slowlog']).catch('digest').default('digest'),
  digest: z.string().max(128),
  db: z.string().max(64).optional().default(''),
})
export type SlowQueryDetailQuery = z.input<typeof SlowQueryDetailQuery>

export const SlowQueryDetail = z.object({
  text: z.string(),
  /** the normalized text through the SQL formatter (packages/sql-lexer) */
  formatted: z.string(),
  /** a statement with real values that EXPLAIN can run; null when performance_schema keeps none */
  sample: z.string().nullable(),
  /** where the sample came from */
  sampleSource: z.enum(['summary', 'history_long', 'history', 'slowlog']).nullable(),
  /** the sample is a statement EXPLAIN accepts (SELECT, INSERT, UPDATE, DELETE, REPLACE, TABLE, WITH) */
  explainable: z.boolean(),
  schema: z.string().nullable(),
})
export type SlowQueryDetail = z.infer<typeof SlowQueryDetail>

export const SlowQueryExplainRequest = z.object({
  db: z.string().max(64).default(''),
  query: z.string().min(1).max(1_000_000),
})
export type SlowQueryExplainRequest = z.input<typeof SlowQueryExplainRequest>

export const SlowQueryExplainResponse = z.object({
  /** the statement that ran (`EXPLAIN …`) */
  sql: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string().nullable())),
  /** a MySQL error (`#errno - message`) or why the statement was refused */
  error: z.string().nullable(),
})
export type SlowQueryExplainResponse = z.infer<typeof SlowQueryExplainResponse>

export const SlowQueriesResetResponse = z.object({
  message: z.object({ type: z.enum(['success', 'error']), text: z.string() }),
})
export type SlowQueriesResetResponse = z.infer<typeof SlowQueriesResetResponse>
