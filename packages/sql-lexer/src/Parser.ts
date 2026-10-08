import { Context } from './Context.ts'
import { Lexer } from './Lexer.ts'
import { type Token, TokenType } from './Token.ts'
import { TokensList } from './TokensList.ts'
import { ParserException } from './exceptions.ts'
import { strtoupper } from './php.ts'
import { STATEMENT_CLASSES, SelectStatement, type Statement, TransactionStatement } from './statements.ts'
import { STATEMENT_PARSERS, isStatementKeyword } from './tables.ts'

export interface ParserOptions {
  /** Throw on the first error instead of collecting them (`$strict`). */
  strict?: boolean
  /** Initial statement delimiter used when lexing a string (default `;`). */
  delimiter?: string | null
  /** Context (keyword table + SQL mode); defaults to {@link Context.current}. */
  context?: Context
}

/**
 * Takes multiple tokens (contained in a Lexer instance) as input and builds a parse tree.
 */
// pma: vendor/phpmyadmin/sql-parser/src/Parser.php::Parser
export class Parser {
  /** List of errors that occurred during parsing. */
  errors: ParserException[] = []
  /** The list of tokens that are parsed. */
  list: TokensList | null = null
  /** List of statements parsed. */
  statements: Statement[] = []
  /** The number of opened brackets. */
  brackets = 0
  /** The lexer errors when this parser lexed a string itself. */
  lexerErrors: Lexer['errors'] = []

  private readonly strict: boolean

  constructor(list: string | TokensList | null = null, options: ParserOptions = {}) {
    this.strict = options.strict ?? false

    Context.run(options.context, () => {
      if (typeof list === 'string') {
        const lexerOptions: { strict: boolean; delimiter?: string | null } = { strict: this.strict }
        if (options.delimiter !== undefined) lexerOptions.delimiter = options.delimiter
        const lexer = new Lexer(list, lexerOptions)
        this.list = lexer.list
        this.lexerErrors = lexer.errors
      } else if (list instanceof TokensList) {
        this.list = list
      }

      if (list === null) return

      this.parse()
    })
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Parser.php::parse
  parse(): void {
    // Last transaction.
    let lastTransaction: TransactionStatement | null = null
    // Last parsed statement.
    let lastStatement: Statement | null = null
    // Union's type or false for no union.
    let unionType: string | false = false
    // The index of the last token from the last statement.
    let prevLastIdx = -1

    const list = this.list as TokensList

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // `DELIMITER` is not an actual statement and it requires special handling.
      if (token.type === TokenType.None && strtoupper(token.token) === 'DELIMITER') {
        // Skipping to the end of this statement.
        list.getNextOfType(TokenType.Delimiter)
        prevLastIdx = list.idx
        continue
      }

      // Counting the brackets around statements.
      if (token.value === '(') {
        ++this.brackets
        continue
      }

      // Statements can start with keywords only. Comments, whitespaces, etc. are ignored.
      if (token.type !== TokenType.Keyword) {
        if (
          token.type !== TokenType.Comment &&
          token.type !== TokenType.Whitespace &&
          token.type !== TokenType.Operator && // `(` and `)`
          token.type !== TokenType.Delimiter
        ) {
          this.error('Unexpected beginning of statement.', token)
        }
        continue
      }

      if (
        token.keyword === 'UNION' ||
        token.keyword === 'UNION ALL' ||
        token.keyword === 'UNION DISTINCT' ||
        token.keyword === 'EXCEPT' ||
        token.keyword === 'INTERSECT'
      ) {
        unionType = token.keyword
        continue
      }

      const lastIdx = list.idx
      let statementName: string | null = null

      if (token.keyword === 'ANALYZE') {
        ++list.idx // Skip ANALYZE

        const first = list.getNextOfType(TokenType.Keyword)
        const second = list.getNextOfType(TokenType.Keyword)

        // ANALYZE keyword can be an indication of two cases:
        // 1 - ANALYZE TABLE statements, in both MariaDB and MySQL
        // 2 - Explain statement, in case of MariaDB https://mariadb.com/kb/en/explain-analyze/
        // We need to point case 2 to use the EXPLAIN Parser.
        statementName = 'EXPLAIN'
        if (
          (first !== null && first.keyword === 'TABLE') ||
          (second !== null && second.keyword === 'TABLE')
        ) {
          statementName = 'ANALYZE'
        }

        list.idx = lastIdx
      } else if (token.keyword === null || !STATEMENT_PARSERS[token.keyword]) {
        // Checking if it is a known statement that can be parsed.
        if (!isStatementKeyword(token.keyword)) {
          // A statement is considered recognized if the parser is aware that it is a statement,
          // but it does not have a parser for it yet.
          this.error('Unrecognized statement type.', token)
        }

        // Skipping to the end of this statement.
        list.getNextOfType(TokenType.Delimiter)
        prevLastIdx = list.idx
        continue
      }

      const className = STATEMENT_PARSERS[statementName ?? (token.keyword as string)]
      const cls = STATEMENT_CLASSES[className as keyof typeof STATEMENT_CLASSES]

      // Processes the rest of the statement.
      const statement = cls.parsed(this, list)

      // The first token that is a part of this token is the next token unprocessed by the previous statement.
      // There might be brackets around statements and this shouldn't affect the parser
      statement.first = prevLastIdx + 1

      // Storing the index of the last token parsed and updating the old index.
      statement.last = list.idx
      prevLastIdx = list.idx

      // Handles unions.
      if (
        unionType !== false &&
        lastStatement instanceof SelectStatement &&
        statement instanceof SelectStatement
      ) {
        // This SELECT statement.
        lastStatement.union.push([unionType, statement])

        // if there are no no delimiting brackets, the `ORDER` and
        // `LIMIT` keywords actually belong to the first statement.
        lastStatement.order = statement.order
        lastStatement.limit = statement.limit
        statement.order = []
        statement.limit = null

        // The statement actually ends where the last statement in union ends.
        lastStatement.last = statement.last

        unionType = false

        // Validate clause order
        statement.validateClauseOrder(this, list)
        continue
      }

      // Handles transactions.
      if (statement instanceof TransactionStatement) {
        if (statement.type === TransactionStatement.TYPE_BEGIN) {
          lastTransaction = statement
          this.statements.push(statement)
        } else if (statement.type === TransactionStatement.TYPE_END) {
          if (lastTransaction === null) {
            // Even though an error occurred, the query is being saved.
            this.statements.push(statement)
            this.error('No transaction was previously started.', token)
          } else {
            lastTransaction.end = statement
          }
          lastTransaction = null
        }

        // Validate clause order
        statement.validateClauseOrder(this, list)
        continue
      }

      // Validate clause order
      statement.validateClauseOrder(this, list)

      // Finally, storing the statement.
      if (lastTransaction !== null) {
        lastTransaction.statements ??= []
        lastTransaction.statements.push(statement)
      } else {
        this.statements.push(statement)
      }

      lastStatement = statement
    }
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Parser.php::error
  error(msg: string, token: Token | null = null, code = 0): void {
    const error = new ParserException(msg, token, code)
    if (this.strict) throw error
    this.errors.push(error)
  }
}
