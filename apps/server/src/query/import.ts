import { type Translator, englishTranslator, sprintf } from '@bettermyadmin/i18n'
import { unQuote } from '@bettermyadmin/mysql-types'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import {
  type Context,
  DeleteStatement,
  InsertStatement,
  Parser,
  ReplaceStatement,
  SetStatement,
  UpdateStatement,
  getTables,
} from '@bettermyadmin/sql-lexer'
import type { Conn } from '../db/connection.ts'
import { MysqlError } from '../http/errors.ts'
import { expandPregReplacement, isNumeric, pregQuote } from '../util/php.ts'
import { formatError } from './message.ts'

/**
 * Bind parameters: every `:name` gets its value, non-numeric values quoted; `:param` never
 * replaces the start of `:param1`.
 * pma: src/Controllers/Import/ImportController.php::__invoke (parameterized)
 */
export function bindParameters(
  sql: string,
  params: Readonly<Record<string, string>>,
  quote: (v: string) => string = (v) => quoteString(v),
): string {
  let out = sql
  for (const [parameter, value] of Object.entries(params)) {
    const replacementValue = isNumeric(value) ? value : quote(value)
    const quoted = pregQuote(parameter)
    // making sure that :param does not apply values to :param1
    out = out.replace(new RegExp(`${quoted}([^a-zA-Z0-9_])`, 'g'), (_m, g1: string) =>
      expandPregReplacement(`${replacementValue}\${1}`, [_m, g1]),
    )
    // for parameters that appear at the end of the string
    out = out.replace(new RegExp(`${quoted}$`), (m) => expandPregReplacement(replacementValue, [m]))
  }
  return out
}

export interface ReloadHints {
  /** ResponseRenderer::$reload (DROP VIEW/TABLE/DATABASE/SCHEMA). */
  reloadNavigation: boolean
  ajaxReload: { reload?: boolean; tableName?: string }
}

/**
 * Navigation refresh hints from the raw query text.
 * pma: src/Controllers/Import/ImportController.php::__invoke
 */
export function reloadHints(sql: string): ReloadHints {
  const hints: ReloadHints = { reloadNavigation: false, ajaxReload: {} }
  // refresh navigation and main panels
  if (/^(DROP)\s+(VIEW|TABLE|DATABASE|SCHEMA)\s+/i.test(sql)) {
    hints.reloadNavigation = true
    hints.ajaxReload.reload = true
  }
  // refresh navigation panel only
  if (/^(CREATE|ALTER)\s+(VIEW|TABLE|DATABASE|SCHEMA)\s+/i.test(sql)) hints.ajaxReload.reload = true
  // do a dynamic reload if table is RENAMED
  const rename = /^RENAME\s+TABLE\s+(.*?)\s+TO\s+(.*?)($|;|\s)/i.exec(sql)
  if (rename !== null) {
    hints.ajaxReload.reload = true
    hints.ajaxReload.tableName = unQuote(rename[2] ?? '')
  }
  return hints
}

/** List of Transactional Engines (Import::isTableTransactional). */
const TRANSACTIONAL_ENGINES = [
  'INNODB',
  'FALCON',
  'NDB',
  'INFINIDB',
  'TOKUDB',
  'XTRADB',
  'SEQUENCE',
  'ROCKSDB',
]

/** The connection's last error, like mysqli_error() through DatabaseInterface::getError(). */
export class LastError {
  value = ''
}

/** DatabaseInterface::tryQuery: null on error (recorded in `last`). */
async function tryQuery(conn: Conn, sql: string, label: string, last: LastError, tr: Translator) {
  try {
    const r = await conn.query(sql, label)
    last.value = ''
    return r
  } catch (e) {
    if (e instanceof MysqlError) {
      last.value = formatError(e.extra.errno ?? 0, e.message, tr).text
      return null
    }
    throw e
  }
}

