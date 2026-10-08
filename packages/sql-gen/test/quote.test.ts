import { describe, expect, it } from 'vitest'
import {
  backquote,
  backquoteCompat,
  bitLiteral,
  escapeMysqlWildcards,
  escapeString,
  hexLiteral,
  quoteString,
} from '../src/index.ts'
import { type Bytes, bytes, isHex, loadFixture } from './fixtures.ts'

interface QuoteFixture {
  backquote: [string, string, string, string][]
  escape: { charset: string; input: Bytes; escaped: Bytes }[]
  escapeNoBackslashEscapes: { charset: string; input: Bytes; escaped: Bytes }[]
}

const f = loadFixture<QuoteFixture>('quote.json')

describe('backquote (golden, executed phpMyAdmin)', () => {
  it('Util::backquote / backquoteCompat', () => {
    for (const [id, bq, mssql, none] of f.backquote) {
      expect(backquote(id), id).toBe(bq)
      expect(backquoteCompat(id, 'MSSQL'), id).toBe(mssql)
      expect(backquoteCompat(id, 'NONE'), id).toBe(none)
    }
  })

  it('maps arrays and handles null', () => {
    expect(backquote(['a', 'b`c'])).toEqual(['`a`', '`b``c`'])
    expect(backquote(null)).toBe('')
    expect(backquoteCompat('select', 'NONE', false, (w) => w === 'select')).toBe('`select`')
    expect(backquoteCompat('name', 'NONE', false, (w) => w === 'select')).toBe('name')
  })
})

describe('escapeString (golden, mysqlnd real_escape_string per charset)', () => {
  it('has fixtures for the multibyte charsets', () => {
    const charsets = new Set(f.escape.map((e) => e.charset))
    expect(charsets.size).toBeGreaterThanOrEqual(3)
  })

  for (const charset of new Set(f.escape.map((e) => e.charset))) {
    it(`charset ${charset}`, () => {
      for (const e of f.escape.filter((x) => x.charset === charset)) {
        const label = `${charset} ${JSON.stringify(e.input)}`
        expect(Buffer.from(escapeString(bytes(e.input), { charset })).toString('hex'), label).toBe(
          Buffer.from(bytes(e.escaped)).toString('hex'),
        )
        if (!isHex(e.input) && !isHex(e.escaped) && (charset === 'utf8mb4' || charset === 'utf8')) {
          expect(escapeString(e.input, { charset }), label).toBe(e.escaped)
          expect(quoteString(e.input, { charset }), label).toBe(`'${e.escaped}'`)
        }
      }
    })
  }

  it('NO_BACKSLASH_ESCAPES (golden, mysqlnd with the server flag set)', () => {
    expect(f.escapeNoBackslashEscapes.length).toBeGreaterThan(0)
    for (const e of f.escapeNoBackslashEscapes) {
      const out = escapeString(bytes(e.input), { charset: e.charset, noBackslashEscapes: true })
      expect(Buffer.from(out).toString('hex'), `${e.charset} ${JSON.stringify(e.input)}`).toBe(
        Buffer.from(bytes(e.escaped)).toString('hex'),
      )
    }
  })

  it('NO_BACKSLASH_ESCAPES doubles quotes only', () => {
    expect(quoteString('it\'s \\ "x"\n', { noBackslashEscapes: true })).toBe("'it''s \\ \"x\"\n'")
    expect(
      Buffer.from(
        quoteString(Uint8Array.from([0xbf, 0x27]), { charset: 'gbk', noBackslashEscapes: true }),
      ).toString('hex'),
    ).toBe(
      '27bf272727', // 0x27 is not a gbk trail byte, so the quote is doubled
    )
  })

  it('literals', () => {
    expect(hexLiteral(Uint8Array.from([0, 1, 255]))).toBe('0x0001ff')
    expect(hexLiteral('ab')).toBe('0x6162')
    expect(bitLiteral('1021')).toBe("b'1001'")
    expect(escapeMysqlWildcards('50%_a\\b')).toBe('50\\%\\_a\\\\b')
  })
})
