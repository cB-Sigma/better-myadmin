import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import vectors from './vectors.json' with { type: 'json' }

const Long = createRequire(import.meta.url)('../index.js') as new (
  low: number,
  high: number,
  unsigned?: boolean,
) => { toString(radix?: number): string; toNumber(): number }

describe('Long, the part mysql2 uses', () => {
  // vectors.json: [low, high, unsigned, toString(), toNumber()] from long 5.3.2, including every
  // pairing of the 32-bit edge values and random halves
  it.each(vectors as Array<[number, number, boolean, string, number]>)(
    'new Long(%i, %i, %s) is %s',
    (low, high, unsigned, text, num) => {
      const l = new Long(low, high, unsigned)
      expect(l.toString()).toBe(text)
      expect(l.toNumber()).toBe(num)
    },
  )

  it('reads the 64-bit extremes', () => {
    expect(new Long(-1, -1, true).toString()).toBe('18446744073709551615')
    expect(new Long(-1, -1, false).toString()).toBe('-1')
    expect(new Long(0, 0x80000000 | 0, false).toString()).toBe('-9223372036854775808')
    expect(new Long(-1, 0x7fffffff, false).toString()).toBe('9223372036854775807')
  })

  it('is what mysql2 loads as long', () => {
    const server = createRequire(new URL('../../../apps/server/package.json', import.meta.url))
    const req = createRequire(server.resolve('mysql2'))
    expect(req('long')).toBe(createRequire(import.meta.url)('../index.js'))
  })
})
