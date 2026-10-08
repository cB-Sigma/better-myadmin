import { Lexer } from '../Lexer.ts'
import { Parser, type ParserOptions } from '../Parser.ts'
import { type Token, TokenType } from '../Token.ts'
import type { TokensList } from '../TokensList.ts'
/**
 * Port of vendor/phpmyadmin/sql-parser/src/Utils/Query.php (statement utilities),
 * Utils/StatementFlags.php, Utils/StatementType.php and Utils/StatementInfo.php.
 */
import { type CaseExpression, Expression } from '../components.ts'
import { empty, looseEquals, strtolower, strtoupper, trim } from '../php.ts'
import {
  AlterStatement,
  AnalyzeStatement,
  CallStatement,
  CheckStatement,
  ChecksumStatement,
  CreateStatement,
  DeleteStatement,
  DropStatement,
  ExplainStatement,
  InsertStatement,
  KillStatement,
  LoadStatement,
  OptimizeStatement,
  RenameStatement,
  RepairStatement,
  ReplaceStatement,
  SelectStatement,
  SetStatement,
  ShowStatement,
  type Statement,
  TruncateStatement,
  UpdateStatement,
  getClauseStartOffset,
} from '../statements.ts'

export { getClauseStartOffset }

// pma: vendor/phpmyadmin/sql-parser/src/Utils/StatementType.php::StatementType
export type StatementType =
  | 'ALTER'
  | 'ANALYZE'
  | 'CALL'
  | 'CHECK'
  | 'CHECKSUM'
  | 'CREATE'
  | 'DELETE'
  | 'DROP'
  | 'EXPLAIN'
  | 'INSERT'
  | 'KILL'
  | 'LOAD'
  | 'OPTIMIZE'
  | 'REPAIR'
  | 'REPLACE'
  | 'SELECT'
  | 'SET'
  | 'SHOW'
  | 'UPDATE'

// pma: vendor/phpmyadmin/sql-parser/src/Utils/StatementFlags.php::StatementFlags
export interface StatementFlags {
  /** select ... DISTINCT ... */
  distinct: boolean
  /** drop ... DATABASE ... */
  dropDatabase: boolean
  /** ... GROUP BY ... */
  group: boolean
  /** ... HAVING ... */
  having: boolean
  /** INSERT ... or REPLACE ... or DELETE ... */
  isAffected: boolean
  /** ... PROCEDURE ANALYSE( ... ) ... */
  isAnalyse: boolean
  /** select ... COUNT( ... ) ... */
  isCount: boolean
  /** DELETE ... (deprecated mirror of queryType) */
  isDelete: boolean
  /** EXPLAIN ... (deprecated mirror of queryType) */
  isExplain: boolean
  /** select ... INTO OUTFILE ... */
  isExport: boolean
  /** select FUNC( ... ) ... */
  isFunc: boolean
  /** select ... GROUP BY ... or select ... HAVING ... */
  isGroup: boolean
  /** INSERT ... or REPLACE ... or LOAD DATA ... */
  isInsert: boolean
  /** ANALYZE ... or CHECK ... or CHECKSUM ... or OPTIMIZE ... or REPAIR ... */
  isMaint: boolean
  /** CALL ... */
  isProcedure: boolean
  /** REPLACE ... (deprecated mirror of queryType) */
  isReplace: boolean
  /** SELECT ... (deprecated mirror of queryType) */
  isSelect: boolean
  /** SHOW ... (deprecated mirror of queryType) */
  isShow: boolean
  /** Contains a subquery. */
  isSubQuery: boolean
  /** ... JOIN ... */
  join: boolean
  /** ... LIMIT ... */
  limit: boolean
  /** TODO in the library: never set. */
  offset: boolean
  /** ... ORDER ... */
  order: boolean
  /** The type of the query (which is usually the first keyword of the statement). */
  queryType: StatementType | null
  /** Whether a page reload is required. */
  reload: boolean
  /** SELECT ... FROM ... */
  selectFrom: boolean
  /** ... UNION ... */
  union: boolean
}

export function newStatementFlags(): StatementFlags {
  return {
    distinct: false,
    dropDatabase: false,
    group: false,
    having: false,
    isAffected: false,
    isAnalyse: false,
    isCount: false,
    isDelete: false,
    isExplain: false,
    isExport: false,
    isFunc: false,
    isGroup: false,
    isInsert: false,
    isMaint: false,
    isProcedure: false,
    isReplace: false,
    isSelect: false,
    isShow: false,
    isSubQuery: false,
    join: false,
    limit: false,
    offset: false,
    order: false,
    queryType: null,
    reload: false,
    selectFrom: false,
    union: false,
  }
}

