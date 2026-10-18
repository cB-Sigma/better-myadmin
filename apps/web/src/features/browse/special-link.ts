import type { GridCell } from '@bettermyadmin/contracts'
import { defaultDatabasePath, defaultTablePath } from '../shell/tabs'

/**
 * The SPA address of a SpecialSchemaLinks cell (phpMyAdmin route + parameters from the server), or
 * null when a parameter the page needs is missing (a NULL dependency column).
 *
 * pma: src/Config/SpecialSchemaLinks.php (the default pages it links to)
 */
export function specialLinkHref(server: number, sl: NonNullable<GridCell['sl']>): string | null {
  const p = new Map(sl.params)
  const enc = encodeURIComponent
  const db = p.get('db')
  const table = p.get('table')
  const query = (keys: string[]) => {
    const q = new URLSearchParams()
    for (const [k, v] of sl.params) if (keys.includes(k)) q.append(k, v)
    const s = q.toString()
    return s === '' ? '' : `?${s}`
  }
  const dbBase = db === undefined ? null : `/s/${server}/db/${enc(db)}`
  const tableBase = dbBase === null || table === undefined ? null : `${dbBase}/t/${enc(table)}`
  switch (sl.route) {
    case '/server/privileges':
      return `/s/${server}/privileges/user${query(['username', 'hostname'])}`
    case '/table/structure/change': {
      const field = p.get('field')
      return tableBase === null || field === undefined
        ? null
        : `${tableBase}/structure/change?fields=${enc(field)}`
    }
    case '/events':
      return dbBase === null ? null : `${dbBase}/events${query(['edit_item', 'item_name'])}`
    case '/database/routines':
      return dbBase === null ? null : `${dbBase}/routines${query(['edit_item', 'item_name', 'item_type'])}`
  }
  if (sl.route.startsWith('/database/'))
    return dbBase === null ? null : `${dbBase}/${defaultDatabasePath(sl.route)}`
  return tableBase === null ? null : `${tableBase}/${defaultTablePath(sl.route)}`
}
