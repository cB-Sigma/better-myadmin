import type { Executed, Field, GridData, Profiling, StatementResult, Warning } from '@bettermyadmin/contracts'
import { type Translator, englishTranslator, formatNumber, sprintf } from '@bettermyadmin/i18n'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import {
  type Context,
  Expression,
  type Limit,
  type SelectStatement,
  type StatementInfo,
  parseAnalyze,
  replaceClause,
  splitSql,
} from '@bettermyadmin/sql-lexer'
import type { AppConfig } from '../config.ts'
import { type Conn, type QueryResult, type ResultSet, USER_STATEMENT } from '../db/connection.ts'
import { toCell } from '../db/field-meta.ts'
import { MysqlError } from '../http/errors.ts'
import type { SessionData } from '../session/store.ts'
import { bindParameters, handleRollbackRequest, reloadHints, runImport } from './import.ts'
import { formatError, getMessageCard, mbLongerThan, mysqlDie } from './message.ts'
import {
  checkProfiling,
  enableProfiling,
  getDetailedProfilingStats,
  getProfilingInformation,
  isProfilingSupported,
} from './profiling.ts'
import { unreadRawCells } from './raw-cells.ts'
import { signSql } from './signature.ts'

export interface PipelineInput {
  sql: string
  db: string
  table: string
  pos: number
  maxRows: number | 'all'
  delimiter: string
  /** fk_checks posted (true/false) or not (undefined). */
  fkChecks?: boolean | undefined
  /** rollback_query */
  rollback?: boolean | undefined
  /** parameterized + parameters[] */
  params?: Readonly<Record<string, string>> | undefined
  /** Sql::$showAsPhp (null: execute) */
  showAsPhp?: boolean | undefined
  /** Profiling::check input (profiling / profiling_form). */
  profiling?: boolean | undefined
  /** Current::$messageToShow (the /sql path: e.g. "The row has been deleted."). */
  messageToShow?: string | undefined
  /** already split statements (a file import's goSql queries) instead of splitting `sql` */
  statements?: readonly string[] | undefined
  /** the /sql path (SqlController): `sql` as posted, no import buffer (no `;` appended) */
  viaSql?: boolean | undefined
  /** no table context (MultiTableQueryController: table null unless the SQL names one table) */
  noTable?: boolean | undefined
}

/** What a results-grid builder receives for a statement with a result set (Results.php). */
export interface GridHookArgs {
  set: ResultSet
  info: StatementInfo
  input: PipelineInput
  numRows: number
  unlimNumRows: number
  queryTime: number
  /** the empty-result table (isLimitedDisplay) */
  limited: boolean
}

/** Builds the grid data of a result set; may replace the header message (sorted column, view hint). */
export type GridHook = (a: GridHookArgs) => Promise<{ grid: GridData; message?: string } | null>

export interface PipelineContext {
  cfg: AppConfig
  conn: Conn
  hmacSecret: string
  executed: Executed[]
  /** The session ($_SESSION['profiling'], SessionCache). Optional for internal callers. */
  session?: SessionData
  server?: number
  /** Parser context for the connected server (keywords per version, sql_mode). */
  context?: Context
  /** Query\Cache 'ExactRows' per `db.table` for this request (Table::countRecords). */
  exactRows?: Map<string, number>
  /** The request language's catalogue (messages are phpMyAdmin's msgids); English when absent. */
  tr?: Translator
  /** Results grid builder (src/browse/grid.ts); absent: no grid metadata. */
  grid?: GridHook
}

const english = englishTranslator()

export interface SqlBoxResult {
  statements: StatementResult[]
  /** ImportController ajax_reload (only sent on the goSql path). */
  ajaxReload?: { reload?: boolean; tableName?: string }
  /** ResponseRenderer::$reload → `reloadNavigation` in the AJAX response. */
  reloadNavigation: boolean
  /** Current::$database / Current::$table at the end of the request (reloadQuerywindow, params). */
  db: string
  table: string
  /** Current::$sqlQuery at the end (history, reloadQuerywindow.sql_query). */
  sqlQuery: string
  /** A transaction was left open for "Rollback when finished": discard the connection. */
  discardConnection: boolean
  /**
   * The request reached ImportController's bookmark step (`bkm_label`): the goSql loop ran to the end
   * (no mysqlDie exit) or import mode finished with a result.
   */
  bookmarkable?: boolean
}

