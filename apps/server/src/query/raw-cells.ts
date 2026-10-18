import type { GridData } from '@bettermyadmin/contracts'

/**
 * The raw values of a grid's statement are only read by the grid editor of a cell it shows whole:
 * a truncated or transformed cell loads its full value when edited (makegrid.ts: `SELECT col …
 * WHERE …`, our gridValue), a cell that is not grid-editable (a BLOB, …) is never edited. Their raw
 * value is not encoded, so a page of large TEXT/BLOB rows is not sent (and held) twice in full, which
 * phpMyAdmin's page never does either (docs/architecture/17-large-data.md).
 */
export function unreadRawCells(grid: GridData): boolean[][] {
  return grid.rows.map((row) => {
    const unread: boolean[] = []
    grid.columns.forEach((col, j) => {
      const cls = row.cells[j]?.cls ?? ''
      unread[col.index] = /\b(truncated|transformed)\b/.test(cls) || !/\bgrid_edit\b/.test(cls)
    })
    return unread
  })
}
