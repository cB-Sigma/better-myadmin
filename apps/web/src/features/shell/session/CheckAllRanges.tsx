import { useEffect } from 'react'

/** The row check boxes of a list: native `input.checkall` boxes and the ui `Checkbox` (role=checkbox). */
const BOX = 'input[type="checkbox"].checkall, button[role="checkbox"].checkall'

function isChecked(el: Element): boolean {
  return el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true'
}

function enabled(el: Element): boolean {
  return !(el as HTMLInputElement | HTMLButtonElement).disabled
}

/** The rows of the table that take part (`tbody tr:not(.noclick)`), with their first row box. */
function rowsOf(table: HTMLTableElement): HTMLTableRowElement[] {
  return [...table.querySelectorAll<HTMLTableRowElement>('tbody tr:not(.noclick)')]
}

/** One click at a time, each one rendered before the next (the boxes are controlled components). */
async function setBoxes(boxes: Element[], checked: boolean): Promise<void> {
  for (const b of boxes) {
    if (!enabled(b) || isChecked(b) === checked) continue
    ;(b as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 0))
  }
}

/**
 * Shift-click on a row check box of a list checks every row between the last clicked one and this
 * one (and unchecks the rows of the previous shift-click range first); a plain click remembers the
 * row when it checks it.
 * pma: resources/js/modules/functions.ts::getCheckAllCheckboxEventHandler (input:checkbox.checkall
 *      click, lastClickedRow / lastShiftClickedRow / lastClickChecked)
 */
export function CheckAllRanges() {
  useEffect(() => {
    let lastClickedRow = -1
    let lastShiftClickedRow = -1
    let busy = false
    const onClick = (e: MouseEvent) => {
      if (busy || !(e.target instanceof Element)) return
      const box = e.target.closest(BOX)
      const tr = box?.closest('tr')
      const table = box?.closest('table')
      if (box == null || tr == null || table == null) return
      const rows = rowsOf(table)
      const boxIn = (r: HTMLTableRowElement) => r.querySelector(BOX)
      const shift = e.shiftKey && lastClickedRow !== -1
      if (shift) window.getSelection()?.removeAllRanges()
      // read the boxes once the click has been rendered
      setTimeout(() => {
        if (!shift) {
          // usual click: remember the row when it is now checked
          lastClickedRow = isChecked(box) ? rows.indexOf(tr) : -1
          lastShiftClickedRow = -1
          return
        }
        busy = true
        const run = async () => {
          const range = (a: number, b: number) =>
            rows
              .slice(Math.min(a, b), Math.max(a, b) + 1)
              .map(boxIn)
              .filter((x): x is Element => x !== null)
          // clear the last shift click result
          if (lastShiftClickedRow >= 0) await setBoxes(range(lastClickedRow, lastShiftClickedRow), false)
          const curr = rows.indexOf(tr)
          await setBoxes(range(lastClickedRow, curr), true)
          lastShiftClickedRow = curr
        }
        void run().finally(() => {
          busy = false
        })
      }, 0)
    }
    // capture: the ui Checkbox (Radix) stops the propagation of its click inside a form
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
  return null
}
