import type { MiddlewareHandler } from 'hono'
import type { AppDeps, AppEnv } from '../app.ts'

/**
 * phpMyAdmin's addresses (bookmarks, links in wikis and tickets, a reverse proxy's old default
 * path): `index.php?route=/database/structure&db=…&server=1`, and the per-page scripts of
 * phpMyAdmin 4 (`db_structure.php?db=…`, `tbl_sql.php`, `server_status.php`), redirected to the
 * BetterMyAdmin page they name, or to the home page.
 *
 * Without it such a path is a static file request: the page load skips authentication (http /
 * signon), and the single-page app that answers it finds no login, reloads, and ends on "Cannot
 * log in to the database server."
 */
export function legacyUrls(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const m = c.req.method
    if (m !== 'GET' && m !== 'HEAD') return next()
    const base = (deps.cfg.Listen?.basePath ?? '').replace(/\/+$/, '')
    const path = base !== '' && c.req.path.startsWith(base) ? c.req.path.slice(base.length) : c.req.path
    const script = /^\/([A-Za-z0-9_]+)\.php$/.exec(path)?.[1]
    if (script === undefined) return next()
    const q = new URL(c.req.url).searchParams
    const route = script === 'index' ? (q.get('route') ?? '/') : scriptRoute(script)
    const server = /^[1-9][0-9]*$/.test(q.get('server') ?? '')
      ? Number(q.get('server'))
      : deps.cfg.ServerDefault || 1
    const target = legacyTarget(route, server, q.get('db') ?? '', q.get('table') ?? '')
    return c.redirect(`${base}${target}`, 302)
  }
}

/** phpMyAdmin 4's script names: db_structure → /database/structure, tbl_sql → /table/sql, server_status → /server/status. */
function scriptRoute(script: string): string {
  const [head = '', ...rest] = script.split('_')
  const page = rest.join('-')
  if (head === 'db') return `/database/${page}`
  if (head === 'tbl') return `/table/${page}`
  if (head === 'server') return `/server/${page}`
  if (script === 'sql') return '/sql'
  return '/'
}

/** The SPA page of a phpMyAdmin route (an unknown page opens the level's default tab). */
export function legacyTarget(route: string, server: number, db: string, table: string): string {
  const s = `/s/${server}`
  const enc = encodeURIComponent
  const dbBase = db === '' ? null : `${s}/db/${enc(db)}`
  const tableBase = dbBase === null || table === '' ? null : `${dbBase}/t/${enc(table)}`
  const page = (r: string, prefix: string) => r.slice(prefix.length).replace(/^\/+/, '').replaceAll('_', '-')
  if (route === '/sql')
    return tableBase !== null ? `${tableBase}/browse` : dbBase !== null ? `${dbBase}/sql` : `${s}/sql`
  if (route.startsWith('/table/') && tableBase !== null) {
    const p = page(route, '/table')
    return `${tableBase}/${p === 'change' ? 'insert' : p}`
  }
  if (route.startsWith('/database/') && dbBase !== null) return `${dbBase}/${page(route, '/database')}`
  if (route.startsWith('/server/')) return `${s}/${page(route, '/server')}`
  // '/' and anything else: the deepest level the parameters name
  return tableBase !== null ? `${tableBase}/` : dbBase !== null ? `${dbBase}/` : `${s}/`
}
