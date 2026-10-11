import type { SimulateResponse } from '@bettermyadmin/contracts'
import { type Gettext, englishTranslator } from '@bettermyadmin/i18n'
import { unQuote } from '@bettermyadmin/mysql-types'
import { backquote } from '@bettermyadmin/sql-gen'
import {
  type Context,
  DeleteStatement,
  Lexer,
  Parser,
  TokenType,
  TokensList,
  UpdateStatement,
  getClause,
  getTables,
} from '@bettermyadmin/sql-lexer'
import type { Conn } from '../db/connection.ts'
import { MysqlError } from '../http/errors.ts'
import { formatError } from './message.ts'
import { signSql } from './signature.ts'

/** pma: src/Controllers/Import/SimulateDmlController.php::createParser */
function createParser(query: string, delimiter: string, context: Context | undefined): Parser {
  const lexer = new Lexer(query, { delimiter, ...(context !== undefined ? { context } : {}) })
  const list = new TokensList(lexer.list.tokens.filter((t) => t.type !== TokenType.Comment))
  return new Parser(list, context !== undefined ? { context } : {})
}

interface SimulatedQueries {
  select: string
  count: string
}

/** pma: src/Import/SimulateDml.php::getSimulatedDeleteQuery */
function getSimulatedDeleteQuery(parser: Parser, statement: DeleteStatement): SimulatedQueries {
  const tableReferences = getTables(statement)
  if (tableReferences.length !== 1) throw new Error('No joins allowed in simulation query')
  const list = parser.list!
  const condition = getClause(statement, list, 'WHERE')
  const where = condition === '' ? '' : ` WHERE ${condition}`
  const order =
    statement.order === null || statement.order.length === 0
      ? ''
      : ` ORDER BY ${getClause(statement, list, 'ORDER BY')}`
  const limit = statement.limit === null ? '' : ` LIMIT ${getClause(statement, list, 'LIMIT')}`
  const from = tableReferences[0]!
  return {
    select: `SELECT * FROM (SELECT * FROM ${from}${where}${order}${limit}) AS pma_tmp`,
    count: `SELECT COUNT(*) FROM (SELECT 1 FROM ${from}${where}${order}${limit}) AS pma_tmp`,
  }
}

/** pma: src/Import/SimulateDml.php::getSimulatedUpdateQuery */
function getSimulatedUpdateQuery(parser: Parser, statement: UpdateStatement): SimulatedQueries {
  const tableReferences = getTables(statement)
  if (tableReferences.length !== 1) throw new Error('No joins allowed in simulation query')
  if (statement.set === null || statement.set.length === 0) throw new Error('SET statements missing')
  const list = parser.list!
  const values = new Map<string, string>()
  const newColumns: string[] = []
  const oldColumns: string[] = []
  for (const set of [...statement.set].reverse()) {
    const column = unQuote(set.column)
    if (values.has(column)) continue
    oldColumns.push(backquote(column))
    const newColumn = backquote(`${column} *new*`)
    newColumns.push(newColumn)
    values.set(column, `${set.value} AS ${newColumn}`)
  }
  const condition = getClause(statement, list, 'WHERE')
  const where = condition === '' ? '' : ` WHERE ${condition}`
  const order =
    statement.order === null || statement.order.length === 0
      ? ''
      : ` ORDER BY ${getClause(statement, list, 'ORDER BY')}`
  const limit = statement.limit === null ? '' : ` LIMIT ${getClause(statement, list, 'LIMIT')}`
  const from = tableReferences[0]!
  const vals = [...values.values()].join(', ')
  const notSame = ` WHERE NOT (${oldColumns.join(', ')}) <=> (${newColumns.join(', ')})`
  return {
    select: `SELECT * FROM (SELECT *, ${vals} FROM ${from}${where}${order}${limit}) AS \`pma_tmp\`${notSame}`,
    count: `SELECT COUNT(*) FROM (SELECT ${oldColumns.join(', ')}, ${vals} FROM ${from}${where}${order}${limit}) AS \`pma_tmp\`${notSame}`,
  }
}

/**
 * "Simulate query": how many rows an UPDATE/DELETE would touch, without running it.
 * pma: src/Controllers/Import/SimulateDmlController.php, src/Import/SimulateDml.php
 */
export async function simulateDml(
  sql: string,
  delimiter: string,
  db: string,
  conn: Conn,
  context: Context | undefined,
  sign: { hmacSecret: string; blowfishSecret: string; tr?: Gettext },
): Promise<SimulateResponse> {
  const tr = sign.tr ?? englishTranslator()
  const parser = createParser(sql, delimiter, context)
  if (parser.errors.length > 0) return { sqlData: null, message: parser.errors[0]!.message }
  const data: NonNullable<SimulateResponse['sqlData']> = []
  for (const statement of parser.statements) {
    if (
      !(statement instanceof UpdateStatement || statement instanceof DeleteStatement) ||
      (statement.join !== null && statement.join.length > 0) ||
      getTables(statement).length > 1
    ) {
      return {
        sqlData: null,
        message: tr.gettext('Only single-table UPDATE and DELETE queries can be simulated.'),
      }
    }
    const q =
      statement instanceof DeleteStatement
        ? getSimulatedDeleteQuery(parser, statement)
        : getSimulatedUpdateQuery(parser, statement)
    // executeMatchedRowQuery: selectDb + fetchValue (0 and the connection error on failure)
    let matchedRows = 0
    try {
      if (db !== '') await conn.query(`USE ${backquote(db)}`, 'simulate.select-db')
      matchedRows = Number((await conn.value(q.count, 'simulate.count')) ?? 0)
    } catch (e) {
      if (e instanceof MysqlError) {
        return { sqlData: null, message: formatError(e.extra.errno ?? 0, e.message, tr).text }
      }
      throw e
    }
    data.push({
      sqlQuery: statement.build(),
      matchedRows,
      matchedRowsSql: q.select,
      matchedRowsSig: signSql(q.select, sign.hmacSecret, sign.blowfishSecret),
    })
  }
  return { sqlData: data }
}