// pma: src/Import/Import.php::isTableTransactional
async function isTableTransactional(
  conn: Conn,
  tableRef: string,
  currentDb: string,
  last: LastError,
  tr: Translator,
): Promise<boolean> {
  const parts = tableRef.split('.')
  let db: string
  let table: string
  if (parts.length === 2) {
    db = unQuote(parts[0]!)
    table = unQuote(parts[1]!)
  } else {
    db = currentDb
    table = unQuote(parts[0]!)
  }
  // Query to check if table exists.
  const exists = await tryQuery(
    conn,
    `SELECT * FROM ${backquote(db)}.${backquote(table)} LIMIT 1`,
    'rollback.check-table',
    last,
    tr,
  )
  if (exists === null) return false
  // Query to check if table is 'Transactional'.
  const r = await tryQuery(
    conn,
    `SELECT \`ENGINE\` FROM \`information_schema\`.\`tables\` WHERE \`table_name\` = ${quoteString(table)} AND \`table_schema\` = ${quoteString(db)} AND UPPER(\`engine\`) IN ("${TRANSACTIONAL_ENGINES.join('", "')}")`,
    'rollback.check-engine',
    last,
    tr,
  )
  return r !== null && (r.resultSets[0]?.rows.length ?? 0) === 1
}

// pma: src/Import/Import.php::checkIfRollbackPossible
async function checkIfRollbackPossible(
  conn: Conn,
  sqlQuery: string,
  currentDb: string,
  context: Context | undefined,
  last: LastError,
  tr: Translator,
): Promise<boolean> {
  const parser = new Parser(sqlQuery, context !== undefined ? { context } : {})
  const statement = parser.statements[0]
  if (statement === undefined) return true
  // Check if query is supported.
  if (
    !(
      statement instanceof InsertStatement ||
      statement instanceof UpdateStatement ||
      statement instanceof DeleteStatement ||
      statement instanceof ReplaceStatement ||
      (statement instanceof SetStatement && statement.options !== null && statement.options.isEmpty())
    )
  ) {
    return false
  }
  // Check if each table is 'InnoDB'.
  for (const table of getTables(statement)) {
    if (!(await isTableTransactional(conn, table, currentDb, last, tr))) return false
  }
  return true
}

/**
 * "Rollback when finished": every piece (split with explode on the delimiter) must be rollback-able,
 * then START TRANSACTION. Returns the error text when refused.
 * pma: src/Import/Import.php::handleRollbackRequest
 */
export async function handleRollbackRequest(
  conn: Conn,
  sqlQuery: string,
  delimiter: string,
  currentDb: string,
  context: Context | undefined,
  tr: Translator = english,
): Promise<string | null> {
  const last = new LastError()
  for (const piece of sqlQuery.split(delimiter)) {
    if (piece === '') continue
    // Check each query for ROLLBACK support.
    if (await checkIfRollbackPossible(conn, piece, currentDb, context, last, tr)) continue
    return last.value !== ''
      ? last.value
      : tr.gettext(
          'Only INSERT, UPDATE, DELETE, REPLACE and SET (without options like GLOBAL) SQL queries containing transactional engine tables can be rolled back.',
        )
  }
  // If everything fine, START a transaction.
  await conn.query('START TRANSACTION', 'rollback.start')
  return null
}

/** One statement run in import mode, kept for the error card. */
export interface FailedQuery {
  sql: string
  error: string
}

export interface ImportModeState {
  /** Current::$sqlQuery: the commented transcript (or '' once display was disabled). */
  sqlQuery: string
  /** ImportSettings::$message of the last executed statement. */
  message: string
  /** Import::$result !== false */
  result: boolean
  hasError: boolean
  failedQueries: FailedQuery[]
  db: string
  reloadNavigation: boolean
  executedQueries: number
}

export interface ImportRunResult {
  /** goSql: the statements to run one by one through Sql::executeQueryAndGetQueryResponse. */
  goSql: boolean
  queriesToBeExecuted: string[]
  /** Current::$sqlQuery after the import (the last statement in goSql mode, the transcript otherwise). */
  sqlQuery: string
  importMode: ImportModeState | null
}

const english = englishTranslator()

/**
 * ImportSql::doImport + Import::runQuery/executeQuery: fewer than 50 statements are handed to the
 * SQL-tab path (goSql); from the 50th on they are executed here with a `# Rows: n` style transcript.
 * pma: src/Import/Import.php::runQuery, ::executeQuery, ::lookForUse
 */
