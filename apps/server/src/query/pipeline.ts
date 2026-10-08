import type { Executed, StatementResult, Warning } from '@bettermyadmin/contracts'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import {
  type Context,
  Expression,
  type Limit,
  type SelectStatement,
  type StatementInfo,
  parseAnalyze,
  replaceClause,
  splitSqlQueriesToExecute,
} from '@bettermyadmin/sql-lexer'
import type { AppConfig } from '../config.ts'
import type { Conn, QueryResult } from '../db/connection.ts'
import { toCell } from '../db/field-meta.ts'
import { MysqlError } from '../http/errors.ts'
import { signSql } from './signature.ts'

export interface PipelineInput {
  sql: string
  db: string
  table: string
  pos: number
  maxRows: number | 'all'
  delimiter: string
  fkChecks?: boolean | undefined
}

export interface PipelineContext {
  cfg: AppConfig
  conn: Conn
  hmacSecret: string
  executed: Executed[]
  /** Parser context for the connected server (keywords per version, sql_mode). */
  context?: Context
  /** Query\Cache 'ExactRows' per `db.table` for this request (Table::countRecords). */
  exactRows?: Map<string, number>
}

/**
 * The SQL tab path: split by the delimiter (ImportSql/BufferedQuery), then run each statement through
 * Sql::executeQueryAndGetQueryResponse, stopping at the first error unless IgnoreMultiSubmitErrors.
 *
 * pma: src/Controllers/Import/ImportController.php (goSql branch), src/Import/Import.php::runQuery
 */
