import type { NavParams } from '@bettermyadmin/contracts'

/**
 * Maps a phpMyAdmin route + parameters (as the navigation nodes carry them) onto the SPA URL that
 * replaces it (docs/reference/pma-route-map.md): `/database/*` → `/s/:s/db/:db/*`,
 * `/table/*` → `/s/:s/db/:db/t/:table/*`. The default tabs open the scope index routes.
 */
export function navHref(server: number, route: string, params: NavParams): string {
  const rest = new URLSearchParams()
  let db: string | undefined
  let table: string | undefined
  for (const [k, v] of Object.entries(params)) {
    if (v === null) continue
    if (k === 'db') db = String(v)
    else if (k === 'table') table = String(v)
    else rest.append(k, String(v))
  }
  const e = encodeURIComponent
  const srv = `/s/${server}`
  const dbBase = db === undefined ? srv : `${srv}/db/${e(db)}`
  const tblBase = table === undefined ? `${dbBase}/table` : `${dbBase}/t/${e(table)}`
  let path: string
  if (route === '/' || route === '') path = srv
  else if (route === '/sql') {
    // Browse (`pos=0`): the table index route shows Browse
    if (table !== undefined && rest.get('pos') === '0') rest.delete('pos')
    path = table !== undefined ? `${tblBase}/` : db !== undefined ? `${dbBase}/sql` : `${srv}/sql`
  } else if (route.startsWith('/server/')) path = `${srv}/${route.slice('/server/'.length)}`
  else if (route === '/database/structure' && rest.size === 0) path = `${dbBase}/`
  else if (route.startsWith('/database/')) path = `${dbBase}/${route.slice('/database/'.length)}`
  // the table routes whose SPA page has another name: the database's "New" table, a table's "New"
  // column, and Insert (pma: /table/change, the NavigationTreeDefaultTabTable2 'insert' icon)
  else if (route === '/table/create') path = `${dbBase}/create-table`
  else if (route === '/table/add-field') path = `${tblBase}/structure/add`
  else if (route === '/table/change') path = `${tblBase}/${rest.has('where_clause') ? 'edit' : 'insert'}`
  else if (route.startsWith('/table/')) path = `${tblBase}/${route.slice('/table/'.length)}`
  else if (route === '/triggers') path = `${table !== undefined ? tblBase : dbBase}/triggers`
  // the Events page is /events (and /events/export) since phpMyAdmin 2b5b66989b
  else if (route === '/events') path = `${dbBase}/events`
  else if (route.startsWith('/view/')) path = `${dbBase}/view/${route.slice('/view/'.length)}`
  else path = `${srv}${route}`
  const qs = rest.toString()
  return qs === '' ? path : `${path}?${qs}`
}

/** The database and table of the main panel, read from the URL (`Current::$database` / `$table`). */
export function currentScope(pathname: string): { db: string; table: string } {
  const m = pathname.match(/^\/s\/[^/]+\/db\/([^/]+)(?:\/t\/([^/]+))?/)
  const d = (s: string | undefined) => {
    if (s === undefined) return ''
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  }
  return { db: d(m?.[1]), table: d(m?.[2]) }
}
