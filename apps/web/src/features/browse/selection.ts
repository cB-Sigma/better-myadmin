/**
 * The grid's square cell selection (makegrid.ts initCellSelection): the selected cells are the
 * cross product of a set of rows (-1: the header row) and a set of columns (display positions).
 * Clicking a selected cell takes its row and column out again; Ctrl/Cmd+click adds.
 */
export interface CellSelection {
  rows: ReadonlySet<number>
  cols: ReadonlySet<number>
  start: { r: number; c: number } | null
  end: { r: number; c: number } | null
}

export const emptySelection: CellSelection = { rows: new Set(), cols: new Set(), start: null, end: null }

export const isSelected = (s: CellSelection, r: number, c: number) =>
  s.cols.size > 0 && s.rows.has(r) && s.cols.has(c)

/** `cell-selected` (one cell) or `cell-selected with-bg-color` (several), or '' */
export function selectionClass(s: CellSelection, r: number, c: number): string {
  if (!isSelected(s, r, c)) return ''
  return s.rows.size === 1 && s.cols.size === 1 ? 'cell-selected' : 'cell-selected with-bg-color'
}

/** mousedown on td.data: selectCell / updateCellSelection */
export function startSelection(s: CellSelection, r: number, c: number, multi: boolean): CellSelection {
  const base = multi ? s : emptySelection
  const rows = new Set(base.rows)
  const cols = new Set(base.cols)
  if (isSelected(base, r, c)) {
    rows.delete(r)
    cols.delete(c)
  } else {
    rows.add(r)
    cols.add(c)
  }
  return { rows, cols, start: { r, c }, end: { r, c } }
}

/** mouseover while selecting: the rectangle from the start cell (added to the sets when multi) */
export function dragSelection(s: CellSelection, r: number, c: number, multi: boolean): CellSelection {
  if (s.start === null) return s
  const rows = multi ? new Set(s.rows) : new Set<number>()
  const cols = multi ? new Set(s.cols) : new Set<number>()
  for (let i = Math.min(r, s.start.r); i <= Math.max(r, s.start.r); i++) rows.add(i)
  for (let j = Math.min(c, s.start.c); j <= Math.max(c, s.start.c); j++) cols.add(j)
  return { ...s, rows, cols, end: { r, c } }
}

/**
 * Shift+arrow: moves the end cell, adding the row / column it enters or dropping the one it
 * leaves when the next cell is selected already. Header (-1) is above the first row.
 */
export function extendSelection(
  s: CellSelection,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
  rowCount: number,
  colCount: number,
): CellSelection {
  const end = s.end
  if (end === null) return s
  const rows = new Set(s.rows)
  const cols = new Set(s.cols)
  let next = end
  if (key === 'ArrowUp') {
    if (end.r === -1) return s
    next = { r: end.r - 1, c: end.c }
    if (isSelected(s, next.r, next.c)) rows.delete(end.r)
    else rows.add(next.r)
  } else if (key === 'ArrowDown') {
    if (end.r === -1) {
      rows.delete(-1)
      next = { r: 0, c: end.c }
    } else {
      if (end.r + 1 >= rowCount) return s
      next = { r: end.r + 1, c: end.c }
      if (isSelected(s, next.r, next.c)) rows.delete(end.r)
      else rows.add(next.r)
    }
  } else {
    const c = key === 'ArrowLeft' ? end.c - 1 : end.c + 1
    if (c < 0 || c >= colCount) return s
    next = { r: end.r, c }
    if (isSelected(s, next.r, next.c)) cols.delete(end.c)
    else cols.add(c)
  }
  return { ...s, rows, cols, end: next }
}

/** Ctrl/Cmd+A: every data cell and header */
export function selectAll(rowCount: number, colCount: number): CellSelection {
  return {
    rows: new Set([-1, ...Array.from({ length: rowCount }, (_, i) => i)]),
    cols: new Set(Array.from({ length: colCount }, (_, i) => i)),
    start: null,
    end: null,
  }
}

/**
 * The copy handler's text: the selected headers' names on a first line, then one line per row
 * with selected cells, tab separated.
 */
export function selectionText(
  s: CellSelection,
  headers: readonly string[],
  cells: (r: number, c: number) => string,
  rowCount: number,
): string {
  const cols = [...s.cols].sort((a, b) => a - b)
  let out = ''
  if (s.rows.has(-1)) {
    const h = cols.map((c) => headers[c] ?? '')
    if (h.length > 0) out += `${h.join('\t')}\n`
  }
  const lines: string[] = []
  for (let r = 0; r < rowCount; r++) {
    if (!s.rows.has(r)) continue
    const line = cols.map((c) => cells(r, c).trim())
    if (line.length > 0) lines.push(line.join('\t'))
  }
  return out + lines.join('\n')
}
