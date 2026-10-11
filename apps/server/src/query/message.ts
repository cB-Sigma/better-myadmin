import type { MysqlDie, SqlCard } from '@bettermyadmin/contracts'
import { type Gettext, englishTranslator } from '@bettermyadmin/i18n'
import { type Context, Lexer, Parser, getErrors } from '@bettermyadmin/sql-lexer'
import type { AppConfig } from '../config.ts'
import { addslashes } from '../util/php.ts'

/**
 * DatabaseInterface::getError() text: `#errno - message`, with phpMyAdmin's extra hints.
 * pma: src/Query/Utilities.php::formatError
 */
export function formatError(
  errorNumber: number,
  errorMessage: string,
  tr: Gettext = english,
): { text: string; hint: MysqlDie['hint'] } {
  let error = `#${errorNumber}`
  const separator = ' — '
  let hint: MysqlDie['hint'] = null
  if (errorNumber === 2002) {
    error += ` - ${errorMessage}${separator}${tr.gettext("The server is not responding (or the local server's socket is not correctly configured).")}`
  } else if (errorNumber === 2003) {
    error += ` - ${errorMessage}${separator}${tr.gettext('The server is not responding.')}`
  } else if (errorNumber === 1698) {
    const logout = tr.gettext('Logout and try as another user.')
    error += ` - ${errorMessage}${separator}${logout}`
    hint = { kind: 'logout', text: logout }
  } else if (errorNumber === 1005) {
    if (errorMessage.includes('errno: 13')) {
      error += ` - ${errorMessage}${separator}${tr.gettext('Please check privileges of directory containing database.')}`
    } else {
      // InnoDB constraints, see https://dev.mysql.com/doc/refman/8.0/en/create-table-foreign-keys.html
      const details = tr.gettext('Details…')
      error += ` - ${errorMessage} (${details})`
      hint = { kind: 'innodb-status', text: details }
    }
  } else {
    error += ` - ${errorMessage}`
  }
  return { text: error, hint }
}

const english = englishTranslator()

/** Generator::formatSql($sql, true): the SQL shown in the card, truncated to MaxCharactersInDisplayedSQL. */
export function formatSqlForDisplay(sql: string, cfg: AppConfig, truncate = true): string {
  const chars = Array.from(sql)
  if (truncate && chars.length > cfg.MaxCharactersInDisplayedSQL) {
    return `${chars.slice(0, cfg.MaxCharactersInDisplayedSQL).join('')}[...]`
  }
  return sql
}

/** The PHP code of "Create PHP code": `$sql = "…";` with `\n"` + `. "` continuation lines. */
export function sqlAsPhp(sql: string): string {
  const newLine = '\\n"\n    . "'
  return `$sql = "${addslashes(sql).replace(/\r\n|\r|\n/g, newLine)}";`
}

const SP = '[ \\t\\n\\r\\v\\f]'
const EXPLAIN_RE = `^EXPLAIN${SP}+(?:ANALYZE${SP}+)?(?:FORMAT=(?:JSON|TREE|TRADITIONAL)${SP}+)?`
const ANALYZE_RE = `^ANALYZE${SP}+(?:FORMAT=(?:JSON|TRADITIONAL)${SP}+)?`

export interface CardOptions {
  cfg: AppConfig
  /** Sql::$showAsPhp */
  showAsPhp: boolean | null
  /** Current::$database / Current::$table when the card is rendered. */
  db: string
  table: string
  /** Profiling::isSupported() — only asked when a Refresh link exists, like phpMyAdmin. */
  profilingSupported: () => Promise<boolean>
  /** isset($_SESSION['profiling']) */
  profilingOn: boolean
}

/**
 * The card under the message: the SQL plus Edit inline / Edit / Explain / PHP / Refresh links.
 * Returns null when only the message is rendered (ShowSQL off, empty SQL or ';').
 * pma: src/Html/Generator.php::getMessage
 */
