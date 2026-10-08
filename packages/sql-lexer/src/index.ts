/**
 * @bettermyadmin/sql-lexer: a dependency-free TypeScript port of phpmyadmin/sql-parser 6.0.0
 * (lexer, parser, statement utilities) plus the phpMyAdmin helpers built on top of it.
 */

// Lexing
export { Lexer, tokenize, type LexerOptions } from './Lexer.ts'
export { Token, TokenType, TokenFlag, type TokenValue } from './Token.ts'
export { TokensList } from './TokensList.ts'
export {
  Context,
  SqlMode,
  CONTEXT_NAMES,
  KEYWORD_MAX_LENGTH,
  LABEL_MAX_LENGTH,
  OPERATOR_MAX_LENGTH,
  getKeywords,
  loadContext,
  loadClosestContext,
  contextNameForServer,
  createServerContext,
  type ContextName,
} from './Context.ts'
export { LexerException, ParserException } from './exceptions.ts'

// Parsing
export { Parser, type ParserOptions } from './Parser.ts'
export * from './statements.ts'
export * from './components.ts'
export {
  OptionsArrays,
  Expressions,
  ExpressionArray,
  CaseExpressions,
  Conditions,
  ArrayObjs,
  Array2d,
  FunctionCalls,
  GroupKeywords,
  OrderKeywords,
  IndexHints,
  IntoKeywords,
  JoinKeywords,
  Keys,
  Limits,
  LockExpressions,
  RenameOperations,
  SetOperations,
  DataTypes,
  References,
  CreateDefinitions,
  ParameterDefinitions,
  PartitionDefinitions,
  AlterOperations,
  type OptionSpec,
  type OptionSpecs,
} from './parsers.ts'
export { STATEMENT_PARSERS, KEYWORD_PARSERS, type StatementClassName, type ParseOptions } from './tables.ts'

// Statement analysis & utilities (Utils/Query.php, ParseAnalyze.php)
export {
  getFlags,
  getAll,
  getAllFromParser,
  getTables,
  getClause,
  getClauseStartOffset,
  replaceClause,
  replaceClauses,
  getFirstStatement,
  parseAnalyze,
  newStatementFlags,
  FUNCTIONS,
  type StatementFlags,
  type StatementInfo,
  type StatementType,
  type SelectTable,
  type FirstStatement,
} from './utils/Query.ts'

// Statement splitting (Utils/BufferedQuery.php + ImportSql::doImport)
export {
  BufferedQuery,
  splitSql,
  splitSqlQueriesToExecute,
  convertLoneCr,
  type BufferedQueryOptions,
  type SplitOptions,
} from './utils/BufferedQuery.ts'

// Errors & linting
export { getErrors, formatErrors, type ErrorEntry } from './utils/Error.ts'
export {
  lint,
  lintQuery,
  getLines,
  findLineNumberAndColumn,
  EDITOR_SQL_PREFIX,
  LINT_MSGIDS,
  type LintMessages,
  type LintMessage,
  type LintEditorType,
} from './utils/Linter.ts'

// Formatting (Utils/Formatter.php, the Format buttons)
export { Formatter, formatSql, type FormatterOptions, type FormatRule } from './utils/Formatter.ts'