/** Per-request state shared by the statements of one run (phpMyAdmin's static/session state). */
export interface RunState {
  showAsPhp: boolean | null
  rollback: boolean
  /** ResponseRenderer::$reload */
  reload: boolean
  /** Sql::$queryTime survives from one statement to the next (it is an instance property). */
  queryTime: number
  /**
   * phpMyAdmin exits after an error and its connection closes, dropping session settings it changed
   * (FOREIGN_KEY_CHECKS) and open transactions; a pooled connection in that state is discarded.
   */
  discard: boolean
}

const emptySession = (): SessionData => ({
  id: '',
  createdAt: 0,
  lastSeenAt: 0,
  csrfToken: '',
  hmacSecret: '',
  currentServer: 1,
  servers: {},
})

/**
 * The SQL tab path (POST /import with sql_query): bind parameters, rollback pre-check, reload hints,
 * split by the delimiter (ImportSql/BufferedQuery), then either the goSql path (each statement through
 * Sql::executeQueryAndGetQueryResponse) or, from 50 statements on, import mode.
 *
 * pma: src/Controllers/Import/ImportController.php::__invoke, src/Import/Import.php::runQuery
 */
export async function runSqlBox(input: PipelineInput, ctx: PipelineContext): Promise<SqlBoxResult> {
  const { conn, cfg } = ctx
  if (conn.serverInfo !== null) ctx.context = conn.serverInfo.context
  ctx.session ??= emptySession()
  ctx.server ??= 1
  const session = ctx.session
  const server = ctx.server
  const ctxOpt = ctx.context !== undefined ? { context: ctx.context } : {}
  ctx.tr ??= english
  const tr = ctx.tr

  // ProfilingChecking middleware
  await checkProfiling(input.profiling, conn, session, server)

  const state: RunState = {
    showAsPhp: input.showAsPhp ?? null,
    rollback: input.rollback === true,
    reload: false,
    queryTime: 0,
    discard: false,
  }
  let db = input.db
  let table = input.table
  let sql = input.sql
  const noBackslashEscapes = /\bNO_BACKSLASH_ESCAPES\b/i.test(conn.serverInfo?.sqlMode ?? '')

  // apply values for parameters
  if (input.params !== undefined) {
    sql = bindParameters(sql, input.params, (v) => quoteString(v, { noBackslashEscapes }))
  }

  // If there is a request to ROLLBACK when finished.
  let discardConnection = false
  if (state.rollback) {
    const refused = await handleRollbackRequest(conn, sql, input.delimiter, db, ctx.context, tr)
    if (refused !== null) {
      // Message::rawError + callExit: only the message
      return {
        statements: [rawErrorStatement(sql, refused, ctx, db)],
        reloadNavigation: false,
        db,
        table,
        // callExit happens before Current::$sqlQuery is reset
        sqlQuery: sql,
        discardConnection: false,
      }
    }
    discardConnection = true
  }

  const hints = reloadHints(sql)
  state.reload = hints.reloadNavigation

  if (db !== '') await conn.query(`USE ${backquote(db)}`, 'query.select-db')

  // ImportSql::doImport, wrapped in ForeignKey::handleDisableCheckInit/Cleanup
  const fkDefault = (await getVariable(conn, 'FOREIGN_KEY_CHECKS')) === 'ON'
  let run: Awaited<ReturnType<typeof runImport>>
  try {
    if (input.fkChecks !== undefined)
      await setVariable(conn, 'FOREIGN_KEY_CHECKS', input.fkChecks ? 'ON' : 'OFF')
    run =
      input.viaSql === true
        ? // SqlController: the posted sql_query is the one query (no ImportSql buffer)
          { goSql: true, queriesToBeExecuted: [sql], sqlQuery: sql, importMode: null }
        : await runImport(input.statements ?? splitSql(sql, { delimiter: input.delimiter }), {
            conn,
            runQuery: state.showAsPhp === null,
            db,
            ignoreMultiSubmitErrors: cfg.IgnoreMultiSubmitErrors,
            tr,
          })
  } finally {
    await setVariable(conn, 'FOREIGN_KEY_CHECKS', fkDefault ? 'ON' : 'OFF')
  }
  const goSql = run.goSql || state.showAsPhp !== null
  let sqlQuery = run.sqlQuery
  if (run.importMode !== null) {
    db = run.importMode.db
    if (run.importMode.reloadNavigation) state.reload = true
  }

  // Parse and analyze the query, for correct db and table name (skipped when too large)
  if (!mbLongerThan(sqlQuery, cfg.MaxCharactersInDisplayedSQL)) {
    const [, d, tableFromSql, reloadNeeded] = parseAnalyze(sqlQuery, db, true, ctxOpt)
    db = d
    state.reload = reloadNeeded
    if (tableFromSql !== '') table = tableFromSql
  }

  const base = { reloadNavigation: false, discardConnection }

  // Import mode errors: the first failed query's error card
  if (run.importMode?.hasError === true) {
    const failed = run.importMode.failedQueries[0]
    if (failed !== undefined) {
      return {
        ...base,
        statements: [errorStatement(failed.sql, failed.sql, failed.error, null, ctx, db, undefined)],
        reloadNavigation: state.reload,
        db,
        table,
        sqlQuery,
      }
    }
  }

  if (goSql) {
    const queries = run.queriesToBeExecuted.length > 0 ? run.queriesToBeExecuted : [sqlQuery]
    const out: StatementResult[] = []
    for (const q of queries) {
      sqlQuery = q
      const [info, d, tableFromSql] = parseAnalyze(q, db, true, ctxOpt)
      db = d
      // Check if User is allowed to issue a 'DROP DATABASE' Statement
      if (!cfg.AllowUserDropDatabase && info.flags.dropDatabase && !(await isSuperUser(conn))) {
        return {
          ...base,
          statements: [
            errorStatement(
              q,
              q,
              tr.gettext('"DROP DATABASE" statements are disabled.'),
              null,
              ctx,
              db,
              info.flags.queryType,
            ),
          ],
          reloadNavigation: state.reload,
          db,
          table,
          sqlQuery,
        }
      }
      if (tableFromSql !== '') table = tableFromSql
      const r = await executeStatement({ ...input, sql: q, db, table }, info, state, ctx)
      // Sql::handleQueryExecuteError → Generator::mysqlDie + exit: the response is only the error card
      if (r.kind === 'error' && r.error !== undefined) {
        return {
          ...base,
          statements: [r],
          reloadNavigation: state.reload,
          db,
          table,
          sqlQuery,
          discardConnection: base.discardConnection || state.discard,
        }
      }
      out.push(r)
    }
    return {
      ...base,
      statements: out,
      ajaxReload: hints.ajaxReload,
      reloadNavigation: state.reload,
      db,
      table,
      sqlQuery,
      bookmarkable: true,
    }
  }

  // import mode tail
  const im = run.importMode!
  let message = im.message
  if (state.rollback) {
    // We rollback because there might be other queries that need to be executed after this
    await conn.query('ROLLBACK', 'rollback')
    message += tr.gettext('[ROLLBACK occurred.]')
    base.discardConnection = false
  }
  const st: StatementResult = {
    sql: input.sql,
    executedSql: input.sql,
    sig: signSql(sqlQuery, ctx.hmacSecret, cfg.blowfish_secret),
    kind: im.result ? 'import' : 'error',
    queryType: null,
    message: { type: im.result ? 'success' : 'error', text: message },
    queryTime: 0,
    warnings: [],
    db: db === '' ? null : db,
    reload: state.reload,
  }
  if (im.result) {
    st.card = await getMessageCard(sqlQuery, {
      cfg,
      showAsPhp: null,
      db,
      table,
      profilingOn: session.profiling === true,
      profilingSupported: () => isProfilingSupported(conn, session, server),
    })
  }
  return {
    ...base,
    statements: [st],
    reloadNavigation: state.reload,
    db,
    table,
    sqlQuery,
    bookmarkable: im.result,
  }
}

