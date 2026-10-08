import { describe, expect, it } from 'vitest'
import { Context, getFirstStatement } from '../src/index.ts'
import { type Encoded, contextFor, decode, loadFixture } from './helpers.ts'

interface Case {
  name: string
  context: string | null
  delimiter: string | null
  query: string
  steps: [Encoded, Encoded, Encoded][]
}

describe('Query::getFirstStatement()', () => {
  for (const c of loadFixture<Case[]>('first-statement.json')) {
    it(c.name, () => {
      Context.run(contextFor(c.context), () => {
        const steps: unknown[] = []
        let rest = c.query
        let d: string | null = c.delimiter
        for (let i = 0; i < 5; ++i) {
          const [first, r, nd] = getFirstStatement(rest, d)
          rest = r
          d = nd
          steps.push([first, rest, d])
          if (first === null) break
        }
        expect(steps).toEqual(c.steps.map((s) => s.map(decode)))
      })
    })
  }
})
