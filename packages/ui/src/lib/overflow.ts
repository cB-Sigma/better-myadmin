/**
 * How many tabs stay in the bar before the rest move into "More".
 *
 * pma: resources/js/menu_resizer.ts::resize — tabs are moved **from the right end** into the
 * dropdown while the summed width is `>= wmax`; when nothing had to move, tabs come back in order
 * while they fit, and the last one may come back if dropping "More" itself frees enough room.
 *
 * @param widths   rendered width of every tab, in order
 * @param available width available for the whole menu (`wmax`)
 * @param moreWidth width of the "More" toggle
 * @returns number of tabs rendered inline (the rest go to the dropdown)
 */
export function visibleTabCount(widths: readonly number[], available: number, moreWidth: number): number {
  const total = widths.reduce((a, b) => a + b, 0)
  // everything fits without the More toggle
  if (total < available) return widths.length
  // keep moving the rightmost inline tab into the dropdown while the row (plus More) overflows
  let count = widths.length
  let used = total + moreWidth
  while (count > 0 && used >= available) {
    count--
    used -= widths[count] ?? 0
  }
  return count
}

/** Below this window width the menu collapses behind the "Toggle navigation" hamburger (Bootstrap lg). */
export const HAMBURGER_BREAKPOINT = 768