/** A plain error message (Message::rawError), no error card. */
function rawErrorStatement(sql: string, text: string, ctx: PipelineContext, db: string): StatementResult {
  return {
    sql,
    executedSql: sql,
    sig: signSql(sql, ctx.hmacSecret, ctx.cfg.blowfish_secret),
    kind: 'error',
    queryType: null,
    message: { type: 'error', text },
    queryTime: 0,
    warnings: [],
    db: db === '' ? null : db,
    reload: false,
  }
}

/** Generator::mysqlDie(serverMessage, sql) as a statement result. */
function errorStatement(
  sql: string,
  shownSql: string,
  serverMessage: string,
  errno: number | null,
  ctx: PipelineContext,
  db: string,
  queryType: string | null | undefined,
  hint: ReturnType<typeof formatError>['hint'] = null,
): StatementResult {
  return {
    sql,
    executedSql: shownSql,
    sig: signSql(sql, ctx.hmacSecret, ctx.cfg.blowfish_secret),
    kind: 'error',
    queryType: queryType ?? null,
    message: { type: 'error', text: serverMessage, ...(errno !== null ? { errno } : {}) },
    error: mysqlDie(serverMessage, shownSql, ctx.cfg, ctx.context, hint),
    queryTime: 0,
    warnings: [],
    db: db === '' ? null : db,
    reload: false,
  }
}

