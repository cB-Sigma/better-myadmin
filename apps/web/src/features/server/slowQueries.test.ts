import { describe, expect, it } from 'vitest'
import { duration } from './SlowQueriesPage.tsx'

/** Statement latencies (ms from the server) in the Slow queries table and detail. */
describe('duration', () => {
  it('picks µs, ms or s and prints plain numbers (no SI prefix of its own)', () => {
    expect(duration(0)).toBe('0 ms')
    expect(duration(0.82114)).toBe('821.14 µs')
    expect(duration(2.48)).toBe('2.48 ms')
    expect(duration(437.11)).toBe('437.11 ms')
    expect(duration(15_560)).toBe('15.56 s')
    expect(duration(0.5)).not.toMatch(/m ms/)
  })
})
