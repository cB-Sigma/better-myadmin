import { describe, expect, it } from 'vitest'
import { php } from '../src/index.ts'

/** mb_strlen without iterating the string (a browse page counts 25 cells of 500 KB). */
describe('mbStrlen', () => {
  it('counts code points: a surrogate pair is one, a lone surrogate one, an ill-formed byte one', () => {
    expect(php.mbStrlen('a😀b')).toBe(3)
    expect(php.mbStrlen('\ud800x')).toBe(2)
    expect(php.mbStrlen('x\udc00')).toBe(2)
    expect(php.mbStrlen(new Uint8Array([0xff, 0x41]))).toBe(2)
    expect(php.mbStrlen(new TextEncoder().encode('€😀'))).toBe(2)
    expect(php.mbStrlen('')).toBe(0)
  })

  it('mbStrlenAtLeast answers from the length when it can, and counts at the boundary', () => {
    const euro = (n: number) => new TextEncoder().encode('€'.repeat(n))
    expect(php.mbStrlenAtLeast(euro(999), 1000)).toBe(false)
    expect(php.mbStrlenAtLeast(euro(1000), 1000)).toBe(true)
    expect(php.mbStrlenAtLeast(new Uint8Array(4000), 1000)).toBe(true)
    expect(php.mbStrlenAtLeast(new Uint8Array(999), 1000)).toBe(false)
    expect(php.mbStrlenAtLeast('😀'.repeat(999), 1000)).toBe(false)
    expect(php.mbStrlenAtLeast('😀'.repeat(1000), 1000)).toBe(true)
    expect(php.mbStrlenAtLeast('x'.repeat(2000), 1000)).toBe(true)
  })
})
