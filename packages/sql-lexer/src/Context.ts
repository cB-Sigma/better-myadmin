import { TokenFlag } from './Token.ts'
import { type ContextName, generatedContexts } from './contexts/generated/index.ts'
import { strtoupper } from './php.ts'

export type { ContextName }

// pma: vendor/phpmyadmin/sql-parser/src/Context.php::Context (SQL_MODE_* constants)
export const SqlMode = {
  NONE: 0,
  ALLOW_INVALID_DATES: 1,
  ANSI_QUOTES: 2,
  COMPAT_MYSQL: 2,
  ERROR_FOR_DIVISION_BY_ZERO: 4,
  HIGH_NOT_PRECEDENCE: 8,
  IGNORE_SPACE: 16,
  NO_AUTO_CREATE_USER: 32,
  NO_AUTO_VALUE_ON_ZERO: 64,
  NO_BACKSLASH_ESCAPES: 128,
  NO_DIR_IN_CREATE: 256,
  NO_ENGINE_SUBSTITUTION: 512,
  NO_FIELD_OPTIONS: 1024,
  NO_KEY_OPTIONS: 2048,
  NO_TABLE_OPTIONS: 4096,
  NO_UNSIGNED_SUBTRACTION: 8192,
  NO_ZERO_DATE: 16384,
  NO_ZERO_IN_DATE: 32768,
  ONLY_FULL_GROUP_BY: 65536,
  PIPES_AS_CONCAT: 131072,
  REAL_AS_FLOAT: 262144,
  STRICT_ALL_TABLES: 524288,
  STRICT_TRANS_TABLES: 1048576,
  NO_ENCLOSING_QUOTES: 1073741824,
  ANSI: 393234,
  DB2: 138258,
  MAXDB: 138290,
  MSSQL: 138258,
  ORACLE: 138290,
  POSTGRESQL: 138258,
  TRADITIONAL: 1622052,
} as const

/** Names accepted by {@link Context.setMode} (`getModeFromString`). */
const MODE_NAMES: Readonly<Record<string, number>> = {
  ALLOW_INVALID_DATES: SqlMode.ALLOW_INVALID_DATES,
  ANSI_QUOTES: SqlMode.ANSI_QUOTES,
  COMPAT_MYSQL: SqlMode.COMPAT_MYSQL,
  ERROR_FOR_DIVISION_BY_ZERO: SqlMode.ERROR_FOR_DIVISION_BY_ZERO,
  HIGH_NOT_PRECEDENCE: SqlMode.HIGH_NOT_PRECEDENCE,
  IGNORE_SPACE: SqlMode.IGNORE_SPACE,
  NO_AUTO_CREATE_USER: SqlMode.NO_AUTO_CREATE_USER,
  NO_AUTO_VALUE_ON_ZERO: SqlMode.NO_AUTO_VALUE_ON_ZERO,
  NO_BACKSLASH_ESCAPES: SqlMode.NO_BACKSLASH_ESCAPES,
  NO_DIR_IN_CREATE: SqlMode.NO_DIR_IN_CREATE,
  NO_ENGINE_SUBSTITUTION: SqlMode.NO_ENGINE_SUBSTITUTION,
  NO_FIELD_OPTIONS: SqlMode.NO_FIELD_OPTIONS,
  NO_KEY_OPTIONS: SqlMode.NO_KEY_OPTIONS,
  NO_TABLE_OPTIONS: SqlMode.NO_TABLE_OPTIONS,
  NO_UNSIGNED_SUBTRACTION: SqlMode.NO_UNSIGNED_SUBTRACTION,
  NO_ZERO_DATE: SqlMode.NO_ZERO_DATE,
  NO_ZERO_IN_DATE: SqlMode.NO_ZERO_IN_DATE,
  ONLY_FULL_GROUP_BY: SqlMode.ONLY_FULL_GROUP_BY,
  PIPES_AS_CONCAT: SqlMode.PIPES_AS_CONCAT,
  REAL_AS_FLOAT: SqlMode.REAL_AS_FLOAT,
  STRICT_ALL_TABLES: SqlMode.STRICT_ALL_TABLES,
  STRICT_TRANS_TABLES: SqlMode.STRICT_TRANS_TABLES,
  NO_ENCLOSING_QUOTES: SqlMode.NO_ENCLOSING_QUOTES,
  ANSI: SqlMode.ANSI,
  DB2: SqlMode.DB2,
  MAXDB: SqlMode.MAXDB,
  MSSQL: SqlMode.MSSQL,
  ORACLE: SqlMode.ORACLE,
  POSTGRESQL: SqlMode.POSTGRESQL,
  TRADITIONAL: SqlMode.TRADITIONAL,
}

