import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sprintf } from '@bettermyadmin/i18n'
import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from '../app.ts'
import { type ServerConfig, getServer } from '../config.ts'
import type { Credentials } from '../db/pool-manager.ts'
import { SecretBox, safeEqual } from '../session/crypto.ts'
import { AuthMessages, LoginFailure } from './failure.ts'
import { checkRules, connectLogin, requestClientIp } from './login.ts'
import { loginCredentials, storeLogin } from './session-login.ts'

/**
 * `auth_type = 'signon'`: another application logs the user in and hands the credentials over.
 *
 * phpMyAdmin reads them from the other application's PHP session named `SignonSession`. Node
 * cannot open a PHP session, so the hand-off is a cookie of that name holding the same keys,
 * encrypted with a key derived from `blowfish_secret` (parity exception X40). The other
 * application writes it with {@link encodeSignonSession} (`apps/server/examples/signon.ts`);
 * login errors are written back into it under `PMA_single_signon_error_message`.
 *
 * `SignonScript` names a JavaScript/TypeScript module instead of a PHP file: it exports
 * `getLoginCredentials(user)` returning `[user, password]` (or a promise of it), called with the
 * configured `user` like phpMyAdmin's `get_login_credentials()` (`apps/server/examples/signon-script.ts`).
 *
 * pma: src/Plugins/Auth/AuthenticationSignon.php, examples/signon.php, examples/signon-script.php
 */

/** The keys phpMyAdmin reads from the signon session ($_SESSION['PMA_single_signon_*']). */
export interface SignonSessionData {
  PMA_single_signon_user?: string
  PMA_single_signon_password?: string
  PMA_single_signon_host?: string
  PMA_single_signon_port?: string | number
  /** server settings merged over Servers[i] for the login */
  PMA_single_signon_cfgupdate?: Record<string, unknown>
  /** written by BetterMyAdmin when the login failed, cleared when the session is read */
  PMA_single_signon_error_message?: string
}

const box = (secret: string) => new SecretBox(secret, 'signon')

/** The `SignonSession` cookie value for these credentials (`secret`: BetterMyAdmin's blowfish_secret). */
export function encodeSignonSession(secret: string, data: SignonSessionData): string {
  return box(secret).encrypt(JSON.stringify(data))
}

/** The signon session of a cookie value; null when it was not written with this secret. */
export function decodeSignonSession(secret: string, value: string): SignonSessionData | null {
  const plain = box(secret).decrypt(value)
  if (plain === null) return null
  try {
    const data = JSON.parse(plain) as unknown
    return data !== null && typeof data === 'object' ? (data as SignonSessionData) : null
  } catch {
    return null
  }
}

/**
 * AuthenticationSignon::setCookieParams: SignonCookieParams with phpMyAdmin's defaults; a
 * samesite other than Lax / Strict is dropped.
 */
export function signonCookieOptions(server: ServerConfig) {
  const p = server.SignonCookieParams
  return {
    path: p.path === '' ? '/' : p.path,
    ...(p.domain !== '' ? { domain: p.domain } : {}),
    secure: p.secure,
    httpOnly: p.httponly,
    ...(p.lifetime > 0 ? { maxAge: p.lifetime } : {}),
    ...(p.samesite === 'Lax' || p.samesite === 'Strict' ? { sameSite: p.samesite } : {}),
  }
}

type ScriptModule = {
  getLoginCredentials?: (user: string) => unknown
  default?: ((user: string) => unknown) | { getLoginCredentials?: (user: string) => unknown }
}

/** SignonScript: `get_login_credentials($cfg['Server']['user'])` of the configured module. */
async function scriptCredentials(script: string, user: string): Promise<[string, string]> {
  const file = isAbsolute(script) ? script : resolve(process.cwd(), script)
  if (!existsSync(file)) throw new SignonError('missing-script')
  const mod = (await import(pathToFileURL(file).href)) as ScriptModule
  const fn =
    mod.getLoginCredentials ??
    (typeof mod.default === 'function' ? mod.default : mod.default?.getLoginCredentials)
  if (typeof fn !== 'function') throw new SignonError('missing-script')
  const r = (await fn(user)) as unknown
  const [u, p] = Array.isArray(r) ? r : []
  return [u === undefined || u === null ? '' : String(u), p === undefined || p === null ? '' : String(p)]
}

