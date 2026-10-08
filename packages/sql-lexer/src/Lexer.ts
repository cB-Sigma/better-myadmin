import { Context, KEYWORD_MAX_LENGTH, LABEL_MAX_LENGTH, OPERATOR_MAX_LENGTH } from './Context.ts'
import { Token, TokenFlag, TokenType } from './Token.ts'
import { TokensList } from './TokensList.ts'
import { LexerException } from './exceptions.ts'
import { utf8Length } from './php.ts'

/** Keywords that indicate that the function keyword before them is not used as a function. */
const KEYWORD_NAME_INDICATORS = ['FROM', 'SET', 'WHERE']
/** Operators that indicate that the function keyword before them is not used as a function. */
const OPERATOR_NAME_INDICATORS = [',', '.']

export interface LexerOptions {
  /** Throw on the first error instead of collecting them (`$strict`). */
  strict?: boolean
  /** Initial statement delimiter (default `;`). */
  delimiter?: string | null
  /** Context (keyword table + SQL mode); defaults to {@link Context.current}. */
  context?: Context
}

const NOT_A_BYTE = '\u0000￿' // never equal to a single character of the input

/**
 * Performs lexical analysis over a SQL statement and splits it in multiple tokens.
 *
 * Positions are counted in Unicode code points, like PHP's `UtfString`.
 */
// pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::Lexer
export class Lexer {
  /** The default delimiter, used by all new instances. */
  static defaultDelimiter = ';'

  errors: LexerException[] = []
  /** The query split in code points (PHP `UtfString`). */
  readonly str: readonly string[]
  readonly len: number
  /** The index of the last parsed character. */
  last = 0
  list: TokensList = new TokensList()
  /** Statements delimiter; may change during lexing. */
  delimiter = ';'
  /** Length of the delimiter in bytes (PHP `strlen`). */
  delimiterLen = 1
  private delimiterBytes: string[] = [';']
  private readonly strict: boolean
  readonly context: Context

  constructor(str: string, options: LexerOptions = {}) {
    this.str = Array.from(str)
    this.len = this.str.length
    this.strict = options.strict ?? false
    this.context = options.context ?? Context.current
    this.setDelimiter(options.delimiter ? options.delimiter : Lexer.defaultDelimiter)
    this.lex()
  }

