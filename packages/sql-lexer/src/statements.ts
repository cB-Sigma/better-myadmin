import { Context } from './Context.ts'
import { Parser } from './Parser.ts'
import { type Token, TokenType, type TokenValue } from './Token.ts'
import { TokensList } from './TokensList.ts'
/**
 * Port of vendor/phpmyadmin/sql-parser/src/Statement.php and src/Statements/*.php.
 *
 * PHP's `new XStatement($parser, $list)` (constructor that parses) is
 * `XStatement.parsed(parser, list)` here: TypeScript field initializers run
 * after `super()`, so parsing cannot happen in the base constructor.
 */
import {
  type AlterOperation,
  type ArrayObj,
  type CaseExpression,
  type Condition,
  type CreateDefinition,
  type DataType,
  type Expression,
  type FunctionCall,
  type GroupKeyword,
  type IndexHint,
  type IntoKeyword,
  type JoinKeyword,
  type Limit,
  LockExpression,
  type OptionsArray,
  type OrderKeyword,
  type ParameterDefinition,
  type PartitionDefinition,
  type RenameOperation,
  type SetOperation,
  WithKeyword,
  buildPartitionDefinitions,
} from './components.ts'
import { ParserException } from './exceptions.ts'
import {
  ALTER_DATABASE_OPTIONS,
  ALTER_EVENT_OPTIONS,
  ALTER_ROUTINE_OPTIONS,
  ALTER_TABLE_OPTIONS,
  ALTER_USER_OPTIONS,
  ALTER_VIEW_OPTIONS,
  AlterOperations,
  Array2d,
  ArrayObjs,
  COMPONENT_PARSERS,
  Conditions,
  CreateDefinitions,
  DataTypes,
  ExpressionArray,
  Expressions,
  IntoKeywords,
  JoinKeywords,
  Limits,
  LockExpressions,
  type OptionSpecs,
  OptionsArrays,
  OrderKeywords,
  ParameterDefinitions,
  SetOperations,
} from './parsers.ts'
import { empty, str, strtoupper, trim } from './php.ts'
import {
  KEYWORD_PARSERS,
  type ParseOptions,
  STATEMENT_PARSERS,
  type StatementClassName,
  hasStatementParser,
  isKeywordParser,
} from './tables.ts'

/** Clause definition: `[name, ADD_CLAUSE | ADD_KEYWORD]`. */
export type ClauseDef = readonly [string, number]
export type Clauses = Readonly<Record<string, ClauseDef>>

const ADD_CLAUSE = 1
const ADD_KEYWORD = 2

type StatementCtor<T extends Statement> = (new () => T) & typeof Statement

/** PHP passing a null property to an `array` parameter: TypeError. */
function requireArray<T>(a: T[] | null): T[] {
  if (a === null) throw new TypeError('Argument must be of type array, null given')
  return a
}

/** PHP `$this->x->build()` on a non-nullsafe property: throws like PHP when it is null. */
function built(c: { build(): string } | null | undefined): string {
  if (c === null || c === undefined) throw new TypeError('Call to a member function build() on null')
  return c.build()
}

function fieldsOf(o: object): Record<string, unknown> {
  return o as Record<string, unknown>
}

// pma: vendor/phpmyadmin/sql-parser/src/Statement.php::Statement
export abstract class Statement {
  /** The name of the PHP class this statement mirrors (`SelectStatement`, ...). */
  abstract readonly kind: StatementClassName | 'NotImplementedStatement'

  /** Options for this statement: `OPTION_NAME => id` or `OPTION_NAME => [id, kind, options?]`. */
  static statementOptions: OptionSpecs = {}
  /** The clauses of this statement, in order. */
  static clauses: Clauses = {}
  /** `static::STATEMENT_END_OPTIONS` (only SelectStatement and SetStatement define it). */
  static STATEMENT_END_OPTIONS: OptionSpecs = {}

  static readonly ADD_CLAUSE = ADD_CLAUSE
  static readonly ADD_KEYWORD = ADD_KEYWORD

  /** The options of this query. */
  options: OptionsArray | null = null
  /** The index of the first token used in this statement. */
  first: number | null = null
  /** The index of the last token used in this statement. */
  last: number | null = null

  /** PHP `new static($parser, $list)`. */
  static parsed<T extends Statement>(this: new () => T, parser: Parser, list: TokensList): T {
    // biome-ignore lint/complexity/noThisInStatic: PHP `new static()` must instantiate the subclass
    const s = new this()
    s.parse(parser, list)
    return s
  }

