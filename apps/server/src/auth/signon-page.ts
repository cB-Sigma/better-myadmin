import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { serialize } from 'hono/utils/cookie'
import type { AppDeps, AppEnv } from '../app.ts'
import type { AppConfig, ServerConfig } from '../config.ts'
import { requestClientIp } from './login.ts'
import {
  type SignonSessionData,
  decodeSignonSession,
  encodeSignonSession,
  signonCookieOptions,
} from './signon.ts'

/**
 * `SignonPage` (BetterMyAdmin only, parity exception X54): the login application of a signon
 * server, served by BetterMyAdmin itself at the path of `SignonURL`.
 *
 * phpMyAdmin's signon login page (examples/signon.php, or a site's own script) is a PHP page that
 * the same web server runs next to phpMyAdmin: it writes the credentials into the `SignonSession`
 * and redirects to phpMyAdmin. BetterMyAdmin is one Node.js process with no PHP to run such a
 * page, so `SignonPage` names a JavaScript module that plays its part, on BetterMyAdmin's port:
 *
 *   export default async function (request: Request, ctx: SignonPageContext): Promise<Response>
 *
 * It is called for every request to SignonURL's path (and below it), before BetterMyAdmin's own
 * login checks, with the helpers to read and write the `SignonSession` cookie that
 * auth/signon.ts reads (`apps/server/examples/signon-page.mjs`).
 */
export interface SignonPageContext {
  /** the server whose SignonURL this is: its index and configuration */
  server: { index: number; config: ServerConfig }
  /** the client address, after TrustedProxies ('' when unknown) */
  clientIp: string
  /** the current SignonSession (null when there is none or it does not decrypt) */
  session: SignonSessionData | null
  /** a Set-Cookie value that stores this SignonSession (null clears it), with SignonCookieParams */
  sessionCookie: (data: SignonSessionData | null) => string
  /** the page the user asked for before being sent here (a path on this host), else '/' */
  returnTo: string
}

/** The page a signon redirect interrupted (set by the page gate, cleared by the next redirect). */
export const RETURN_COOKIE = 'bma_signon_return'

/** A same-host path that is not the signon page itself, else '/'. */
function safeReturn(value: string | undefined, base: string): string {
  if (value === undefined || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return '/'
  const path = value.split(/[?#]/)[0] ?? ''
  return path === base || path.startsWith(`${base}/`) ? '/' : value
}

type PageHandler = (request: Request, ctx: SignonPageContext) => Response | Promise<Response>

/**
 * The agent API's credentials for a request to a signon server (optional export `agentCredentials`
 * of the SignonPage module): the MySQL user and password the request authenticates as (e.g. from
 * a single sign-on proxy's header), or null when it carries none.
 */
export type AgentCredentialsHook = (
  request: Request,
  ctx: { server: { index: number; config: ServerConfig }; clientIp: string },
) => { user: string; password: string } | null | Promise<{ user: string; password: string } | null>

interface SignonModule {
  default?: unknown
  signonPage?: unknown
  agentCredentials?: unknown
}

const modules = new Map<string, Promise<SignonModule>>()

function loadModule(file: string): Promise<SignonModule> {
  let m = modules.get(file)
  if (m === undefined) {
    m = import(pathToFileURL(file).href) as Promise<SignonModule>
    // a failed import is retried on the next request (the file may be fixed meanwhile)
    m.catch(() => modules.delete(file))
    modules.set(file, m)
  }
  return m
}

/** The SignonPage file of a server, resolved against the working directory. */
export function signonPageFile(srv: ServerConfig): string {
  return isAbsolute(srv.SignonPage) ? srv.SignonPage : resolve(process.cwd(), srv.SignonPage)
}

async function loadHandler(file: string): Promise<PageHandler> {
  const mod = await loadModule(file)
  const fn = mod.signonPage ?? mod.default
  if (typeof fn !== 'function') throw new Error(`SignonPage ${file} exports no function`)
  return fn as PageHandler
}

/** The SignonPage module's `agentCredentials` export, or null when it has none. */
export async function loadAgentCredentials(file: string): Promise<AgentCredentialsHook | null> {
  const fn = (await loadModule(file)).agentCredentials
  return typeof fn === 'function' ? (fn as AgentCredentialsHook) : null
}

/** The path a SignonURL names when it is on this host ('/signon/' → '/signon'), else null. */
export function signonPagePath(url: string): string | null {
  if (!url.startsWith('/') || url.startsWith('//')) return null
  const path = url.split(/[?#]/)[0] ?? ''
  return path.length > 1 ? path.replace(/\/+$/, '') : null
}

/** The server whose SignonPage serves this request path, if any. */
function pageServer(cfg: AppConfig, path: string): { index: number; srv: ServerConfig; base: string } | null {
  for (const [key, srv] of Object.entries(cfg.Servers)) {
    if (srv.auth_type !== 'signon' || srv.SignonPage === '') continue
    const base = signonPagePath(srv.SignonURL)
    if (base !== null && (path === base || path.startsWith(`${base}/`)))
      return { index: Number(key), srv, base }
  }
  return null
}

/** Serves the SignonPage modules (mounted before the page gate, so SignonURL is not redirected to itself). */
export function signonPages(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { cfg } = deps
    const hit = pageServer(cfg, c.req.path)
    if (hit === null) return next()
    const file = signonPageFile(hit.srv)
    const handler = await loadHandler(file)
    const cookie = getCookie(c, hit.srv.SignonSession)
    const ctx: SignonPageContext = {
      server: { index: hit.index, config: hit.srv },
      clientIp: requestClientIp(c, cfg.TrustedProxies) || '',
      session: cookie === undefined ? null : decodeSignonSession(cfg.blowfish_secret, cookie),
      sessionCookie: (data) => {
        const opts = signonCookieOptions(hit.srv)
        return data === null
          ? serialize(hit.srv.SignonSession, '', { ...opts, maxAge: 0 })
          : serialize(hit.srv.SignonSession, encodeSignonSession(cfg.blowfish_secret, data), opts)
      },
      returnTo: safeReturn(getCookie(c, RETURN_COOKIE), hit.base),
    }
    const res = await handler(c.req.raw, ctx)
    if (!(res instanceof Response)) throw new Error(`SignonPage ${file} did not return a Response`)
    // the page sent the user on: the interrupted page is used up
    if (res.status >= 300 && res.status < 400 && getCookie(c, RETURN_COOKIE) !== undefined) {
      try {
        res.headers.append('Set-Cookie', serialize(RETURN_COOKIE, '', { path: '/', maxAge: 0 }))
      } catch {
        // immutable headers: the cookie expires on its own
      }
    }
    c.res = res
  }
}
