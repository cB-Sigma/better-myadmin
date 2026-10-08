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
  /**
   * Signature of `sql` when it came from a URL (Core::checkSqlQuerySignature). When present it must
   * verify, otherwise the query is refused like phpMyAdmin ignores an unsigned GET sql_query.
   */
  sig: z.string().optional(),
  /** fk_checks: omitted = not posted (FOREIGN_KEY_CHECKS left alone). */
  fkChecks: z.boolean().optional(),
  /**
   * Profiling (Profiling::check): true = `profiling` posted (turns the session flag on),
   * false = `profiling_form` posted without `profiling` (turns it off), omitted = unchanged.
   */
  profiling: z.boolean().optional(),
  /** rollback_query: "Rollback when finished". */
  rollback: z.boolean().optional(),
  /** `parameterized` + `parameters[:name]`: "Bind parameters". Keys include the colon. */
  params: z.record(z.string()).optional(),
  /** show_as_php: true = "Create PHP code", false = show the SQL only; neither executes the query. */
  showAsPhp: z.boolean().optional(),
  /** Client-chosen id so POST /query/cancel can KILL QUERY this request's connection. */
  queryId: z.string().max(64).optional(),
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

/**
 * resultset: rows to show; affected/empty: the no-results card (empty = a result with columns but no
 * rows); error: mysqlDie card (or a raw error message); php: Show as PHP / SQL only (not executed);
 * import: the >= 50 statements "import mode" summary with its commented transcript.
 */
export const StatementKind = z.enum(['resultset', 'affected', 'error', 'empty', 'php', 'import'])

export const MessageType = z.enum(['success', 'notice', 'error'])

export const Warning = z.object({ level: z.string(), code: z.number().int(), message: z.string() })
export type Warning = z.infer<typeof Warning>

export const Executed = z.object({ sql: z.string(), ms: z.number(), label: z.string().optional() })
export type Executed = z.infer<typeof Executed>

/** The action links under the executed SQL (Generator::getMessage), in display order. */
export const SqlLinks = z.object({
  /** "Edit inline" */
  editInline: z.boolean(),
  /** "Edit": the SQL tab of the current scope with the query prefilled. */
  edit: z.boolean(),
  /** "Explain SQL" / "Skip Explain SQL" / "Skip Analyze SQL" (msgids, translated by the UI) and the query each one runs. */
  explain: z
    .object({ text: z.enum(['Explain SQL', 'Skip Explain SQL', 'Skip Analyze SQL']), sql: z.string() })
    .nullable(),
  /** create = "Create PHP code"; without = "Without PHP code" + "Submit query" (both re-run the SQL). */
  php: z.enum(['create', 'without']).nullable(),
  /** "Refresh": re-executes through the browse path. */
  refresh: z.boolean(),
  /** The Profiling switch next to Refresh (only when @@have_profiling). */
  profiling: z.object({ checked: z.boolean() }).nullable(),
})
export type SqlLinks = z.infer<typeof SqlLinks>

/** The card with the SQL; null when Generator::getMessage renders only the message. */
export const SqlCard = z.object({
  /** The query as given to getMessage (what the links act on). */
  sql: z.string(),
  /** What the card shows: the SQL truncated to MaxCharactersInDisplayedSQL + "[...]", or the PHP code. */
  display: z.string(),
  php: z.boolean(),
  links: SqlLinks,
  /** Scope of the Edit links (Current::$database / Current::$table). */
  db: z.string(),
  table: z.string(),
})
export type SqlCard = z.infer<typeof SqlCard>

/** Generator::mysqlDie */
export const MysqlDie = z.object({
  /** Lexer/parser errors of the failed SQL ("Static analysis:"). */
  staticAnalysis: z.array(z.object({ message: z.string(), token: z.string(), position: z.number().int() })),
  /** The SQL under "SQL query:"; null when hidden (empty, or contains `connect`). */
  sql: z.string().nullable(),
  /** The SQL is shown unformatted (escaped) when static analysis found errors, else truncated. */
  sqlTruncated: z.boolean(),
  /** MySQL documentation icon for SELECT (the SQL contains `select`). */
  selectDoc: z.boolean(),
  /** "MySQL said:" text: Utilities::formatError output (`#errno - message[ — hint]`), blank lines collapsed. */
  serverMessage: z.string(),
  /** Link appended by formatError (1698: logout, 1005: InnoDB status). */
  hint: z.object({ kind: z.enum(['logout', 'innodb-status']), text: z.string() }).nullable(),
})
export type MysqlDie = z.infer<typeof MysqlDie>

const ProfilingRow = z.object({ status: z.string(), duration: z.string(), durationRaw: z.string() })
const ProfilingState = z.object({
  state: z.string(),
  totalTime: z.string(),
  totalTimeRaw: z.number(),
  percent: z.string(),
  calls: z.number().int(),
  average: z.string(),
  averageRaw: z.string(),
})
/** Sql::getDetailedProfilingStats, formatted like sql/profiling_chart.twig. */
export const Profiling = z.object({
  totalTime: z.number(),
  profile: z.array(ProfilingRow),
  states: z.array(ProfilingState),
  chart: z.object({ labels: z.array(z.string()), data: z.array(z.number()) }),
})
export type Profiling = z.infer<typeof Profiling>

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
  /** CALL: every non-empty result set after the first (Sql::getHtmlForStoredProcedureResults). */
  moreResults: z
    .array(
      z.object({
        fields: z.array(Field),
        rows: z.array(z.array(Cell)),
        numRows: z.number().int(),
        message: z.string(),
      }),
    )
    .optional(),
  /** The executed-SQL card (null: message only). */
  card: SqlCard.nullable().optional(),
  error: MysqlDie.optional(),
  profiling: Profiling.optional(),
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
  /** ImportController ajax_reload: DROP/CREATE/ALTER → reload navigation, RENAME TABLE → table_name. */
  ajaxReload: z.object({ reload: z.boolean().optional(), tableName: z.string().optional() }).optional(),
  /** ResponseRenderer::$reload → `reloadNavigation` of the AJAX response. */
  reloadNavigation: z.boolean().default(false),
  /** reloadQuerywindow.sql_query: Current::$sqlQuery when shorter than MaxCharactersInDisplayedSQL. */
  sqlQuery: z.string().default(''),
})
export type QueryResponse = z.infer<typeof QueryResponse>
