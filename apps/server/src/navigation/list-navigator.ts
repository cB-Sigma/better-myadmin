import type { NavPageSelector } from '@bettermyadmin/contracts'

interface PageEntry {
  page: number
  /** PHP builds some page numbers from floor() (a float): those never compare === to $pageNow. */
  isFloat: boolean
}

/**
 * The page numbers offered by the page `<select>`.
 * pma: src/Util.php::pageselector
 */
export function pageselectorPages(
  rows: number,
  pageNow = 1,
  nbTotalPage = 1,
  showAll = 200,
  sliceStart = 5,
  sliceEnd = 5,
  percent = 20,
  range = 10,
): NavPageSelector['pages'] {
  const increment = Math.floor(nbTotalPage / percent)
  const pageNowMinusRange = pageNow - range
  const pageNowPlusRange = pageNow + range
  let pages: PageEntry[]
  if (nbTotalPage < showAll) {
    pages = Array.from({ length: Math.max(nbTotalPage, 1) }, (_, i) => ({ page: i + 1, isFloat: false }))
    // range(1, 0) is [1, 0] in PHP
    if (nbTotalPage < 1) pages = [1, 0].map((p) => ({ page: p, isFloat: false }))
  } else {
    pages = []
    for (let i = 1; i <= sliceStart; i++) pages.push({ page: i, isFloat: false })
    for (let i = nbTotalPage - sliceEnd; i <= nbTotalPage; i++) pages.push({ page: i, isFloat: false })
    let i = sliceStart
    let iFloat = false
    const x = nbTotalPage - sliceEnd
    let metBoundary = false
    while (i <= x) {
      if (i >= pageNowMinusRange && i <= pageNowPlusRange) {
        i++
        metBoundary = true
      } else {
        i += increment
        iFloat = true
        if (i > pageNowMinusRange && !metBoundary) {
          i = pageNowMinusRange
          iFloat = false
        }
      }
      if (i <= 0 || i > x) continue
      pages.push({ page: i, isFloat: iFloat })
    }
    i = pageNow
    let dist = 1
    while (i < x) {
      dist *= 2
      i = pageNow + dist
      if (i <= 0 || i > x) continue
      pages.push({ page: i, isFloat: false })
    }
    i = pageNow
    dist = 1
    while (i > 0) {
      dist *= 2
      i = pageNow - dist
      if (i <= 0 || i > x) continue
      pages.push({ page: i, isFloat: false })
    }
    // sort($pages); array_unique($pages) — stable sort, first occurrence kept
    pages.sort((a, b) => a.page - b.page)
    const seen = new Set<number>()
    pages = pages.filter((p) => {
      if (seen.has(p.page)) return false
      seen.add(p.page)
      return true
    })
  }
  if (pageNow > nbTotalPage) pages.push({ page: pageNow, isFloat: false })
  return pages.map((p) => ({
    value: (p.page - 1) * rows,
    page: p.page,
    selected: !p.isFloat && p.page === pageNow,
  }))
}

/**
 * pma: src/Html/Generator.php::getListNavigator with list_navigator.twig (`frame_navigation`);
 * null when phpMyAdmin renders nothing (`max_count >= count`).
 */
export function listNavigator(
  count: number,
  pos: number,
  maxCountIn: number,
  paramName: NavPageSelector['paramName'],
): NavPageSelector | null {
  const maxCount = maxCountIn <= 0 ? 250 : maxCountIn
  if (!(maxCount < count)) return null
  const pages = pageselectorPages(maxCount, Math.floor(pos / maxCount) + 1, Math.ceil(count / maxCount))
  const lastPos = Math.floor(count / maxCount) * maxCount
  const hasNext = pos + maxCount < count
  return {
    count,
    pos,
    maxCount,
    paramName,
    begin: pos > 0 ? 0 : null,
    prev: pos > 0 ? pos - maxCount : null,
    next: hasNext ? pos + maxCount : null,
    end: hasNext ? (lastPos === count ? count - maxCount : lastPos) : null,
    pages,
  }
}