  /** `$this->str[$i]` (empty string when out of range). */
  private c(i: number): string {
    return this.str[i] ?? ''
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::setDelimiter
  setDelimiter(delimiter: string): void {
    this.delimiter = delimiter
    this.delimiterLen = utf8Length(delimiter)
    // PHP compares the delimiter byte by byte with the characters of the query:
    // a non-ASCII byte never equals a (multi-byte) character.
    this.delimiterBytes = []
    for (const ch of delimiter) {
      const n = utf8Length(ch)
      if (n === 1) this.delimiterBytes.push(ch)
      else for (let k = 0; k < n; k++) this.delimiterBytes.push(NOT_A_BYTE)
    }
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::lex
  lex(): void {
    const list = new TokensList()
    let lastToken: Token | null = null

    for (this.last = 0, this.lastIdx = 0; this.last < this.len; this.lastIdx = ++this.last) {
      const lastIdx = this.lastIdx
      let token = this.parse()

      if (token === null) {
        token = new Token(this.c(this.last))
        this.error('Unexpected character.', this.c(this.last), this.last)
      } else if (
        lastToken !== null &&
        token.type === TokenType.Symbol &&
        token.flags & TokenFlag.SYMBOL_VARIABLE &&
        (lastToken.type === TokenType.String ||
          (lastToken.type === TokenType.Symbol && lastToken.flags & TokenFlag.SYMBOL_BACKTICK))
      ) {
        // Handles ```... FROM 'user'@'%' ...```.
        lastToken.token += token.token
        lastToken.type = TokenType.Symbol
        lastToken.flags = TokenFlag.SYMBOL_USER
        lastToken.value = String(lastToken.value) + '@' + String(token.value)
        continue
      } else if (
        lastToken !== null &&
        token.type === TokenType.Keyword &&
        lastToken.type === TokenType.Operator &&
        lastToken.value === '.'
      ) {
        // Handles ```... tbl.FROM ...```. In this case, FROM is not a reserved word.
        token.type = TokenType.None
        token.flags = 0
        token.value = token.token
      }

      token.position = lastIdx
      list.tokens[list.count++] = token

      // Handling delimiters.
      if (token.type === TokenType.None && token.value === 'DELIMITER') {
        if (this.last + 1 >= this.len) {
          this.error('Expected whitespace(s) before delimiter.', '', this.last + 1)
          continue
        }

        // Skipping last R (from `delimiteR`) and whitespaces between
        // the keyword `DELIMITER` and the actual delimiter.
        let pos = ++this.last
        token = this.parseWhitespace()

        if (token !== null) {
          token.position = pos
          list.tokens[list.count++] = token
        }

        // Preparing the token that holds the new delimiter.
        if (this.last + 1 >= this.len) {
          this.error('Expected delimiter.', '', this.last + 1)
          continue
        }

        pos = this.last + 1

        // Parsing the delimiter.
        let delimiter = ''
        let delimiterLen = 0
        while (++this.last < this.len && !Context.isWhitespace(this.c(this.last)) && delimiterLen < 15) {
          delimiter += this.c(this.last)
          ++delimiterLen
        }

        if (delimiter === '') {
          this.error('Expected delimiter.', '', this.last)
          delimiter = ';'
        }

        --this.last

        // Saving the delimiter and its token.
        this.setDelimiter(delimiter)
        token = new Token(this.delimiter, TokenType.Delimiter)
        token.position = pos
        list.tokens[list.count++] = token
      }

      lastToken = token
    }

    // Adding a final delimiter to mark the ending.
    list.tokens[list.count++] = new Token('', TokenType.Delimiter)

    this.list = list

    this.solveAmbiguityOnStarOperator()
    this.solveAmbiguityOnFunctionKeywords()
  }

  private lastIdx = 0

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::solveAmbiguityOnStarOperator
  private solveAmbiguityOnStarOperator(): void {
    const iBak = this.list.idx
    for (;;) {
      const starToken = this.list.getNextOfTypeAndValue(TokenType.Operator, '*')
      if (starToken === null) break
      // getNext() already gets rid of whitespaces and comments.
      const next = this.list.getNext()
      if (next === null) continue
      if (
        (next.type !== TokenType.Keyword || !['FROM', 'USING'].includes(next.value as string)) &&
        (next.type !== TokenType.Operator || ![',', ')'].includes(next.value as string))
      ) {
        continue
      }
      starToken.flags = TokenFlag.OPERATOR_SQL
    }
    this.list.idx = iBak
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::solveAmbiguityOnFunctionKeywords
  private solveAmbiguityOnFunctionKeywords(): void {
    const iBak = this.list.idx
    const keywordFunction = TokenType.Keyword | TokenFlag.KEYWORD_FUNCTION
    for (;;) {
      const keywordToken = this.list.getNextOfTypeAndFlag(TokenType.Keyword, keywordFunction)
      if (keywordToken === null) break
      const next = this.list.getNext()
      if (
        (next?.type !== TokenType.Keyword || !KEYWORD_NAME_INDICATORS.includes(next.value as string)) &&
        (next?.type !== TokenType.Operator || !OPERATOR_NAME_INDICATORS.includes(next.value as string)) &&
        next?.value !== ''
      ) {
        continue
      }
      keywordToken.type = TokenType.None
      keywordToken.flags = TokenFlag.NONE
      keywordToken.keyword = keywordToken.value as string
    }
    this.list.idx = iBak
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::error
  error(msg: string, str = '', pos = 0, code = 0): void {
    const error = new LexerException(msg, str, pos, code)
    if (this.strict) throw error
    this.errors.push(error)
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::parseKeyword
  parseKeyword(): Token | null {
    let token = ''
    let ret: Token | null = null
    let iEnd = this.last
    let lastSpace = false

    for (let j = 1; j < KEYWORD_MAX_LENGTH && this.last < this.len; ++j, ++this.last) {
      // Composed keywords shouldn't have more than one whitespace between keywords.
      if (Context.isWhitespace(this.c(this.last))) {
        if (lastSpace) {
          --j // The size of the keyword didn't increase.
          continue
        }
        lastSpace = true
      } else {
        lastSpace = false
      }

      token += this.c(this.last)
      const flags = this.context.isKeyword(token)

      if ((this.last + 1 !== this.len && !Context.isSeparator(this.c(this.last + 1))) || !flags) {
        continue
      }

      ret = new Token(token, TokenType.Keyword, flags)
      iEnd = this.last
      // We don't break so we find longest keyword.
    }

    this.last = iEnd
    return ret
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::parseLabel
  parseLabel(): Token | null {
    let token = ''
    let ret: Token | null = null
    let iEnd = this.last
    for (let j = 1; j < LABEL_MAX_LENGTH && this.last < this.len; ++j, ++this.last) {
      const ch = this.c(this.last)
      if (ch === ':' && j > 1) {
        // End of label
        token += ch
        ret = new Token(token, TokenType.Label)
        iEnd = this.last
        break
      }

      if (Context.isWhitespace(ch) && j > 1) {
        // Whitespace between label and :
        --j
      } else if (Context.isSeparator(ch)) {
        // Any other separator
        break
      }

      token += ch
    }

    this.last = iEnd
    return ret
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::parseOperator
  parseOperator(): Token | null {
    let token = ''
    let ret: Token | null = null
    let iEnd = this.last

    for (let j = 1; j < OPERATOR_MAX_LENGTH && this.last < this.len; ++j, ++this.last) {
      token += this.c(this.last)
      const flags = Context.isOperator(token)
      if (!flags) continue
      ret = new Token(token, TokenType.Operator, flags)
      iEnd = this.last
    }

    this.last = iEnd
    return ret
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::parseWhitespace
  parseWhitespace(): Token | null {
    let token = this.c(this.last)
    if (!Context.isWhitespace(token)) return null

    while (++this.last < this.len && Context.isWhitespace(this.c(this.last))) {
      token += this.c(this.last)
    }

    --this.last
    return new Token(token, TokenType.Whitespace)
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::parseComment
  parseComment(): Token | null {
    const iBak = this.last
    let token = this.c(this.last)

    // Bash style comments. (#comment\n)
    if (Context.isComment(token) !== null) {
      while (++this.last < this.len && this.c(this.last) !== '\n') {
        token += this.c(this.last)
      }
      // Include trailing \n as whitespace token
      if (this.last < this.len) --this.last
      return new Token(token, TokenType.Comment, TokenFlag.COMMENT_BASH)
    }

    // C style comments. (/*comment*\/)
    if (++this.last < this.len) {
      token += this.c(this.last)
      if (Context.isComment(token) !== null) {
        // There might be a conflict with "*" operator here, when string is "*/*".
        const next = this.last + 1
        if (next < this.len && this.c(next) === '*' && token === '*/') {
          // Conflict in "*/*": first "*" was not for ending a comment.
          this.last = iBak
          return null
        }

        let flags: number = TokenFlag.COMMENT_C

        // This comment already ended. It may be a part of a previous MySQL specific command.
        if (token === '*/') {
          return new Token(token, TokenType.Comment, flags)
        }

        // Checking if this is a MySQL-specific command.
        if (this.last + 1 < this.len && this.c(this.last + 1) === '!') {
          flags |= TokenFlag.COMMENT_MYSQL_CMD
          token += this.c(++this.last)

          while (++this.last < this.len && this.c(this.last) >= '0' && this.c(this.last) <= '9') {
            token += this.c(this.last)
          }

          --this.last

          // We split this comment and parse only its beginning here.
          return new Token(token, TokenType.Comment, flags)
        }

        // Parsing the comment.
        while (++this.last < this.len && (this.c(this.last - 1) !== '*' || this.c(this.last) !== '/')) {
          token += this.c(this.last)
        }

        // Adding the ending.
        if (this.last < this.len) token += this.c(this.last)

        return new Token(token, TokenType.Comment, flags)
      }
    }

    // SQL style comments. (-- comment\n)
    let end: boolean
    if (++this.last < this.len) {
      token += this.c(this.last)
      end = false
    } else {
      --this.last
      end = true
    }

    if (Context.isComment(token, end) !== null) {
      // Checking if this comment did not end already (```--\n```).
      if (this.c(this.last) !== '\n') {
        while (++this.last < this.len && this.c(this.last) !== '\n') {
          token += this.c(this.last)
        }
      }
      // Include trailing \n as whitespace token
      if (this.last < this.len) --this.last
      return new Token(token, TokenType.Comment, TokenFlag.COMMENT_SQL)
    }

    this.last = iBak
    return null
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::parseBool
  parseBool(): Token | null {
    if (this.last + 3 >= this.len) {
      // At least `min(strlen('TRUE'), strlen('FALSE'))` characters are required.
      return null
    }

    const iBak = this.last
    let token = this.c(this.last) + this.c(++this.last) + this.c(++this.last) + this.c(++this.last)

    if (Context.isBool(token)) return new Token(token, TokenType.Bool)

    if (++this.last < this.len) {
      token += this.c(this.last)
      if (Context.isBool(token)) return new Token(token, TokenType.Bool, 1)
    }

    this.last = iBak
    return null
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::parseNumber
  parseNumber(): Token | null {
    // A rudimentary state machine is being used to parse numbers due to the
    // various forms of their notation (see the PHP source for the diagram).
    const iBak = this.last
    let token = ''
    let flags = 0
    let state = 1
    for (; this.last < this.len; ++this.last) {
      const ch = this.c(this.last)
      if (state === 1) {
        if (ch === '-') {
          flags |= TokenFlag.NUMBER_NEGATIVE
        } else if (this.last + 1 < this.len && ch === '0' && this.c(this.last + 1) === 'x') {
          token += this.c(this.last++)
          state = 2
        } else if (ch >= '0' && ch <= '9') {
          state = 3
        } else if (ch === '.') {
          state = 10
        } else if (ch === 'b') {
          state = 7
        } else if (ch !== '+') {
          // `+` is a valid character in a number.
          break
        }
      } else if (state === 2) {
        flags |= TokenFlag.NUMBER_HEX
        if (!((ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'F') || (ch >= 'a' && ch <= 'f'))) {
          break
        }
      } else if (state === 3) {
        if (ch === '.') {
          state = 4
        } else if (ch === 'e' || ch === 'E') {
          state = 5
        } else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
          // A number can't be directly followed by a letter
          state = -state
          break
        } else if (ch < '0' || ch > '9') {
          // Just digits and `.`, `e` and `E` are valid characters.
          break
        }
      } else if (state === 4) {
        flags |= TokenFlag.NUMBER_FLOAT
        if (ch === 'e' || ch === 'E') {
          state = 5
        } else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
          // A number can't be directly followed by a letter
          state = -state
          break
        } else if (ch < '0' || ch > '9') {
          // Just digits, `e` and `E` are valid characters.
          break
        }
      } else if (state === 5) {
        flags |= TokenFlag.NUMBER_APPROXIMATE
        if (ch === '+' || ch === '-' || (ch >= '0' && ch <= '9')) {
          state = 6
        } else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
          // A number can't be directly followed by a letter
          state = -state
          break
        } else {
          break
        }
      } else if (state === 6) {
        if (ch < '0' || ch > '9') {
          // Just digits are valid characters.
          break
        }
      } else if (state === 7) {
        flags |= TokenFlag.NUMBER_BINARY
        if (ch !== "'") break
        state = 8
      } else if (state === 8) {
        if (ch === "'") {
          state = 9
        } else if (ch !== '0' && ch !== '1') {
          break
        }
      } else if (state === 9) {
        break
      } else if (state === 10) {
        flags |= TokenFlag.NUMBER_FLOAT
        if (ch < '0' || ch > '9') break
        state = 4
      }

      token += this.c(this.last)
    }

    if (state === 2 || state === 3 || (token !== '.' && state === 4) || state === 6 || state === 9) {
      --this.last
      return new Token(token, TokenType.Number, flags)
    }

    this.last = iBak
    return null
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::parseString
  parseString(startQuote = ''): Token | null {
    let token = this.c(this.last)
    const flags = Context.isString(token)

    if (flags === null && token !== startQuote) return null

    const quote = token

    while (++this.last < this.len) {
      if (
        this.last + 1 < this.len &&
        ((this.c(this.last) === quote && this.c(this.last + 1) === quote) ||
          (this.c(this.last) === '\\' && quote !== '`'))
      ) {
        token += this.c(this.last) + this.c(++this.last)
      } else {
        if (this.c(this.last) === quote) break
        token += this.c(this.last)
      }
    }

    if (this.last >= this.len || this.c(this.last) !== quote) {
      this.error(`Ending quote ${quote} was expected.`, '', this.last)
    } else {
      token += this.c(this.last)
    }

    return new Token(token, TokenType.String, flags ?? TokenFlag.NONE)
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::parseSymbol
  parseSymbol(): Token | null {
    let token = this.c(this.last)
    let flags = Context.isSymbol(token)

    if (flags === null) return null

    if (flags & TokenFlag.SYMBOL_VARIABLE) {
      if (this.last + 1 < this.len && this.c(++this.last) === '@') {
        // This is a system variable (e.g. `@@hostname`).
        token += this.c(this.last++)
        flags |= TokenFlag.SYMBOL_SYSTEM
      }
    } else if (flags & TokenFlag.SYMBOL_PARAMETER) {
      if (token !== '?' && this.last + 1 < this.len) {
        ++this.last
      }
    } else {
      token = ''
    }

    let str: Token | null = null

    if (this.last < this.len) {
      str = this.parseString('`')

      if (str === null) {
        str = this.parseUnknown()

        if (str === null && !(flags & TokenFlag.SYMBOL_PARAMETER)) {
          this.error('Variable name was expected.', this.c(this.last), this.last)
        }
      }
    }

    if (str !== null) token += str.token

    return new Token(token, TokenType.Symbol, flags)
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::parseUnknown
  parseUnknown(): Token | null {
    let token = this.c(this.last)
    if (Context.isSeparator(token)) return null

    while (++this.last < this.len && !Context.isSeparator(this.c(this.last))) {
      token += this.c(this.last)

      // Test if end of token equals the current delimiter. If so, remove it from the token.
      if (token.endsWith(this.delimiter)) {
        token = token.slice(0, token.length - this.delimiter.length)
        this.last -= this.delimiterLen - 1
        break
      }
    }

    --this.last
    return new Token(token)
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::parseDelimiter
  parseDelimiter(): Token | null {
    let idx = 0
    while (idx < this.delimiterLen && this.last + idx < this.len) {
      if (this.delimiterBytes[idx] !== this.c(this.last + idx)) return null
      ++idx
    }
    this.last += this.delimiterLen - 1
    return new Token(this.delimiter, TokenType.Delimiter)
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Lexer.php::parse
  private parse(): Token | null {
    return (
      this.parseDelimiter() ??
      this.parseWhitespace() ??
      this.parseNumber() ??
      this.parseComment() ??
      this.parseOperator() ??
      this.parseBool() ??
      this.parseString() ??
      this.parseSymbol() ??
      this.parseKeyword() ??
      this.parseLabel() ??
      this.parseUnknown()
    )
  }
}

/** Convenience: lexes `sql` and returns the token list. */
export function tokenize(sql: string, options: LexerOptions = {}): Token[] {
  return new Lexer(sql, options).list.tokens
}
