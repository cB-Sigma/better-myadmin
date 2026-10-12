import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app.ts'
import { getServer } from '../config.ts'
import { httpPageAuth, httpRealm } from './http.ts'
import { signonPageAuth } from './signon.ts'

/** A page load of the SPA (not the API, a hashed asset, a static file or the setup script). */
export function isPageRequest(method: string, path: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false
  if (path.startsWith('/api/') || path.startsWith('/assets/') || path === '/setup' || path.startsWith('/setup/'))
    return false
  const last = path.slice(path.lastIndexOf('/') + 1)
  return !last.includes('.') || last.endsWith('.html')
}

/** The 401 page body when no SPA is served (API-only mode). */
const DENIED_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Access denied!</title></head><body id="loginform"><h1>Welcome to BetterMyAdmin</h1><h3>Wrong username/password. Access denied.</h3></body></html>'

/**
 * The page load authenticates the `http` and `signon` servers, as phpMyAdmin's Authentication
 * middleware does on every request: a missing or rejected Basic login gets the SPA with a 401 and
 * the `WWW-Authenticate` challenge (the SPA then shows AuthenticationHttp::authForm), a signon
 * server without credentials redirects to SignonURL. The server is the one in the URL (`/s/N/…`),
 * else the session's current server.
 * pma: src/Http/Middleware/Authentication.php, src/Plugins/Auth/AuthenticationHttp.php::authForm,
 *      src/Plugins/Auth/AuthenticationSignon.php::showLoginForm
 */
export function authPageGate(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { cfg } = c.get('deps')
    const session = c.get('session')
    const m = /^\/s\/(\d+)(?:\/|$)/.exec(c.req.path)
    const server = m !== null ? Number(m[1]) : session.currentServer
    const s = getServer(cfg, server)
    if (s === undefined || (s.auth_type !== 'http' && s.auth_type !== 'signon')) return next()
    session.currentServer = server

    if (s.auth_type === 'signon') {
      const r = await signonPageAuth(c, server)
      if (r === 'ok') {
        delete c.get('session').authFailure
        return next()
      }
      if ('redirect' in r) return c.redirect(r.redirect, 302)
      c.get('session').authFailure = { server, failure: { kind: 'error', message: r.error } }
      return next()
    }

    const r = await httpPageAuth(c, server)
    if (r === 'ok') {
      delete c.get('session').authFailure
      return next()
    }
    if (r !== 'challenge') {
      c.get('session').authFailure = { server, failure: { kind: 'error', message: r.error } }
      return next()
    }
    c.get('session').authFailure = { server, failure: { kind: 'http' } }
    await next()
    const html = c.res.status === 200 && (c.res.headers.get('content-type') ?? '').includes('text/html')
    const headers = new Headers(html ? c.res.headers : { 'Content-Type': 'text/html; charset=utf-8' })
    headers.set('WWW-Authenticate', `Basic realm="${httpRealm(s)}"`)
    c.res = new Response(html ? c.res.body : DENIED_HTML, { status: 401, headers })
  }
}