/** Sql::isAppendLimitClause */
export function isAppendLimitClause(info: StatementInfo, maxRows: number | 'all'): boolean {
  return (
    info.parser.errors.length === 0 &&
    maxRows !== 'all' &&
    !info.flags.isExport &&
    !info.flags.isAnalyse &&
    (info.flags.selectFrom || info.flags.isSubQuery) &&
    !info.flags.limit
  )
}

/** Sql::isJustBrowsing */
export function isJustBrowsing(info: StatementInfo): boolean {
  const where = (info.statement as { where?: Array<{ expr: string }> | null } | null)?.where
  return (
    !info.flags.isGroup &&
    !info.flags.isFunc &&
    !info.flags.union &&
    !info.flags.distinct &&
    info.flags.selectFrom &&
    info.selectTables.length === 1 &&
    (where === null ||
      where === undefined ||
      where.length === 0 ||
      (where.length === 1 && where[0]?.expr === '1')) &&
    !info.flags.group &&
    !info.flags.isSubQuery &&
    !info.flags.join &&
    !info.flags.having
  )
}

/** Message::getMessageFor{Deleted,Affected,Inserted}Rows: sprintf(_ngettext(…), $rows) */
const rowsMessage = (tr: Translator, one: string, many: string, n: number) =>
  sprintf(tr.ngettext(one, many, n), n)

/** `Query took %01.4f seconds.)` as Results adds it after "(" */
const queryTook = (tr: Translator, queryTime: number) =>
  sprintf(`${tr.gettext('Query took %01.4f seconds.')})`, queryTime)

/**
 * One statement of the goSql path.
 * pma: src/Sql.php::executeQueryAndGetQueryResponse, ::executeTheQuery
 */
