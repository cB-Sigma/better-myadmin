import { describe, expect, it } from 'vitest'
import { Formatter, type FormatterOptions, formatSql } from '../src/index.ts'
import { contextFor, loadFixture } from './helpers.ts'

interface Case {
  name: string
  context: string | null
  query: string
  options?: FormatterOptions
  text?: string
  cli?: string
  html?: string
  singleLine?: string
  noComments?: string
  phpException?: string
}

const cases = loadFixture<Case[]>('format.json')

describe('Formatter::format() (phpmyadmin/sql-parser 6.0.0)', () => {
  // The library's own cases, in order: the CLI colour state is a PHP `static` shared across calls.
  it('FormatterTest cases (text, cli, html)', () => {
    for (const c of cases.filter((x) => x.name.startsWith('FormatterTest/'))) {
      const o = c.options ?? {}
      expect(Formatter.format(c.query, { ...o, type: 'text' }), `${c.name} text`).toBe(c.text)
      expect(Formatter.format(c.query, { ...o, type: 'cli' }), `${c.name} cli`).toBe(c.cli)
      expect(Formatter.format(c.query, { ...o, type: 'html' }), `${c.name} html`).toBe(c.html)
    }
  })

  for (const c of cases.filter((x) => !x.name.startsWith('FormatterTest/'))) {
    it(c.name, () => {
      expect(c.phpException).toBeUndefined()
      const context = contextFor(c.context)
      // pma: src/Controllers/Database/SqlFormatController.php
      expect(formatSql(c.query, { context })).toBe(c.text)
      expect(formatSql(c.query, { context, singleLine: true })).toBe(c.singleLine)
      expect(Formatter.format(c.query, { type: 'html' }, context)).toBe(c.html)
      expect(Formatter.format(c.query, { type: 'text', remove_comments: true }, context)).toBe(c.noComments)
    })
  }
})