/** `[table, database|null]` */
export type SelectTable = [string, string | null]

// pma: vendor/phpmyadmin/sql-parser/src/Utils/StatementInfo.php::StatementInfo
export interface StatementInfo {
  readonly parser: Parser
  /** The first statement, or null when nothing was parsed. */
  readonly statement: Statement | null
  readonly flags: StatementFlags
  /** Real tables (behind aliases) of the SELECT expressions, else of the FROM clause. */
  readonly selectTables: SelectTable[]
  /** SELECT expressions without an explicit table qualifier. */
  readonly selectExpressions: (string | null)[]
}

/** Functions that set the flag `isFunc`. */
// pma: vendor/phpmyadmin/sql-parser/src/Utils/Query.php::$functions
export const FUNCTIONS = ['SUM', 'AVG', 'STD', 'STDDEV', 'MIN', 'MAX', 'BIT_OR', 'BIT_AND']

/** PHP property read on an `Expression|CaseExpression` (undefined properties read as null). */
function prop(e: Expression | CaseExpression | null | undefined, name: string): unknown {
  if (e === null || e === undefined) return null
  return (e as unknown as Record<string, unknown>)[name] ?? null
}

// pma: vendor/phpmyadmin/sql-parser/src/Utils/Query.php::getFlagsSelect
function getFlagsSelect(statement: SelectStatement, flags: StatementFlags): void {
  flags.queryType = 'SELECT'
  flags.isSelect = true

  if (statement.from.length > 0) flags.selectFrom = true

  if (statement.options?.has('DISTINCT')) flags.distinct = true

  if (!empty(statement.group) || !empty(statement.having)) flags.isGroup = true

  if (statement.into !== null && statement.into.type === 'OUTFILE') flags.isExport = true

  const expressions: (Expression | CaseExpression | null)[] = [...statement.expr]
  if (!empty(statement.join)) {
    for (const join of statement.join ?? []) expressions.push(join.expr)
  }

  for (const expr of expressions) {
    const fn = prop(expr, 'function')
    if (!empty(fn)) {
      const func = strtoupper(String(fn))
      if (func === 'COUNT') {
        flags.isCount = true
      } else if (FUNCTIONS.includes(func)) {
        flags.isFunc = true
      }
    }

    if (empty(prop(expr, 'subquery'))) continue

    flags.isSubQuery = true
  }

  if (statement.procedure !== null && statement.procedure.name === 'ANALYSE') flags.isAnalyse = true

  if (!empty(statement.group)) flags.group = true

  if (!empty(statement.having)) flags.having = true

  if (statement.union.length > 0) flags.union = true

  if (empty(statement.join)) return

  flags.join = true
}

// pma: vendor/phpmyadmin/sql-parser/src/Utils/Query.php::getFlags
export function getFlags(statement: Statement | null): StatementFlags {
  const flags = newStatementFlags()

  if (statement instanceof AlterStatement) {
    flags.queryType = 'ALTER'
    flags.reload = true
  } else if (statement instanceof CreateStatement) {
    flags.queryType = 'CREATE'
    flags.reload = true
  } else if (statement instanceof AnalyzeStatement) {
    flags.queryType = 'ANALYZE'
    flags.isMaint = true
  } else if (statement instanceof CheckStatement) {
    flags.queryType = 'CHECK'
    flags.isMaint = true
  } else if (statement instanceof ChecksumStatement) {
    flags.queryType = 'CHECKSUM'
    flags.isMaint = true
  } else if (statement instanceof OptimizeStatement) {
    flags.queryType = 'OPTIMIZE'
    flags.isMaint = true
  } else if (statement instanceof RepairStatement) {
    flags.queryType = 'REPAIR'
    flags.isMaint = true
  } else if (statement instanceof CallStatement) {
    flags.queryType = 'CALL'
    flags.isProcedure = true
  } else if (statement instanceof DeleteStatement) {
    flags.queryType = 'DELETE'
    flags.isDelete = true
    flags.isAffected = true
  } else if (statement instanceof DropStatement) {
    flags.queryType = 'DROP'
    flags.reload = true
    if (statement.options?.has('DATABASE') || statement.options?.has('SCHEMA')) flags.dropDatabase = true
  } else if (statement instanceof ExplainStatement) {
    flags.queryType = 'EXPLAIN'
    flags.isExplain = true
  } else if (statement instanceof InsertStatement) {
    flags.queryType = 'INSERT'
    flags.isAffected = true
    flags.isInsert = true
  } else if (statement instanceof LoadStatement) {
    flags.queryType = 'LOAD'
    flags.isAffected = true
    flags.isInsert = true
  } else if (statement instanceof ReplaceStatement) {
    flags.queryType = 'REPLACE'
    flags.isAffected = true
    flags.isReplace = true
    flags.isInsert = true
  } else if (statement instanceof SelectStatement) {
    getFlagsSelect(statement, flags)
  } else if (statement instanceof ShowStatement) {
    flags.queryType = 'SHOW'
    flags.isShow = true
  } else if (statement instanceof UpdateStatement) {
    flags.queryType = 'UPDATE'
    flags.isAffected = true
  } else if (statement instanceof SetStatement) {
    flags.queryType = 'SET'
  } else if (statement instanceof KillStatement) {
    flags.queryType = 'KILL'
  }

  if (
    statement instanceof SelectStatement ||
    statement instanceof UpdateStatement ||
    statement instanceof DeleteStatement
  ) {
    if (statement.limit !== null) flags.limit = true
    if (!empty(statement.order)) flags.order = true
  }

  return flags
}