export async function executeStatement(
  input: PipelineInput,
  info: StatementInfo,
  state: RunState,
  ctx: PipelineContext,
): Promise<StatementResult> {
  const { conn, cfg } = ctx
  const tr = ctx.tr ?? english
  const session = ctx.session!
  const server = ctx.server!
  const db = input.db
  const table = input.table
  const sig = signSql(input.sql, ctx.hmacSecret, cfg.blowfish_secret)
  const base = {
    sql: input.sql,
    sig,
    queryType: info.flags.queryType ?? null,
    warnings: [] as Warning[],
    reload: false,
  }
  const card = (sqlQuery: string) =>
    getMessageCard(sqlQuery, {
      cfg,
      showAsPhp: state.showAsPhp,
      db,
      table,
      profilingOn: session.profiling === true,
      profilingSupported: () => isProfilingSupported(conn, session, server),
    })

  const appendLimit = isAppendLimitClause(info, input.maxRows)
  const fullSql =
    appendLimit && info.statement !== null && info.parser.list !== null
      ? replaceClause(info.statement, info.parser.list, `LIMIT ${input.pos}, ${input.maxRows}`)
      : input.sql

  if (db !== '') {
    // hasCurrentDbChanged + selectDb
    const current = await conn.value('SELECT DATABASE()', 'query.current-db')
    base.reload = current !== null && current !== db
    if (current !== db) {
      // DatabaseInterface::selectDb: a failure (unknown database) is not raised, the query runs
      await conn.query(`USE ${backquote(db)}`, 'query.select-db').catch((e: unknown) => {
        if (!(e instanceof MysqlError)) throw e
      })
    }
  }
  state.reload = base.reload

  // Show as PHP / SQL only: the query is not executed
  if (state.showAsPhp !== null) {
    const message = messageForNoRowsReturned(tr, info, 0, '0', 0, state)
    return {
      ...base,
      executedSql: input.sql,
      kind: 'php',
      message: {
        type: state.showAsPhp || info.flags.isAffected || info.flags.isInsert ? 'success' : 'notice',
        text: message,
      },
      queryTime: 0,
      card: await card(input.sql),
      db: db === '' ? null : db,
    }
  }

  // ForeignKey::handleDisableCheckInit
  const fkDefault = (await getVariable(conn, 'FOREIGN_KEY_CHECKS')) === 'ON'
  if (input.fkChecks !== undefined)
    await setVariable(conn, 'FOREIGN_KEY_CHECKS', input.fkChecks ? 'ON' : 'OFF')

  await enableProfiling(conn, session, server)

  let result: QueryResult | null = null
  let errorMessage = ''
  try {
    result = await conn.query(fullSql, USER_STATEMENT)
    state.queryTime = result.ms / 1000
  } catch (e) {
    if (!(e instanceof MysqlError)) {
      await setVariable(conn, 'FOREIGN_KEY_CHECKS', fkDefault ? 'ON' : 'OFF')
      throw e
    }
    const formatted = formatError(e.extra.errno ?? 0, e.message, tr)
    if (!cfg.IgnoreMultiSubmitErrors) {
      // Generator::mysqlDie + exit (FOREIGN_KEY_CHECKS stays as set: the connection is discarded)
      if ((await getVariable(conn, 'FOREIGN_KEY_CHECKS')) !== (fkDefault ? 'ON' : 'OFF')) state.discard = true
      return errorStatement(
        input.sql,
        fullSql,
        formatted.text,
        e.extra.errno ?? null,
        ctx,
        db,
        info.flags.queryType,
        formatted.hint,
      )
    }
    errorMessage = formatted.text
  }
  const queryTime = state.queryTime

  const sets = result?.resultSets ?? []
  const set = sets[0]
  const numRows = info.flags.isAffected
    ? (result?.header?.affectedRows ?? 0)
    : result !== null
      ? (set?.rows.length ?? 0)
      : 0

  // mysqli keeps a CALL's further result sets pending: SHOW PROFILE / SHOW WARNINGS fail client-side
  // ("Commands out of sync") and never reach the server until they are consumed by the results display
  const pending = info.flags.isProcedure && sets.length > 0
  const profilingRows = pending ? [] : await getProfilingInformation(conn, session, server)

  const unlimNumRows =
    result === null
      ? 0
      : await countQueryResults(numRows, isJustBrowsing(info), db, table, info, input, appendLimit, ctx)

  // DatabaseInterface::getWarnings runs after every executed statement
  const warnings: Warning[] = (pending ? [] : await conn.rows('SHOW WARNINGS', 'query.warnings')).map(
    (w) => ({
      level: w.Level ?? '',
      code: Number(w.Code ?? 0),
      message: w.Message ?? '',
    }),
  )

  const profiling: Profiling | null = getDetailedProfilingStats(profilingRows, tr)
  const noResults = (numRows === 0 && unlimNumRows === 0) || info.flags.isAffected || result === null
  let r: StatementResult
  if (noResults) {
    // insertId() is SELECT LAST_INSERT_ID() (mysqli_insert_id is unreliable for BIGINT keys)
    const insertId =
      errorMessage === '' && info.flags.isInsert
        ? ((await conn.value('SELECT LAST_INSERT_ID();', 'query.insert-id')) ?? '0')
        : '0'
    const message =
      errorMessage !== ''
        ? { type: 'error' as const, text: errorMessage }
        : {
            type: 'success' as const,
            text: messageForNoRowsReturned(
              tr,
              info,
              numRows,
              insertId,
              queryTime,
              state,
              input.messageToShow ?? '',
            ),
          }
    const hasColumns = set !== undefined && set.fields.length > 0
    if (hasColumns && db !== '' && table !== '' && info.flags.queryType === 'SELECT') {
      // the empty results table still runs Results::setDisplayPartsAndTotal → countRecords()
      await countRecords(ctx, db, table, false)
    }
    r = {
      ...base,
      warnings,
      executedSql: fullSql,
      kind: errorMessage !== '' ? 'error' : hasColumns ? 'empty' : 'affected',
      message,
      queryTime,
      card: await card(input.sql),
      db: db === '' ? null : db,
    }
    if (info.flags.isAffected && errorMessage === '') r.affectedRows = numRows
    if (insertId !== '0') r.insertId = insertId
    if (set !== undefined && hasColumns) {
      r.result = toResult(set, numRows, unlimNumRows, input, appendLimit)
      if (ctx.grid !== undefined && errorMessage === '' && !info.flags.isAffected) {
        const g = await ctx.grid({ set, info, input, numRows, unlimNumRows, queryTime, limited: true })
        if (g !== null) {
          r.grid = g.grid
          // sql/no_results_returned.twig: "Query results operations" with Create view only
          if (!info.flags.isProcedure) {
            r.grid.operations = { print: false, procedure: false, export: null, gis: false }
          }
        }
      }
    }
    if (info.flags.isProcedure) {
      const more = procedureResults(tr, sets, info, input, queryTime)
      if (more.length > 0) r.moreResults = more
    }
  } else {
    const text = info.flags.isProcedure
      ? procedureMessage(tr, numRows, input, queryTime)
      : resultsMessage(tr, info, unlimNumRows, numRows, input, queryTime)
    r = {
      ...base,
      warnings,
      executedSql: fullSql,
      kind: 'resultset',
      message: { type: 'success', text },
      queryTime,
      card: await card(input.sql),
      db: db === '' ? null : db,
    }
    if (set !== undefined) {
      const g =
        ctx.grid !== undefined
          ? await ctx.grid({ set, info, input, numRows, unlimNumRows, queryTime, limited: false })
          : null
      // the cells the grid editor never reads are not encoded (a page of large TEXT / BLOB values)
      r.result = toResult(
        set,
        numRows,
        unlimNumRows,
        input,
        appendLimit,
        g === null ? null : unreadRawCells(g.grid),
      )
      if (g !== null) {
        r.grid = g.grid
        if (g.message !== undefined) r.message.text = g.message
      }
    }
    if (info.flags.isProcedure) {
      const more = procedureResults(tr, sets.slice(1), info, input, queryTime)
      if (more.length > 0) r.moreResults = more
    }
  }
  if (profiling !== null) r.profiling = profiling

  // ForeignKey::handleDisableCheckCleanup
  await setVariable(conn, 'FOREIGN_KEY_CHECKS', fkDefault ? 'ON' : 'OFF')
  return r
}

