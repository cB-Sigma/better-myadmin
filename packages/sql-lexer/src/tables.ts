/**
 * Data tables of the parser (kept free of imports to avoid module cycles).
 */

/** Options passed to component parsers (PHP `$options` arrays). */
export interface ParseOptions {
  parseField?: string
  field?: string
  breakOnAlias?: boolean
  breakOnParentheses?: boolean
  parenthesesDelimited?: boolean
  fromInsert?: boolean
  fromReplace?: boolean
  type?: 'PartitionDefinitions'
  typeOptions?: ParseOptions
}

export type StatementClassName =
  | 'ExplainStatement'
  | 'AnalyzeStatement'
  | 'BackupStatement'
  | 'CheckStatement'
  | 'ChecksumStatement'
  | 'KillStatement'
  | 'OptimizeStatement'
  | 'RepairStatement'
  | 'RestoreStatement'
  | 'SetStatement'
  | 'ShowStatement'
  | 'AlterStatement'
  | 'CreateStatement'
  | 'DropStatement'
  | 'RenameStatement'
  | 'TruncateStatement'
  | 'CallStatement'
  | 'DeleteStatement'
  | 'InsertStatement'
  | 'LoadStatement'
  | 'ReplaceStatement'
  | 'SelectStatement'
  | 'UpdateStatement'
  | 'WithStatement'
  | 'TransactionStatement'
  | 'PurgeStatement'
  | 'LockStatement'

// pma: vendor/phpmyadmin/sql-parser/src/Parser.php::STATEMENT_PARSERS
export const STATEMENT_PARSERS: Readonly<Record<string, StatementClassName | ''>> = {
  // MySQL Utility Statements
  DESCRIBE: 'ExplainStatement',
  DESC: 'ExplainStatement',
  EXPLAIN: 'ExplainStatement',
  FLUSH: '',
  GRANT: '',
  HELP: '',
  'SET PASSWORD': '',
  STATUS: '',
  USE: '',

  // Table Maintenance Statements
  ANALYZE: 'AnalyzeStatement',
  BACKUP: 'BackupStatement',
  CHECK: 'CheckStatement',
  CHECKSUM: 'ChecksumStatement',
  KILL: 'KillStatement',
  OPTIMIZE: 'OptimizeStatement',
  REPAIR: 'RepairStatement',
  RESTORE: 'RestoreStatement',

  // Database Administration Statements
  SET: 'SetStatement',
  SHOW: 'ShowStatement',

  // Data Definition Statements.
  ALTER: 'AlterStatement',
  CREATE: 'CreateStatement',
  DROP: 'DropStatement',
  RENAME: 'RenameStatement',
  TRUNCATE: 'TruncateStatement',

  // Data Manipulation Statements.
  CALL: 'CallStatement',
  DELETE: 'DeleteStatement',
  DO: '',
  HANDLER: '',
  INSERT: 'InsertStatement',
  'LOAD DATA': 'LoadStatement',
  REPLACE: 'ReplaceStatement',
  SELECT: 'SelectStatement',
  UPDATE: 'UpdateStatement',
  WITH: 'WithStatement',

  // Prepared Statements.
  DEALLOCATE: '',
  EXECUTE: '',
  PREPARE: '',

  // Transactional and Locking Statements
  BEGIN: 'TransactionStatement',
  COMMIT: 'TransactionStatement',
  ROLLBACK: 'TransactionStatement',
  'START TRANSACTION': 'TransactionStatement',

  PURGE: 'PurgeStatement',

  // Lock statements
  LOCK: 'LockStatement',
  UNLOCK: 'LockStatement',
}

/** `isset(Parser::STATEMENT_PARSERS[$k])` */
export function isStatementKeyword(k: unknown): boolean {
  return typeof k === 'string' && Object.hasOwn(STATEMENT_PARSERS, k)
}

/** `! empty(Parser::STATEMENT_PARSERS[$k])` */
export function hasStatementParser(k: unknown): boolean {
  return typeof k === 'string' && Object.hasOwn(STATEMENT_PARSERS, k) && STATEMENT_PARSERS[k] !== ''
}

export type ComponentParserName =
  | 'OptionsArrays'
  | 'UnionKeywords'
  | 'Expressions'
  | 'ExpressionArray'
  | 'FunctionCalls'
  | 'JoinKeywords'
  | 'IndexHints'
  | 'GroupKeywords'
  | 'Conditions'
  | 'IntoKeywords'
  | 'Limits'
  | 'OrderKeywords'
  | 'ArrayObjs'
  | 'RenameOperations'
  | 'SetOperations'
  | 'Array2d'

export interface KeywordParser {
  class: ComponentParserName
  field: string
  options?: ParseOptions
}