export async function getMessageCard(sqlQuery: string, o: CardOptions): Promise<SqlCard | null> {
  const { cfg } = o
  const renderSql = cfg.ShowSQL && sqlQuery !== '' && sqlQuery !== ';'
  if (!renderSql) return null
  const sqlBox = cfg.SQLQuery as { Edit: boolean; Explain: boolean; ShowAsPHP: boolean; Refresh: boolean }

  const display = o.showAsPhp === true ? sqlAsPhp(sqlQuery) : formatSqlForDisplay(sqlQuery, cfg)
  const queryTooBig = Array.from(sqlQuery).length > cfg.MaxCharactersInDisplayedSQL
  const isSelect = new RegExp(`^SELECT${SP}+`, 'i').test(sqlQuery)

  let explain: SqlCard['links']['explain'] = null
  if (sqlBox.Explain && !queryTooBig) {
    if (isSelect) {
      explain = { text: 'Explain SQL', sql: `EXPLAIN ${sqlQuery}` }
    } else if (new RegExp(`${EXPLAIN_RE}SELECT${SP}+`, 'i').test(sqlQuery)) {
      explain = {
        text: 'Skip Explain SQL',
        sql: sqlQuery.replace(new RegExp(EXPLAIN_RE, 'i'), ''),
      }
    } else if (new RegExp(`${ANALYZE_RE}SELECT${SP}+`, 'i').test(sqlQuery)) {
      explain = {
        text: 'Skip Analyze SQL',
        sql: sqlQuery.replace(new RegExp(ANALYZE_RE, 'i'), ''),
      }
    }
  }

  const edit = sqlBox.Edit && o.showAsPhp !== true
  const php: SqlCard['links']['php'] =
    sqlBox.ShowAsPHP && !queryTooBig ? (o.showAsPhp === true ? 'without' : 'create') : null
  // 'Submit query' does the same as Refresh
  const refresh =
    sqlBox.Refresh &&
    o.showAsPhp === null &&
    new RegExp(`^(ANALYZE|EXPLAIN|SELECT|SHOW)${SP}+`, 'i').test(sqlQuery)
  // avoid displaying a Profiling checkbox that could be checked, which would re-execute an INSERT, for example
  const profiling = refresh && (await o.profilingSupported()) ? { checked: o.profilingOn } : null
  const editInline = sqlBox.Edit && !queryTooBig && o.showAsPhp !== true

  return {
    sql: sqlQuery,
    display,
    php: o.showAsPhp === true,
    db: o.db,
    table: o.db === '' ? '' : o.table,
    links: { editInline, edit, explain, php, refresh, profiling },
  }
}

/**
 * The error card: static analysis, the SQL, and the server's message.
 * pma: src/Html/Generator.php::mysqlDie
 */
export function mysqlDie(
  serverMessage: string,
  sqlQueryIn: string,
  cfg: AppConfig,
  context: Context | undefined,
  hint: MysqlDie['hint'] = null,
): MysqlDie {
  const sqlQuery = sqlQueryIn.trim()
  const lexer = new Lexer(sqlQuery, context !== undefined ? { context } : {})
  const parser = new Parser(lexer.list, context !== undefined ? { context } : {})
  const errors = getErrors([lexer, parser])
  const formattedSql =
    sqlQuery === '' ? '' : errors.length > 0 ? sqlQuery : formatSqlForDisplay(sqlQuery, cfg)
  // For security reasons, if the MySQL refuses the connection, the query is hidden so no details are revealed.
  const showSql = sqlQuery !== '' && !sqlQuery.includes('connect')
  return {
    staticAnalysis: showSql ? errors.map((e) => ({ message: e[0], token: e[2], position: e[3] ?? 0 })) : [],
    sql: showSql ? formattedSql : null,
    sqlTruncated: errors.length === 0,
    selectDoc: showSql && formattedSql.toLowerCase().includes('select'),
    serverMessage: serverMessage.replace(/((\r\n)|(\r)|(\n)){3,}/g, '\n\n'),
    hint,
  }
}
