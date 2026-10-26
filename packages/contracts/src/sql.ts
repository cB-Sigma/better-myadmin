import { z } from 'zod'

/** POST /api/servers/:s/sql/lint (pma: /lint). The editor lints in a worker; this is the fallback. */
export const LintRequest = z.object({
  sql: z.string(),
  /** lintOptions.editorType of the routine/trigger/event editors. */
  editorType: z.enum(['event', 'routine', 'trigger']).optional(),
})
export type LintRequest = z.input<typeof LintRequest>

export const LintMessage = z.object({
  message: z.string(),
  fromLine: z.number().int(),
  fromColumn: z.number().int(),
  toLine: z.number().int(),
  toColumn: z.number().int(),
  severity: z.enum(['warning', 'error']),
})
export const LintResponse = z.object({ lints: z.array(LintMessage) })
export type LintResponse = z.infer<typeof LintResponse>

/** POST /api/servers/:s/sql/format (pma: /database/sql/format). */
export const FormatRequest = z.object({ sql: z.string(), singleLine: z.boolean().default(false) })
export type FormatRequest = z.input<typeof FormatRequest>
export const FormatResponse = z.object({ sql: z.string() })
export type FormatResponse = z.infer<typeof FormatResponse>

/** GET /api/servers/:s/sql/autocomplete?db= (pma: /database/sql/autocomplete). */
export const AutocompleteResponse = z.object({
  /** table name → columns; empty when EnableAutocompleteForTablesAndColumns is off or no db. */
  tables: z.record(z.string(), z.array(z.object({ field: z.string(), columnHint: z.string() }))),
})
export type AutocompleteResponse = z.infer<typeof AutocompleteResponse>

/** GET /api/servers/:s/sql/default-fk-check (pma: /sql/get-default-fk-check-value). */
export const DefaultFkCheckResponse = z.object({ defaultFkCheckValue: z.boolean() })
export type DefaultFkCheckResponse = z.infer<typeof DefaultFkCheckResponse>

/** POST /api/servers/:s/query/simulate (pma: /import/simulate-dml). */
export const SimulateRequest = z.object({
  sql: z.string(),
  db: z.string().optional(),
  delimiter: z.string().default(';'),
})
export type SimulateRequest = z.input<typeof SimulateRequest>
export const SimulateResponse = z.object({
  /** Per statement; null when `message` holds the error. */
  sqlData: z
    .array(
      z.object({
        /** Statement::build() of the parsed statement (shown under "SQL query:"). */
        sqlQuery: z.string(),
        matchedRows: z.number().int(),
        /** The signed SELECT behind the "Affected rows:" link. */
        matchedRowsSql: z.string(),
        matchedRowsSig: z.string(),
      }),
    )
    .nullable(),
  message: z.string().optional(),
})
export type SimulateResponse = z.infer<typeof SimulateResponse>

/** POST /api/servers/:s/query/cancel: KILL QUERY on the connection running `queryId`. */
export const CancelRequest = z.object({ queryId: z.string().min(1) })
export const CancelResponse = z.object({ killed: z.boolean() })
export type CancelResponse = z.infer<typeof CancelResponse>

/** The column list of the table-scope SQL tab. */
export const SqlFormColumn = z.object({ field: z.string(), comment: z.string() })

/**
 * GET /api/servers/:s/sql/form?db=&table=&sqlQuery=&showQuery=
 * Everything SqlQueryForm::getHtml renders server-side (pma: /server/sql, /database/sql, /table/sql).
 */
export const SqlFormResponse = z.object({
  scope: z.enum(['server', 'database', 'table']),
  /** The legend's object: server verbose/host, database name, or `db.table`. */
  legendName: z.string(),
  /** Prefilled query (DefaultQueryDatabase / DefaultQueryTable expanded, or the query param). */
  query: z.string(),
  columns: z.array(SqlFormColumn),
  /** ForeignKey::isCheckEnabled() */
  fkChecks: z.boolean(),
  profilingSupported: z.boolean(),
  /** For the lint worker: the parser context of the connected server (Context::loadClosest). */
  server: z.object({ versionInt: z.number().int(), isMariaDb: z.boolean(), sqlMode: z.string() }),
  settings: z.object({
    Confirm: z.boolean(),
    RetainQueryBox: z.boolean(),
    CodemirrorEnable: z.boolean(),
    LintEnable: z.boolean(),
    EnableAutocompleteForTablesAndColumns: z.boolean(),
    TextareaCols: z.number().int(),
    TextareaRows: z.number().int(),
    TextareaAutoSelect: z.boolean(),
    MaxCharactersInDisplayedSQL: z.number().int(),
    ActionLinksMode: z.string(),
    AllowSharedBookmarks: z.boolean(),
  }),
})
export type SqlFormResponse = z.infer<typeof SqlFormResponse>

/** $cfg['Console'] (src/Config/Settings/Console.php). */
export const ConsoleSettings = z.object({
  StartHistory: z.boolean(),
  AlwaysExpand: z.boolean(),
  CurrentQuery: z.boolean(),
  EnterExecutes: z.boolean(),
  DarkTheme: z.boolean(),
  Mode: z.enum(['show', 'collapse', 'info']),
  Height: z.number().int().positive(),
  GroupQueries: z.boolean(),
  OrderBy: z.enum(['exec', 'time', 'count']),
  Order: z.enum(['asc', 'desc']),
})
export type ConsoleSettings = z.infer<typeof ConsoleSettings>

/** GET /api/servers/:s/console/config */
export const ConsoleConfigResponse = z.object({
  settings: ConsoleSettings,
  /** $cfg['DBG']['sql']: shows the Debug SQL card. */
  debugSql: z.boolean(),
  maxCharactersInDisplayedSql: z.number().int(),
  confirm: z.boolean(),
  /**
   * The lint context of the connected server: the console's input is linted like the SQL box
   * (pma: modules/console.ts lint: CodeMirror.sqlLint → /lint)
   */
  server: z.object({ versionInt: z.number().int(), isMariaDb: z.boolean(), sqlMode: z.string() }),
})
export type ConsoleConfigResponse = z.infer<typeof ConsoleConfigResponse>

/** POST /api/servers/:s/console/config (pma: /console/update-config). */
export const ConsoleConfigUpdate = z.object({
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
})
export type ConsoleConfigUpdate = z.input<typeof ConsoleConfigUpdate>
