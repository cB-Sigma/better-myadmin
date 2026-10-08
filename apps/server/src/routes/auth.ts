import {
  type AuthState,
  LoginRequest,
  type LoginResponse,
  type LogoutResponse,
} from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { type AppEnv, writeSessionCookies } from '../app.ts'
import { cookieLogin } from '../auth/cookie.ts'
import { getClientIp } from '../auth/ip-allow-deny.ts'
import { getServer, phpEmpty, serverIndexes, serverLabel } from '../config.ts'
import { ValidationError } from '../http/errors.ts'
import { regenerate } from '../session/manager.ts'

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
  const parsed = LoginRequest.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid request.',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  const req = parsed.data
  if (getServer(cfg, req.server) === undefined) throw new ValidationError('Invalid server index!')
  // an empty username just shows the form again (readCredentials returns false)
  if (req.username === '') throw new ValidationError('Missing username.')

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
  })

  // Session::secure(): new id + token on login, logins on other servers are kept
  const session = regenerate(store, c.get('session'), req.server)
  session.servers[String(req.server)] = {
    user: creds.user,
    credEnc: credBox.encrypt(JSON.stringify({ password: creds.password })),
    // two-factor is not implemented yet (M4); the flag is already part of the model
    twoFactorOk: true,
    ...(creds.host !== undefined ? { host: creds.host } : {}),
    ...(creds.port !== undefined ? { port: creds.port } : {}),
  }
  delete session.expired
  c.set('session', session)
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
    twoFactorRequired: false,
    csrfToken: session.csrfToken,
  }
  return c.json(body)
})

authRoutes.post('/logout', async (c) => {
  const { cfg, pools } = c.get('deps')
  const session = c.get('session')
  const server = session.currentServer
  const logoutUrl = getServer(cfg, server)?.LogoutURL ?? ''
  // LoginCookieDeleteAll: drop every server login, else only the current one
  if (cfg.LoginCookieDeleteAll) {
    session.servers = {}
    await pools.dropSession(session.id)
  } else {
    delete session.servers[String(server)]
    await pools.dropSession(session.id, server)
  }
  if (Object.keys(session.servers).length === 0) {
    const fresh = regenerate(c.get('deps').store, session, server)
    fresh.servers = {}
    c.set('session', fresh)
  }
  const body: LogoutResponse = { ok: true, logoutUrl: logoutUrl === '' ? null : logoutUrl }
  return c.json(body)
})

authRoutes.post('/switch-server', async (c) => {
  const { cfg } = c.get('deps')
  const { server } = (await c.req.json().catch(() => ({}))) as { server?: number }
  if (typeof server !== 'number' || getServer(cfg, server) === undefined) {
    throw new ValidationError('Invalid server index!')
  }
  c.get('session').currentServer = server
  return c.json({ ok: true })
})