function toResult(
  set: ResultSet,
  numRows: number,
  unlimNumRows: number,
  input: PipelineInput,
  appendLimit: boolean,
  unread: boolean[][] | null = null,
): NonNullable<StatementResult['result']> {
  return {
    fields: set.fields as Field[],
    rows: set.rows.map((row, r) =>
      row.map((v, i) => (unread?.[r]?.[i] === true ? null : toCell(v, set.fields[i]!))),
    ),
    numRows,
    totalRows: unlimNumRows,
    approximate: false,
    pos: input.pos,
    maxRows: input.maxRows,
    limitAppended: appendLimit,
  }
}

/** Sql::getHtmlForStoredProcedureResults: every non-empty result set gets its own table and message. */
function procedureResults(
  tr: Translator,
  sets: readonly ResultSet[],
  _info: StatementInfo,
  input: PipelineInput,
  queryTime: number,
): NonNullable<StatementResult['moreResults']> {
  return sets
    .filter((s) => s.rows.length > 0)
    .map((s) => ({
      fields: s.fields as Field[],
      rows: s.rows.map((row) => row.map((v, i) => toCell(v, s.fields[i]!))),
      numRows: s.rows.length,
      message: procedureMessage(tr, s.rows.length, input, queryTime),
    }))
}

/** Results::setMessageInformation for a CALL result set (setProperties(numRows, …, numRows)). */
function procedureMessage(tr: Translator, numRows: number, input: PipelineInput, queryTime: number): string {
  const posNext = input.maxRows === 'all' ? 0 : input.pos + input.maxRows
  const first = input.pos
  const last = input.maxRows === 'all' || posNext > numRows ? first + numRows - 1 : posNext - 1
  const totalText = sprintf(tr.gettext('%s total'), formatNumber(tr, numRows, 0))
  return `${sprintf(tr.gettext('Showing rows %1s - %2s'), first, last)} (${totalText}, ${queryTook(tr, queryTime)}`
}