// pma: vendor/phpmyadmin/sql-parser/src/Context.php::OPERATORS
const OPERATORS: ReadonlyMap<string, number> = new Map([
  ['%', 1],
  ['*', 1],
  ['+', 1],
  ['-', 1],
  ['/', 1],
  ['!', 2],
  ['!=', 2],
  ['&&', 2],
  ['<', 2],
  ['<=', 2],
  ['<=>', 2],
  ['<>', 2],
  ['=', 2],
  ['>', 2],
  ['>=', 2],
  ['||', 2],
  ['&', 4],
  ['<<', 4],
  ['>>', 4],
  ['^', 4],
  ['|', 4],
  ['~', 4],
  [':=', 8],
  ['(', 16],
  [')', 16],
  ['.', 16],
  [',', 16],
  [';', 16],
])

export const KEYWORD_MAX_LENGTH = 30
export const LABEL_MAX_LENGTH = 16
export const OPERATOR_MAX_LENGTH = 4

const keywordCache = new Map<ContextName, ReadonlyMap<string, number>>()

/** Keyword table of a generated context (`Context<Name>::KEYWORDS`). */
export function getKeywords(name: ContextName): ReadonlyMap<string, number> {
  let map = keywordCache.get(name)
  if (map === undefined) {
    const m = new Map<string, number>()
    const groups = generatedContexts[name].keywords
    for (const [flags, list] of Object.entries(groups)) {
      const f = Number(flags)
      for (const kw of list.split('|')) m.set(kw, f)
    }
    map = m
    keywordCache.set(name, map)
  }
  return map
}

/** Every context shipped by phpmyadmin/sql-parser (e.g. `MySql80000`, `MariaDb100600`). */
export const CONTEXT_NAMES = Object.keys(generatedContexts) as ContextName[]

function isContextName(name: string): name is ContextName {
  return Object.hasOwn(generatedContexts, name)
}

/**
 * A lexing/parsing context: a keyword table and an SQL mode.
 *
 * PHP keeps this as global static state (`Context::$keywords`, `Context::$mode`);
 * here the "current" context is a module-level instance ({@link Context.current})
 * that can also be swapped for the duration of a call with {@link Context.run}.
 */
// pma: vendor/phpmyadmin/sql-parser/src/Context.php::Context
export class Context {
  /** The context used by default (`ContextMySql50700`). */
  static readonly DEFAULT: ContextName = 'MySql50700'

  /** The context currently in use (PHP's static state). */
  static current: Context = new Context()

  loadedContext: ContextName
  keywords: ReadonlyMap<string, number>
  mode: number

  constructor(name: ContextName = Context.DEFAULT, mode: number = SqlMode.NONE) {
    this.loadedContext = name
    this.keywords = getKeywords(name)
    this.mode = mode
  }

