import { describe, expect, it } from 'vitest'
import { colorByTarget, dragTo, hitsStart, line2, line3, relationLine, rgb } from './designer'

describe('designer canvas (move.ts)', () => {
  it('relationLine: the closest sides, rows 7 px below their top [p05-d2699b]', () => {
    // master on the left, referenced table to the right: right side of master → left side of foreign
    const l = relationLine({ left: 10, top: 20, width: 100 }, 40, { left: 300, top: 50, width: 80 }, 20)
    expect(l).toEqual({ x1: 111, x2: 300, y1: 67, y2: 77, side: null })
    // stacked tables: both left sides (sLeft)
    const s = relationLine({ left: 10, top: 0, width: 100 }, 0, { left: 12, top: 200, width: 90 }, 0)
    expect(s.side).toBe('left')
    expect([s.x1, s.x2]).toEqual([11, 12])
    // right edges closest: sRight
    const r = relationLine({ left: 0, top: 0, width: 100 }, 0, { left: 50, top: 100, width: 52 }, 0)
    expect(r.side).toBe('right')
    expect([r.x1, r.x2]).toEqual([101, 102])
  })

  it('line2 / line3 segments', () => {
    const l = { x1: 111, y1: 67, x2: 300, y2: 77, side: null }
    expect(line2(l)).toEqual([
      [111, 67, 121, 67],
      [300, 77, 290, 77],
      [121, 67, 290, 77],
    ])
    expect(line3(l)).toEqual([
      [111, 67, 205.5, 67],
      [205.5, 77, 300, 77],
      [205.5, 67, 205.5, 77],
    ])
    const left = { x1: 11, y1: 7, x2: 12, y2: 207, side: 'left' as const }
    expect(line2(left)).toEqual([
      [11, 7, 1, 7],
      [12, 207, 2, 207],
      [1, 7, 2, 207],
    ])
    expect(line3(left)).toEqual([
      [11, 7, 1, 7],
      [12, 207, 1, 207],
      [1, 7, 1, 207],
    ])
  })

  it('getColorByTarget: one colour per target, cycling the six hues', () => {
    const targets: Array<[string, string]> = []
    expect(colorByTarget(targets, 'a.id')).toBe(rgb(0, 200, 0))
    expect(colorByTarget(targets, 'b.id')).toBe(rgb(0, 0, 200))
    expect(colorByTarget(targets, 'a.id')).toBe(rgb(0, 200, 0))
    for (const t of ['c', 'd', 'e']) colorByTarget(targets, t)
    // i = 6: d = 0, j = 2 → red at 5/6
    expect(colorByTarget(targets, 'f')).toBe(rgb(167, 0, 0))
  })

  it('dragTo: grid snapping and the x/y clamp [p05-39dc32]', () => {
    expect(dragTo({ x: 100, y: 100 }, 17, 23, true)).toEqual({ raw: { x: 117, y: 123 }, x: 110, y: 120 })
    expect(dragTo({ x: 5, y: 5 }, -10, -10, false)).toEqual({ raw: { x: -5, y: -5 }, x: 0, y: -5 })
    expect(dragTo({ x: 50, y: 5 }, 0, -10, false)).toEqual({ raw: { x: 50, y: -5 }, x: 50, y: 0 })
  })

  it('canvasClick: hit area around the start point [p05-e7645a]', () => {
    const l = { x1: 100, y1: 50, x2: 0, y2: 0, side: null }
    expect(hitsStart(l, 105, 55)).toBe(true)
    expect(hitsStart(l, 110, 50)).toBe(false)
  })
})