function inArrayTables(needle: SelectTable, haystack: readonly SelectTable[]): boolean {
  return haystack.some((t) => looseEquals(t[0], needle[0]) && looseEquals(t[1], needle[1]))
}

// pma: vendor/phpmyadmin/sql-parser/src/Utils/Query.php::getAll
export function getAll(query: string, options: ParserOptions = {}): StatementInfo {
  const parser = new Parser(query, options)

  if (parser.statements.length === 0) {
    return { parser, statement: null, flags: getFlags(null), selectTables: [], selectExpressions: [] }
  }

  return getAllFromParser(parser)
}

/** {@link getAll} for an already-built parser (uses its first statement). */
export function getAllFromParser(parser: Parser): StatementInfo {
  const statement = parser.statements[0] ?? null
  const flags = getFlags(statement)
  const selectTables: SelectTable[] = []
  const selectExpressions: (string | null)[] = []

  if (statement instanceof SelectStatement) {
    // Finding tables' aliases and their associated real names.
    const tableAliases = new Map<string, SelectTable>()
    for (const expr of statement.from) {
      const table = prop(expr, 'table') as string | null
      const alias = prop(expr, 'alias') as string | null
      if (table === null || alias === null || table === '' || alias === '') continue
      tableAliases.set(alias, [table, (prop(expr, 'database') as string | null) ?? null])
    }

    // Trying to find selected tables only from the select expression.
    // Sometimes, this is not possible because the tables aren't defined
    // explicitly (e.g. SELECT * FROM film, SELECT film_id FROM film).
    for (const expr of statement.expr) {
      const table = prop(expr, 'table') as string | null
      if (table !== null && table !== '') {
        let arr: SelectTable
        const aliased = tableAliases.get(table)
        if (aliased !== undefined) {
          arr = aliased
        } else {
          const database = prop(expr, 'database') as string | null
          arr = [table, database !== null && database !== '' ? database : null]
        }
        if (!inArrayTables(arr, selectTables)) selectTables.push(arr)
      } else {
        selectExpressions.push(expr.expr)
      }
    }

    // If no tables names were found in the SELECT clause or if there
    // are expressions like * or COUNT(*), etc. tables names should be
    // extracted from the FROM clause.
    if (selectTables.length === 0) {
      for (const expr of statement.from) {
        const table = prop(expr, 'table') as string | null
        if (table === null || table === '') continue
        const database = prop(expr, 'database') as string | null
        const arr: SelectTable = [table, database !== null && database !== '' ? database : null]
        if (inArrayTables(arr, selectTables)) continue
        selectTables.push(arr)
      }
    }
  }

  return { parser, statement, flags, selectTables, selectExpressions }
}

