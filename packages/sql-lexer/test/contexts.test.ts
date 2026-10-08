import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CONTEXT_NAMES,
  Context,
  type ContextName,
  SqlMode,
  contextNameForServer,
  createServerContext,
  getKeywords,
} from '../src/index.ts'
import { loadFixture } from './helpers.ts'

interface ContextsFixture {
  loadClosest: [string, string | null, string][]
  hashes: Record<string, { count: number; sha1: string }>
  words: string[]
  isKeyword: Record<string, [number | null, number | null][]>
  modes: [string, number, string[], boolean][]
  escapeInputs: string[]
}

const fx = loadFixture<ContextsFixture>('contexts.json')

describe('Context', () => {
  it('ships every phpmyadmin/sql-parser context', () => {
    expect([...CONTEXT_NAMES].sort()).toEqual(Object.keys(fx.hashes).sort())
  })

  for (const [name, { count, sha1 }] of Object.entries(fx.hashes)) {
    it(`keyword table ${name} is identical`, () => {
      const kw = getKeywords(name as ContextName)
      const lines = [...kw.entries()].map(([k, f]) => `${k}=${f}`)
      // PHP sort() of strings (byte order; keywords are ASCII)
      lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      expect(lines.length).toBe(count)
      expect(createHash('sha1').update(lines.join('\n')).digest('hex')).toBe(sha1)
    })
  }

  it('isKeyword() matches for sample words in every context', () => {
    for (const [name, row] of Object.entries(fx.isKeyword)) {
      const ctx = new Context(name as ContextName)
      expect(fx.words.map((w) => [ctx.isKeyword(w), ctx.isKeyword(w, true)])).toEqual(row)
    }
  })

  it('loadClosest() picks the same context as PHP', () => {
    for (const [input, ret, loaded] of fx.loadClosest) {
      const ctx = new Context()
      expect([input, ctx.loadClosest(input), 'Context' + ctx.loadedContext]).toEqual([input, ret, loaded])
    }
  })

  it('setMode()/escape() match PHP', () => {
    for (const [mode, modeInt, escaped, hasAnsi] of fx.modes) {
      const ctx = new Context()
      if (mode.startsWith('int:')) ctx.setMode(Number(mode.slice(4)))
      else ctx.setMode(mode)
      expect(ctx.getMode()).toBe(modeInt)
      expect(fx.escapeInputs.map((s) => ctx.escape(s))).toEqual(escaped)
      expect(ctx.hasMode(SqlMode.ANSI_QUOTES)).toBe(hasAnsi)
    }
  })

  it('builds server contexts like DatabaseInterface::postConnect()', () => {
    expect(contextNameForServer(80032, false)).toBe('MySql80032')
    const ctx = createServerContext(100621, true, 'ANSI_QUOTES,STRICT_TRANS_TABLES')
    expect(ctx.loadedContext).toBe('MariaDb100600')
    expect(ctx.hasMode(SqlMode.ANSI_QUOTES)).toBe(true)
    expect(createServerContext(80405, false).loadedContext).toBe('MySql80400')
  })
})
