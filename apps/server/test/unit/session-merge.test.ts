import { describe, expect, it } from 'vitest'
import { mergeChanges } from '../../src/session/merge.ts'

describe('mergeChanges (concurrent requests of one session)', () => {
  it("keeps another request's change when this one changed something else", () => {
    const before = { a: { recent: [1], cache: {} }, b: 1 }
    const latest = { a: { recent: [2, 1], cache: {} }, b: 1 }
    const after = { a: { recent: [1], cache: { superuser: true } }, b: 1 }
    expect(mergeChanges(latest, before, after)).toEqual({
      a: { recent: [2, 1], cache: { superuser: true } },
      b: 1,
    })
  })

  it('an unchanged request leaves the latest copy as it is', () => {
    const latest = { x: 2 }
    expect(mergeChanges(latest, { x: 1 }, { x: 1 })).toBe(latest)
  })

  it('applies values, deletions and new keys of the request', () => {
    const before = { keep: 1, drop: 1, change: { v: 1 } }
    const latest = { keep: 2, drop: 1, change: { v: 1, w: 3 }, other: 4 }
    const after = { keep: 1, change: { v: 5 }, add: 6 }
    expect(mergeChanges(latest, before, after)).toEqual({ keep: 2, change: { v: 5, w: 3 }, other: 4, add: 6 })
  })

  it('arrays are values: the request wins when it changed one', () => {
    expect(mergeChanges({ l: [3] }, { l: [1] }, { l: [1, 2] })).toEqual({ l: [1, 2] })
  })
})
