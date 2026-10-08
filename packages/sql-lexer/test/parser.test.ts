import { describe, expect, it } from 'vitest'
import {
  Context,
  Lexer,
  Parser,
  type Statement,
  type TokensList,
  getAll,
  getClause,
  getTables,
  replaceClause,
  replaceClauses,
} from '../src/index.ts'
import {
  type Built,
  type Encoded,
  type EncodedInfo,
  contextFor,
  decode,
  decodeErrors,
  decodeInfo,
  encodeErrors,
  encodeInfo,
  isKnownDivergence,
  loadFixture,
} from './helpers.ts'

interface ParserCase {
  name: string
  context: string | null
  delimiter: string | null
  query: string
  /** Set when PHP threw (TypeError under strict_types) instead of producing a result. */
  phpException?: string
  statements: { class: string; first: number; last: number; build: Built }[]
  errors: [string, Encoded, number | null, number][]
  getAll?: EncodedInfo
  utils?: {
    getClause: [string, number | string, boolean, Built][]
    replace: [string, string | null, boolean, Built][]
    replaceClauses: [[string, string][], Built][]
    getTables: Built
  }
}

const cases = loadFixture<ParserCase[]>('parser.json')

/** Runs `fn` like PHP would: an exception becomes `{exception}` (only its presence is compared). */
function attempt(fn: () => unknown): unknown {
  try {
    return fn()
  } catch {
    return { exception: true }
  }
}

function expectBuilt(actual: unknown, expected: Built): void {
  if (expected !== null && typeof expected === 'object' && 'exception' in expected) {
    expect(actual).toEqual({ exception: true })
  } else {
    expect(actual).toEqual(decode(expected as Encoded))
  }
}

function parse(c: ParserCase): Parser {
  const context = contextFor(c.context)
  const lexer = new Lexer(c.query, { context, delimiter: c.delimiter })
  return new Parser(lexer.list, { context })
}

describe('Parser matches phpmyadmin/sql-parser', () => {
  it('has fixtures', () => {
    expect(cases.length).toBeGreaterThan(700)
  })

  for (const c of cases) {
    if (c.phpException !== undefined) {
      it(`${c.name}: PHP throws, the port parses (known divergence)`, () => {
        expect(isKnownDivergence('parser', c.name, 'phpException')).toBe(true)
        expect(() => parse(c)).not.toThrow()
      })
      continue
    }

    describe(c.name, () => {
      it.skipIf(isKnownDivergence('parser', c.name, 'statements'))('statements and errors', () => {
        const parser = parse(c)
        expect(parser.statements.map((s) => [s.kind, s.first, s.last])).toEqual(
          c.statements.map((s) => [s.class, s.first, s.last]),
        )
        expect(encodeErrors(parser.errors)).toEqual(decodeErrors(c.errors))
      })

      it.skipIf(isKnownDivergence('parser', c.name, 'build'))('build()', () => {
        const parser = parse(c)
        Context.run(contextFor(c.context), () => {
          parser.statements.forEach((s, i) => {
            const expected = c.statements[i]
            if (expected === undefined) return
            expectBuilt(
              attempt(() => s.build()),
              expected.build,
            )
          })
        })
      })

      if (c.getAll !== undefined) {
        const expected = c.getAll
        it.skipIf(isKnownDivergence('parser', c.name, 'getAll'))('Query::getAll()', () => {
          const info = getAll(c.query, { context: contextFor(c.context) })
          expect(encodeInfo(info)).toEqual(decodeInfo(expected))
        })
      }

      if (c.utils !== undefined) {
        const utils = c.utils
        it.skipIf(isKnownDivergence('parser', c.name, 'utils'))('Query utilities', () => {
          const parser = parse(c)
          const s = parser.statements[0] as Statement
          const list = parser.list as TokensList
          Context.run(contextFor(c.context), () => {
            for (const [clause, type, skipFirst, built] of utils.getClause) {
              expectBuilt(
                attempt(() => getClause(s, list, clause, type, skipFirst)),
                built,
              )
            }
            for (const [old, nw, onlyType, built] of utils.replace) {
              expectBuilt(
                attempt(() => replaceClause(s, list, old, nw, onlyType)),
                built,
              )
            }
            for (const [ops, built] of utils.replaceClauses) {
              expectBuilt(
                attempt(() => replaceClauses(s, list, ops)),
                built,
              )
            }
            expectBuilt(
              attempt(() => getTables(s)),
              utils.getTables,
            )
          })
        })
      }
    })
  }
})
