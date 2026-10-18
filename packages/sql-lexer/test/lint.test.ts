import { describe, expect, it } from 'vitest'
import { type LintMessage, lint } from '../src/index.ts'
import { contextFor, isKnownDivergence, loadFixture } from './helpers.ts'

interface Case {
  name: string
  context: string | null
  query: string
  lint?: LintMessage[]
  phpException?: string
}

describe('Linter::lint() (phpMyAdmin)', () => {
  for (const c of loadFixture<Case[]>('lint.json')) {
    it(c.name, () => {
      if (c.lint === undefined) {
        // PHP throws a TypeError (see known-divergences.json); the port still lints.
        expect(isKnownDivergence('lint', c.name, 'phpException')).toBe(true)
        expect(() => lint(c.query, { context: contextFor(c.context) })).not.toThrow()
        return
      }
      expect(lint(c.query, { context: contextFor(c.context) })).toEqual(c.lint)
    })
  }

  it('refuses long queries [p09-d82c3f]', () => {
    expect(lint('SELECT 1 '.repeat(2000))[0]?.severity).toBe('warning')
  })
})
