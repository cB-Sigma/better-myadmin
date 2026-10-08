import { describe, expect, it } from 'vitest'
import { BufferedQuery, getAll, splitSql, splitSqlQueriesToExecute } from '../src/index.ts'
import { contextFor, decodeInfo, encodeInfo, isKnownDivergence, loadFixture } from './helpers.ts'

interface SplitCase {
  name: string
  context: string | null
  delimiter: string | null
  query: string
  statements: string[]
  chunked: string[]
  analysed: Parameters<typeof decodeInfo>[0][]
}

const cases = loadFixture<SplitCase[]>('split.json')

describe('statement splitting matches phpMyAdmin (ImportSql::doImport + BufferedQuery)', () => {
  it('has fixtures', () => {
    expect(cases.length).toBeGreaterThan(700)
  })

  for (const c of cases) {
    describe(c.name, () => {
      const options = c.delimiter === null ? {} : { delimiter: c.delimiter }

      it.skipIf(isKnownDivergence('split', c.name, 'statements'))('statements', () => {
        expect(splitSql(c.query, options)).toEqual(c.statements)
        expect(splitSql(c.query, { ...options, chunkSize: c.name.startsWith('split/') ? 3 : 7 })).toEqual(
          c.chunked,
        )
      })

      it.skipIf(isKnownDivergence('split', c.name, 'analysed'))('analysis of each executed query', () => {
        const context = contextFor(c.context)
        const queries = splitSqlQueriesToExecute(c.query, options)
        expect(queries.length).toBe(c.analysed.length)
        queries.forEach((q, i) => {
          const expected = c.analysed[i] as (typeof c.analysed)[number] | { phpException: string }
          if ('phpException' in expected) {
            // PHP throws a TypeError here (see known-divergences.json); the port returns an analysis.
            expect(isKnownDivergence('split', c.name, 'phpException')).toBe(true)
            expect(() => getAll(q, { context })).not.toThrow()
            return
          }
          expect(encodeInfo(getAll(q, { context }))).toEqual(decodeInfo(expected))
        })
      })
    })
  }
})

interface BqCase {
  query: string
  options: Record<string, boolean>
  results: (string | false)[]
}

describe('BufferedQuery', () => {
  for (const c of loadFixture<BqCase[]>('buffered-query.json')) {
    it(JSON.stringify(c.query) + ' ' + JSON.stringify(c.options), () => {
      const bq = new BufferedQuery(c.query, c.options)
      const results: (string | false)[] = []
      for (let i = 0; i < 20; ++i) {
        const r = bq.extract()
        results.push(r)
        if (r === false || r === '') break
      }
      for (let i = 0; i < 20 && bq.query !== ''; ++i) results.push(bq.extract(true))
      expect(results).toEqual(c.results)
    })
  }
})