class SignonError extends Error {
  constructor(readonly kind: 'missing-script') {
    super(kind)
  }
}

export type SignonAuthResult = 'ok' | { redirect: string } | { error: string }

/**
 * The page request of a signon server: readCredentials (script or session), then the login, or
 * showLoginForm (the redirect to SignonURL, "You must set SignonURL!" without one). A failed login
 * writes AuthenticationPlugin::getErrorMessage into the signon session (showFailure).
 */
export async function signonPageAuth(c: Context<AppEnv>, server: number): Promise<SignonAuthResult> {
  const { cfg, pools, credBox } = c.get('deps')
  const s = getServer(cfg, server)
  if (s === undefined) return { error: 'You must set SignonURL!' }
  const tr = c.get('tr')
  const loginForm = (): SignonAuthResult =>
    s.SignonURL === '' ? { error: 'You must set SignonURL!' } : { redirect: s.SignonURL }

  const creds: Credentials = { user: '', password: '' }
  const cookieValue = s.SignonScript === '' ? getCookie(c, s.SignonSession) : undefined
  let data: SignonSessionData | null = null
  if (s.SignonScript !== '') {
    try {
      ;[creds.user, creds.password] = await scriptCredentials(s.SignonScript, s.user)
    } catch (e) {
      if (!(e instanceof SignonError)) throw e
      return {
        error: sprintf(
          tr.gettext('Can not find signon authentication script: %s'),
          "$cfg['Servers'][$i]['SignonScript']",
        ),
      }
    }
  } else if (cookieValue !== undefined) {
    data = decodeSignonSession(cfg.blowfish_secret, cookieValue) ?? {}
    // Clear error message
    if (data.PMA_single_signon_error_message !== undefined) {
      delete data.PMA_single_signon_error_message
      writeSignonSession(c, s, data)
    }
    creds.user = data.PMA_single_signon_user ?? ''
    creds.password = data.PMA_single_signon_password ?? ''
    if (data.PMA_single_signon_host !== undefined) creds.host = data.PMA_single_signon_host
    if (data.PMA_single_signon_port !== undefined && String(data.PMA_single_signon_port) !== '')
      creds.port = Number(data.PMA_single_signon_port)
    if (data.PMA_single_signon_cfgupdate !== undefined) creds.overrides = data.PMA_single_signon_cfgupdate
  }
  if (creds.user === '') return loginForm()

  const session = c.get('session')
  const current = session.servers[String(server)]
  if (current !== undefined) {
    const kept = loginCredentials(credBox, current)
    if (
      kept !== null &&
      kept.user === creds.user &&
      safeEqual(kept.password, creds.password) &&
      kept.host === creds.host &&
      kept.port === creds.port
    )
      return 'ok'
  }
  try {
    checkRules(s, creds.user, creds.password, requestClientIp(c, cfg.TrustedProxies), tr)
    await connectLogin(pools, server, creds, tr)
    await storeLogin(c, server, creds, { secure: false })
    return 'ok'
  } catch (e) {
    if (!(e instanceof LoginFailure)) throw e
    delete session.servers[String(server)]
    if (data !== null) {
      // getErrorMessage: after a failed connect there is no connection error text
      const message = e.failureType === 'server-denied' ? tr.gettext(AuthMessages.serverDenied) : e.message
      writeSignonSession(c, s, { ...data, PMA_single_signon_error_message: message })
    }
    return loginForm()
  }
}

function writeSignonSession(c: Context<AppEnv>, s: ServerConfig, data: SignonSessionData): void {
  setCookie(
    c,
    s.SignonSession,
    encodeSignonSession(c.get('deps').cfg.blowfish_secret, data),
    signonCookieOptions(s),
  )
}