  /** Runs `fn` with `ctx` as the current context. */
  static run<T>(ctx: Context | undefined, fn: () => T): T {
    if (ctx === undefined || ctx === Context.current) return fn()
    const prev = Context.current
    Context.current = ctx
    try {
      return fn()
    } finally {
      Context.current = prev
    }
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::isKeyword
  isKeyword(str: string, isReserved = false): number | null {
    const flags = this.keywords.get(strtoupper(str))
    if (flags === undefined || (isReserved && !(flags & TokenFlag.KEYWORD_RESERVED))) return null
    return flags
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::load
  load(context = ''): boolean {
    let name = context === '' ? Context.DEFAULT : context
    // A full class name (`PhpMyAdmin\SqlParser\Contexts\ContextMySql50700`) or the short name.
    const m = /^\\?PhpMyAdmin\\SqlParser\\Contexts\\Context(.+)$/.exec(name)
    if (m) name = m[1] as string
    if (!isContextName(name)) return false
    this.loadedContext = name
    this.keywords = getKeywords(name)
    return true
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::loadClosest
  loadClosest(context = ''): string | null {
    let ctx = context
    for (let i = ctx.length; i > 0; ) {
      if (this.load(ctx)) return ctx
      // Replace last two non zero digits by zeroes.
      let stop = false
      for (;;) {
        i -= 2
        const part = i < 0 ? ctx.slice(Math.max(0, ctx.length + i), ctx.length + i + 2) : ctx.slice(i, i + 2)
        if (!isPhpNumeric(part)) {
          stop = true
          break
        }
        if (!(Number.parseInt(part, 10) === 0 && i > 0)) break
      }
      if (stop) break
      ctx = phpSubstr(ctx, 0, i) + '00' + phpSubstr(ctx, i + 2)
    }
    if (ctx.startsWith('MariaDb')) return this.loadClosest('MariaDb100300')
    if (ctx.startsWith('MySql')) return this.loadClosest('MySql50700')
    return null
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::getMode
  getMode(): number {
    return this.mode
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::setMode
  setMode(mode: number | string = SqlMode.NONE): void {
    if (typeof mode === 'number') {
      this.mode = mode
      return
    }
    this.mode = SqlMode.NONE
    if (mode === '') return
    for (const m of mode.split(',')) this.mode |= MODE_NAMES[m] ?? SqlMode.NONE
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::hasMode
  hasMode(flag: number | null = null): boolean {
    if (!flag) return false
    return (this.mode & flag) === flag
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::escape
  escape(str: string, defaultQuote = '`'): string {
    let quote = defaultQuote
    if (
      this.mode & SqlMode.NO_ENCLOSING_QUOTES &&
      !(this.isKeyword(str, true) || doesIdentifierRequireQuoting(str))
    ) {
      return str
    }
    if (this.mode & SqlMode.ANSI_QUOTES) quote = '"'
    return quote + str.replaceAll(quote, quote + quote) + quote
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::escapeAll
  escapeAll(strings: readonly string[]): string[] {
    return strings.map((s) => this.escape(s))
  }

  // ---- static helpers that do not depend on the loaded keywords ----

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::isOperator
  static isOperator(str: string): number | null {
    return OPERATORS.get(str) ?? null
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::isWhitespace
  static isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\r' || ch === '\n' || ch === '\t'
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::isComment
  static isComment(str: string, end = false): number | null {
    if (str.startsWith('#')) return TokenFlag.COMMENT_BASH
    if (str.startsWith('/*!')) return TokenFlag.COMMENT_MYSQL_CMD
    if (str.startsWith('/*') || str.startsWith('*/')) return TokenFlag.COMMENT_C
    if (
      str.startsWith('-- ') ||
      str.startsWith('--\r') ||
      str.startsWith('--\n') ||
      str.startsWith('--\t') ||
      (str === '--' && end)
    ) {
      return TokenFlag.COMMENT_SQL
    }
    return null
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::isBool
  static isBool(str: string): boolean {
    const upper = strtoupper(str)
    return upper === 'TRUE' || upper === 'FALSE'
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::isNumber
  static isNumber(str: string): boolean {
    return ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '-', '+', 'e', 'E'].includes(str)
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::isSymbol
  static isSymbol(ch: string): number | null {
    switch (ch) {
      case '@':
        return TokenFlag.SYMBOL_VARIABLE
      case '`':
        return TokenFlag.SYMBOL_BACKTICK
      case ':':
      case '?':
        return TokenFlag.SYMBOL_PARAMETER
      default:
        return null
    }
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::isString
  static isString(ch: string): number | null {
    if (ch === "'") return TokenFlag.STRING_SINGLE_QUOTES
    if (ch === '"') return TokenFlag.STRING_DOUBLE_QUOTES
    return null
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Context.php::isSeparator
  static isSeparator(str: string): boolean {
    // Only non-alphanumeric ASCII characters may be separators. `~` is the last printable ASCII character.
    return (
      str <= '~' &&
      str !== '_' &&
      str !== '$' &&
      (str < '0' || str > '9') &&
      (str < 'a' || str > 'z') &&
      (str < 'A' || str > 'Z')
    )
  }
}

function isPhpNumeric(s: string): boolean {
  return /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(s)
}

/** PHP `substr()` with possibly negative start. */
function phpSubstr(s: string, start: number, length?: number): string {
  let st = start < 0 ? Math.max(0, s.length + start) : Math.min(start, s.length)
  if (length === undefined) return s.slice(st)
  const end = length < 0 ? s.length + length : st + length
  if (end < st) st = end
  return s.slice(st, end)
}

// pma: vendor/phpmyadmin/sql-parser/src/Context.php::doesIdentifierRequireQuoting
function doesIdentifierRequireQuoting(identifier: string): boolean {
  // PHP: preg_match('/^[$]|^\d+$|[^0-9a-zA-Z$_\x80-\xffff]/', $identifier) on bytes.
  // The character class `\x80-\xff` + `ff` allows every byte >= 0x80, i.e. every non-ASCII char.
  return /^[$]|^\d+$|[^0-9a-zA-Z$_\u0080-\u{10ffff}]/u.test(identifier)
}

// ---- PHP-style static facade over the current context ----

/** Loads a context by name (`MySql80000`, full PHP class name, ...) into the current context. */
export function loadContext(context = ''): boolean {
  return Context.current.load(context)
}

/** `Context::loadClosest()` on the current context, e.g. `loadClosestContext('MySql80032')`. */
export function loadClosestContext(context = ''): string | null {
  return Context.current.loadClosest(context)
}

/**
 * Builds the context name phpMyAdmin passes to `Context::loadClosest()`
 * (`DatabaseInterface::postConnect`): `'MariaDb' | 'MySql'` + version int (e.g. 80032).
 */
// pma: src/Dbal/DatabaseInterface.php::postConnect
export function contextNameForServer(versionInt: number, isMariaDb: boolean): string {
  return (isMariaDb ? 'MariaDb' : 'MySql') + String(versionInt)
}

/**
 * Creates a context for a server version the way phpMyAdmin does on connect:
 * `Context::setMode(@@sql_mode)` + `Context::loadClosest(...)`.
 */
export function createServerContext(versionInt: number, isMariaDb: boolean, sqlMode = ''): Context {
  const ctx = new Context()
  ctx.setMode(sqlMode)
  ctx.loadClosest(contextNameForServer(versionInt, isMariaDb))
  return ctx
}
