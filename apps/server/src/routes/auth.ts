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
import { logUser } from '../auth/auth-log.ts'
import { captchaSettings, verifyCaptcha } from '../auth/captcha.ts'
import { configFailure, configLogin } from '../auth/config.ts'
import { cookieLogin } from '../auth/cookie.ts'
import { LoginFailure } from '../auth/failure.ts'
import { requestClientIp } from '../auth/login.ts'
import { loginRateLimiter } from '../auth/rate-limit.ts'
import { storeLogin, withTwoFactor } from '../auth/session-login.ts'
import { getServer, serverIndexes, serverLabel } from '../config.ts'
import { ValidationError } from '../http/errors.ts'
import { parseJson } from '../http/validate.ts'
import { forgetServerMetadata } from '../metadata/service.ts'
import { regenerate } from '../session/manager.ts'
import type { ServerLogin } from '../session/store.ts'

/** pmaUser-N equivalent: the recalled username cookie. */
const userCookie = (server: number) => `bma_user_${server}`

export const authRoutes = new Hono<AppEnv>()

/**
 * GET /api/auth/state — the current server's login. A `config` server logs in here
 * (AuthenticationConfig); `http` / `signon` log in when the page loads (auth/page-gate.ts).
 * pma: src/Http/Middleware/Authentication.php, src/Plugins/Auth/*::showLoginForm / ::showFailure
 */
authRoutes.get('/state', async (c) => {
  const { cfg, userBox } = c.get('deps')
  const session = c.get('session')
  const authType = (getServer(cfg, session.currentServer)?.auth_type ?? 'cookie') as AuthState['authType']
  let login: ServerLogin | undefined = session.servers[String(session.currentServer)]
  let failure: AuthState['failure'] = null
  if (login === undefined && authType === 'config') {
    try {
      login = await configLogin(c, session.currentServer)
    } catch (e) {
      if (!(e instanceof LoginFailure)) throw e
      failure = { kind: 'config', ...configFailure(e, c.get('deps').configFile !== undefined, c.get('tr')) }
    }
  } else if (login === undefined && (authType === 'http' || authType === 'signon')) {
    const f = c.get('session').authFailure
    failure = f !== undefined && f.server === session.currentServer ? f.failure : { kind: 'reload' }
  }
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
    authType,
    failure,
    captcha: authType === 'cookie' ? captchaSettings(cfg) : null,
  }
  return c.json(body)
})

/**
 * POST /api/auth/login — the cookie auth form: captcha, rate limit (X2), credentials, rules,
 * connection, then Session::secure and the second factor.
 * pma: src/Plugins/Auth/AuthenticationCookie.php::readCredentials, src/Plugins/AuthenticationPlugin.php::authenticate
 */
authRoutes.post('/login', async (c) => {
  const { cfg, pools, userBox } = c.get('deps')
  const req = await parseJson(c, LoginRequest)
  const tr = c.get('tr')
  if (getServer(cfg, req.server) === undefined) throw new ValidationError(tr.gettext('Invalid server index!'))
  // an empty username just shows the form again (readCredentials returns false)
  if (req.username === '') throw new ValidationError(tr.gettext('Missing username.'))

  const remoteIp = requestClientIp(c, cfg.TrustedProxies)
  await verifyCaptcha(cfg, req.captchaToken, remoteIp, tr)
  const limiter = loginRateLimiter(cfg)
  const locked = limiter.lockedMessage(remoteIp, req.username, tr)
  if (locked !== null) throw new LoginFailure('form', locked)

  let creds: Awaited<ReturnType<typeof cookieLogin>>
  try {
    creds = await cookieLogin(cfg, pools, {
      serverIndex: req.server,
      username: req.username,
      password: req.password,
      arbitraryServer: req.arbitraryServer,
      remoteIp,
      tr,
    })
  } catch (e) {
    if (e instanceof LoginFailure && e.failureType !== 'form') {
      limiter.failed(remoteIp, req.username)
      // AuthenticationPlugin::logFailure
      logUser(cfg, req.username, e.failureType, remoteIp)
    }
    throw e
  }
  limiter.succeeded(remoteIp, req.username)

  // Session::secure(): new id + token on login, logins on other servers are kept
  const login = await storeLogin(c, req.server, creds, { secure: true })
  const session = c.get('session')
  delete session.authFailure
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

/**
 * POST /api/auth/logout — LogoutURL or the auth type's login form URL; cookie auth with
 * LoginCookieDeleteAll off keeps the other cookie logins (partial logout).
 * pma: src/Plugins/AuthenticationPlugin.php::logOut, src/Plugins/Auth/AuthenticationCookie.php::logOut
 */
authRoutes.post('/logout', async (c) => {
  const { cfg, pools } = c.get('deps')
  const session = c.get('session')
  const server = session.currentServer
  const srv = getServer(cfg, server)
  const user = session.servers[String(server)]?.user ?? ''
  // getLoginFormURL: http asks again for another user, signon goes back to its form
  let logoutUrl: string | null = null
  if (srv !== undefined && srv.LogoutURL !== '') logoutUrl = srv.LogoutURL
  else if (srv?.auth_type === 'http') {
    const base = cfg.Listen.basePath === '' ? '/' : cfg.Listen.basePath
    logoutUrl = `${base.endsWith('/') ? base : `${base}/`}?old_usr=${encodeURIComponent(user)}`
  } else if (srv?.auth_type === 'signon' && srv.SignonURL !== '') logoutUrl = srv.SignonURL
  const cookieAuth = srv?.auth_type === 'cookie'
  delete session.servers[String(server)]
  forgetServerMetadata(session, server)
  await pools.dropSession(session.id, server)
  // the other servers still holding a cookie login (pmaAuth-N cookies)
  const remaining =
    cfg.LoginCookieDeleteAll || !cookieAuth
      ? []
      : Object.keys(session.servers)
          .map(Number)
          .filter((n) => getServer(cfg, n)?.auth_type === 'cookie')
  if (remaining.length === 0) {
    // session_unset() + session_destroy()
    for (const n of Object.keys(session.servers).map(Number)) forgetServerMetadata(session, n)
    await pools.dropSession(session.id)
    const fresh = regenerate(c.get('deps').store, session, server)
    fresh.servers = {}
    c.set('session', fresh)
    const body: LogoutResponse = { ok: true, logoutUrl, server: null }
    return c.json(body)
  }
  // redirect to the (last) other authenticated server with $_SESSION['partial_logout'], whose
  // home page shows the partial-logout message
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