// pma: vendor/phpmyadmin/sql-parser/src/Utils/Query.php::getTables
export function getTables(statement: Statement): string[] {
  let expressions: (Expression | CaseExpression | null)[] = []

  if (statement instanceof InsertStatement || statement instanceof ReplaceStatement) {
    const dest = statement.into?.dest
    expressions = [dest instanceof Expression ? dest : null]
  } else if (statement instanceof UpdateStatement) {
    expressions = statement.tables ?? []
  } else if (statement instanceof SelectStatement || statement instanceof DeleteStatement) {
    expressions = statement.from ?? []
  } else if (statement instanceof AlterStatement || statement instanceof TruncateStatement) {
    expressions = [statement.table]
  } else if (statement instanceof DropStatement) {
    if (!statement.options?.has('TABLE')) {
      // No tables are dropped.
      return []
    }
    expressions = statement.fields ?? []
  } else if (statement instanceof RenameStatement) {
    for (const rename of statement.renames ?? []) expressions.push(rename.old)
  }

  const ret: string[] = []
  for (const expr of expressions) {
    if (expr === null || empty(prop(expr, 'table'))) continue
    const e = expr as Expression
    e.expr = null // Force rebuild.
    e.alias = null // Aliases are not required.
    ret.push(e.build())
  }

  return ret
}

// pma: vendor/phpmyadmin/sql-parser/src/Utils/Query.php::getClause
export function getClause(
  statement: Statement,
  list: TokensList,
  clause: string,
  type: number | string = 0,
  skipFirstClause = true,
): string {
  let skipFirst = skipFirstClause
  // The index of the current clause.
  let currIdx = 0
  // The count of brackets. We keep track of them so we won't insert the clause in a subquery.
  let brackets = 0
  // The string to be returned.
  let ret = ''
  // The clauses of this type of statement and their index.
  const clauses = statement.getClauseOrder()
  // Lexer used for lexing the clause.
  const lexer = new Lexer(clause)
  // The type of this clause.
  const clauseType = lexer.list.getNextOfType(TokenType.Keyword)?.keyword ?? ''
  // The index of this clause.
  const clauseIdx = Object.hasOwn(clauses, clauseType) ? (clauses[clauseType] as number) : -1

  let firstClauseIdx = clauseIdx
  let lastClauseIdx = clauseIdx

  // Determining the behavior of this function.
  if (type === -1) {
    firstClauseIdx = -1 // Something small enough.
    lastClauseIdx = clauseIdx - 1
  } else if (type === 1) {
    firstClauseIdx = clauseIdx + 1
    lastClauseIdx = 10000 // Something big enough.
  } else if (typeof type === 'string' && Object.hasOwn(clauses, type)) {
    const typeIdx = clauses[type] as number
    if (typeIdx > clauseIdx) {
      firstClauseIdx = clauseIdx + 1
      lastClauseIdx = typeIdx - 1
    } else {
      firstClauseIdx = typeIdx + 1
      lastClauseIdx = clauseIdx - 1
    }
  }

  // This option is unavailable for multiple clauses.
  if (type !== 0) skipFirst = false

  for (let i = statement.first ?? 0; i <= (statement.last ?? -1); ++i) {
    const token = list.tokens[i] as Token | undefined
    if (token === undefined) continue

    if (token.type === TokenType.Comment) continue

    if (token.type === TokenType.Operator) {
      if (token.value === '(') {
        ++brackets
      } else if (token.value === ')') {
        --brackets
      }
    }

    if (brackets === 0) {
      // Checking if the section was changed.
      if (
        token.type === TokenType.Keyword &&
        token.keyword !== null &&
        Object.hasOwn(clauses, token.keyword) &&
        (clauses[token.keyword] as number) >= currIdx
      ) {
        currIdx = clauses[token.keyword] as number
        if (skipFirst && currIdx === clauseIdx) {
          // This token is skipped (not added to the old clause) because it will be replaced.
          continue
        }
      }
    }

    if (firstClauseIdx > currIdx || currIdx > lastClauseIdx) continue

    ret += token.token
  }

  return trim(ret)
}

/** PHP `ctype_space()` */
function ctypeSpace(s: string): boolean {
  return s.length > 0 && /^[ \t\n\v\f\r]+$/.test(s)
}

// pma: vendor/phpmyadmin/sql-parser/src/Utils/Query.php::glueQueryPartsWithSpaces
function glueQueryPartsWithSpaces(parts: readonly string[]): string {
  let statement = ''
  for (const part of parts) {
    if (part === '') continue
    const lastChar = Array.from(statement).at(-1) ?? ''
    const firstChar = Array.from(part)[0] ?? ''
    if (statement !== '' && !ctypeSpace(lastChar) && !ctypeSpace(firstChar)) statement += ' '
    statement += part
  }
  return statement
}