/** Sql::countQueryResults */
export async function countQueryResults(
  numRows: number,
  justBrowsing: boolean,
  db: string,
  table: string,
  info: StatementInfo,
  input: PipelineInput,
  appendLimit: boolean,
  ctx: PipelineContext,
): Promise<number> {
  if (info.statement === null) return 0
  if (!appendLimit) return numRows
  if (input.maxRows !== 'all' && input.maxRows > numRows) return input.pos + numRows
  if (info.flags.queryType !== 'SELECT' && !info.flags.isSubQuery) return 0
  if (justBrowsing) {
    const approx = await countRecords(ctx, db, table, false)
    return approx < ctx.cfg.MaxExactCount ? countRecords(ctx, db, table, true) : approx
  }
  const original = info.statement as SelectStatement
  // PHP `clone`: shallow copy keeping the prototype
  const st = Object.assign(Object.create(Object.getPrototypeOf(original)), original) as SelectStatement
  const options = st.options as { options: Record<string, unknown> } | null
  if (options !== null) {
    const key = Object.keys(options.options).find((k) => {
      const v = options.options[k]
      return typeof v === 'string' && v.toUpperCase() === 'SQL_NO_CACHE'
    })
    if (key !== undefined) {
      const copy = Object.assign(Object.create(Object.getPrototypeOf(options)), options) as typeof options
      copy.options = { ...options.options }
      delete copy.options[key]
      st.options = copy as unknown as SelectStatement['options']
    }
  }
  st.order = null as unknown as SelectStatement['order']
  st.limit = null as unknown as Limit
  if (!info.flags.isGroup && !info.flags.distinct && !info.flags.union) {
    const one = new Expression()
    one.expr = '1'
    st.expr = [one]
  }
  const countQuery = `SELECT COUNT(*) FROM (${st.build()} ) as cnt`
  return Number((await ctx.conn.value(countQuery, 'query.count')) ?? 0)
}

/**
 * Table::countRecords. The approximate count reads information_schema (a read-only difference from
 * phpMyAdmin's getTablesFull query, same value).
 */
export async function countRecords(
  ctx: PipelineContext,
  db: string,
  table: string,
  forceExact: boolean,
): Promise<number> {
  const { conn, cfg } = ctx
  ctx.exactRows ??= new Map()
  const cacheKey = `${db}\u0000${table}`
  const cached = ctx.exactRows.get(cacheKey)
  if (cached !== undefined) return cached
  const rows = await conn.rows(
    `SELECT TABLE_TYPE, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quoteString(db)} AND TABLE_NAME = ${quoteString(table)}`,
    'table.status',
  )
  const status = rows[0]
  const isView =
    status?.TABLE_TYPE === 'VIEW' || status?.TABLE_TYPE === 'SYSTEM VIEW' || db === 'information_schema'
  if (!forceExact && !isView && status?.TABLE_ROWS !== null && status?.TABLE_ROWS !== undefined) {
    const approx = Number(status.TABLE_ROWS)
    if (approx >= cfg.MaxExactCount) return approx
  }
  if (!isView) {
    const exact = Number(
      (await conn.value(`SELECT COUNT(*) FROM ${backquote(db)}.${backquote(table)}`, 'table.count')) ?? 0,
    )
    ctx.exactRows.set(cacheKey, exact)
    return exact
  }
  if (cfg.MaxExactCountViews === 0) return -1
  try {
    const r = await conn.query(
      `SELECT 1 FROM ${backquote(db)}.${backquote(table)} LIMIT ${cfg.MaxExactCountViews}`,
      'view.count',
    )
    const n = r.resultSets[0]?.rows.length ?? 0
    if (n === cfg.MaxExactCountViews) return -1
    ctx.exactRows.set(cacheKey, n)
    return n
  } catch {
    return -1
  }
}