  protected get statics(): typeof Statement {
    return this.constructor as typeof Statement
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statement.php::build
  build(): string {
    let query = ''
    // Clauses which were built already. Multiple clauses use the same field.
    const built: Record<string, boolean> = {}
    const self = fieldsOf(this)

    for (const [name, type] of Object.values(this.getClauses())) {
      // The name of the field that is used as source for the builder.
      if (!isKeywordParser(name)) continue // PHP: `$field = null`, `empty($this->{''})`
      const kp = KEYWORD_PARSERS[name] as (typeof KEYWORD_PARSERS)[string]
      const field = kp.field
      const value = self[field]

      // The field is empty, there is nothing to be built.
      if (empty(value) || value === null) continue

      // Checking if this field was already built.
      if (type & ADD_CLAUSE) {
        if (built[field]) continue
        built[field] = true
      }

      // Checking if the name of the clause should be added.
      if (type & ADD_KEYWORD) query = trim(query) + ' ' + name

      // Checking if the result of the builder should be added.
      if (!(type & ADD_CLAUSE)) continue

      if (Array.isArray(value)) {
        const cls = COMPONENT_PARSERS[kp.class]
        query = trim(query) + ' ' + (cls.buildAll as (c: readonly unknown[]) => string)(value)
      } else {
        query = trim(query) + ' ' + (value as { build(): string }).build()
      }
    }

    return query
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statement.php::parse
  parse(parser: Parser, list: TokensList): void {
    // Array containing all list of clauses parsed. This is used to check for duplicate clauses.
    const parsedClauses: Record<string, true> = {}
    const self = fieldsOf(this)
    const statics = this.statics

    // The first token that is a part of this token is the next token unprocessed by the previous statement.
    this.first = list.idx

    // Whether options were parsed or not. For statements that do not have any options this is set to `true`.
    let parsedOptions = Object.keys(statics.statementOptions).length === 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // End of statement.
      if (token.type === TokenType.Delimiter) break

      // Checking if this closing bracket is the pair for a bracket outside the statement.
      if (token.value === ')' && parser.brackets > 0) {
        --parser.brackets
        continue
      }

      // Only keywords are relevant here. Other parts of the query are processed in the functions below.
      if (token.type !== TokenType.Keyword) {
        if (token.type !== TokenType.Comment && token.type !== TokenType.Whitespace) {
          parser.error('Unexpected token.', token)
        }
        continue
      }

      // Unions are parsed by the parser because they represent more than one statement.
      if (
        token.keyword === 'UNION' ||
        token.keyword === 'UNION ALL' ||
        token.keyword === 'UNION DISTINCT' ||
        token.keyword === 'EXCEPT' ||
        token.keyword === 'INTERSECT'
      ) {
        break
      }

      // The name of the class that is used for parsing.
      let cls: (typeof COMPONENT_PARSERS)[keyof typeof COMPONENT_PARSERS] | null = null
      // The name of the field where the result of the parsing is stored.
      let field: string | null = null
      // Parser's options.
      let options: ParseOptions = {}

      // Checking if this is a known clause and checking for duplicate clauses.
      if (
        typeof token.value === 'string' &&
        (isKeywordParser(token.value) || hasStatementParser(token.value))
      ) {
        if (Object.hasOwn(parsedClauses, token.value)) {
          parser.error('This type of clause was previously parsed.', token)
          break
        }
        parsedClauses[token.value] = true
      }

      // Checking if this is a known clause.
      const tokenValue = token.keyword === 'TRUNCATE' ? token.keyword : token.value
      if (typeof tokenValue === 'string' && isKeywordParser(tokenValue) && list.idx < list.count) {
        const kp = KEYWORD_PARSERS[tokenValue] as (typeof KEYWORD_PARSERS)[string]
        cls = COMPONENT_PARSERS[kp.class]
        field = kp.field
        if (kp.options !== undefined) options = kp.options
      }

      // Checking if this is the beginning of the statement.
      if (hasStatementParser(token.keyword)) {
        if (
          Object.keys(statics.clauses).length > 0 &&
          typeof token.value === 'string' &&
          !Object.hasOwn(statics.clauses, token.value)
        ) {
          // Some keywords (e.g. `SET`) may be the beginning of a statement and a clause.
          parser.error('A new statement was found, but no delimiter between it and the previous one.', token)
          break
        }

        if (!parsedOptions) {
          if (!Object.hasOwn(statics.statementOptions, str(token.value))) {
            // Skipping keyword.
            ++list.idx
          }
          this.options = OptionsArrays.parse(parser, list, statics.statementOptions)
          parsedOptions = true
        }
      } else if (cls === null) {
        if (!(this instanceof SetStatement) || (token.value !== 'COLLATE' && token.value !== 'DEFAULT')) {
          // There is no parser for this keyword and isn't the beginning of a statement (so no options) either.
          parser.error('Unrecognized keyword.', token)
          continue
        }
        self.endOptions = OptionsArrays.parse(parser, list, SetStatement.STATEMENT_END_OPTIONS)
      }

      this.before(parser, list, token)

      // Parsing this keyword.
      if (cls !== null && field !== null) {
        // We can't parse keyword at the end of statement
        if (list.idx >= list.count) {
          parser.error('Keyword at end of statement.', token)
          continue
        }
        ++list.idx // Skipping keyword or last option.
        self[field] = cls.parse(parser, list, options)
      }

      this.after(parser, list, token)
    }

    this.last = --list.idx // Go back to last used token.
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statement.php::before
  before(_parser: Parser, _list: TokensList, _token: Token): void {}

  // pma: vendor/phpmyadmin/sql-parser/src/Statement.php::after
  after(_parser: Parser, _list: TokensList, _token: Token): void {}

  // pma: vendor/phpmyadmin/sql-parser/src/Statement.php::getClauses
  getClauses(): Clauses {
    return this.statics.clauses
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statement.php::getClauseOrder
  getClauseOrder(): Record<string, number> {
    const clauses: string[] = []
    for (const key of Object.keys(this.getClauses())) {
      if (key === '_END_OPTIONS') {
        clauses.push(...Object.keys(this.statics.STATEMENT_END_OPTIONS))
      } else {
        clauses.push(key)
      }
    }
    // array_flip(): later duplicates win.
    const order: Record<string, number> = {}
    clauses.forEach((c, i) => {
      order[c] = i
    })
    return order
  }

  toString(): string {
    return this.build()
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statement.php::validateClauseOrder
  validateClauseOrder(parser: Parser, list: TokensList): boolean {
    const clauses = Object.keys(this.getClauses())
    if (clauses.length === 0) return true

    let minIdx = -1
    // For tracking JOIN clauses in a query
    //   = 0 - JOIN not found till now
    //   > 0 - Index of first JOIN clause in the statement.
    let minJoin = 0
    // For tracking JOIN clauses in a query
    //   = 0 - JOIN not found till now
    //   > 0 - Index of last JOIN clause (which appears together with other JOINs) in the statement.
    let maxJoin = 0
    let error = 0
    let lastIdx = 0
    for (const clauseType of clauses) {
      const clauseStartIdx = getClauseStartOffset(this, list, clauseType)

      if (
        clauseStartIdx !== -1 &&
        this instanceof SelectStatement &&
        (clauseType === 'FORCE' || clauseType === 'IGNORE' || clauseType === 'USE')
      ) {
        // TODO: ordering of clauses in a SELECT statement with
        // Index hints is not supported
        return true
      }

      // Handle ordering of Multiple Joins in a query
      if (clauseStartIdx !== -1) {
        const containsJoinClause = strtoupper(clauseType).includes('JOIN')
        if (minJoin === 0 && containsJoinClause) {
          // First JOIN clause is detected
          minJoin = maxJoin = clauseStartIdx
        } else if (minJoin !== 0 && !containsJoinClause) {
          // After a previous JOIN clause, a non-JOIN clause has been detected
          maxJoin = lastIdx
        } else if (maxJoin < clauseStartIdx && containsJoinClause) {
          error = 1
        }
      }

      if (clauseStartIdx !== -1 && clauseStartIdx < minIdx) {
        if (minJoin === 0 || error === 1) {
          const token = list.at(clauseStartIdx)
          parser.error('Unexpected ordering of clauses.', token)
          return false
        }
        minIdx = clauseStartIdx
      } else if (clauseStartIdx !== -1) {
        minIdx = clauseStartIdx
      }

      lastIdx = clauseStartIdx !== -1 ? clauseStartIdx : lastIdx
    }

    return true
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Utils/Query.php::getClauseStartOffset
export function getClauseStartOffset(statement: Statement, list: TokensList, clause: string): number {
  // The count of brackets. We keep track of them so we won't insert the clause in a subquery.
  let brackets = 0
  // The clauses of this type of statement and their index.
  const clauses = statement.getClauses()

  for (let i = statement.first ?? 0; i <= (statement.last ?? -1); ++i) {
    const token = list.tokens[i]
    if (token === undefined) {
      // PHP reads `null` here; every check below fails on it.
      continue
    }

    if (token.type === TokenType.Comment) continue

    if (token.type === TokenType.Operator) {
      if (token.value === '(') {
        ++brackets
      } else if (token.value === ')') {
        --brackets
      }
    }

    if (brackets !== 0) continue

    if (
      token.type === TokenType.Keyword &&
      token.keyword !== null &&
      Object.hasOwn(clauses, token.keyword) &&
      clause === token.keyword
    ) {
      return i
    }

    if (token.keyword === 'UNION') return -1
  }

  return -1
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/NotImplementedStatement.php::NotImplementedStatement
export class NotImplementedStatement extends Statement {
  readonly kind: StatementClassName | 'NotImplementedStatement' = 'NotImplementedStatement'
  /** The part of the statement that can't be parsed. */
  unknown: Token[] = []

  override build(): string {
    // Building the parsed part of the query (if any).
    let query = super.build() + ' '
    // Rebuilding the unknown part from tokens.
    for (const token of this.unknown) query += token.token
    return query
  }

  override parse(_parser: Parser, list: TokensList): void {
    for (; list.idx < list.count; ++list.idx) {
      if ((list.tokens[list.idx] as Token).type === TokenType.Delimiter) break
      this.unknown.push(list.tokens[list.idx] as Token)
    }
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/ShowStatement.php::ShowStatement
export class ShowStatement extends NotImplementedStatement {
  override readonly kind = 'ShowStatement'
  static override statementOptions: OptionSpecs = {
    CREATE: 1,
    AUTHORS: 2,
    BINARY: 2,
    BINLOG: 2,
    CHARACTER: 2,
    CODE: 2,
    COLLATION: 2,
    COLUMNS: 2,
    CONTRIBUTORS: 2,
    DATABASE: 2,
    DATABASES: 2,
    ENGINE: 2,
    ENGINES: 2,
    ERRORS: 2,
    EVENT: 2,
    EVENTS: 2,
    FUNCTION: 2,
    GRANTS: 2,
    HOSTS: 2,
    INDEX: 2,
    INNODB: 2,
    LOGS: 2,
    MASTER: 2,
    OPEN: 2,
    PLUGINS: 2,
    PRIVILEGES: 2,
    PROCEDURE: 2,
    PROCESSLIST: 2,
    PROFILE: 2,
    PROFILES: 2,
    SCHEDULER: 2,
    SET: 2,
    SLAVE: 2,
    STATUS: 2,
    TABLE: 2,
    TABLES: 2,
    TRIGGER: 2,
    TRIGGERS: 2,
    VARIABLES: 2,
    VIEW: 2,
    WARNINGS: 2,
  }
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/AlterStatement.php::AlterStatement
export class AlterStatement extends Statement {
  readonly kind = 'AlterStatement'
  /** Table affected. */
  table: Expression | null = null
  /** Column affected by this statement. */
  altered: AlterOperation[] | null = []

  static override statementOptions: OptionSpecs = {
    ONLINE: 1,
    OFFLINE: 1,
    IGNORE: 2,
    // `DEFINER` is also used for `ALTER EVENT`
    DEFINER: [2, 'expr='],
    DATABASE: 3,
    EVENT: 3,
    FUNCTION: 3,
    PROCEDURE: 3,
    SERVER: 3,
    TABLE: 3,
    TABLESPACE: 3,
    USER: 3,
    VIEW: 3,
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/AlterStatement.php::parse
  override parse(parser: Parser, list: TokensList): void {
    ++list.idx // Skipping `ALTER`.
    const parsedOptions = OptionsArrays.parse(parser, list, AlterStatement.statementOptions)
    if (parsedOptions.isEmpty()) {
      parser.error('Unrecognized alter operation.', list.at(list.idx))
      return
    }

    this.options = parsedOptions
    ++list.idx

    // Parsing affected table.
    this.table = Expressions.parse(parser, list, { parseField: 'table', breakOnAlias: true })
    ++list.idx // Skipping field.

    // 0 -> alter operation, 1 -> `,` or end
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        let options: OptionSpecs = {}
        if (this.options.has('DATABASE')) {
          options = ALTER_DATABASE_OPTIONS
        } else if (this.options.has('TABLE')) {
          options = ALTER_TABLE_OPTIONS
        } else if (this.options.has('VIEW')) {
          options = ALTER_VIEW_OPTIONS
        } else if (this.options.has('USER')) {
          options = ALTER_USER_OPTIONS
        } else if (this.options.has('EVENT')) {
          options = ALTER_EVENT_OPTIONS
        } else if (this.options.has('FUNCTION') || this.options.has('PROCEDURE')) {
          options = ALTER_ROUTINE_OPTIONS
        }
        this.altered ??= []
        this.altered.push(AlterOperations.parse(parser, list, options))
        state = 1
      } else if (state === 1) {
        if (token.type === TokenType.Operator && token.value === ',') state = 0
      }
    }
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/AlterStatement.php::build
  override build(): string {
    const tmp: string[] = []
    for (const altered of this.altered ?? []) tmp.push(altered.build())
    return trim('ALTER ' + built(this.options) + ' ' + built(this.table) + ' ' + tmp.join(', '))
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/AnalyzeStatement.php::AnalyzeStatement
export class AnalyzeStatement extends Statement {
  readonly kind = 'AnalyzeStatement'
  static override statementOptions: OptionSpecs = {
    TABLE: 1,
    NO_WRITE_TO_BINLOG: 2,
    LOCAL: 3,
  }
  /** Analyzed tables. */
  tables: Expression[] | null = null
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/MaintenanceStatement.php::MaintenanceStatement
export abstract class MaintenanceStatement extends Statement {
  /** Tables maintained. */
  tables: Expression[] | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/MaintenanceStatement.php::after
  override after(parser: Parser, list: TokensList, _token: Token): void {
    // [some options] is going to be parsed first.
    //
    // There is a parser specified in `Parser::$KEYWORD_PARSERS`
    // which parses the name of the tables.
    //
    // Finally, we parse here [some more options] and that's all.
    ++list.idx
    ;(this.options as OptionsArray).merge(OptionsArrays.parse(parser, list, this.statics.statementOptions))
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/BackupStatement.php::BackupStatement
export class BackupStatement extends MaintenanceStatement {
  readonly kind = 'BackupStatement'
  static override statementOptions: OptionSpecs = {
    TABLE: 1,
    NO_WRITE_TO_BINLOG: 2,
    LOCAL: 3,
    TO: [4, 'var'],
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/CheckStatement.php::CheckStatement
export class CheckStatement extends MaintenanceStatement {
  readonly kind = 'CheckStatement'
  static override statementOptions: OptionSpecs = {
    TABLE: 1,
    'FOR UPGRADE': 2,
    QUICK: 3,
    FAST: 4,
    MEDIUM: 5,
    EXTENDED: 6,
    CHANGED: 7,
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/ChecksumStatement.php::ChecksumStatement
export class ChecksumStatement extends MaintenanceStatement {
  readonly kind = 'ChecksumStatement'
  static override statementOptions: OptionSpecs = {
    TABLE: 1,
    QUICK: 2,
    EXTENDED: 3,
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/RepairStatement.php::RepairStatement
export class RepairStatement extends MaintenanceStatement {
  readonly kind = 'RepairStatement'
  static override statementOptions: OptionSpecs = {
    TABLE: 1,
    NO_WRITE_TO_BINLOG: 2,
    LOCAL: 3,
    QUICK: 4,
    EXTENDED: 5,
    USE_FRM: 6,
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/RestoreStatement.php::RestoreStatement
export class RestoreStatement extends MaintenanceStatement {
  readonly kind = 'RestoreStatement'
  static override statementOptions: OptionSpecs = {
    TABLE: 1,
    FROM: [2, 'var'],
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/OptimizeStatement.php::OptimizeStatement
export class OptimizeStatement extends Statement {
  readonly kind = 'OptimizeStatement'
  static override statementOptions: OptionSpecs = {
    TABLE: 1,
    NO_WRITE_TO_BINLOG: 2,
    LOCAL: 3,
  }
  /** Optimized tables. */
  tables: Expression[] | null = null
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/CallStatement.php::CallStatement
export class CallStatement extends Statement {
  readonly kind = 'CallStatement'
  /** The name of the function and its parameters. */
  call: FunctionCall | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/CallStatement.php::build
  override build(): string {
    const call = this.call as FunctionCall
    return 'CALL ' + str(call.name) + '(' + (call.parameters ? call.parameters.raw.join(',') : '') + ')'
  }
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/CreateStatement.php::CreateStatement
export class CreateStatement extends Statement {
  readonly kind = 'CreateStatement'

  static override statementOptions: OptionSpecs = {
    // CREATE TABLE
    TEMPORARY: 1,

    // CREATE VIEW
    'OR REPLACE': 2,
    ALGORITHM: [3, 'var='],
    // `DEFINER` is also used for `CREATE FUNCTION / PROCEDURE`
    DEFINER: [4, 'expr='],
    // Used in `CREATE VIEW`
    'SQL SECURITY': [5, 'var'],

    DATABASE: 6,
    EVENT: 6,
    FUNCTION: 6,
    INDEX: 6,
    'UNIQUE INDEX': 6,
    'FULLTEXT INDEX': 6,
    'SPATIAL INDEX': 6,
    PROCEDURE: 6,
    SERVER: 6,
    TABLE: 6,
    TABLESPACE: 6,
    TRIGGER: 6,
    USER: 6,
    VIEW: 6,
    SCHEMA: 6,

    // CREATE TABLE
    'IF NOT EXISTS': 7,
  }

  /** All database options. */
  static readonly DATABASE_OPTIONS: OptionSpecs = {
    'CHARACTER SET': [1, 'var='],
    CHARSET: [1, 'var='],
    'DEFAULT CHARACTER SET': [1, 'var='],
    'DEFAULT CHARSET': [1, 'var='],
    'DEFAULT COLLATE': [2, 'var='],
    COLLATE: [2, 'var='],
  }

  /** All table options. */
  static readonly TABLE_OPTIONS: OptionSpecs = {
    ENGINE: [1, 'var='],
    AUTO_INCREMENT: [2, 'var='],
    AVG_ROW_LENGTH: [3, 'var'],
    'CHARACTER SET': [4, 'var='],
    CHARSET: [4, 'var='],
    'DEFAULT CHARACTER SET': [4, 'var='],
    'DEFAULT CHARSET': [4, 'var='],
    CHECKSUM: [5, 'var'],
    'DEFAULT COLLATE': [6, 'var='],
    COLLATE: [6, 'var='],
    COMMENT: [7, 'var='],
    CONNECTION: [8, 'var'],
    'DATA DIRECTORY': [9, 'var'],
    DELAY_KEY_WRITE: [10, 'var'],
    'INDEX DIRECTORY': [11, 'var'],
    INSERT_METHOD: [12, 'var'],
    KEY_BLOCK_SIZE: [13, 'var'],
    MAX_ROWS: [14, 'var'],
    MIN_ROWS: [15, 'var'],
    PACK_KEYS: [16, 'var'],
    PASSWORD: [17, 'var'],
    ROW_FORMAT: [18, 'var'],
    TABLESPACE: [19, 'var'],
    STORAGE: [20, 'var'],
    UNION: [21, 'var'],
    PAGE_COMPRESSED: [22, 'var'],
    PAGE_COMPRESSION_LEVEL: [23, 'var'],
  }

  /** All function options. */
  static readonly FUNCTION_OPTIONS: OptionSpecs = {
    NOT: [2, 'var'],
    FUNCTION: [3, 'var='],
    PROCEDURE: [3, 'var='],
    'CONTAINS SQL': 4,
    'NO SQL': 4,
    'READS SQL DATA': 4,
    'MODIFIES SQL DATA': 4,
    'SQL SECURITY': [6, 'var'],
    LANGUAGE: [7, 'var'],
    COMMENT: [8, 'var'],

    CREATE: 1,
    DETERMINISTIC: 2,
  }

  /** All trigger options. */
  static readonly TRIGGER_OPTIONS: OptionSpecs = {
    BEFORE: 1,
    AFTER: 1,
    INSERT: 2,
    UPDATE: 2,
    DELETE: 2,
  }

  /** The name of the entity that is created. Used by all `CREATE` statements. */
  name: Expression | null = null
  /** The options of the entity (table, procedure, function, etc.). */
  entityOptions: OptionsArray | null = null
  /** If `CREATE TABLE`, a list of columns and keys; if `CREATE VIEW`, a list of columns. */
  fields: CreateDefinition[] | ArrayObj | null = null
  /** If `CREATE TABLE WITH`; if `CREATE VIEW AS WITH`. */
  with: WithStatement | null = null
  /** If `CREATE TABLE ... SELECT`; if `CREATE VIEW AS ` ... SELECT. */
  select: SelectStatement | null = null
  /** If `CREATE TABLE ... LIKE`. */
  like: Expression | null = null
  /** Expression used for partitioning. */
  partitionBy: string | null = null
  /** The number of partitions. */
  partitionsNum: TokenValue | null = null
  /** Expression used for subpartitioning. */
  subpartitionBy: string | null = null
  /** The number of subpartitions. */
  subpartitionsNum: TokenValue | null = null
  /** The partition of the new table. */
  partitions: PartitionDefinition[] | null = null
  /** If `CREATE TRIGGER` the name of the table. */
  table: Expression | null = null
  /** The return data type of this routine. */
  return: DataType | null = null
  /** The parameters of this routine. */
  parameters: ParameterDefinition[] | null = null
  /** The body of this function or procedure. For views, it is the select statement that creates the view. */
  body: Token[] = []

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/CreateStatement.php::build
  override build(): string {
    const options = this.options as OptionsArray
    let fields = ''
    if (this.fields !== null && !(Array.isArray(this.fields) && this.fields.length === 0)) {
      if (Array.isArray(this.fields)) {
        fields = CreateDefinitions.buildAll(this.fields) + ' '
      } else {
        fields = this.fields.build()
      }
    }

    if (options.has('DATABASE') || options.has('SCHEMA')) {
      return 'CREATE ' + options.build() + ' ' + built(this.name) + ' ' + built(this.entityOptions)
    }

    if (options.has('TABLE')) {
      if (this.select !== null) {
        return 'CREATE ' + options.build() + ' ' + built(this.name) + ' ' + this.select.build()
      }
      if (this.like !== null) {
        return 'CREATE ' + options.build() + ' ' + built(this.name) + ' LIKE ' + this.like.build()
      }
      if (this.with !== null) {
        return 'CREATE ' + options.build() + ' ' + built(this.name) + ' ' + this.with.build()
      }

      let partition = ''
      if (!empty(this.partitionBy)) partition += '\nPARTITION BY ' + this.partitionBy
      if (!empty(this.partitionsNum)) partition += '\nPARTITIONS ' + str(this.partitionsNum)
      if (!empty(this.subpartitionBy)) partition += '\nSUBPARTITION BY ' + this.subpartitionBy
      if (!empty(this.subpartitionsNum)) partition += '\nSUBPARTITIONS ' + str(this.subpartitionsNum)
      if (!empty(this.partitions)) {
        partition += '\n' + buildPartitionDefinitions(this.partitions as PartitionDefinition[])
      }

      return (
        'CREATE ' +
        options.build() +
        ' ' +
        built(this.name) +
        ' ' +
        fields +
        (this.entityOptions?.build() ?? '') +
        partition
      )
    }

    if (options.has('VIEW')) {
      let builtStatement = ''
      if (this.select !== null) {
        builtStatement = this.select.build()
      } else if (this.with !== null) {
        builtStatement = this.with.build()
      }
      return (
        'CREATE ' +
        options.build() +
        ' ' +
        built(this.name) +
        ' ' +
        fields +
        ' AS ' +
        builtStatement +
        TokensList.buildFromArray(this.body) +
        ' ' +
        (this.entityOptions?.build() ?? '')
      )
    }

    if (options.has('TRIGGER')) {
      return (
        'CREATE ' +
        options.build() +
        ' ' +
        built(this.name) +
        ' ' +
        built(this.entityOptions) +
        ' ' +
        'ON ' +
        built(this.table) +
        ' ' +
        'FOR EACH ROW ' +
        TokensList.buildFromArray(this.body)
      )
    }

    if (options.has('PROCEDURE') || options.has('FUNCTION')) {
      let tmp = ''
      if (options.has('FUNCTION')) tmp = 'RETURNS ' + built(this.return)
      return (
        'CREATE ' +
        options.build() +
        ' ' +
        built(this.name) +
        ' ' +
        ParameterDefinitions.buildAll(requireArray(this.parameters)) +
        ' ' +
        tmp +
        ' ' +
        built(this.entityOptions) +
        ' ' +
        TokensList.buildFromArray(this.body)
      )
    }

    return 'CREATE ' + options.build() + ' ' + built(this.name) + ' ' + TokensList.buildFromArray(this.body)
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/CreateStatement.php::parse
  override parse(parser: Parser, list: TokensList): void {
    ++list.idx // Skipping `CREATE`.

    // Parsing options.
    this.options = OptionsArrays.parse(parser, list, CreateStatement.statementOptions)
    ++list.idx // Skipping last option.

    const isDatabase = this.options.has('DATABASE') || this.options.has('SCHEMA')
    const fieldName = isDatabase ? 'database' : 'table'

    // Parsing the field name.
    this.name = Expressions.parse(parser, list, { parseField: fieldName, breakOnAlias: true })

    if (this.name === null) {
      parser.error('The name of the entity was expected.', list.at(list.idx))
    } else {
      ++list.idx // Skipping field.
    }

    let token: Token | null = list.at(list.idx)
    let nextidx = list.idx + 1
    while (nextidx < list.count && (list.tokens[nextidx] as Token).type === TokenType.Whitespace) {
      ++nextidx
    }
    const nextToken = (): Token | null => list.at(nextidx)

    if (isDatabase) {
      this.entityOptions = OptionsArrays.parse(parser, list, CreateStatement.DATABASE_OPTIONS)
    } else if (this.options.has('TABLE')) {
      if (token?.type === TokenType.Keyword && token.keyword === 'SELECT') {
        // CREATE TABLE ... SELECT
        this.select = SelectStatement.parsed(parser, list)
      } else if (token?.type === TokenType.Keyword && token.keyword === 'WITH') {
        // CREATE TABLE WITH
        this.with = WithStatement.parsed(parser, list)
      } else if (
        token?.type === TokenType.Keyword &&
        token.keyword === 'AS' &&
        nextToken()?.type === TokenType.Keyword
      ) {
        if (nextToken()?.value === 'SELECT') {
          // CREATE TABLE ... AS SELECT
          list.idx = nextidx
          this.select = SelectStatement.parsed(parser, list)
        } else if (nextToken()?.value === 'WITH') {
          // CREATE TABLE ... AS WITH
          list.idx = nextidx
          this.with = WithStatement.parsed(parser, list)
        }
      } else if (token?.type === TokenType.Keyword && token.keyword === 'LIKE') {
        // CREATE TABLE `new_tbl` LIKE 'orig_tbl'
        list.idx = nextidx
        this.like = Expressions.parse(parser, list, { parseField: 'table', breakOnAlias: true })
        // The 'LIKE' keyword was found, but no table_name was found next to it
        if (this.like === null) parser.error('A table name was expected.', list.at(list.idx))
      } else {
        this.fields = CreateDefinitions.parse(parser, list)
        if (this.fields.length === 0) {
          parser.error('At least one column definition was expected.', list.at(list.idx))
        }

        ++list.idx

        this.entityOptions = OptionsArrays.parse(parser, list, CreateStatement.TABLE_OPTIONS)

        // The field that is being filled (`partitionBy` or `subpartitionBy`).
        let field: 'partitionBy' | 'subpartitionBy' | null = null
        // The number of brackets. `false` means no bracket was found previously. At least one bracket is
        // required to validate the expression.
        let brackets: number | false = false

        // Handles partitions.
        for (; list.idx < list.count; ++list.idx) {
          token = list.tokens[list.idx] as Token

          // End of statement.
          if (token.type === TokenType.Delimiter) break

          // Skipping comments.
          if (token.type === TokenType.Comment) continue

          if (token.type === TokenType.Keyword && token.keyword === 'PARTITION BY') {
            field = 'partitionBy'
            brackets = false
          } else if (token.type === TokenType.Keyword && token.keyword === 'SUBPARTITION BY') {
            field = 'subpartitionBy'
            brackets = false
          } else if (token.type === TokenType.Keyword && token.keyword === 'PARTITIONS') {
            const t = list.getNextOfType(TokenType.Number)
            --list.idx // `getNextOfType` also advances one position.
            this.partitionsNum = t === null ? null : t.value
          } else if (token.type === TokenType.Keyword && token.keyword === 'SUBPARTITIONS') {
            const t = list.getNextOfType(TokenType.Number)
            --list.idx // `getNextOfType` also advances one position.
            this.subpartitionsNum = t === null ? null : t.value
          } else if (field !== null) {
            if (token.type === TokenType.Operator) {
              if (token.value === '(') {
                brackets = Number(brackets) + 1
              } else if (token.value === ')') {
                // PHP: decrementing `false` has no effect.
                if (brackets !== false) --brackets
              }
            }

            // Building the expression used for partitioning.
            this[field] = str(this[field]) + (token.type === TokenType.Whitespace ? ' ' : token.token)

            if (brackets === 0) {
              this[field] = trim(str(this[field]))
              field = null
            }
          } else if (token.type === TokenType.Operator && token.value === '(') {
            if (!empty(this.partitionBy)) {
              this.partitions = ArrayObjs.parsePartitions(parser, list)
            }
            break
          }
        }
      }
    } else if (this.options.has('PROCEDURE') || this.options.has('FUNCTION')) {
      this.parameters = ParameterDefinitions.parse(parser, list)
      if (this.options.has('FUNCTION')) {
        const prevToken = token
        const t = list.getNextOfType(TokenType.Keyword)
        if (t === null || t.keyword !== 'RETURNS') {
          parser.error('A "RETURNS" keyword was expected.', t ?? prevToken)
        } else {
          ++list.idx
          this.return = DataTypes.parse(parser, list)
        }
      }

      ++list.idx

      this.entityOptions = OptionsArrays.parse(parser, list, CreateStatement.FUNCTION_OPTIONS)
      ++list.idx

      for (; list.idx < list.count; ++list.idx) {
        token = list.tokens[list.idx] as Token
        if (token.type === TokenType.Delimiter) break
        this.body.push(token)
      }
    } else if (this.options.has('VIEW')) {
      // Parsing columns list.
      const t = list.getNext() // Skipping whitespaces and comments.

      if (t !== null && t.type === TokenType.Operator && t.value === '(') {
        --list.idx // getNext() also goes forward one field.
        this.fields = ArrayObjs.parse(parser, list)
        ++list.idx // Skipping last token from the array.
        list.getNext()
      }

      // Parsing the SELECT expression if the view started with it.
      if (
        t !== null &&
        t.type === TokenType.Keyword &&
        t.keyword === 'AS' &&
        nextToken()?.type === TokenType.Keyword
      ) {
        if (nextToken()?.value === 'SELECT') {
          list.idx = nextidx
          this.select = SelectStatement.parsed(parser, list)
          ++list.idx // Skipping last token from the select.
        } else if (nextToken()?.value === 'WITH') {
          ++list.idx
          this.with = WithStatement.parsed(parser, list)
        }
      }

      // Parsing all other tokens until the end of the statement.
      for (; list.idx < list.count; ++list.idx) {
        token = list.tokens[list.idx] as Token
        if (token.type === TokenType.Delimiter) break
        this.body.push(token)
      }
    } else if (this.options.has('TRIGGER')) {
      // Parsing the time and the event.
      this.entityOptions = OptionsArrays.parse(parser, list, CreateStatement.TRIGGER_OPTIONS)
      ++list.idx

      list.getNextOfTypeAndValue(TokenType.Keyword, 'ON')
      ++list.idx // Skipping `ON`.

      // Parsing the name of the table.
      this.table = Expressions.parse(parser, list, { parseField: 'table', breakOnAlias: true })
      ++list.idx

      list.getNextOfTypeAndValue(TokenType.Keyword, 'FOR EACH ROW')
      ++list.idx // Skipping `FOR EACH ROW`.

      for (; list.idx < list.count; ++list.idx) {
        token = list.tokens[list.idx] as Token
        if (token.type === TokenType.Delimiter) break
        this.body.push(token)
      }
    } else {
      for (; list.idx < list.count; ++list.idx) {
        token = list.tokens[list.idx] as Token
        if (token.type === TokenType.Delimiter) break
        this.body.push(token)
      }
    }
  }
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/DeleteStatement.php::DeleteStatement
export class DeleteStatement extends Statement {
  readonly kind = 'DeleteStatement'
  static override statementOptions: OptionSpecs = {
    LOW_PRIORITY: 1,
    QUICK: 2,
    IGNORE: 3,
  }

  static override clauses: Clauses = {
    DELETE: ['DELETE', ADD_KEYWORD],
    // Used for options.
    _OPTIONS: ['_OPTIONS', ADD_CLAUSE],
    FROM: ['FROM', ADD_CLAUSE | ADD_KEYWORD],
    PARTITION: ['PARTITION', ADD_CLAUSE | ADD_KEYWORD],
    USING: ['USING', ADD_CLAUSE | ADD_KEYWORD],
    WHERE: ['WHERE', ADD_CLAUSE | ADD_KEYWORD],
    'ORDER BY': ['ORDER BY', ADD_CLAUSE | ADD_KEYWORD],
    LIMIT: ['LIMIT', ADD_CLAUSE | ADD_KEYWORD],
  }

  /** Table(s) used as sources for this statement. */
  from: (Expression | CaseExpression)[] | null = null
  /** Joins. */
  join: JoinKeyword[] | null = null
  /** Tables used as sources for this statement. */
  using: (Expression | CaseExpression)[] | null = null
  /** Columns used in this statement. */
  columns: (Expression | CaseExpression)[] | null = null
  /** Partitions used as source for this statement. */
  partition: ArrayObj | null = null
  /** Conditions used for filtering each row of the result set. */
  where: Condition[] | null = null
  /** Specifies the order of the rows in the result set. */
  order: OrderKeyword[] | null = null
  /** Conditions used for limiting the size of the result set. */
  limit: Limit | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/DeleteStatement.php::build
  override build(): string {
    let ret = 'DELETE ' + (this.options as OptionsArray).build()

    if (this.columns !== null && this.columns.length > 0) ret += ' ' + Expressions.buildAll(this.columns)
    if (this.from !== null && this.from.length > 0) ret += ' FROM ' + Expressions.buildAll(this.from)
    if (this.join !== null && this.join.length > 0) ret += ' ' + JoinKeywords.buildAll(this.join)
    if (this.using !== null && this.using.length > 0) ret += ' USING ' + Expressions.buildAll(this.using)
    if (this.where !== null && this.where.length > 0) ret += ' WHERE ' + Conditions.buildAll(this.where)
    if (this.order !== null && this.order.length > 0) ret += ' ORDER BY ' + OrderKeywords.buildAll(this.order)
    if (this.limit !== null && str(this.limit).length > 0) ret += ' LIMIT ' + this.limit.build()

    return ret
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/DeleteStatement.php::parse
  override parse(parser: Parser, list: TokensList): void {
    ++list.idx // Skipping `DELETE`.

    // parse any options if provided
    this.options = OptionsArrays.parse(parser, list, DeleteStatement.statementOptions)
    ++list.idx

    // 0 -> columns or FROM, 1 -> FROM, 2 -> tables + JOIN/USING/WHERE/ORDER BY/LIMIT, 3 -> WHERE (after USING),
    // 4 -> ORDER BY/LIMIT, 5 -> LIMIT, 6 -> end
    let state = 0
    // If the query is multi-table or not
    let multiTable = false

    loop: for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // End of statement.
      if (token.type === TokenType.Delimiter) break

      if (state === 0) {
        if (token.type === TokenType.Keyword) {
          if (token.keyword !== 'FROM') {
            parser.error('Unexpected keyword.', token)
            break
          }
          ++list.idx // Skip 'FROM'
          this.from = ExpressionArray.parse(parser, list)
          state = 2
        } else {
          this.columns = ExpressionArray.parse(parser, list)
          state = 1
        }
      } else if (state === 1) {
        if (token.type !== TokenType.Keyword) {
          parser.error('Unexpected token.', token)
          break
        }
        if (token.keyword !== 'FROM') {
          parser.error('Unexpected keyword.', token)
          break
        }
        ++list.idx // Skip 'FROM'
        this.from = ExpressionArray.parse(parser, list)
        state = 2
      } else if (state === 2) {
        if (token.type === TokenType.Keyword) {
          if ((token.keyword as string).toUpperCase().includes('JOIN')) {
            ++list.idx
            this.join = JoinKeywords.parse(parser, list)
            // remain in state = 2
          } else {
            switch (token.keyword) {
              case 'USING':
                ++list.idx // Skip 'USING'
                this.using = ExpressionArray.parse(parser, list)
                state = 3
                multiTable = true
                break
              case 'WHERE':
                ++list.idx // Skip 'WHERE'
                this.where = Conditions.parse(parser, list)
                state = 4
                break
              case 'ORDER BY':
                ++list.idx // Skip 'ORDER BY'
                this.order = OrderKeywords.parse(parser, list)
                state = 5
                break
              case 'LIMIT':
                ++list.idx // Skip 'LIMIT'
                this.limit = Limits.parse(parser, list)
                state = 6
                break
              default:
                parser.error('Unexpected keyword.', token)
                break loop
            }
          }
        }
      } else if (state === 3) {
        if (token.type !== TokenType.Keyword) {
          parser.error('Unexpected token.', token)
          break
        }
        if (token.keyword !== 'WHERE') {
          parser.error('Unexpected keyword.', token)
          break
        }
        ++list.idx // Skip 'WHERE'
        this.where = Conditions.parse(parser, list)
        state = 4
      } else if (state === 4) {
        if (multiTable && token.type === TokenType.Keyword) {
          parser.error('This type of clause is not valid in Multi-table queries.', token)
          break
        }

        if (token.type === TokenType.Keyword) {
          switch (token.keyword) {
            case 'ORDER BY':
              ++list.idx // Skip 'ORDER  BY'
              this.order = OrderKeywords.parse(parser, list)
              state = 5
              break
            case 'LIMIT':
              ++list.idx // Skip 'LIMIT'
              this.limit = Limits.parse(parser, list)
              state = 6
              break
            default:
              parser.error('Unexpected keyword.', token)
              break loop
          }
        }
      } else if (state === 5) {
        if (token.type === TokenType.Keyword) {
          if (token.keyword !== 'LIMIT') {
            parser.error('Unexpected keyword.', token)
            break
          }
          ++list.idx // Skip 'LIMIT'
          this.limit = Limits.parse(parser, list)
          state = 6
        }
      }
    }

    if (state >= 2) {
      for (const fromExpr of this.from ?? []) {
        const f = fieldsOf(fromExpr)
        f.database = f.table
        f.table = f.column
        f.column = null
      }
    }

    --list.idx
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/DropStatement.php::DropStatement
export class DropStatement extends Statement {
  readonly kind = 'DropStatement'
  static override statementOptions: OptionSpecs = {
    DATABASE: 1,
    EVENT: 1,
    FUNCTION: 1,
    INDEX: 1,
    LOGFILE: 1,
    PROCEDURE: 1,
    SCHEMA: 1,
    SERVER: 1,
    TABLE: 1,
    VIEW: 1,
    TABLESPACE: 1,
    TRIGGER: 1,
    USER: 1,

    TEMPORARY: 2,
    'IF EXISTS': 3,
  }

  static override clauses: Clauses = {
    DROP: ['DROP', ADD_KEYWORD],
    // Used for options.
    _OPTIONS: ['_OPTIONS', ADD_CLAUSE],
    // Used for select expressions.
    DROP_: ['DROP', ADD_CLAUSE],
    ON: ['ON', ADD_CLAUSE | ADD_KEYWORD],
  }

  /** Dropped elements. */
  fields: (Expression | CaseExpression)[] | null = null
  /** Table of the dropped index. */
  table: Expression | null = null
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/ExplainStatement.php::ExplainStatement
export class ExplainStatement extends Statement {
  readonly kind = 'ExplainStatement'

  private static readonly OPTIONS: OptionSpecs = {
    EXTENDED: 1,
    PARTITIONS: 1,
    FORMAT: [1, 'var'],
  }

  /** The parser of the statement to be explained. */
  bodyParser: Parser | null = null
  /** The statement alias, could be any of the following: {EXPLAIN | DESCRIBE | DESC}, {EXPLAIN | DESCRIBE | DESC}
   * ANALYZE, ANALYZE */
  statementAlias = ''
  /** The connection identifier, if used. */
  connectionId: TokenValue | null = null
  /** The explained database for the table's name, if used. */
  explainedDatabase: TokenValue | null = null
  /** The explained table's name, if used. */
  explainedTable: TokenValue | null = null
  /** The explained column's name, if used. */
  explainedColumn: string | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/ExplainStatement.php::parse
  override parse(parser: Parser, list: TokensList): void {
    // 0 -> EXPLAIN/DESC/DESCRIBE/ANALYZE, 1 -> options, 2 -> explainable statement, 3 -> table/column
    let state = 0
    // To handle the use of 'analyze' in the MariaDB query.
    let miniState = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // End of statement.
      if (token.type === TokenType.Delimiter) {
        --list.idx // Back up one token, no real reasons to document
        break
      }

      // Skipping whitespaces and comments.
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        if (token.keyword === 'ANALYZE' && miniState === 0) {
          state = 1
          this.statementAlias = 'ANALYZE'
        } else if (token.keyword === 'EXPLAIN' || token.keyword === 'DESC' || token.keyword === 'DESCRIBE') {
          this.statementAlias = token.keyword

          let lastIdx = list.idx
          list.idx++ // Ignore the current token
          const nextKeyword = list.getNextOfType(TokenType.Keyword)
          list.idx = lastIdx

          // There is no other keyword, we must be describing a table
          if (nextKeyword === null) {
            state = 3
            continue
          }

          miniState = 1

          lastIdx = list.idx
          const analyze = list.getNextOfTypeAndValue(TokenType.Keyword, 'ANALYZE')
          if (analyze !== null && analyze.keyword !== null) {
            miniState = 2
            this.statementAlias += ' ANALYZE'
          } else {
            list.idx = lastIdx
          }

          state = 1
        }
      } else if (state === 1) {
        // Parsing options.
        this.options = OptionsArrays.parse(parser, list, ExplainStatement.OPTIONS)
        state = 2
      } else if (state === 2) {
        const currIdx = list.idx
        list.idx++ // Ignore the current token
        let nextToken = list.getNext()
        list.idx = currIdx

        if (token.keyword === 'FOR' && nextToken?.keyword === 'CONNECTION') {
          list.idx++ // Ignore the current token
          list.getNext() // CONNECTION
          nextToken = list.getNext() // Identifier
          this.connectionId = nextToken?.value ?? null
          break
        }

        if (
          token.keyword !== 'SELECT' &&
          token.keyword !== 'TABLE' &&
          token.keyword !== 'INSERT' &&
          token.keyword !== 'REPLACE' &&
          token.keyword !== 'UPDATE' &&
          token.keyword !== 'DELETE'
        ) {
          parser.error('Unexpected token.', token)
          break
        }

        // Index of the last parsed token by default would be the last token in the list.
        const idxOfLastParsedToken = list.count - 1
        const subList = new TokensList(list.tokens.slice(list.idx))

        this.bodyParser = new Parser(subList)
        if (this.bodyParser.errors.length > 0) {
          for (const error of this.bodyParser.errors) parser.errors.push(error)
          break
        }

        list.idx = idxOfLastParsedToken
        break
      } else if (state === 3) {
        if (token.type === TokenType.Operator && token.value === '.') continue

        if (this.explainedDatabase === null) {
          const lastIdx = list.idx
          const nextDot = list.getNextOfTypeAndValue(TokenType.Operator, '.')
          list.idx = lastIdx
          if (nextDot !== null) {
            // Found a dot, so it must be a db.table name format
            this.explainedDatabase = token.value
            continue
          }
        }

        if (this.explainedTable === null) {
          this.explainedTable = token.value
          continue
        }

        if (this.explainedColumn === null) this.explainedColumn = str(token.value)
      }
    }

    if (state !== 3 || this.explainedTable !== null) return

    // We reached end of the state 3 and no table name was found
    parser.error('Expected a table name.', list.at(list.idx))
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/ExplainStatement.php::build
  override build(): string {
    let s = this.statementAlias

    if (this.options !== null) {
      if (this.options.options.size > 0) s += ' '
      s += this.options.build() + ' '
    }

    if (this.options === null) s += ' '

    if (this.bodyParser !== null) {
      for (const statement of this.bodyParser.statements) s += statement.build()
    } else if (!empty(this.connectionId)) {
      s += 'FOR CONNECTION ' + str(this.connectionId)
    }

    if (this.explainedDatabase !== null && this.explainedTable !== null) {
      s +=
        Context.current.escape(str(this.explainedDatabase)) +
        '.' +
        Context.current.escape(str(this.explainedTable))
    } else if (this.explainedTable !== null) {
      s += Context.current.escape(str(this.explainedTable))
    }

    if (this.explainedColumn !== null) s += ' ' + Context.current.escape(this.explainedColumn)

    return s
  }
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/InsertStatement.php::InsertStatement
export class InsertStatement extends Statement {
  readonly kind = 'InsertStatement'
  static override statementOptions: OptionSpecs = {
    LOW_PRIORITY: 1,
    DELAYED: 2,
    HIGH_PRIORITY: 3,
    IGNORE: 4,
  }

  /** Tables used as target for this statement. */
  into: IntoKeyword | null = null
  /** Values to be inserted. */
  values: ArrayObj[] | null = null
  /** If SET clause is present holds the SetOperation. */
  set: SetOperation[] | null = null
  /** If SELECT clause is present holds the SelectStatement. */
  select: SelectStatement | null = null
  /** If WITH CTE is present holds the WithStatement. */
  with: WithStatement | null = null
  /** If ON DUPLICATE KEY UPDATE clause is present holds the SetOperation. */
  onDuplicateSet: SetOperation[] | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/InsertStatement.php::build
  override build(): string {
    let ret = 'INSERT ' + str(this.options)
    ret = trim(ret) + ' INTO ' + str(this.into)

    if (this.values !== null && this.values.length > 0) {
      ret += ' VALUES ' + ArrayObjs.buildAll(this.values)
    } else if (this.set !== null && this.set.length > 0) {
      ret += ' SET ' + SetOperations.buildAll(this.set)
    } else if (this.select !== null && str(this.select).length > 0) {
      ret += ' ' + this.select.build()
    }

    if (this.onDuplicateSet !== null && this.onDuplicateSet.length > 0) {
      ret += ' ON DUPLICATE KEY UPDATE ' + SetOperations.buildAll(this.onDuplicateSet)
    }

    return ret
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/InsertStatement.php::parse
  override parse(parser: Parser, list: TokensList): void {
    ++list.idx // Skipping `INSERT`.

    // parse any options if provided
    this.options = OptionsArrays.parse(parser, list, InsertStatement.statementOptions)
    ++list.idx

    // 0 -> INTO, 1 -> VALUES/SET/SELECT/WITH, 2 -> ON DUPLICATE KEY UPDATE, 3 -> end
    let state = 0
    // For keeping track of the ON DUPLICATE KEY UPDATE keywords.
    let miniState = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // End of statement.
      if (token.type === TokenType.Delimiter) break

      // Skipping whitespaces and comments.
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        if (token.type === TokenType.Keyword && token.keyword !== 'INTO') {
          parser.error('Unexpected keyword.', token)
          break
        }

        ++list.idx
        this.into = IntoKeywords.parse(parser, list, { fromInsert: true })

        state = 1
      } else if (state === 1) {
        if (token.type !== TokenType.Keyword) {
          parser.error('Unexpected token.', token)
          break
        }

        if (token.keyword === 'VALUE' || token.keyword === 'VALUES') {
          ++list.idx // skip VALUES
          this.values = Array2d.parse(parser, list)
        } else if (token.keyword === 'SET') {
          ++list.idx // skip SET
          this.set = SetOperations.parse(parser, list)
        } else if (token.keyword === 'SELECT') {
          this.select = SelectStatement.parsed(parser, list)
        } else if (token.keyword === 'WITH') {
          this.with = WithStatement.parsed(parser, list)
        } else {
          parser.error('Unexpected keyword.', token)
          break
        }

        state = 2
        miniState = 1
      } else if (state === 2) {
        const lastCount = miniState

        if (miniState === 1 && token.keyword === 'ON') {
          ++miniState
        } else if (miniState === 2 && token.keyword === 'DUPLICATE') {
          ++miniState
        } else if (miniState === 3 && token.keyword === 'KEY') {
          ++miniState
        } else if (miniState === 4 && token.keyword === 'UPDATE') {
          ++miniState
        }

        if (lastCount === miniState) {
          parser.error('Unexpected token.', token)
          break
        }

        if (miniState === 5) {
          ++list.idx
          this.onDuplicateSet = SetOperations.parse(parser, list)
          state = 3
        }
      }
    }

    --list.idx
  }
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/KillStatement.php::KillStatement
export class KillStatement extends Statement {
  readonly kind = 'KillStatement'
  static override statementOptions: OptionSpecs = {
    HARD: 1,
    SOFT: 1,
    CONNECTION: 2,
    QUERY: 2,
    USER: 2,
  }

  /** Holds the identifier if explicitly set */
  identifier: Statement | number | null = null
  /** Whether MariaDB ID keyword is used or not. */
  idKeywordUsed = false
  /** Whether parenthesis used around the identifier or not */
  parenthesisUsed = false

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/KillStatement.php::parse
  override parse(parser: Parser, list: TokensList): void {
    // 0 -> identifier or `(` or `ID`, 2 -> end, 3 -> inside parenthesis
    let state = 0

    ++list.idx // Skipping `KILL`.
    this.options = OptionsArrays.parse(parser, list, KillStatement.statementOptions)
    ++list.idx
    loop: for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      switch (state) {
        case 0: {
          const currIdx = list.idx
          const prev = list.getPreviousOfType(TokenType.Keyword)
          list.idx = currIdx
          if (token.type === TokenType.Number && isPhpInt(token)) {
            this.identifier = token.value as number
            state = 2
          } else if (token.type === TokenType.Operator && token.value === '(') {
            this.parenthesisUsed = true
            state = 3
          } else if (prev !== null && token.value === 'ID' && prev.value === 'QUERY') {
            this.idKeywordUsed = true
            state = 0
          } else {
            parser.error('Unexpected token.', token)
            break loop
          }
          break
        }

        case 3:
          if (token.type === TokenType.Keyword && token.value === 'SELECT') {
            const subList = new TokensList(list.tokens.slice(Math.max(0, list.idx - 1)))
            const subParser = new Parser(subList)
            if (subParser.errors.length > 0) {
              for (const error of subParser.errors) parser.errors.push(error)
              break
            }
            this.identifier = subParser.statements[0] ?? null
            state = 2
          } else if (token.type === TokenType.Operator && token.value === ')') {
            state = 2
          } else if (token.type === TokenType.Number && isPhpInt(token)) {
            this.identifier = token.value as number
            state = 3
          } else {
            parser.error('Unexpected token.', token)
            break loop
          }
          break
      }
    }

    if (state !== 2) {
      const token = list.at(list.idx)
      parser.error('Unexpected end of the KILL statement.', token)
    }

    --list.idx
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/KillStatement.php::build
  override build(): string {
    let ret = 'KILL'
    if (this.options !== null && this.options.options.size > 0) ret += ' ' + this.options.build()
    if (this.idKeywordUsed) ret += ' ID'
    const identifier = str(this.identifier)
    if (this.parenthesisUsed) {
      ret += ' (' + identifier + ')'
    } else {
      ret += ' ' + identifier
    }
    return ret
  }
}

/** `is_int($token->value)` for a number token: hex numbers and plain integers. */
function isPhpInt(token: Token): boolean {
  return (
    typeof token.value === 'number' &&
    !(token.flags & 2) && // FLAG_NUMBER_FLOAT
    !(token.flags & 4) && // FLAG_NUMBER_APPROXIMATE
    (Number.isSafeInteger(token.value) || Math.abs(token.value) === 2 ** 63)
  )
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/LoadStatement.php::LoadStatement
export class LoadStatement extends Statement {
  readonly kind = 'LoadStatement'
  static override statementOptions: OptionSpecs = {
    LOW_PRIORITY: 1,
    CONCURRENT: 1,
    LOCAL: 2,
  }

  private static readonly STATEMENT_FIELDS_OPTIONS: OptionSpecs = {
    'TERMINATED BY': [1, 'expr'],
    OPTIONALLY: 2,
    'ENCLOSED BY': [3, 'expr'],
    'ESCAPED BY': [4, 'expr'],
  }

  private static readonly STATEMENT_LINES_OPTIONS: OptionSpecs = {
    'STARTING BY': [1, 'expr'],
    'TERMINATED BY': [2, 'expr'],
  }

  /** File name being used to load data. */
  fileName: Expression | null = null
  /** Table used as destination for this statement. */
  table: Expression | null = null
  /** Partitions used as source for this statement. */
  partition: ArrayObj | null = null
  /** Character set used to interpret data. */
  charsetName: Expression | null = null
  /** Options for FIELDS/COLUMNS keyword. */
  fieldsOptions: OptionsArray | null = null
  /** Whether to use `FIELDS` or `COLUMNS` while building. */
  fieldsKeyword: string | null = null
  /** Options for OPTIONS keyword. */
  linesOptions: OptionsArray | null = null
  /** Column names or user variables. */
  columnNamesOrUserVariables: (Expression | CaseExpression)[] | null = null
  /** SET clause's updated values(optional). */
  set: SetOperation[] | null = null
  /** Ignore 'number' LINES/ROWS. */
  ignoreNumber: Expression | null = null
  /** REPLACE/IGNORE Keyword. */
  replaceIgnore: string | null = null
  /** LINES/ROWS Keyword. */
  linesRows: string | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/LoadStatement.php::build
  override build(): string {
    let ret = 'LOAD DATA ' + str(this.options) + ' INFILE ' + str(this.fileName)

    if (this.replaceIgnore !== null) ret += ' ' + trim(this.replaceIgnore)

    ret += ' INTO TABLE ' + str(this.table)

    if (this.partition !== null && str(this.partition).length > 0)
      ret += ' PARTITION ' + this.partition.build()
    if (this.charsetName !== null) ret += ' CHARACTER SET ' + str(this.charsetName)
    if (this.fieldsKeyword !== null) ret += ' ' + this.fieldsKeyword + ' ' + str(this.fieldsOptions)
    if (this.linesOptions !== null && str(this.linesOptions).length > 0)
      ret += ' LINES ' + str(this.linesOptions)
    if (this.ignoreNumber !== null) ret += ' IGNORE ' + str(this.ignoreNumber) + ' ' + str(this.linesRows)
    if (this.columnNamesOrUserVariables !== null && this.columnNamesOrUserVariables.length > 0) {
      ret += ' ' + Expressions.buildAll(this.columnNamesOrUserVariables)
    }
    if (this.set !== null && this.set.length > 0) ret += ' SET ' + SetOperations.buildAll(this.set)

    return ret
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/LoadStatement.php::parse
  override parse(parser: Parser, list: TokensList): void {
    ++list.idx // Skipping `LOAD DATA`.

    // parse any options if provided
    this.options = OptionsArrays.parse(parser, list, LoadStatement.statementOptions)
    ++list.idx

    // 0 -> INFILE, 1 -> REPLACE/IGNORE/INTO, 2 -> TABLE, 3..7 -> clauses
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // End of statement.
      if (token.type === TokenType.Delimiter) break

      // Skipping whitespaces and comments.
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        if (token.type === TokenType.Keyword && token.keyword !== 'INFILE') {
          parser.error('Unexpected keyword.', token)
          break
        }
        if (token.type !== TokenType.Keyword) {
          parser.error('Unexpected token.', token)
          break
        }

        ++list.idx
        this.fileName = Expressions.parse(parser, list, { parseField: 'file' })
        state = 1
      } else if (state === 1) {
        if (token.type === TokenType.Keyword) {
          if (token.keyword === 'REPLACE' || token.keyword === 'IGNORE') {
            this.replaceIgnore = trim(token.keyword)
          } else if (token.keyword === 'INTO') {
            state = 2
          }
        }
      } else if (state === 2) {
        if (token.type !== TokenType.Keyword || token.keyword !== 'TABLE') {
          parser.error('Unexpected token.', token)
          break
        }

        ++list.idx
        this.table = Expressions.parse(parser, list, { parseField: 'table', breakOnAlias: true })
        state = 3
      } else if (state >= 3 && state <= 7) {
        if (token.type === TokenType.Keyword) {
          const newState = this.parseKeywordsAccordingToState(parser, list, state)
          if (newState === state) {
            // Avoid infinite loop
            break
          }
        } else if (token.type === TokenType.Operator && token.token === '(') {
          this.columnNamesOrUserVariables = ExpressionArray.parse(parser, list)
          state = 7
        } else {
          parser.error('Unexpected token.', token)
          break
        }
      }
    }

    --list.idx
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/LoadStatement.php::parseFileOptions
  parseFileOptions(parser: Parser, list: TokensList, keyword = 'FIELDS'): void {
    ++list.idx

    if (keyword === 'FIELDS' || keyword === 'COLUMNS') {
      // parse field options
      this.fieldsOptions = OptionsArrays.parse(parser, list, LoadStatement.STATEMENT_FIELDS_OPTIONS)
      this.fieldsKeyword = keyword
    } else {
      // parse line options
      this.linesOptions = OptionsArrays.parse(parser, list, LoadStatement.STATEMENT_LINES_OPTIONS)
    }
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/LoadStatement.php::parseKeywordsAccordingToState
  parseKeywordsAccordingToState(parser: Parser, list: TokensList, state: number): number {
    const token = list.tokens[list.idx] as Token

    // The PHP switch falls through from the current state to the following ones.
    if (state <= 3 && token.keyword === 'PARTITION') {
      ++list.idx
      this.partition = ArrayObjs.parse(parser, list)
      return 4
    }

    if (state <= 4 && token.keyword === 'CHARACTER SET') {
      ++list.idx
      this.charsetName = Expressions.parse(parser, list)
      return 5
    }

    if (
      state <= 5 &&
      (token.keyword === 'FIELDS' || token.keyword === 'COLUMNS' || token.keyword === 'LINES')
    ) {
      this.parseFileOptions(parser, list, str(token.value))
      return 6
    }

    if (state <= 6 && token.keyword === 'IGNORE') {
      ++list.idx

      this.ignoreNumber = Expressions.parse(parser, list)
      const nextToken = list.getNextOfType(TokenType.Keyword)

      if (
        nextToken !== null &&
        nextToken.type === TokenType.Keyword &&
        (nextToken.keyword === 'LINES' || nextToken.keyword === 'ROWS')
      ) {
        this.linesRows = nextToken.token
      }

      return 7
    }

    if (state <= 7 && token.keyword === 'SET') {
      ++list.idx
      this.set = SetOperations.parse(parser, list)
      return 8
    }

    return state
  }
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/LockStatement.php::LockStatement
export class LockStatement extends Statement {
  readonly kind = 'LockStatement'
  /** Tables with their Lock expressions. */
  locked: LockExpression[] = []
  /** Whether it's a LOCK statement if false then it's an UNLOCK statement */
  isLock = true

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/LockStatement.php::parse
  override parse(parser: Parser, list: TokensList): void {
    if (list.at(list.idx)?.value === 'UNLOCK') {
      // this is in fact an UNLOCK statement
      this.isLock = false
    }

    ++list.idx // Skipping `LOCK`.

    // 0 -> TABLES, 1 -> lock expression, 2 -> `,` or end
    let state = 0
    let prevToken: Token | null = null

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // End of statement.
      if (token.type === TokenType.Delimiter) break

      // Skipping whitespaces and comments.
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        if (token.type === TokenType.Keyword) {
          if (token.keyword !== 'TABLES') {
            parser.error('Unexpected keyword.', token)
            break
          }
          state = 1
          continue
        }
        parser.error('Unexpected token.', token)
        break
      }

      if (state === 1) {
        if (!this.isLock) {
          // UNLOCK statement should not have any more tokens
          parser.error('Unexpected token.', token)
          break
        }
        this.locked.push(LockExpressions.parse(parser, list))
        state = 2
      } else if (state === 2) {
        if (token.value === ',') {
          // move over to parsing next lock expression
          state = 1
        }
      }

      prevToken = token
    }

    if (state === 2 || prevToken === null) return

    parser.error('Unexpected end of LOCK statement.', prevToken)
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/LockStatement.php::build
  override build(): string {
    return trim((this.isLock ? 'LOCK' : 'UNLOCK') + ' TABLES ' + LockExpression.buildAll(this.locked))
  }
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/PurgeStatement.php::PurgeStatement
export class PurgeStatement extends Statement {
  readonly kind = 'PurgeStatement'
  /** The type of logs */
  logType: string | null = null
  /** The end option of this query. */
  endOption: string | null = null
  /** The end expr of this query. */
  endExpr: Expression | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/PurgeStatement.php::build
  override build(): string {
    const ret =
      'PURGE ' +
      str(this.logType) +
      ' LOGS ' +
      (this.endOption !== null ? this.endOption + ' ' + str(this.endExpr) : '')
    return trim(ret)
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/PurgeStatement.php::parse
  override parse(parser: Parser, list: TokensList): void {
    ++list.idx // Skipping `PURGE`.

    // 0 -> BINARY/MASTER, 1 -> LOGS, 2 -> TO/BEFORE, 3 -> expression
    let state = 0
    let prevToken: Token | null = null
    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // End of statement.
      if (token.type === TokenType.Delimiter) break

      // Skipping whitespaces and comments.
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      switch (state) {
        case 0:
          // parse `{ BINARY | MASTER }`
          this.logType = parseExpectedKeyword(parser, token, ['BINARY', 'MASTER'])
          break
        case 1:
          // parse `LOGS`
          parseExpectedKeyword(parser, token, ['LOGS'])
          break
        case 2:
          // parse `{ TO | BEFORE }`
          this.endOption = parseExpectedKeyword(parser, token, ['TO', 'BEFORE'])
          break
        case 3:
          // parse `expr`
          this.endExpr = Expressions.parse(parser, list, {})
          break
        default:
          parser.error('Unexpected token.', token)
          break
      }

      state++
      prevToken = token
    }

    // Only one possible end state
    if (state === 4) return

    parser.error('Unexpected token.', prevToken)
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/PurgeStatement.php::parseExpectedKeyword
function parseExpectedKeyword(
  parser: Parser,
  token: Token,
  expectedKeywords: readonly string[],
): string | null {
  if (token.type === TokenType.Keyword) {
    if (expectedKeywords.includes(token.keyword as string)) return token.keyword
    parser.error('Unexpected keyword', token)
  } else {
    parser.error('Unexpected token.', token)
  }
  return null
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/RenameStatement.php::RenameStatement
export class RenameStatement extends Statement {
  readonly kind = 'RenameStatement'
  /** The old and new names of the tables. */
  renames: RenameOperation[] | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/RenameStatement.php::before
  override before(_parser: Parser, list: TokensList, token: Token): void {
    if (token.type !== TokenType.Keyword || token.keyword !== 'RENAME') return
    // Checking if it is the beginning of the query.
    list.getNextOfTypeAndValue(TokenType.Keyword, 'TABLE')
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/RenameStatement.php::build
  override build(): string {
    return (
      'RENAME TABLE ' +
      requireArray(this.renames)
        .map((r) => r.build())
        .join(', ')
    )
  }
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/ReplaceStatement.php::ReplaceStatement
export class ReplaceStatement extends Statement {
  readonly kind = 'ReplaceStatement'
  static override statementOptions: OptionSpecs = {
    LOW_PRIORITY: 1,
    DELAYED: 1,
  }

  /** Tables used as target for this statement. */
  into: IntoKeyword | null = null
  /** Values to be replaced. */
  values: ArrayObj[] | null = null
  /** If SET clause is present holds the SetOperation. */
  set: SetOperation[] | null = null
  /** If SELECT clause is present holds the SelectStatement. */
  select: SelectStatement | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/ReplaceStatement.php::build
  override build(): string {
    let ret = 'REPLACE ' + str(this.options)
    ret = trim(ret) + ' INTO ' + str(this.into)

    if (this.values !== null && this.values.length > 0) {
      ret += ' VALUES ' + ArrayObjs.buildAll(this.values)
    } else if (this.set !== null && this.set.length > 0) {
      ret += ' SET ' + SetOperations.buildAll(this.set)
    } else if (this.select !== null && str(this.select).length > 0) {
      ret += ' ' + this.select.build()
    }

    return ret
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/ReplaceStatement.php::parse
  override parse(parser: Parser, list: TokensList): void {
    ++list.idx // Skipping `REPLACE`.

    // parse any options if provided
    this.options = OptionsArrays.parse(parser, list, ReplaceStatement.statementOptions)

    ++list.idx

    // 0 -> INTO, 1 -> VALUES/SET/SELECT, 2 -> end
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // End of statement.
      if (token.type === TokenType.Delimiter) break

      // Skipping whitespaces and comments.
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        if (token.type === TokenType.Keyword && token.keyword !== 'INTO') {
          parser.error('Unexpected keyword.', token)
          break
        }

        ++list.idx
        this.into = IntoKeywords.parse(parser, list, { fromReplace: true })

        state = 1
      } else if (state === 1) {
        if (token.type !== TokenType.Keyword) {
          parser.error('Unexpected token.', token)
          break
        }

        if (token.keyword === 'VALUE' || token.keyword === 'VALUES') {
          ++list.idx // skip VALUES
          this.values = Array2d.parse(parser, list)
        } else if (token.keyword === 'SET') {
          ++list.idx // skip SET
          this.set = SetOperations.parse(parser, list)
        } else if (token.keyword === 'SELECT') {
          this.select = SelectStatement.parsed(parser, list)
        } else {
          parser.error('Unexpected keyword.', token)
          break
        }

        state = 2
      }
    }

    --list.idx
  }
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/SelectStatement.php::SelectStatement
export class SelectStatement extends Statement {
  readonly kind = 'SelectStatement'

  static override statementOptions: OptionSpecs = {
    ALL: 1,
    DISTINCT: 1,
    DISTINCTROW: 1,
    HIGH_PRIORITY: 2,
    MAX_STATEMENT_TIME: [3, 'var='],
    STRAIGHT_JOIN: 4,
    SQL_SMALL_RESULT: 5,
    SQL_BIG_RESULT: 6,
    SQL_BUFFER_RESULT: 7,
    SQL_CACHE: 8,
    SQL_NO_CACHE: 8,
    SQL_CALC_FOUND_ROWS: 9,
  }

  static readonly STATEMENT_GROUP_OPTIONS: OptionSpecs = { 'WITH ROLLUP': 1 }

  static override STATEMENT_END_OPTIONS: OptionSpecs = {
    'FOR UPDATE': 1,
    'LOCK IN SHARE MODE': 1,
  }

  static override clauses: Clauses = {
    SELECT: ['SELECT', ADD_KEYWORD],
    // Used for options.
    _OPTIONS: ['_OPTIONS', ADD_CLAUSE],
    // Used for selected expressions.
    _SELECT: ['SELECT', ADD_CLAUSE],
    INTO: ['INTO', ADD_CLAUSE | ADD_KEYWORD],
    FROM: ['FROM', ADD_CLAUSE | ADD_KEYWORD],
    FORCE: ['FORCE', ADD_CLAUSE],
    USE: ['USE', ADD_CLAUSE],
    IGNORE: ['IGNORE', ADD_CLAUSE | ADD_KEYWORD],
    PARTITION: ['PARTITION', ADD_CLAUSE | ADD_KEYWORD],

    JOIN: ['JOIN', ADD_CLAUSE],
    'FULL JOIN': ['FULL JOIN', ADD_CLAUSE],
    'INNER JOIN': ['INNER JOIN', ADD_CLAUSE],
    'LEFT JOIN': ['LEFT JOIN', ADD_CLAUSE],
    'LEFT OUTER JOIN': ['LEFT OUTER JOIN', ADD_CLAUSE],
    'RIGHT JOIN': ['RIGHT JOIN', ADD_CLAUSE],
    'RIGHT OUTER JOIN': ['RIGHT OUTER JOIN', ADD_CLAUSE],
    'NATURAL JOIN': ['NATURAL JOIN', ADD_CLAUSE],
    'NATURAL LEFT JOIN': ['NATURAL LEFT JOIN', ADD_CLAUSE],
    'NATURAL RIGHT JOIN': ['NATURAL RIGHT JOIN', ADD_CLAUSE],
    'NATURAL LEFT OUTER JOIN': ['NATURAL LEFT OUTER JOIN', ADD_CLAUSE],
    'NATURAL RIGHT OUTER JOIN': ['NATURAL RIGHT JOIN', ADD_CLAUSE],
    WHERE: ['WHERE', ADD_CLAUSE | ADD_KEYWORD],
    'GROUP BY': ['GROUP BY', ADD_CLAUSE | ADD_KEYWORD],
    _GROUP_OPTIONS: ['_GROUP_OPTIONS', ADD_CLAUSE],
    HAVING: ['HAVING', ADD_CLAUSE | ADD_KEYWORD],
    'ORDER BY': ['ORDER BY', ADD_CLAUSE | ADD_KEYWORD],
    LIMIT: ['LIMIT', ADD_CLAUSE | ADD_KEYWORD],
    PROCEDURE: ['PROCEDURE', ADD_CLAUSE | ADD_KEYWORD],
    UNION: ['UNION', ADD_CLAUSE],
    EXCEPT: ['EXCEPT', ADD_CLAUSE],
    INTERSECT: ['INTERSECT', ADD_CLAUSE],
    _END_OPTIONS: ['_END_OPTIONS', ADD_CLAUSE],
    // These are available only when `UNION` is present.
    // 'ORDER BY' => ['ORDER BY', 3],
    // 'LIMIT' => ['LIMIT', 3],
  }

  /** Expressions that are being selected by this statement. */
  expr: (Expression | CaseExpression)[] = []
  /** Tables used as sources for this statement. */
  from: (Expression | CaseExpression)[] = []
  /** Index hints */
  indexHints: IndexHint[] | null = null
  /** Partitions used as source for this statement. */
  partition: ArrayObj | null = null
  /** Conditions used for filtering each row of the result set. */
  where: Condition[] | null = null
  /** Conditions used for grouping the result set. */
  group: GroupKeyword[] | null = null
  /** List of options available for the GROUP BY component. */
  groupOptions: OptionsArray | null = null
  /** Conditions used for filtering the result set. */
  having: Condition[] | null = null
  /** Specifies the order of the rows in the result set. */
  order: OrderKeyword[] | null = null
  /** Conditions used for limiting the size of the result set. */
  limit: Limit | null = null
  /** Procedure that should process the data in the result set. */
  procedure: FunctionCall | null = null
  /** Destination of this result set. */
  into: IntoKeyword | null = null
  /** Joins. */
  join: JoinKeyword[] | null = null
  /** Unions. */
  union: [string, SelectStatement][] = []
  /** The end options of this query. */
  endOptions: OptionsArray | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/SelectStatement.php::parse
  override parse(parser: Parser, list: TokensList): void {
    // Array containing all list of clauses parsed. This is used to check for duplicate clauses.
    const parsedClauses: Record<string, true> = {}
    const self = fieldsOf(this)

    // The first token that is a part of this token is the next token unprocessed by the previous statement.
    this.first = list.idx

    // Whether options were parsed or not. For statements that do not have any options this is set to `true`.
    let parsedOptions = Object.keys(SelectStatement.statementOptions).length === 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // End of statement.
      if (token.type === TokenType.Delimiter) break

      // Checking if this closing bracket is the pair for a bracket outside the statement.
      if (token.value === ')' && parser.brackets > 0) {
        --parser.brackets
        continue
      }

      // Only keywords are relevant here. Other parts of the query are processed in the functions below.
      if (token.type !== TokenType.Keyword) {
        if (token.type !== TokenType.Comment && token.type !== TokenType.Whitespace) {
          parser.error('Unexpected token.', token)
        }
        continue
      }

      // Unions are parsed by the parser because they represent more than one statement.
      if (
        token.keyword === 'UNION' ||
        token.keyword === 'UNION ALL' ||
        token.keyword === 'UNION DISTINCT' ||
        token.keyword === 'EXCEPT' ||
        token.keyword === 'INTERSECT'
      ) {
        break
      }

      const lastIdx = list.idx

      // ON DUPLICATE KEY UPDATE ...
      // has to be parsed in parent statement (INSERT or REPLACE)
      // so look for it and break
      if (token.value === 'ON') {
        ++list.idx // Skip ON

        // look for ON DUPLICATE KEY UPDATE
        const first = list.getNextOfType(TokenType.Keyword)
        const second = list.getNextOfType(TokenType.Keyword)
        const third = list.getNextOfType(TokenType.Keyword)

        if (
          first !== null &&
          second !== null &&
          third !== null &&
          first.value === 'DUPLICATE' &&
          second.value === 'KEY' &&
          third.value === 'UPDATE'
        ) {
          list.idx = lastIdx
          break
        }
      }

      list.idx = lastIdx

      // The name of the class that is used for parsing.
      let cls: (typeof COMPONENT_PARSERS)[keyof typeof COMPONENT_PARSERS] | null = null
      // The name of the field where the result of the parsing is stored.
      let field: string | null = null
      // Parser's options.
      let options: ParseOptions = {}

      // Checking if this is a known clause and checking for duplicate clauses.
      if (
        typeof token.value === 'string' &&
        (isKeywordParser(token.value) || hasStatementParser(token.value))
      ) {
        if (Object.hasOwn(parsedClauses, token.value)) {
          parser.error('This type of clause was previously parsed.', token)
          break
        }
        parsedClauses[token.value] = true
      }

      // Checking if this is a known clause.
      const tokenValue = token.keyword === 'TRUNCATE' ? token.keyword : token.value
      if (typeof tokenValue === 'string' && isKeywordParser(tokenValue) && list.idx < list.count) {
        const kp = KEYWORD_PARSERS[tokenValue] as (typeof KEYWORD_PARSERS)[string]
        cls = COMPONENT_PARSERS[kp.class]
        field = kp.field
        if (kp.options !== undefined) options = kp.options
      }

      // Checking if this is the beginning of the statement.
      if (hasStatementParser(token.keyword)) {
        if (
          Object.keys(SelectStatement.clauses).length > 0 &&
          typeof token.value === 'string' &&
          !Object.hasOwn(SelectStatement.clauses, token.value)
        ) {
          // Some keywords (e.g. `SET`) may be the beginning of a statement and a clause.
          parser.error('A new statement was found, but no delimiter between it and the previous one.', token)
          break
        }

        if (!parsedOptions) {
          if (!Object.hasOwn(SelectStatement.statementOptions, str(token.value))) {
            // Skipping keyword.
            ++list.idx
          }
          this.options = OptionsArrays.parse(parser, list, SelectStatement.statementOptions)
          parsedOptions = true
        }
      } else if (cls === null) {
        if (token.value === 'WITH ROLLUP') {
          // Handle group options in Select statement
          this.groupOptions = OptionsArrays.parse(parser, list, SelectStatement.STATEMENT_GROUP_OPTIONS)
        } else if (token.value === 'FOR UPDATE' || token.value === 'LOCK IN SHARE MODE') {
          // Handle special end options in Select statement
          this.endOptions = OptionsArrays.parse(parser, list, SelectStatement.STATEMENT_END_OPTIONS)
        } else {
          // There is no parser for this keyword and isn't the beginning of a statement (so no options) either.
          parser.error('Unrecognized keyword.', token)
          continue
        }
      }

      if (cls === null || field === null) continue

      // We can't parse keyword at the end of statement
      if (list.idx >= list.count) {
        parser.error('Keyword at end of statement.', token)
        continue
      }

      ++list.idx // Skipping keyword or last option.
      self[field] = cls.parse(parser, list, options)
    }

    this.last = --list.idx // Go back to last used token.
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/SelectStatement.php::getClauses
  override getClauses(): Clauses {
    // This is a cheap fix for `SELECT` statements that contain `UNION`.
    // The `ORDER BY` and `LIMIT` clauses should be at the end of the statement.
    if (this.union.length > 0) {
      const clauses: Record<string, ClauseDef> = Object.fromEntries(
        Object.entries(SelectStatement.clauses).filter(([k]) => k !== 'ORDER BY' && k !== 'LIMIT'),
      )
      clauses['ORDER BY'] = ['ORDER BY', ADD_CLAUSE | ADD_KEYWORD]
      clauses.LIMIT = ['LIMIT', ADD_CLAUSE | ADD_KEYWORD]
      return clauses
    }

    return SelectStatement.clauses
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/SelectStatement.php::getAliases
  getAliases(database: string): Record<
    string,
    {
      alias: string | null
      tables: Record<string, { alias: string | null; columns: Record<string, string> }>
    }
  > {
    if (this.expr.length === 0 || this.from.length === 0) return {}

    const retval: Record<
      string,
      {
        alias: string | null
        tables: Record<string, { alias: string | null; columns: Record<string, string> }>
      }
    > = {}
    const tables: Record<string, Record<string, string>> = {}

    const expressions: (Expression | CaseExpression | null)[] = [...this.from]
    if (!empty(this.join)) {
      for (const join of this.join as JoinKeyword[]) expressions.push(join.expr)
    }

    for (const e of expressions) {
      const expr = fieldsOf(e ?? {})
      const table = expr.table as string | null | undefined
      if (table === undefined || table === null || table === '') continue

      const database_ = expr.database as string | null | undefined
      const thisDb = database_ !== undefined && database_ !== null && database_ !== '' ? database_ : database

      retval[thisDb] ??= { alias: null, tables: {} }
      const dbEntry = retval[thisDb]
      const alias = expr.alias as string | null | undefined
      if (!Object.hasOwn(dbEntry.tables, table)) {
        dbEntry.tables[table] = {
          alias: alias !== undefined && alias !== null && alias !== '' ? alias : null,
          columns: {},
        }
      }

      tables[thisDb] ??= {}
      ;(tables[thisDb] as Record<string, string>)[str(alias)] = table
    }

    for (const e of this.expr) {
      const expr = fieldsOf(e)
      const column = expr.column as string | null | undefined
      const alias = expr.alias as string | null | undefined
      if (column === undefined || column === null || alias === undefined || alias === null) continue
      if (column === '' || alias === '') continue

      const database_ = expr.database as string | null | undefined
      const thisDb = database_ !== undefined && database_ !== null && database_ !== '' ? database_ : database
      const table = expr.table as string | null | undefined

      if (table !== undefined && table !== null && table !== '') {
        const thisTable = tables[thisDb]?.[table] ?? table
        retval[thisDb] ??= { alias: null, tables: {} }
        retval[thisDb].tables[thisTable] ??= { alias: null, columns: {} }
        const t = retval[thisDb].tables[thisTable]
        t.columns[column] = alias
      } else {
        for (const t of Object.values(retval[thisDb]?.tables ?? {})) t.columns[column] = alias
      }
    }

    return retval
  }
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/SetStatement.php::SetStatement
export class SetStatement extends Statement {
  readonly kind = 'SetStatement'

  static override clauses: Clauses = {
    SET: ['SET', ADD_CLAUSE | ADD_KEYWORD],
    _END_OPTIONS: ['_END_OPTIONS', ADD_CLAUSE],
  }

  static override statementOptions: OptionSpecs = {
    CHARSET: [3, 'var'],
    'CHARACTER SET': [3, 'var'],
    NAMES: [3, 'var'],
    PASSWORD: [3, 'expr'],
    SESSION: 3,
    GLOBAL: 3,
    PERSIST: 3,
    PERSIST_ONLY: 3,
    '@@SESSION': 3,
    '@@GLOBAL': 3,
    '@@PERSIST': 3,
    '@@PERSIST_ONLY': 3,
  }

  static override STATEMENT_END_OPTIONS: OptionSpecs = {
    COLLATE: [1, 'var'],
    DEFAULT: 1,
  }

  /** Options used in current statement. */
  endOptions: OptionsArray | null = null
  /** The updated values. */
  set: SetOperation[] | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/SetStatement.php::build
  override build(): string {
    const ret =
      'SET ' +
      built(this.options) +
      ' ' +
      SetOperations.buildAll(requireArray(this.set)) +
      ' ' +
      (this.endOptions?.build() ?? '')
    return trim(ret)
  }
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/TransactionStatement.php::TransactionStatement
export class TransactionStatement extends Statement {
  readonly kind = 'TransactionStatement'

  /** Type of transaction that starts a transaction. */
  static readonly TYPE_BEGIN = 1
  /** Type of transaction that ends a transaction. */
  static readonly TYPE_END = 2

  /** The type of this query. */
  type: number | null = null
  /** The list of statements in this transaction. */
  statements: Statement[] | null = null
  /** The ending transaction statement which may be a `COMMIT` or a `ROLLBACK`. */
  end: TransactionStatement | null = null

  static override statementOptions: OptionSpecs = {
    'START TRANSACTION': 1,
    BEGIN: 1,
    COMMIT: 1,
    ROLLBACK: 1,
    'WITH CONSISTENT SNAPSHOT': 2,
    WORK: 2,
    'AND NO CHAIN': 3,
    'AND CHAIN': 3,
    RELEASE: 4,
    'NO RELEASE': 4,
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/TransactionStatement.php::parse
  override parse(parser: Parser, list: TokensList): void {
    super.parse(parser, list)

    const options = this.options as OptionsArray | null
    // Checks the type of this query.
    if (options?.has('START TRANSACTION') || options?.has('BEGIN')) {
      this.type = TransactionStatement.TYPE_BEGIN
    } else if (options?.has('COMMIT') || options?.has('ROLLBACK')) {
      this.type = TransactionStatement.TYPE_END
    }
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/TransactionStatement.php::build
  override build(): string {
    let ret = built(this.options)
    if (this.type === TransactionStatement.TYPE_BEGIN) {
      for (const statement of this.statements ?? []) {
        // We put the delimiter `;` because it is the default delimiter...
        ret += ';' + statement.build()
      }
      ret += ';'
      if (this.end !== null) ret += this.end.build()
    }
    return ret
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/TruncateStatement.php::TruncateStatement
export class TruncateStatement extends Statement {
  readonly kind = 'TruncateStatement'
  static override statementOptions: OptionSpecs = { TABLE: 1 }
  /** The name of the truncated table. */
  table: Expression | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/TruncateStatement.php::build
  override build(): string {
    return 'TRUNCATE TABLE ' + str(this.table) + ';'
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Statements/UpdateStatement.php::UpdateStatement
export class UpdateStatement extends Statement {
  readonly kind = 'UpdateStatement'
  static override statementOptions: OptionSpecs = {
    LOW_PRIORITY: 1,
    IGNORE: 2,
  }

  static override clauses: Clauses = {
    UPDATE: ['UPDATE', ADD_KEYWORD],
    // Used for options.
    _OPTIONS: ['_OPTIONS', ADD_CLAUSE],
    // Used for updated tables.
    _UPDATE: ['UPDATE', ADD_CLAUSE],
    JOIN: ['JOIN', ADD_CLAUSE],
    'LEFT JOIN': ['LEFT JOIN', ADD_CLAUSE],
    'INNER JOIN': ['INNER JOIN', ADD_CLAUSE],
    SET: ['SET', ADD_CLAUSE | ADD_KEYWORD],
    WHERE: ['WHERE', ADD_CLAUSE | ADD_KEYWORD],
    'ORDER BY': ['ORDER BY', ADD_CLAUSE | ADD_KEYWORD],
    LIMIT: ['LIMIT', ADD_CLAUSE | ADD_KEYWORD],
  }

  /** Tables used as sources for this statement. */
  tables: (Expression | CaseExpression)[] | null = null
  /** The updated values. */
  set: SetOperation[] | null = null
  /** Conditions used for filtering each row of the result set. */
  where: Condition[] | null = null
  /** Specifies the order of the rows in the result set. */
  order: OrderKeyword[] | null = null
  /** Conditions used for limiting the size of the result set. */
  limit: Limit | null = null
  /** Joins. */
  join: JoinKeyword[] | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/UpdateStatement.php::after
  override after(parser: Parser, list: TokensList, token: Token): void {
    // Finds the SET clause (if any).
    const tokenValue = token.value
    // Ensure we finished to parse the "SET" token, and if yes, ensure that assignments are defined.
    const kpField =
      typeof tokenValue === 'string' && isKeywordParser(tokenValue)
        ? (KEYWORD_PARSERS[tokenValue] as (typeof KEYWORD_PARSERS)[string]).field
        : null
    if ((this.set !== null && this.set.length === 0) === false || kpField !== 'set') return

    parser.error('Missing assignment in SET operation.', list.at(list.idx))
  }
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Statements/WithStatement.php::WithStatement
export class WithStatement extends Statement {
  readonly kind = 'WithStatement'
  static override statementOptions: OptionSpecs = { RECURSIVE: 1 }

  static override clauses: Clauses = {
    WITH: ['WITH', ADD_KEYWORD],
    // Used for options.
    _OPTIONS: ['_OPTIONS', ADD_CLAUSE],
    AS: ['AS', ADD_KEYWORD],
  }

  withers: Map<string, WithKeyword> = new Map()
  /** holds the CTE parser. */
  cteStatementParser: Parser | null = null

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/WithStatement.php::parse
  override parse(parser: Parser, list: TokensList): void {
    // 0 -> CTE name, 1 -> `(` or AS, 2 -> AS, 3 -> CTE subquery, 4 -> `,` or statement, 5 -> statement
    let state = 0
    let wither: string | null = null

    ++list.idx // Skipping `WITH`.

    // parse any options if provided
    this.options = OptionsArrays.parse(parser, list, WithStatement.statementOptions)
    ++list.idx

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // Skipping whitespaces and comments.
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        if (token.type !== TokenType.None || !/^[a-zA-Z0-9_$]+$/.test(token.token)) {
          parser.error('The name of the CTE was expected.', token)
          break
        }

        wither = str(token.value)
        this.withers.set(wither, new WithKeyword(wither))
        state = 1
      } else if (state === 1) {
        if (token.type === TokenType.Operator && token.value === '(') {
          const columns = Array2d.parse(parser, list)
          if (parser.errors.length > 0) break
          ;(this.withers.get(wither as string) as WithKeyword).columns = columns
          state = 2
        } else if (token.type === TokenType.Keyword && token.keyword === 'AS') {
          state = 3
        } else {
          parser.error('Unexpected token.', token)
          break
        }
      } else if (state === 2) {
        if (!(token.type === TokenType.Keyword && token.keyword === 'AS')) {
          parser.error('AS keyword was expected.', token)
          break
        }
        state = 3
      } else if (state === 3) {
        const idxBeforeGetNext = list.idx

        list.idx++ // Ignore the current token
        const nextKeyword = list.getNext()

        if (!(token.value === '(' && nextKeyword !== null && nextKeyword.value === 'SELECT')) {
          parser.error('Subquery of the CTE was expected.', token)
          list.idx = idxBeforeGetNext
          break
        }

        // Restore the index
        list.idx = idxBeforeGetNext

        ++list.idx
        const subList = this.getSubTokenList(list)
        if (subList instanceof ParserException) {
          parser.errors.push(subList)
          break
        }

        const subParser = new Parser(subList)

        if (subParser.errors.length > 0) {
          for (const error of subParser.errors) parser.errors.push(error)
          break
        }
        ;(this.withers.get(wither as string) as WithKeyword).statement = subParser

        state = 4
      } else if (state === 4) {
        if (token.value === ',') {
          // There's another WITH expression to parse, go back to state=0
          state = 0
          continue
        }

        if (
          token.type === TokenType.Keyword &&
          (token.value === 'SELECT' ||
            token.value === 'INSERT' ||
            token.value === 'UPDATE' ||
            token.value === 'DELETE')
        ) {
          state = 5
          --list.idx
          continue
        }

        parser.error('An expression was expected.', token)
        break
      } else if (state === 5) {
        // Index of the last parsed token by default would be the last token in the list.
        let idxOfLastParsedToken = list.count - 1

        // Index of the first token in the expression.
        const idxBeforeSearch = list.idx

        // The length of the expression tokens is null by default, in order for the array_slice to
        // consider the whole list of the tokens.
        let lengthOfExpressionTokens: number | null = null

        if (list.getNextOfTypeAndValue(TokenType.Keyword, 'ON') !== null) {
          // (-1) because getNextOfTypeAndValue returned the next token after the `ON`.
          const idxOfOn = list.idx - 1
          // We want to make sure that it's `ON DUPLICATE KEY UPDATE`
          const dubplicateToken = list.getNext()
          const keyToken = list.getNext()
          const updateToken = list.getNext()
          if (
            dubplicateToken !== null &&
            dubplicateToken.keyword === 'DUPLICATE' &&
            keyToken !== null &&
            keyToken.keyword === 'KEY' &&
            updateToken !== null &&
            updateToken.keyword === 'UPDATE'
          ) {
            // Index of the last parsed token will be the token before the ON Keyword
            idxOfLastParsedToken = idxOfOn - 1
            // The length of the expression tokens would be the difference
            // between the first unrelated token `ON` and the idx
            // before skipping the CTE tokens.
            lengthOfExpressionTokens = idxOfOn - idxBeforeSearch
          }
        }

        // Restore the index
        list.idx = idxBeforeSearch

        const subList = new TokensList(
          lengthOfExpressionTokens === null
            ? list.tokens.slice(list.idx)
            : phpArraySlice(list.tokens, list.idx, lengthOfExpressionTokens),
        )
        const subParser = new Parser(subList)
        if (subParser.errors.length > 0) {
          for (const error of subParser.errors) parser.errors.push(error)
          break
        }

        this.cteStatementParser = subParser

        list.idx = idxOfLastParsedToken
        break
      }
    }

    // 5 is the only valid end state
    if (state !== 5) {
      // Token may not have been initialized correctly, so we must check if it's a valid token.
      const token = list.at(list.idx)
      parser.error('Unexpected end of the WITH CTE.', token)
    }

    --list.idx
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/WithStatement.php::build
  override build(): string {
    let s = 'WITH '

    if (this.options !== null && this.options.options.size > 0) s += this.options.build() + ' '

    if (this.withers.size > 0) s += [...this.withers.values()].map((w) => w.build()).join(', ') + ' '

    if (this.cteStatementParser !== null) {
      s += this.cteStatementParser.statements.map((st) => st.build()).join('')
    }

    return s
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Statements/WithStatement.php::getSubTokenList
  private getSubTokenList(list: TokensList): ParserException | TokensList {
    const idx = list.idx
    let token = list.tokens[list.idx] as Token
    let openParenthesis = 0

    while (list.idx < list.count) {
      if (token.value === '(') {
        ++openParenthesis
      } else if (token.value === ')') {
        if (--openParenthesis === -1) break
      }

      ++list.idx
      if (list.tokens[list.idx] === undefined) break

      token = list.tokens[list.idx] as Token
    }

    // performance improvement: return the error to avoid a try/catch in the loop
    if (list.idx === list.count) {
      --list.idx
      return new ParserException('A closing bracket was expected.', token)
    }

    const length = list.idx - idx
    return new TokensList(phpArraySlice(list.tokens, idx, length))
  }
}

/** PHP `array_slice($array, $offset, $length)` (negative length counts from the end). */
function phpArraySlice<T>(arr: readonly T[], offset: number, length: number): T[] {
  const start = offset < 0 ? Math.max(0, arr.length + offset) : offset
  const end = length < 0 ? arr.length + length : start + length
  return arr.slice(start, Math.max(start, end))
}

/** Statement classes by PHP class name (`Parser::STATEMENT_PARSERS` values). */
export const STATEMENT_CLASSES: Readonly<Record<StatementClassName, StatementCtor<Statement>>> = {
  ExplainStatement,
  AnalyzeStatement,
  BackupStatement,
  CheckStatement,
  ChecksumStatement,
  KillStatement,
  OptimizeStatement,
  RepairStatement,
  RestoreStatement,
  SetStatement,
  ShowStatement: ShowStatement as unknown as StatementCtor<Statement>,
  AlterStatement,
  CreateStatement,
  DropStatement,
  RenameStatement,
  TruncateStatement,
  CallStatement,
  DeleteStatement,
  InsertStatement,
  LoadStatement,
  ReplaceStatement,
  SelectStatement,
  UpdateStatement,
  WithStatement,
  TransactionStatement,
  PurgeStatement,
  LockStatement,
}
