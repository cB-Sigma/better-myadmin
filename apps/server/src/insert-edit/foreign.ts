/**
 * Browse foreign values popup.
 * pma: src/Controllers/BrowseForeignersController.php, src/BrowseForeigners.php
 */

import type { BrowseForeignersRequest, BrowseForeignersResponse } from '@bettermyadmin/contracts'
import { mbStrlen } from '@bettermyadmin/mysql-types'
import { phpCompareStrings } from '../navigation/php.ts'
import { type IeCtx, foreignersOf, getForeignData } from './context.ts'

const utf8 = new TextDecoder('utf-8')

export async function browseForeigners(
  ctx: IeCtx,
  req: BrowseForeignersRequest,
): Promise<BrowseForeignersResponse> {
  const { cfg } = ctx
  const maxRows = cfg.MaxRows
  // BrowseForeigners::getForeignLimit ("Show all" button value)
  const limit = req.showAll ? '' : `LIMIT ${req.pos}, ${maxRows} `
  const fd = await getForeignData(ctx, await foreignersOf(ctx), req.field, true, req.filter, limit, true)
  const showAllButton = fd.dispRow !== null && cfg.ShowAll && fd.theTotal > maxRows
  if (fd.dispRow === null) {
    return { rows: null, total: fd.theTotal, maxRows, pos: req.pos, showAllButton }
  }
  const descriptions = fd.dispRow.map((r) => (r.display === null ? '' : utf8.decode(r.display)))
  const keys = fd.dispRow.map((r) => (r.key === null ? '' : utf8.decode(r.key)))
  // asort($keys): stable sort by value, keeping the original indexes
  const byKey = keys
    .map((_, i) => i)
    .sort((a, b) => phpCompareStrings(keys[a] as string, keys[b] as string) || a - b)
  const limitChars = cfg.LimitChars
  const describe = (d: string) =>
    mbStrlen(d) <= limitChars
      ? { description: d, title: '' }
      : { description: `${Array.from(d).slice(0, limitChars).join('')}...`, title: d }
  // `$keyname == $currentValue` (loose comparison)
  const isSel = (k: string) => req.data !== '' && looseEquals(k, req.data)
  let horizontal = 0
  const rows: NonNullable<BrowseForeignersResponse['rows']> = []
  byKey.forEach((indexByKeyname, indexByDescription) => {
    horizontal++
    let header = false
    if (cfg.RepeatCells > 0 && horizontal > cfg.RepeatCells) {
      header = true
      horizontal = 0
    }
    const lk = keys[indexByKeyname] as string
    const rk = keys[indexByDescription] as string
    rows.push({
      left: { key: lk, ...describe(descriptions[indexByKeyname] as string), selected: isSel(lk) },
      right: { key: rk, ...describe(descriptions[indexByDescription] as string), selected: isSel(rk) },
      header,
    })
  })
  return { rows, total: fd.theTotal, maxRows, pos: req.pos, showAllButton }
}

/** PHP 8 `==` between two strings: numeric strings compare as numbers */
function looseEquals(a: string, b: string): boolean {
  const num = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/
  if (num.test(a) && num.test(b)) return Number(a) === Number(b)
  return a === b
}
