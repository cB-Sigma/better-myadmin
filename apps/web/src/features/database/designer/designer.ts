/**
 * The Designer canvas maths: where a relation line starts and ends, the shape of an angular or
 * direct line, the colour of each referenced column, snapping, and the positions posted on save.
 * pma: resources/js/designer/move.ts (reload, canvasClick, line0, line2, line3, getColorByTarget,
 *      mouseMove, getUrlPos)
 */

/** `heightField`: the line meets the row 7 px below its top */
export const HEIGHT_FIELD = 7
const SM_ADD = 10
export const GRID_SIZE = 10

/** a table on the canvas: position and size (offsetLeft/Top/Width) */
export interface Box {
  left: number
  top: number
  width: number
}

export interface Line {
  x1: number
  y1: number
  x2: number
  y2: number
  /** the side both ends leave from: sLeft / sRight */
  side: 'left' | 'right' | null
}

/**
 * DesignerMove.reload: the end points between the master table (column row at `masterRowTop`) and
 * the referenced one; the closest pair of sides wins.
 */
export function relationLine(master: Box, masterRowTop: number, foreign: Box, foreignRowTop: number): Line {
  const x1Left = master.left + 1
  const x1Right = x1Left + master.width
  const x2Left = foreign.left
  const x2Right = x2Left + foreign.width
  const a = [
    Math.abs(x1Left - x2Left),
    Math.abs(x1Left - x2Right),
    Math.abs(x1Right - x2Left),
    Math.abs(x1Right - x2Right),
  ]
  let n = 0
  for (let i = 1; i < 4; i++) if ((a[n] as number) > (a[i] as number)) n = i
  let x1 = 0
  let x2 = 0
  let side: Line['side'] = null
  if (n === 1) {
    x1 = x1Left
    x2 = x2Right
    if (x1 < x2) n = 0
  }
  if (n === 2) {
    x1 = x1Right
    x2 = x2Left
    if (x1 > x2) n = 0
  }
  if (n === 3) {
    x1 = x1Right
    x2 = x2Right
    side = 'right'
  }
  if (n === 0) {
    x1 = x1Left
    x2 = x2Left
    side = 'left'
  }
  return {
    x1,
    x2,
    y1: master.top + masterRowTop + HEIGHT_FIELD,
    y2: foreign.top + foreignRowTop + HEIGHT_FIELD,
    side,
  }
}

export type Segment = [number, number, number, number]

/** DesignerMove.line2 (`onAngularDirect` = 1) */
export function line2(l: Line): Segment[] {
  let x1 = l.x1
  let x2 = l.x2
  if (l.side === 'right') {
    x1 += SM_ADD
    x2 += SM_ADD
  } else if (l.side === 'left') {
    x1 -= SM_ADD
    x2 -= SM_ADD
  } else if (l.x1 < l.x2) {
    x1 += SM_ADD
    x2 -= SM_ADD
  } else {
    x1 -= SM_ADD
    x2 += SM_ADD
  }
  return [
    [l.x1, l.y1, x1, l.y1],
    [l.x2, l.y2, x2, l.y2],
    [x1, l.y1, x2, l.y2],
  ]
}

/** DesignerMove.line3 (`onAngularDirect` = 0) */
export function line3(l: Line): Segment[] {
  let x1 = l.x1
  let x2 = l.x2
  if (l.side === 'right') {
    if (l.x1 < l.x2) {
      x1 += l.x2 - l.x1 + SM_ADD
      x2 += SM_ADD
    } else {
      x2 += l.x1 - l.x2 + SM_ADD
      x1 += SM_ADD
    }
  } else if (l.side === 'left') {
    if (l.x1 < l.x2) {
      x2 -= l.x2 - l.x1 + SM_ADD
      x1 -= SM_ADD
    } else {
      x1 -= l.x1 - l.x2 + SM_ADD
      x2 -= SM_ADD
    }
  } else {
    const xS = (l.x1 + l.x2) / 2
    return [
      [l.x1, l.y1, xS, l.y1],
      [xS, l.y2, l.x2, l.y2],
      [xS, l.y1, xS, l.y2],
    ]
  }
  return [
    [l.x1, l.y1, x1, l.y1],
    [l.x2, l.y2, x2, l.y2],
    [x1, l.y1, x2, l.y2],
  ]
}

/** canvasClick: a click within 10 px horizontally and 7 px vertically of the line's start */
export const hitsStart = (l: Line, x: number, y: number) =>
  x > l.x1 - 10 && x < l.x1 + 10 && y > l.y1 - 7 && y < l.y1 + 7

/** a computed line colour (`rgba(r,g,b,1)` in phpMyAdmin's canvas) as #rrggbb */
export const rgb = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** DesignerMove.getColorByTarget: one colour per referenced column, in order of first use */
export function colorByTarget(targets: Array<[string, string]>, target: string): string {
  const known = targets.find((t) => t[0] === target)
  if (known !== undefined) return known[1]
  const i = targets.length + 1
  const d = i % 6
  let j = (i - d) / 6
  j = j % 4
  j++
  const colorCase = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 0],
    [1, 0, 1],
    [0, 1, 1],
  ] as const
  const [a, b, c] = colorCase[d] as readonly [number, number, number]
  const e = 1 - (j - 1) / 6
  const color = rgb(Math.round(a * 200 * e), Math.round(b * 200 * e), Math.round(c * 200 * e))
  targets.push([target, color])
  return color
}

/**
 * DesignerMove.mouseMove: the new position of a dragged table. `raw` is the unsnapped position
 * kept in data-left/data-top; the shown one snaps to the grid and is kept at x ≥ 0 (or, when x is
 * fine, y ≥ 0).
 */
export function dragTo(
  raw: { x: number; y: number },
  dx: number,
  dy: number,
  grid: boolean,
): { raw: { x: number; y: number }; x: number; y: number } {
  const next = { x: raw.x + dx, y: raw.y + dy }
  let x = next.x
  let y = next.y
  if (grid) {
    x = Math.trunc(x / GRID_SIZE) * GRID_SIZE
    y = Math.trunc(y / GRID_SIZE) * GRID_SIZE
  }
  if (x < 0) x = 0
  else if (y < 0) y = 0
  return { raw: next, x, y }
}
