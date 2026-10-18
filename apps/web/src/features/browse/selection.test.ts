import { describe, expect, it } from 'vitest'
import {
  dragSelection,
  emptySelection,
  extendSelection,
  selectAll,
  selectionClass,
  selectionText,
  startSelection,
} from './selection'

describe('grid cell selection (makegrid.ts initCellSelection)', () => {
  it('selects a cell, and unselects it on a second click', () => {
    const one = startSelection(emptySelection, 1, 2, false)
    expect(selectionClass(one, 1, 2)).toBe('cell-selected')
    expect(selectionClass(startSelection(one, 1, 2, true), 1, 2)).toBe('')
  })

  it('drags a rectangle from the start cell; Ctrl adds to the selection', () => {
    let s = startSelection(emptySelection, 0, 0, false)
    s = dragSelection(s, 1, 1, false)
    expect([...s.rows]).toEqual([0, 1])
    expect([...s.cols]).toEqual([0, 1])
    expect(selectionClass(s, 1, 0)).toBe('cell-selected with-bg-color')
    const added = dragSelection(startSelection(s, 3, 3, true), 3, 3, true)
    expect(added.rows.has(0) && added.rows.has(3)).toBe(true)
  })

  it('extends with Shift+arrows, into the header row and back', () => {
    let s = startSelection(emptySelection, 0, 0, false)
    s = extendSelection(s, 'ArrowRight', 3, 3)
    expect([...s.cols]).toEqual([0, 1])
    s = extendSelection(s, 'ArrowUp', 3, 3)
    expect(s.rows.has(-1)).toBe(true)
    // nothing above the header, nothing right of the last column
    expect(extendSelection(s, 'ArrowUp', 3, 3)).toBe(s)
    s = extendSelection(extendSelection(s, 'ArrowRight', 3, 3), 'ArrowRight', 3, 3)
    expect(s.end).toEqual({ r: -1, c: 2 })
  })

  it('copies the selected headers and cells tab separated', () => {
    const all = selectAll(2, 2)
    const text = selectionText(
      all,
      ['id', 'name'],
      (r, c) =>
        [
          ['1', ' a '],
          ['2', 'b'],
        ][r]![c]!,
      2,
    )
    expect(text).toBe('id\tname\n1\ta\n2\tb')
    const body = dragSelection(startSelection(emptySelection, 0, 1, false), 1, 1, false)
    expect(selectionText(body, ['id', 'name'], (r) => (r === 0 ? 'a' : 'b'), 2)).toBe('a\nb')
  })
})