/** Sql::getMessageForNoRowsReturned (the SQL-tab path passes an empty message_to_show) */
function messageForNoRowsReturned(
  tr: Translator,
  info: StatementInfo,
  numRows: number,
  insertId: string,
  queryTime: number,
  state: Pick<RunState, 'showAsPhp' | 'rollback'>,
  messageToShow = '',
): string {
  let msg: string
  if (info.flags.queryType === 'DELETE') {
    msg = rowsMessage(tr, '%1$d row deleted.', '%1$d rows deleted.', numRows)
  } else if (info.flags.isInsert) {
    msg =
      info.flags.queryType === 'REPLACE'
        ? rowsMessage(tr, '%1$d row affected.', '%1$d rows affected.', numRows)
        : rowsMessage(tr, '%1$d row inserted.', '%1$d rows inserted.', numRows)
    if (insertId !== '0') {
      // insert_id is the id of the FIRST inserted row
      msg += `\n${sprintf(tr.gettext('Inserted row id: %1$d'), (BigInt(insertId) + BigInt(numRows) - 1n).toString())}`
    }
  } else if (info.flags.isAffected) {
    msg = rowsMessage(tr, '%1$d row affected.', '%1$d rows affected.', numRows)
  } else if (messageToShow !== '' && info.flags.queryType !== 'SELECT') {
    msg = messageToShow
  } else if (state.showAsPhp === true) {
    // i18n-new: "Showing as PHP code" as JavaScript (parity exception X57)
    msg = tr.gettext('Showing as JS code')
  } else if (state.showAsPhp === false) {
    // User disable showing as code, query is only displayed
    msg = tr.gettext('Showing SQL query')
  } else {
    msg = tr.gettext('MySQL returned an empty result set (i.e. zero rows).')
  }
  if (queryTime > 0) msg += ` ${sprintf(`(${tr.gettext('Query took %01.4f seconds.')})`, queryTime)}`
  // In case of ROLLBACK, notify the user.
  if (state.rollback) msg += ` ${tr.gettext('[ROLLBACK occurred.]')}`
  return msg
}

/** Results::setMessageInformation, for result sets with a navigation bar. */
export function resultsMessage(
  tr: Translator,
  info: StatementInfo,
  unlimNumRows: number,
  numRows: number,
  input: PipelineInput,
  queryTime: number,
): string {
  const f = info.flags
  // SHOW / EXPLAIN / maintenance / COUNT results have no navigation bar → just "(Query took …)"
  // setDisplayPartsAndTotal: COUNT queries returning several rows (GROUP BY) get the navigation bar back
  const nonData =
    (f.isCount && numRows <= 1) ||
    f.isAnalyse ||
    f.isMaint ||
    f.queryType === 'EXPLAIN' ||
    f.queryType === 'SHOW'
  // the bare Message::success() card, "(Query took …)" only when the time is positive
  if (nonData) {
    const done = tr.gettext('Your SQL query has been executed successfully.')
    return queryTime > 0 ? `${done} (${queryTook(tr, queryTime)}` : done
  }
  const total = unlimNumRows > 0 ? unlimNumRows : 0
  const statementLimit = (info.statement as { limit?: { offset: unknown; rowCount: unknown } | null } | null)
    ?.limit
  let first: number
  let last: number
  const posNext = input.maxRows === 'all' ? 0 : input.pos + input.maxRows
  if (statementLimit !== null && statementLimit !== undefined) {
    first = Number(statementLimit.offset)
    const rowCount = Number(statementLimit.rowCount)
    last = rowCount < total ? first + rowCount - 1 : first + total - 1
  } else if (input.maxRows === 'all' || posNext > total) {
    first = input.pos
    last = first + numRows - 1
  } else {
    first = input.pos
    last = posNext - 1
  }
  const totalText = sprintf(tr.gettext('%s total'), formatNumber(tr, total, 0))
  return `${sprintf(tr.gettext('Showing rows %1s - %2s'), first, last)} (${totalText}, ${queryTook(tr, queryTime)}`
}

/** DatabaseInterface::getVariable (session) */
export async function getVariable(conn: Conn, name: string): Promise<string> {
  return (await conn.rows(`SHOW SESSION VARIABLES LIKE '${name}';`, 'var.get'))[0]?.Value ?? ''
}

/** DatabaseInterface::setVariable: SET only when the value differs. */
export async function setVariable(conn: Conn, name: string, value: string): Promise<void> {
  const current = await getVariable(conn, name)
  if (current === value) return
  await conn.query(`SET ${name} = ${value};`, 'var.set')
}

export async function isSuperUser(conn: Conn): Promise<boolean> {
  try {
    return (await conn.value('SELECT 1 FROM mysql.user LIMIT 1', 'priv.superuser')) !== null
  } catch {
    return false
  }
}
