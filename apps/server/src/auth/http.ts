import { phpEmpty } from '@bettermyadmin/metadata'
import type { Context } from 'hono'
import type { AppEnv } from '../app.ts'
import { type ServerConfig, getServer } from '../config.ts'
import type { Credentials } from '../db/pool-manager.ts'
import { safeEqual } from '../session/crypto.ts'
import { logUser } from './auth-log.ts'
import { LoginFailure, sanitizeMySQLUser } from './failure.ts'
import { checkRules, connectLogin, requestClientIp } from './login.ts'
import { loginRateLimiter } from './rate-limit.ts'
import { loginCredentials, storeLogin } from './session-login.ts'

/**
 * `auth_type = 'http'`: HTTP Basic credentials. Read from the Authorization header when a page
 * loads (the browser sends them with every request once the realm prompt was answered), kept in
 * the session like the other auth types (parity exception X1), re-checked when they change.
 * pma: src/Plugins/Auth/AuthenticationHttp.php
 */

/**
 * AuthenticationHttp::readCredentials for a `Basic` Authorization header (the user is cut at its
 * first NUL byte); null without credentials.
 */
export function readBasicCredentials(header: string | undefined): { user: string; password: string } | null {
  if (header === undefined || !header.startsWith('Basic ')) return null
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  // the SAPI fills PHP_AUTH_USER / PHP_AUTH_PW only for a `user:password` pair
  const colon = decoded.indexOf(':')
  if (colon === -1) return null
  const user = sanitizeMySQLUser(decoded.slice(0, colon))
  if (user === '') return null
  return { user, password: decoded.slice(colon + 1) }
}

/**
 * AuthenticationHttp::authForm: `auth_http_realm`, else the product name and the server's
 * `verbose` or `host` (parity exception X33); non US-ASCII characters removed (RFC 2616).
 */
export function httpRealm(server: ServerConfig): string {
  const realm = phpEmpty(server.auth_http_realm)
    ? `BetterMyAdmin ${phpEmpty(server.verbose) ? server.host : server.verbose}`
    : server.auth_http_realm
  return realm.replace(/[^\x20-\x7e]/g, '')
}

/** `error`: the generic error page (the login rate limit, X2). */
export type HttpAuthResult = 'ok' | 'challenge' | { error: string }

/**
 * The page request of an http-auth server: the Basic credentials (`old_usr`, the user who logged
 * out, is not accepted again) log in, or the 401 challenge is due. A failed connection shows the
 * authentication form too: after a failed connect DatabaseInterface::getError() is empty
 * (AuthenticationHttp::showFailure).
 */
export async function httpPageAuth(c: Context<AppEnv>, server: number): Promise<HttpAuthResult> {
  const { cfg, pools, credBox } = c.get('deps')
  const s = getServer(cfg, server)
  if (s === undefined) return 'challenge'
  const creds = readBasicCredentials(c.req.header('authorization'))
  const oldUser = c.req.query('old_usr') ?? ''
  if (creds === null || (oldUser !== '' && safeEqual(oldUser, creds.user))) return 'challenge'

  const session = c.get('session')
  const current = session.servers[String(server)]
  if (current !== undefined) {
    const kept = loginCredentials(credBox, current)
    if (kept !== null && kept.user === creds.user && safeEqual(kept.password, creds.password)) return 'ok'
  }
  const tr = c.get('tr')
  const ip = requestClientIp(c, cfg.TrustedProxies)
  const limiter = loginRateLimiter(cfg)
  const locked = limiter.lockedMessage(ip, creds.user, tr)
  if (locked !== null) return { error: locked }
  try {
    const login: Credentials = { user: creds.user, password: creds.password }
    checkRules(s, login.user, login.password, ip, tr)
    await connectLogin(pools, server, login, tr)
    limiter.succeeded(ip, creds.user)
    await storeLogin(c, server, login, { secure: false })
    return 'ok'
  } catch (e) {
    if (!(e instanceof LoginFailure)) throw e
    limiter.failed(ip, creds.user)
    logUser(cfg, creds.user, e.failureType, ip)
    delete session.servers[String(server)]
    return 'challenge'
  }
}