// pma: vendor/phpmyadmin/sql-parser/src/Parser.php::KEYWORD_PARSERS
export const KEYWORD_PARSERS: Readonly<Record<string, KeywordParser>> = {
  // This is not a proper keyword and was added here to help the builder.
  _OPTIONS: { class: 'OptionsArrays', field: 'options' },
  _END_OPTIONS: { class: 'OptionsArrays', field: 'endOptions' },
  _GROUP_OPTIONS: { class: 'OptionsArrays', field: 'groupOptions' },

  INTERSECT: { class: 'UnionKeywords', field: 'union' },
  EXCEPT: { class: 'UnionKeywords', field: 'union' },
  UNION: { class: 'UnionKeywords', field: 'union' },
  'UNION ALL': { class: 'UnionKeywords', field: 'union' },
  'UNION DISTINCT': { class: 'UnionKeywords', field: 'union' },

  // Actual clause parsers.
  ALTER: { class: 'Expressions', field: 'table', options: { parseField: 'table' } },
  ANALYZE: { class: 'ExpressionArray', field: 'tables', options: { parseField: 'table' } },
  BACKUP: { class: 'ExpressionArray', field: 'tables', options: { parseField: 'table' } },
  CALL: { class: 'FunctionCalls', field: 'call' },
  CHECK: { class: 'ExpressionArray', field: 'tables', options: { parseField: 'table' } },
  CHECKSUM: { class: 'ExpressionArray', field: 'tables', options: { parseField: 'table' } },
  'CROSS JOIN': { class: 'JoinKeywords', field: 'join' },
  DROP: { class: 'ExpressionArray', field: 'fields', options: { parseField: 'table' } },
  FORCE: { class: 'IndexHints', field: 'indexHints' },
  FROM: { class: 'ExpressionArray', field: 'from', options: { field: 'table' } },
  'GROUP BY': { class: 'GroupKeywords', field: 'group' },
  HAVING: { class: 'Conditions', field: 'having' },
  IGNORE: { class: 'IndexHints', field: 'indexHints' },
  INTO: { class: 'IntoKeywords', field: 'into' },
  JOIN: { class: 'JoinKeywords', field: 'join' },
  'LEFT JOIN': { class: 'JoinKeywords', field: 'join' },
  'LEFT OUTER JOIN': { class: 'JoinKeywords', field: 'join' },
  ON: { class: 'Expressions', field: 'table', options: { parseField: 'table' } },
  'RIGHT JOIN': { class: 'JoinKeywords', field: 'join' },
  'RIGHT OUTER JOIN': { class: 'JoinKeywords', field: 'join' },
  'INNER JOIN': { class: 'JoinKeywords', field: 'join' },
  'FULL JOIN': { class: 'JoinKeywords', field: 'join' },
  'FULL OUTER JOIN': { class: 'JoinKeywords', field: 'join' },
  'NATURAL JOIN': { class: 'JoinKeywords', field: 'join' },
  'NATURAL LEFT JOIN': { class: 'JoinKeywords', field: 'join' },
  'NATURAL RIGHT JOIN': { class: 'JoinKeywords', field: 'join' },
  'NATURAL LEFT OUTER JOIN': { class: 'JoinKeywords', field: 'join' },
  'NATURAL RIGHT OUTER JOIN': { class: 'JoinKeywords', field: 'join' },
  STRAIGHT_JOIN: { class: 'JoinKeywords', field: 'join' },
  LIMIT: { class: 'Limits', field: 'limit' },
  OPTIMIZE: { class: 'ExpressionArray', field: 'tables', options: { parseField: 'table' } },
  'ORDER BY': { class: 'OrderKeywords', field: 'order' },
  PARTITION: { class: 'ArrayObjs', field: 'partition' },
  PROCEDURE: { class: 'FunctionCalls', field: 'procedure' },
  RENAME: { class: 'RenameOperations', field: 'renames' },
  REPAIR: { class: 'ExpressionArray', field: 'tables', options: { parseField: 'table' } },
  RESTORE: { class: 'ExpressionArray', field: 'tables', options: { parseField: 'table' } },
  SET: { class: 'SetOperations', field: 'set' },
  SELECT: { class: 'ExpressionArray', field: 'expr' },
  TRUNCATE: { class: 'Expressions', field: 'table', options: { parseField: 'table' } },
  UPDATE: { class: 'ExpressionArray', field: 'tables', options: { parseField: 'table' } },
  USE: { class: 'IndexHints', field: 'indexHints' },
  VALUE: { class: 'Array2d', field: 'values' },
  VALUES: { class: 'Array2d', field: 'values' },
  WHERE: { class: 'Conditions', field: 'where' },
}

/** `isset(Parser::KEYWORD_PARSERS[$k])` */
export function isKeywordParser(k: unknown): k is string {
  return typeof k === 'string' && Object.hasOwn(KEYWORD_PARSERS, k)
}
