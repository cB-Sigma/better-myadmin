import { hexdec, phpFloatval, phpIntval, stripcslashes, strtoupper } from './php.ts'

// pma: vendor/phpmyadmin/sql-parser/src/TokenType.php::TokenType
export const TokenType = {
  /** Invalid or ambiguous token; further analysis might be required. */
  None: 0,
  /** SQL specific keywords: SELECT, UPDATE, INSERT, etc. */
  Keyword: 1,
  /** Any type of legal operator. */
  Operator: 2,
  /** Spaces, tabs, new lines, etc. */
  Whitespace: 3,
  /** Bash (#), C (/* *\/) or SQL (--) comments. */
  Comment: 4,
  /** Boolean values: true or false. */
  Bool: 5,
  /** Numbers: 4, 0x8, 15.16, 23e42, etc. */
  Number: 6,
  /** Literal strings: 'string', "test". */
  String: 7,
  /** Database, table names, variables, etc. */
  Symbol: 8,
  /** Delimits statements. */
  Delimiter: 9,
  /** Labels in LOOP statement, ITERATE statement etc. */
  Label: 10,
} as const
export type TokenType = (typeof TokenType)[keyof typeof TokenType]

/** Token value after evaluation (PHP `bool|float|int|string`). */
export type TokenValue = string | number | boolean

// pma: vendor/phpmyadmin/sql-parser/src/Token.php::Token (flag constants)
export const TokenFlag = {
  NONE: 0,

  KEYWORD: 1,
  KEYWORD_RESERVED: 2,
  KEYWORD_COMPOSED: 4,
  KEYWORD_DATA_TYPE: 8,
  KEYWORD_KEY: 16,
  KEYWORD_FUNCTION: 32,

  NUMBER_HEX: 1,
  NUMBER_FLOAT: 2,
  NUMBER_APPROXIMATE: 4,
  NUMBER_NEGATIVE: 8,
  NUMBER_BINARY: 16,

  STRING_SINGLE_QUOTES: 1,
  STRING_DOUBLE_QUOTES: 2,

  COMMENT_BASH: 1,
  COMMENT_C: 2,
  COMMENT_SQL: 4,
  COMMENT_MYSQL_CMD: 8,

  OPERATOR_ARITHMETIC: 1,
  OPERATOR_LOGICAL: 2,
  OPERATOR_BITWISE: 4,
  OPERATOR_ASSIGNMENT: 8,
  OPERATOR_SQL: 16,

  SYMBOL_VARIABLE: 1,
  SYMBOL_BACKTICK: 2,
  SYMBOL_USER: 4,
  SYMBOL_SYSTEM: 8,
  SYMBOL_PARAMETER: 16,
} as const

/** Substring by code points (PHP `mb_substr($str, $start, $length)` with a negative or null length). */
function mbSubstr(str: string, start: number, length?: number): string {
  const chars = Array.from(str)
  const end = length === undefined ? chars.length : length < 0 ? chars.length + length : start + length
  return chars.slice(start, Math.max(start, end)).join('')
}

// pma: vendor/phpmyadmin/sql-parser/src/Token.php::Token
export class Token {
  /** The token in its raw string representation. */
  token: string
  /** The value this token contains (i.e. token after some evaluation). */
  value: TokenValue
  /** The keyword value this token contains, always uppercase. */
  keyword: string | null = null
  type: TokenType
  flags: number
  /** Position in the initial string where this token started, in code points. */
  position: number | null = null

  constructor(token: string, type: TokenType = TokenType.None, flags: number = TokenFlag.NONE) {
    this.token = token
    this.type = type
    this.flags = flags
    this.value = this.extract()
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Token.php::extract
  extract(): TokenValue {
    switch (this.type) {
      case TokenType.Keyword:
        this.keyword = strtoupper(this.token)
        if (!(this.flags & TokenFlag.KEYWORD_RESERVED)) {
          // Unreserved keywords should stay the way they are because they
          // might represent field names.
          return this.token
        }
        return this.keyword

      case TokenType.Whitespace:
        return ' '

      case TokenType.Bool:
        return strtoupper(this.token) === 'TRUE'

      case TokenType.Number: {
        const ret = this.token.replaceAll('--', '') // e.g. ---42 === -42
        if (this.flags & TokenFlag.NUMBER_HEX) {
          const hex = this.token.replace(/[-+]/g, '')
          const n = hexdec(hex)
          if (this.flags & TokenFlag.NUMBER_NEGATIVE) return n === 0 ? 0 : -n
          return n
        }
        if (this.flags & TokenFlag.NUMBER_APPROXIMATE || this.flags & TokenFlag.NUMBER_FLOAT) {
          return phpFloatval(ret)
        }
        if (!(this.flags & TokenFlag.NUMBER_BINARY)) {
          return phpIntval(ret)
        }
        return ret
      }

      case TokenType.String: {
        // Trims quotes.
        let str = mbSubstr(this.token, 1, -1)
        // Removes surrounding quotes.
        const quote = this.token[0] ?? ''
        if (quote !== '') str = str.replaceAll(quote + quote, quote)
        // Finally unescapes the string. In MySQL, `\f` and `\v` have no representation.
        str = str.replaceAll('\\f', 'f')
        str = str.replaceAll('\\v', 'v')
        return stripcslashes(str)
      }

      case TokenType.Symbol: {
        let str = this.token
        if (str[0] === '@') {
          str = mbSubstr(str, str[1] === '@' ? 2 : 1)
        }
        if (str[0] === ':') {
          str = mbSubstr(str, 1)
        }
        if (str[0] === '`' || str[0] === '"' || str[0] === "'") {
          const quote = str[0]
          str = mbSubstr(str, 1, -1)
          str = str.replaceAll(quote + quote, quote)
        }
        return str
      }

      default:
        return this.token
    }
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Token.php::getInlineToken
  getInlineToken(): string {
    return this.token.replaceAll('\r', '\\r').replaceAll('\n', '\\n').replaceAll('\t', '\\t')
  }
}