export async function runSqlBox(input: PipelineInput, ctx: PipelineContext): Promise<StatementResult[]> {
  const queries = splitSqlQueriesToExecute(input.sql, { delimiter: input.delimiter })
  if (ctx.conn.serverInfo !== null) ctx.context = ctx.conn.serverInfo.context
  if (queries.length === 0) return []
  const out: StatementResult[] = []
  let db = input.db
  let table = input.table
  for (const sql of queries) {
    const r = await executeStatement({ ...input, sql, db, table }, ctx)
    // Sql::handleQueryExecuteError → Generator::mysqlDie + exit: the response is only the error card
    if (r.kind === 'error' && !ctx.cfg.IgnoreMultiSubmitErrors) return [r]
    out.push(r)
    if (r.db !== null) db = r.db
    table = ''
  }
  return out
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

const ngettext = (one: string, many: string, n: number) => (n === 1 ? one : many).replace('%1$d', String(n))

/** PHP sprintf('%01.4f') */
const fmtTime = (seconds: number) => seconds.toFixed(4)

/**
 * Util::formatNumber($value, 0) for row totals: digitsLeft 0 → number_format with "," thousands.
 */
export function formatCount(n: number): string {
  if (n === 0) return '0'
  return Math.round(n).toLocaleString('en-US')
}

async function executeStatement(input: PipelineInput, ctx: PipelineContext): Promise<StatementResult> {
  const { conn, cfg } = ctx
  const [info, dbAfterParse, tableAfterParse] = parseAnalyze(
    input.sql,
    input.db,
    true,
    ctx.context !== undefined ? { context: ctx.context } : {},
  )
  const db = dbAfterParse
  const table = tableAfterParse !== '' ? tableAfterParse : input.table
  const sig = signSql(input.sql, ctx.hmacSecret, cfg.blowfish_secret)
  const base = {
    sql: input.sql,
    sig,
    queryType: info.flags.queryType ?? null,
    warnings: [] as Warning[],
    reload: false,
  }

  // "DROP DATABASE" statements are disabled. (Sql::hasNoRightsToDropDatabase)
  if (!cfg.AllowUserDropDatabase && info.flags.dropDatabase && !(await isSuperUser(conn))) {
    return {
      ...base,
      executedSql: input.sql,
      kind: 'error',
      message: { type: 'error', text: '"DROP DATABASE" statements are disabled.' },
      queryTime: 0,
      db: db === '' ? null : db,
    }
  }

  if (db !== '') {
    // hasCurrentDbChanged + selectDb
    const current = await conn.value('SELECT DATABASE()', 'query.current-db')
    base.reload = current !== null && current !== db
    if (current !== db) await conn.query(`USE ${backquote(db)}`, 'query.select-db')
  }

  const appendLimit = isAppendLimitClause(info, input.maxRows)
  const fullSql =
    appendLimit && info.statement !== null && info.parser.list !== null
      ? replaceClause(info.statement, info.parser.list, `LIMIT ${input.pos}, ${input.maxRows}`)
      : input.sql

  // ForeignKey::handleDisableCheckInit
  const fkDefault =
    (await conn.rows("SHOW SESSION VARIABLES LIKE 'FOREIGN_KEY_CHECKS';", 'fk.get'))[0]?.Value === 'ON'
  if (input.fkChecks !== undefined)
    await setVariable(conn, 'FOREIGN_KEY_CHECKS', input.fkChecks ? 'ON' : 'OFF')

  let result: QueryResult
  try {
    result = await conn.query(fullSql, 'query.user')
  } catch (e) {
    await setVariable(conn, 'FOREIGN_KEY_CHECKS', fkDefault ? 'ON' : 'OFF')
    if (e instanceof MysqlError) {
      return {
        ...base,
        executedSql: fullSql,
        kind: 'error',
        message: {
          type: 'error',
          text: `#${e.extra.errno ?? 0} - ${e.message}`,
          ...(e.extra.errno !== undefined ? { errno: e.extra.errno } : {}),
        },
        queryTime: 0,
        db: db === '' ? null : db,
      }
    }
    throw e
  }
  const queryTime = result.ms / 1000

  const set = result.resultSets[0]
  const numRows = info.flags.isAffected ? (result.header?.affectedRows ?? 0) : (set?.rows.length ?? 0)

  const unlimNumRows = await countQueryResults(
    numRows,
    isJustBrowsing(info),
    db,
    table,
    info,
    input,
    appendLimit,
    ctx,
  )

  // DatabaseInterface::getWarnings runs after every executed statement
  const warnings: Warning[] = (await conn.rows('SHOW WARNINGS', 'query.warnings')).map((w) => ({
    level: w.Level ?? '',
    code: Number(w.Code ?? 0),
    message: w.Message ?? '',
  }))

  await setVariable(conn, 'FOREIGN_KEY_CHECKS', fkDefault ? 'ON' : 'OFF')

  const noResults = (numRows === 0 && unlimNumRows === 0) || info.flags.isAffected || set === undefined
  // insertId() is SELECT LAST_INSERT_ID() (mysqli_insert_id is unreliable for BIGINT keys)
  const insertId =
    noResults && info.flags.isInsert
      ? ((await conn.value('SELECT LAST_INSERT_ID();', 'query.insert-id')) ?? '0')
      : '0'
  if (
    noResults &&
    set !== undefined &&
    set.fields.length > 0 &&
    db !== '' &&
    table !== '' &&
    info.flags.queryType === 'SELECT'
  ) {
    // the empty results table still runs Results::setDisplayPartsAndTotal → countRecords()
    await countRecords(ctx, db, table, false)
  }
  const r: StatementResult = {
    ...base,
    warnings,
    executedSql: fullSql,
    kind: noResults ? (set !== undefined && set.fields.length > 0 ? 'empty' : 'affected') : 'resultset',
    message: noResults
      ? { type: 'success', text: messageForNoRowsReturned(info, numRows, insertId, queryTime) }
      : {
          type: 'success',
          text: resultsMessage(info, unlimNumRows, numRows, input, queryTime),
        },
    queryTime,
    db: db === '' ? null : db,
  }
  if (info.flags.isAffected) r.affectedRows = numRows
  if (insertId !== '0') r.insertId = insertId
  if (set !== undefined) {
    r.result = {
      fields: set.fields,
      rows: set.rows.map((row) => row.map((v, i) => toCell(v, set.fields[i]!))),
      numRows,
      totalRows: unlimNumRows,
      approximate: false,
      pos: input.pos,
      maxRows: input.maxRows,
      limitAppended: appendLimit,
    }
  }
  return r
}

/** Sql::countQueryResults */
async function countQueryResults(
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
async function countRecords(
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

/** Sql::getMessageForNoRowsReturned (without show-as-PHP and rollback, which are M1) */
function messageForNoRowsReturned(
  info: StatementInfo,
  numRows: number,
  insertId: string,
  queryTime: number,
  // the SQL tab path (ImportController goSql) always passes '' here
  messageToShow = '',
): string {
  let msg: string
  if (info.flags.queryType === 'DELETE') {
    msg = ngettext('%1$d row deleted.', '%1$d rows deleted.', numRows)
  } else if (info.flags.isInsert) {
    msg =
      info.flags.queryType === 'REPLACE'
        ? ngettext('%1$d row affected.', '%1$d rows affected.', numRows)
        : ngettext('%1$d row inserted.', '%1$d rows inserted.', numRows)
    if (insertId !== '0') {
      // insert_id is the id of the FIRST inserted row
      msg += `\nInserted row id: ${(BigInt(insertId) + BigInt(numRows) - 1n).toString()}`
    }
  } else if (info.flags.isAffected) {
    msg = ngettext('%1$d row affected.', '%1$d rows affected.', numRows)
  } else if (messageToShow !== '' && info.flags.queryType !== 'SELECT') {
    msg = messageToShow
  } else {
    msg = 'MySQL returned an empty result set (i.e. zero rows).'
  }
  if (queryTime > 0) msg += ` (Query took ${fmtTime(queryTime)} seconds.)`
  return msg
}

/** Results::setMessageInformation, for result sets with a navigation bar. */
function resultsMessage(
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
  if (nonData || f.isProcedure)
    return `Your SQL query has been executed successfully. (Query took ${fmtTime(queryTime)} seconds.)`
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
  const totalText = `${formatCount(total)} total`
  return `Showing rows ${first} - ${last} (${totalText}, Query took ${fmtTime(queryTime)} seconds.)`
}

async function setVariable(conn: Conn, name: string, value: string): Promise<void> {
  const current = (await conn.rows(`SHOW SESSION VARIABLES LIKE '${name}';`, 'var.get'))[0]?.Value ?? ''
  if (current === value) return
  await conn.query(`SET ${name} = ${value};`, 'var.set')
}

async function isSuperUser(conn: Conn): Promise<boolean> {
  try {
    return (await conn.value('SELECT 1 FROM mysql.user LIMIT 1', 'priv.superuser')) !== null
  } catch {
    return false
  }
}