// pma: vendor/phpmyadmin/sql-parser/src/Utils/Query.php::replaceClause
export function replaceClause(
  statement: Statement,
  list: TokensList,
  old: string,
  newClause: string | null = null,
  onlyType = false,
): string {
  // TODO: Update the tokens list and the statement.
  const parts = [getClause(statement, list, old, -1, false), newClause ?? old]
  if (onlyType) parts.push(getClause(statement, list, old, 0))
  parts.push(getClause(statement, list, old, 1, false))
  return glueQueryPartsWithSpaces(parts)
}

// pma: vendor/phpmyadmin/sql-parser/src/Utils/Query.php::replaceClauses
export function replaceClauses(
  statement: Statement,
  list: TokensList,
  ops: readonly (readonly [string, string])[],
): string {
  const count = ops.length

  // Nothing to do.
  if (count === 0) return ''

  const first = ops[0] as readonly [string, string]
  // If there is only one clause, `replaceClause()` should be used.
  if (count === 1) return replaceClause(statement, list, first[0], first[1])

  // Adding everything before first replacement.
  const parts = [getClause(statement, list, first[0], -1)]

  // Doing replacements.
  ops.forEach((clause, i) => {
    parts.push(clause[1])
    // Adding everything between this and next replacement.
    if (i + 1 === count) return
    parts.push(getClause(statement, list, clause[0], (ops[i + 1] as readonly [string, string])[0]))
  })

  // Adding everything after the last replacement.
  parts.push(getClause(statement, list, (ops[count - 1] as readonly [string, string])[0], 1))

  return glueQueryPartsWithSpaces(parts)
}

/** Result of {@link getFirstStatement}: `[first statement | null, remaining query, last delimiter]`. */
export type FirstStatement = [string | null, string, string | null]

// pma: vendor/phpmyadmin/sql-parser/src/Utils/Query.php::getFirstStatement
export function getFirstStatement(query: string, initialDelimiter: string | null = null): FirstStatement {
  let delimiter = initialDelimiter
  const lexer = new Lexer(query, { delimiter })
  const list = lexer.list

  // Whether a full statement was found.
  let fullStatement = false
  // The first full statement.
  let statement = ''

  for (list.idx = 0; list.idx < list.count; ++list.idx) {
    const token = list.tokens[list.idx] as Token

    if (token.type === TokenType.Comment) continue

    statement += token.token

    if (token.type === TokenType.Delimiter && !empty(token.token)) {
      delimiter = token.token
      fullStatement = true
      break
    }
  }

  // No statement was found so we return the entire query as being the remaining part.
  if (!fullStatement) return [null, query, delimiter]

  // At least one query was found so we have to build the rest of the remaining query.
  let rest = ''
  for (++list.idx; list.idx < list.count; ++list.idx) rest += (list.tokens[list.idx] as Token).token

  return [trim(statement), rest, delimiter]
}

/**
 * phpMyAdmin's `ParseAnalyze::sqlQuery()`: analyses a query and works out the
 * database/table it targets and whether the navigation must be reloaded.
 *
 * @returns `[info, db, table, reload]`
 */
// pma: src/ParseAnalyze.php::sqlQuery
export function parseAnalyze(
  sqlQuery: string,
  currentDb: string,
  isAjaxRequest: boolean,
  options: ParserOptions = {},
): [StatementInfo, string, string, boolean] {
  const info = getAll(sqlQuery, options)
  let db = currentDb

  let table = ''

  let reload =
    info.statement instanceof AlterStatement ||
    info.statement instanceof CreateStatement ||
    info.statement instanceof DropStatement

  // If the targeted table (and database) are different than the ones that is
  // currently browsed, edit `$db` and `$table` to match them so other elements
  // (page headers, links, navigation panel) can be updated properly.
  if (info.selectTables.length > 0) {
    // Previous table and database name is stored to check if it changed.
    const previousDb = db

    if (info.selectTables.length > 1) {
      table = ''
    } else {
      const first = info.selectTables[0] as SelectTable
      table = first[0] ?? ''
      if (first[1] !== null) db = first[1]
    }

    // There is no point checking if a reloading is required if we already decided
    // to reload. Also, no reload is required for AJAX requests.
    if (!reload && !isAjaxRequest) {
      // NOTE: Database names are case-insensitive.
      reload = strtolower(db) !== strtolower(previousDb)
    }
  }

  return [info, db, table, reload]
}
