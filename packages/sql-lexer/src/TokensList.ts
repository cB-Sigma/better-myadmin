import { type Token, TokenType } from './Token.ts'

// pma: vendor/phpmyadmin/sql-parser/src/TokensList.php::TokensList
export class TokensList {
  tokens: Token[]
  count: number
  /** The index of the next token to be returned. */
  idx = 0

  constructor(tokens: Token[] = []) {
    this.tokens = tokens
    this.count = tokens.length
  }

  // pma: vendor/phpmyadmin/sql-parser/src/TokensList.php::build
  build(): string {
    return TokensList.buildFromArray(this.tokens)
  }

  // pma: vendor/phpmyadmin/sql-parser/src/TokensList.php::buildFromArray
  static buildFromArray(list: readonly Token[]): string {
    let ret = ''
    for (const token of list) ret += token.token
    return ret
  }

  add(token: Token): void {
    this.tokens[this.count++] = token
  }

  /** PHP `$list->tokens[$i]` (null when out of range). */
  at(i: number): Token | null {
    return this.tokens[i] ?? null
  }

  // pma: vendor/phpmyadmin/sql-parser/src/TokensList.php::getNext
  getNext(): Token | null {
    for (; this.idx < this.count; ++this.idx) {
      const t = this.tokens[this.idx] as Token
      if (t.type !== TokenType.Whitespace && t.type !== TokenType.Comment) {
        return this.tokens[this.idx++] as Token
      }
    }
    return null
  }

  // pma: vendor/phpmyadmin/sql-parser/src/TokensList.php::getPrevious
  getPrevious(): Token | null {
    for (; this.idx >= 0; --this.idx) {
      const t = this.tokens[this.idx]
      if (t === undefined) {
        // PHP reads `null->type` (null) here, the checks pass and `null` is returned.
        this.idx--
        return null
      }
      if (t.type !== TokenType.Whitespace && t.type !== TokenType.Comment) {
        return this.tokens[this.idx--] as Token
      }
    }
    return null
  }

  // pma: vendor/phpmyadmin/sql-parser/src/TokensList.php::getPreviousOfType
  getPreviousOfType(type: TokenType | readonly TokenType[]): Token | null {
    const types = Array.isArray(type) ? type : [type]
    for (; this.idx >= 0; --this.idx) {
      const t = this.tokens[this.idx]
      if (t !== undefined && types.includes(t.type)) {
        return this.tokens[this.idx--] as Token
      }
    }
    return null
  }

  // pma: vendor/phpmyadmin/sql-parser/src/TokensList.php::getNextOfType
  getNextOfType(type: TokenType | readonly TokenType[]): Token | null {
    const types = Array.isArray(type) ? type : [type]
    for (; this.idx < this.count; ++this.idx) {
      if (types.includes((this.tokens[this.idx] as Token).type)) {
        return this.tokens[this.idx++] as Token
      }
    }
    return null
  }

  // pma: vendor/phpmyadmin/sql-parser/src/TokensList.php::getNextOfTypeAndValue
  getNextOfTypeAndValue(type: TokenType, value: string): Token | null {
    for (; this.idx < this.count; ++this.idx) {
      const t = this.tokens[this.idx] as Token
      if (t.type === type && t.value === value) {
        return this.tokens[this.idx++] as Token
      }
    }
    return null
  }

  // pma: vendor/phpmyadmin/sql-parser/src/TokensList.php::getNextOfTypeAndFlag
  getNextOfTypeAndFlag(type: TokenType, flag: number): Token | null {
    for (; this.idx < this.count; ++this.idx) {
      const t = this.tokens[this.idx] as Token
      if (t.type === type && t.flags === flag) {
        return this.tokens[this.idx++] as Token
      }
    }
    return null
  }
}
