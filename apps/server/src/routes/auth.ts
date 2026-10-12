import {
  type AuthState,
  LoginRequest,
  type LoginResponse,
  type LogoutResponse,
  type TwoFactorChallengeResponse,
  TwoFactorVerifyRequest,
  type TwoFactorVerifyResponse,
} from '@bettermyadmin/contracts'
import { phpEmpty } from '@bettermyadmin/metadata'
import { type Context, Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { type AppEnv, writeSessionCookies } from '../app.ts'
import { cookieLogin } from '../auth/cookie.ts'
import { getClientIp } from '../auth/ip-allow-deny.ts'
import { getServer, serverIndexes, serverLabel } from '../config.ts'
import { ValidationError } from '../http/errors.ts'
import { parseJson } from '../http/validate.ts'
import { forgetServerMetadata, withMeta } from '../metadata/service.ts'
import { prefsCtx, twoFactorCtx } from '../preferences/service.ts'
import { TwoFactor } from '../preferences/two-factor.ts'
import { regenerate } from '../session/manager.ts'
import type { ServerLogin } from '../session/store.ts'
import { asServerRequest, loginCredentials } from './server.ts'

/** pmaUser-N equivalent: the recalled username cookie. */
const userCookie = (server: number) => `bma_user_${server}`

export const authRoutes = new Hono<AppEnv>()

authRoutes.get('/state', (c) => {
  const { cfg, userBox } = c.get('deps')
  const session = c.get('session')
  const login = session.servers[String(session.currentServer)]
  let recalledUser: string | null = null
  if (cfg.LoginCookieRecall && cfg.blowfish_secret !== '') {
    const enc = getCookie(c, userCookie(session.currentServer))
    if (enc !== undefined) recalledUser = userBox.decrypt(enc)
  }
  const body: AuthState = {
    authenticated: login?.twoFactorOk === true,
    server: session.currentServer,
    user: login?.user ?? null,
    twoFactorPending: login !== undefined && !login.twoFactorOk,
    servers: serverIndexes(cfg)
      .map((index) => ({ s: getServer(cfg, index)!, index }))
      .filter(({ s }) => !phpEmpty(s.host))
      .map(({ s, index }) => ({
        index,
        label: serverLabel(s),
        authType: s.auth_type as AuthState['servers'][number]['authType'],
      })),
    recalledUser,
    allowArbitraryServer: cfg.AllowArbitraryServer,
    csrfToken: session.csrfToken,
    sessionExpired: session.expired === true,
  }
  return c.json(body)
})

authRoutes.post('/login', async (c) => {
  const { cfg, pools, credBox, userBox, store } = c.get('deps')
  const req = await parseJson(c, LoginRequest)
  if (getServer(cfg, req.server) === undefined)
    throw new ValidationError(c.get('tr').gettext('Invalid server index!'))
  // an empty username just shows the form again (readCredentials returns false)
  if (req.username === '') throw new ValidationError(c.get('tr').gettext('Missing username.'))

  // Node's socket address; TrustedProxies decides whether a forwarded header is believed
  const remote = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
    ?.socket?.remoteAddress
  const remoteIp = getClientIp(remote?.replace(/^::ffff:/, ''), cfg.TrustedProxies, (n) => c.req.header(n))

  const creds = await cookieLogin(cfg, pools, {
    serverIndex: req.server,
    username: req.username,
    password: req.password,
    arbitraryServer: req.arbitraryServer,
    remoteIp,
    tr: c.get('tr'),
  })

  // Session::secure(): new id + token on login, logins on other servers are kept
  const session = regenerate(store, c.get('session'), req.server)
  const login: ServerLogin = {
    user: creds.user,
    credEnc: credBox.encrypt(JSON.stringify({ password: creds.password })),
    twoFactorOk: false,
    ...(creds.host !== undefined ? { host: creds.host } : {}),
    ...(creds.port !== undefined ? { port: creds.port } : {}),
  }
  session.servers[String(req.server)] = login
  delete session.expired
  forgetServerMetadata(session, req.server)
  c.set('session', session)
  // AuthenticationPlugin::checkTwoFactor: the configured backend's check (none passes)
  login.twoFactorOk = await withTwoFactor(c, req.server, login, (tf) => tf.check({}), true)
  writeSessionCookies(c, session)

  if (cfg.LoginCookieRecall && cfg.blowfish_secret !== '') {
    // pmaUser-N lives 30 days
    setCookie(c, userCookie(req.server), userBox.encrypt(creds.user), {
      path: '/',
      httpOnly: true,
      secure: c.get('isHttps'),
      sameSite: 'Strict',
      maxAge: 30 * 24 * 3600,
    })
  }

  const body: LoginResponse = {
    ok: true,
    server: req.server,
    twoFactorRequired: !login.twoFactorOk,
    csrfToken: session.csrfToken,
  }
  return c.json(body)
})

/**
 * The login's TwoFactor (user preferences of that server). `fallback` when the preferences cannot
 * be read (no reachable server or storage).
 */
async function withTwoFactor<T>(
  c: Context<AppEnv>,
  server: number,
  login: ServerLogin,
  fn: (tf: TwoFactor) => Promise<T>,
  fallback: T,
): Promise<T> {
  const creds = loginCredentials(c.get('deps').credBox, login)
  if (creds === null) return fallback
  try {
    return await asServerRequest(c, server, creds, (sc) =>
      withMeta(sc, {}, async (m) => {
        const ctx = await prefsCtx(m)
        return fn(await TwoFactor.create(ctx.prefs, twoFactorCtx(ctx)))
      }),
    )
  } catch {
    return fallback
  }
}

const pendingLogin = (c: Context<AppEnv>): ServerLogin => {
  const session = c.get('session')
  const login = session.servers[String(session.currentServer)]
  if (login === undefined || login.twoFactorOk)
    throw new ValidationError(c.get('tr').gettext('Missing username.'))
  return login
}

/** GET /api/auth/two-factor — login/twofactor.twig: the second factor of a pending login */
authRoutes.get('/two-factor', async (c) => {
  const login = pendingLogin(c)
  const server = c.get('session').currentServer
  const body = await withTwoFactor<TwoFactorChallengeResponse>(
    c,
    server,
    login,
    async (tf) => {
      const r = tf.render()
      return { form: r.form, showSubmit: tf.showSubmit, error: null }
    },
    { form: { kind: 'invalid' }, showSubmit: false, error: null },
  )
  return c.json(body)
})

/** POST /api/auth/two-factor — TwoFactor::check with the posted fields; cached in the session */
authRoutes.post('/two-factor', async (c) => {
  const req = await parseJson(c, TwoFactorVerifyRequest)
  const login = pendingLogin(c)
  const server = c.get('session').currentServer
  const body = await withTwoFactor<TwoFactorVerifyResponse>(
    c,
    server,
    login,
    async (tf) => {
      if (await tf.check(req.fields)) return { ok: true }
      const r = tf.render()
      return { ok: false, challenge: { form: r.form, showSubmit: tf.showSubmit, error: r.error } }
    },
    { ok: false },
  )
  if (body.ok) login.twoFactorOk = true
  return c.json(body)
})

authRoutes.post('/logout', async (c) => {
  const { cfg, pools } = c.get('deps')
  const session = c.get('session')
  const server = session.currentServer
  const logoutUrl = getServer(cfg, server)?.LogoutURL ?? ''
  // LoginCookieDeleteAll: drop every server login, else only the current one
  if (cfg.LoginCookieDeleteAll) {
    const all = Object.keys(session.servers).map(Number)
    session.servers = {}
    for (const s of all) forgetServerMetadata(session, s)
    await pools.dropSession(session.id)
  } else {
    delete session.servers[String(server)]
    forgetServerMetadata(session, server)
    await pools.dropSession(session.id, server)
  }
  const remaining = Object.keys(session.servers).map(Number)
  if (remaining.length === 0) {
    const fresh = regenerate(c.get('deps').store, session, server)
    fresh.servers = {}
    c.set('session', fresh)
    const body: LogoutResponse = { ok: true, logoutUrl: logoutUrl === '' ? null : logoutUrl, server: null }
    return c.json(body)
  }
  // AuthenticationPlugin::logOut: redirect to the (last) other authenticated server with
  // $_SESSION['partial_logout'], whose home page shows the partial-logout message
  const other = Math.max(...remaining)
  session.partialLogout = true
  session.currentServer = other
  const body: LogoutResponse = { ok: true, logoutUrl: null, server: other }
  return c.json(body)
})

authRoutes.post('/switch-server', async (c) => {
  const { cfg } = c.get('deps')
  const { server } = (await c.req.json().catch(() => ({}))) as { server?: number }
  if (typeof server !== 'number' || getServer(cfg, server) === undefined) {
    throw new ValidationError(c.get('tr').gettext('Invalid server index!'))
  }
  c.get('session').currentServer = server
  return c.json({ ok: true })
})
