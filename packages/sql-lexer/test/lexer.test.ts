import { describe, expect, it } from 'vitest'
import { Lexer, type Token } from '../src/index.ts'
import { type Encoded, contextFor, decode, isKnownDivergence, loadFixture } from './helpers.ts'

interface LexerCase {
  name: string
  context: string | null
  delimiter: string | null
  query: string
  tokens: [number, number, Encoded, Encoded, string | null, number | null][]
  errors: [string, Encoded, number, number][]
}

const cases = loadFixture<LexerCase[]>('lexer.json')

function encodeToken(t: Token): unknown[] {
  return [t.type, t.flags, t.token, t.value === t.token ? null : t.value, t.keyword, t.position]
}

describe('Lexer matches phpmyadmin/sql-parser', () => {
  it('has fixtures', () => {
    expect(cases.length).toBeGreaterThan(700)
  })

  for (const c of cases) {
    it.skipIf(isKnownDivergence('lexer', c.name, 'tokens'))(c.name, () => {
      const lexer = new Lexer(c.query, { context: contextFor(c.context), delimiter: c.delimiter })
      const expected = c.tokens.map((t) => [t[0], t[1], decode(t[2]), decode(t[3]), t[4], t[5]])
      expect(lexer.list.tokens.map(encodeToken)).toEqual(expected)
      expect(lexer.errors.map((e) => [e.message, e.ch, e.pos, e.code])).toEqual(
        c.errors.map((e) => [e[0], decode(e[1]), e[2], e[3]]),
      )
    })
  }
})
