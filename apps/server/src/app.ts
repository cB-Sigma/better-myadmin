import { CSRF_COOKIE, CSRF_HEADER, type Executed, SESSION_COOKIE } from '@bettermyadmin/contracts'
import type { Language, LanguageManager, Translator } from '@bettermyadmin/i18n'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { logUser } from './auth/auth-log.ts'
import { requestClientIp } from './auth/login.ts'
import { authPageGate, isPageRequest } from './auth/page-gate.ts'
import type { AppConfig } from './config.ts'
import type { PoolManager } from './db/pool-manager.ts'
import { configPermissions } from './http/config-permissions.ts'
import { BmaError, CsrfError } from './http/errors.ts'
import { securityHeaders } from './http/headers.ts'
import { sqlLog } from './http/sql-log.ts'
import { languageLoading, languageManager } from './i18n.ts'
import { authRoutes } from './routes/auth.ts'
import { i18nRoutes } from './routes/i18n.ts'
import { metaRoutes } from './routes/meta.ts'
import { serverRoutes } from './routes/server.ts'
import { setupRoutes } from './routes/setup.ts'
import { telemetryRoutes } from './routes/telemetry.ts'
import { type SecretBox, safeEqual } from './session/crypto.ts'
import { newSession, nowSeconds } from './session/manager.ts'
import { mergeChanges } from './session/merge.ts'
import type { SessionData, SessionStore } from './session/store.ts'

export interface AppDeps {
  cfg: AppConfig
  store: SessionStore
  pools: PoolManager
  /** Encrypts credentials kept in the session store. */
  credBox: SecretBox
  /** Encrypts the recalled-username cookie (LoginCookieRecall). */
  userBox: SecretBox
  /** blowfish_secret as configured, before main.ts generated one (home page key-length warnings). */
  configuredSecret?: string
  /** True when blowfish_secret was generated into DataDir because the configuration had none. */
  secretGenerated?: boolean
  /** The configuration file that was loaded (none: defaults and environment only). */
  configFile?: string
}

export interface AppEnv {
  Variables: {
    deps: AppDeps
    session: SessionData
    /** True when the session did not exist before this request. */
    sessionIsNew: boolean
    executed: Executed[]
    isHttps: boolean
    /** The request's language (LanguageManager::selectLanguage) and its catalogue. */
    languageManager: LanguageManager
    language: Language
    tr: Translator
    languageWarning: boolean
  }
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()

  app.onError((err, c) => {
    if (err instanceof BmaError) return c.json(err.toEnvelope(), err.status as 400)
    console.error(err)
    // `environment` = development shows the exception and where it was raised
    // pma: src/Error/ErrorHandler.php::handleException (hideLocation)
    if (deps.cfg.environment === 'development') {
      const where = err.stack?.split('\n')[1]?.trim().replace(/^at /, '') ?? ''
      const message = `${err.name}: ${err.message}${where === '' ? '' : ` (${where})`}`
      return c.json({ error: { code: 'INTERNAL', message } }, 500)
    }
    return c.json({ error: { code: 'INTERNAL', message: 'Internal error.' } }, 500)
  })

  app.use('*', securityHeaders(deps.cfg))

  const session = sessionMiddleware(deps)
  const language = languageLoading(languageManager(deps.cfg))
  const permissions = configPermissions()
  app.use('/api/*', session)
  app.use('/api/*', sqlLog())
  app.use('/api/*', language)
  app.use('/api/*', permissions)

  // page loads authenticate the http / signon servers (the SPA itself is served by main.ts)
  const gate = authPageGate()
  app.use('*', async (c, next) => {
    if (!isPageRequest(c.req.method, c.req.path)) return next()
    await session(c, async () => {
      await language(c, async () => {
        const r = await permissions(c, async () => {
          const g = await gate(c, next)
          if (g instanceof Response) c.res = g
        })
        if (r instanceof Response) c.res = r
      })
    })
  })

  // CSRF: double submit on every non-GET request (pma: TokenRequestParamChecking)
  app.use('/api/*', async (c, next) => {
    const m = c.req.method
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
      const header = c.req.header(CSRF_HEADER) ?? ''
      if (c.get('sessionIsNew') || header === '' || !safeEqual(header, c.get('session').csrfToken)) {
        throw new CsrfError()
      }
    }
    await next()
  })

  app.route('/api/auth', authRoutes)
  app.route('/api/meta', metaRoutes)
  app.route('/api/i18n', i18nRoutes)
  app.route('/api/servers', serverRoutes)
  app.route('/api/telemetry', telemetryRoutes)
  app.route('/api/setup', setupRoutes)

  app.all('/api/*', (c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404))

  return app
}

export type App = ReturnType<typeof createApp>

/** The session: loaded or created, the cookie carries only the id; inactivity drops the logins. */
function sessionMiddleware(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('deps', deps)
    c.set('executed', [])
    const proto = c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.replace(':', '')
    c.set('isHttps', proto === 'https')
    const id = getCookie(c, SESSION_COOKIE)
    let session = id !== undefined ? deps.store.get(id) : null
    c.set('sessionIsNew', session === null)
    // the session as stored when the request started: what this request changes (including the
    // inactivity logout below) is merged over what a concurrent request stored meanwhile
    // (PHP serialises a session's requests with the session lock)
    const loaded: unknown = session === null ? null : JSON.parse(JSON.stringify(session))
    if (session === null) session = newSession(deps.cfg.ServerDefault > 0 ? deps.cfg.ServerDefault : 1)
    else if (
      Object.keys(session.servers).length > 0 &&
      nowSeconds() - session.lastSeenAt > deps.cfg.LoginCookieValidity
    ) {
      // inactivity logout (pma: AuthenticationFailure::NO_ACTIVITY, logged by logFailure)
      const ip = requestClientIp(c, deps.cfg.TrustedProxies)
      for (const login of Object.values(session.servers)) logUser(deps.cfg, login.user, 'no-activity', ip)
      session.servers = {}
      session.expired = true
      void deps.pools.dropSession(session.id)
    }
    c.set('session', session)
    await next()
    let s = c.get('session')
    if (loaded !== null && s.id === session.id) {
      const latest = deps.store.get(s.id)
      // deleted meanwhile (logout, Session::secure() in another request): never bring it back
      if (latest === null) return
      s = mergeChanges(latest, loaded, s)
    }
    s.lastSeenAt = nowSeconds()
    deps.store.set(s)
    writeSessionCookies(c, s)
  }
}

// biome-ignore lint/suspicious/noExplicitAny: any route path/input
export function writeSessionCookies(c: Context<AppEnv, any, any>, s: SessionData) {
  const { cfg } = c.get('deps')
  const secure = c.get('isHttps')
  const sameSite = (['Lax', 'Strict', 'None'].includes(cfg.CookieSameSite) ? cfg.CookieSameSite : 'Strict') as
    | 'Lax'
    | 'Strict'
    | 'None'
  const path = cfg.Listen?.basePath !== undefined && cfg.Listen.basePath !== '' ? cfg.Listen.basePath : '/'
  // LoginCookieStore = 0 → browser-session cookie, otherwise kept that many seconds
  const maxAge = cfg.LoginCookieStore > 0 ? { maxAge: cfg.LoginCookieStore } : {}
  setCookie(c, SESSION_COOKIE, s.id, { path, httpOnly: true, secure, sameSite, ...maxAge })
  setCookie(c, CSRF_COOKIE, s.csrfToken, { path, httpOnly: false, secure, sameSite, ...maxAge })
}
