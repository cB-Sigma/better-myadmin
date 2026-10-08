import type { Token } from './Token.ts'

// pma: vendor/phpmyadmin/sql-parser/src/Exceptions/LexerException.php::LexerException
export class LexerException extends Error {
  /** The character that produced the error. */
  readonly ch: string
  /** The position (in code points) of the character. */
  readonly pos: number
  readonly code: number

  constructor(message: string, ch = '', pos = 0, code = 0) {
    super(message)
    this.name = 'LexerException'
    this.ch = ch
    this.pos = pos
    this.code = code
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Exceptions/ParserException.php::ParserException
export class ParserException extends Error {
  /** The token that produced this error. */
  readonly token: Token | null
  readonly code: number

  constructor(message: string, token: Token | null, code = 0) {
    super(message)
    this.name = 'ParserException'
    this.token = token
    this.code = code
  }
}