export async function runImport(
  statements: readonly string[],
  opts: {
    conn: Conn
    runQuery: boolean
    db: string
    ignoreMultiSubmitErrors: boolean
    tr?: Translator
  },
): Promise<ImportRunResult> {
  const tr = opts.tr ?? english
  const st: ImportModeState = {
    sqlQuery: '',
    message: tr.gettext('Sorry an unexpected error happened!'),
    result: false,
    hasError: false,
    failedQueries: [],
    db: opts.db,
    reloadNavigation: false,
    executedQueries: 0,
  }
  let importRunBuffer: string | null = null
  let goSql = false
  let sqlQueryDisabled = false
  let maxSqlLength = 0
  let sqlData: string[] = []
  let importModeUsed = false

  const executeQuery = async (sql: string) => {
    importModeUsed = true
    const last = new LastError()
    const result = await tryQuery(opts.conn, sql, 'import.query', last, tr)
    // USE query changes the database, so need to track while running multiple queries
    const isUseQuery = sql.toLowerCase().includes('use ')
    st.message = '# '
    st.result = result !== null
    if (result === null) {
      st.failedQueries.push({ sql, error: last.value })
      st.message += tr.gettext('Error')
      if (!opts.ignoreMultiSubmitErrors) {
        st.hasError = true
        return
      }
    } else {
      const aNumRows = result.resultSets[0]?.rows.length ?? 0
      const aAffectedRows = result.header?.affectedRows ?? aNumRows
      if (aNumRows > 0) st.message += `${tr.gettext('Rows')}: ${aNumRows}`
      else if (aAffectedRows > 0)
        st.message += sprintf(
          tr.ngettext('%1$d row affected.', '%1$d rows affected.', aAffectedRows),
          aAffectedRows,
        )
      else st.message += tr.gettext('MySQL returned an empty result set (i.e. zero rows).')
      if (aNumRows > 0 || isUseQuery) sqlData.push(sql)
    }
    if (!sqlQueryDisabled) st.sqlQuery += `${st.message}\n`
    // If a 'USE <db>' SQL-clause was found and the query succeeded, set our current $db to the new one
    if (result !== null) {
      const dbNameInsideUse = lookForUse(sql)
      if (dbNameInsideUse !== '') {
        st.db = dbNameInsideUse
        st.reloadNavigation = true
      }
    }
    if (
      result !== null &&
      /^[\s]*(DROP|CREATE)[\s]+(IF EXISTS[ \t\n\r\v\f]+)?(TABLE|DATABASE)[ \t\n\r\v\f]+(.+)/im.test(sql)
    ) {
      st.reloadNavigation = true
    }
  }

  const runQuery = async (sql: string) => {
    if (importRunBuffer === null) {
      // Do we have something to push into buffer?
      importRunBuffer = sql !== '' ? `${sql};` : null
      return
    }
    maxSqlLength = Math.max(maxSqlLength, Array.from(importRunBuffer).length)
    if (!sqlQueryDisabled) st.sqlQuery += importRunBuffer
    st.executedQueries++
    if (opts.runQuery && st.executedQueries < 50) {
      goSql = true
      st.sqlQuery = importRunBuffer
      sqlData.push(importRunBuffer)
    } else if (opts.runQuery) {
      /* Handle rollback from go_sql */
      if (goSql && sqlData.length > 0) {
        const queries = sqlData
        sqlData = []
        goSql = false
        for (const query of queries) {
          await executeQuery(query)
          if (st.hasError) break
        }
      }
      if (!st.hasError) await executeQuery(importRunBuffer)
    }
    // check length of query unless we decided to pass it to /sql
    if (!goSql && opts.runQuery && st.sqlQuery !== '') {
      if (Array.from(st.sqlQuery).length > 50000 || st.executedQueries > 50 || maxSqlLength > 1000) {
        st.sqlQuery = ''
        sqlQueryDisabled = true
      }
    }
    // Do we have something to push into buffer?
    importRunBuffer = sql !== '' ? `${sql};` : null
  }

  for (const s of statements) {
    if (st.hasError) break
    await runQuery(s)
  }
  // Finishing.
  if (!st.hasError) await runQuery('')

  return {
    goSql,
    queriesToBeExecuted: goSql ? sqlData : [],
    sqlQuery: st.sqlQuery,
    importMode: importModeUsed ? st : null,
  }
}

/** pma: src/Import/Import.php::lookForUse */
export function lookForUse(buffer: string): string {
  const m = /^[\s]*USE[ \t\n\r\v\f]+([\S]+)/i.exec(buffer)
  if (m === null) return ''
  let db = (m[1] ?? '').trim()
  db = db.replace(/^;+|;+$/g, '') // for example, USE abc;
  return unQuote(db)
}
