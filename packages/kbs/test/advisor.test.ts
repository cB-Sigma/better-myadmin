import { englishTranslator } from '@bettermyadmin/i18n'
import { describe, expect, it } from 'vitest'
import { Advisor, BEFORE_MYSQL_80003_RULES, GENERIC_RULES, byTime, vsprintf } from '../src/index.ts'
import fixture from './fixtures/advisor.json' with { type: 'json' }

/**
 * Golden fixtures produced by running phpMyAdmin's Advisor (scripts/advisor-fixtures.php): the same
 * status/variables must fire the same rules with the same rendered issue, recommendation and
 * justification, check the same preconditions, and report the same evaluation errors.
 */
interface Case {
  name: string
  vendor: string
  version: number
  memory: number | null
  status: Record<string, string>
  variables: Record<string, string>
  result: {
    fired: unknown[]
    notfired: unknown[]
    unchecked: string[]
    errors: string[]
  }
}

const tr = englishTranslator()
// Url::getFromRoute('/server/variables', ['filter' => …]) and Core::linkURL in the fixture's set-up
const pmaUrls = {
  variableUrl: (name: string) =>
    `index.php?route=/server/variables&filter=${encodeURIComponent(name)}&lang=en`,
  linkUrl: (url: string) =>
    `index.php?route=/url&url=${encodeURIComponent(url).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
}

describe('advisor rules', () => {
  it('ports all 55 rules (48 generic, 7 before MySQL 8.0.3)', () => {
    expect(GENERIC_RULES).toHaveLength(48)
    expect(BEFORE_MYSQL_80003_RULES).toHaveLength(7)
  })
})

describe('advisor vs phpMyAdmin', () => {
  for (const c of (fixture as { cases: Case[] }).cases) {
    it(c.name, () => {
      const advisor = new Advisor({ tr, ...pmaUrls })
      const result = advisor.run({
        status: c.status,
        variables: c.variables,
        systemMemory: c.memory ?? 0,
        versionInt: c.version,
        isMariaDb: c.vendor === 'mariadb',
      })
      expect(result.errors).toEqual(c.result.errors)
      expect(result.unchecked).toEqual(c.result.unchecked)
      expect(result.fired).toEqual(c.result.fired)
      expect(result.notfired).toEqual(c.result.notfired)
    })
  }
})

describe('helpers', () => {
  it('ADVISOR_bytime scales a per-second rate', () => {
    expect(byTime(tr, 2.5, 2)).toBe('2.5 per second')
    expect(byTime(tr, 0.05, 2)).toBe('3 per minute')
    expect(byTime(tr, 0.0005, 2)).toBe('1.8 per hour')
    expect(byTime(tr, 0.000001, 2)).toBe('0.09 per day')
    expect(byTime(tr, 0.00000001, 2)).toBe('<0.01 per day')
    expect(byTime(tr, 0, 0)).toBe('<1 per day')
  })

  it('vsprintf converts PHP values like PHP', () => {
    expect(vsprintf('%s / %d / %s', [3.5, 7n, 1e15])).toBe('3.5 / 7 / 1.0E+15')
    expect(vsprintf('%s%%', [33.333333333333336])).toBe('33.333333333333%')
    expect(vsprintf('%s and %s', [true, null])).toBe('1 and ')
  })
})
