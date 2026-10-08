import { describe, expect, it } from 'vitest'
import { toPhpString, typeName } from '../src/advisor/php.ts'
import { ExpressionLanguage, type PhpValue } from '../src/index.ts'
import fixture from './fixtures/expressions.json' with { type: 'json' }

/**
 * Golden fixtures of Symfony ExpressionLanguage 7.4 run by PHP 8.3 (scripts/expression-fixtures.php):
 * results with their PHP type, and the exact exception messages (syntax errors with "Did you mean").
 */
const PHP_TYPES: Record<string, string> = {
  int: 'int',
  float: 'float',
  string: 'string',
  bool: 'bool',
  null: 'null',
  array: 'array',
}

function toValues(raw: Record<string, unknown>): Map<string, PhpValue> {
  const m = new Map<string, PhpValue>()
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number') m.set(k, Number.isInteger(v) && k !== 'fl' ? BigInt(v) : v)
    else m.set(k, v as PhpValue)
  }
  return m
}

const shown = (v: PhpValue) => (typeof v === 'boolean' ? (v ? 'true' : 'false') : toPhpString(v))

describe('ExpressionLanguage vs Symfony', () => {
  const values = toValues(fixture.values)
  const el = new ExpressionLanguage()
  for (const c of fixture.cases as Array<Record<string, unknown>>) {
    it(String(c.expression), () => {
      const run = () => el.evaluate(String(c.expression), values)
      if (c.error !== undefined) {
        expect(run).toThrow(String(c.message))
        return
      }
      const r = run()
      expect(PHP_TYPES[typeName(r)]).toBe(c.type)
      if (Array.isArray(r)) {
        expect(r.map((v) => [typeName(v), Array.isArray(v) ? 'Array' : toPhpString(v)])).toEqual(c.value)
      } else {
        expect(shown(r)).toBe(c.value)
      }
    })
  }
})
