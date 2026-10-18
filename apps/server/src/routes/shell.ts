import {
  ChangePasswordRequest,
  type DatabaseScope,
  type HomeResponse,
  type PasswordForm,
  type ServerScope,
  SetCollationRequest,
  type SetCollationResponse,
  type TableScope,
} from '@bettermyadmin/contracts'
import { type Context, Hono } from 'hono'
import { getServer } from '../config.ts'
import { parseJson } from '../http/validate.ts'
import { MetaRequest, withMeta } from '../metadata/service.ts'
import { homeData } from '../shell/home.ts'
import { changePassword, passwordForm } from '../shell/password.ts'
import { type ShellCtx, databaseScope, serverScope, tableScope } from '../shell/scope.ts'
import type { ServerEnv } from './server.ts'

/**
 * Shell endpoints: the server/database/table scope payloads behind the breadcrumb and tab bars,
 * the home page blocks, the connection collation and the change-password dialog.
 */
export const shellRoutes = new Hono<ServerEnv>()

// biome-ignore lint/suspicious/noExplicitAny: any route path/input
async function withShell<T>(c: Context<ServerEnv, any, any>, fn: (ctx: ShellCtx) => Promise<T>): Promise<T> {
  const deps = c.get('deps')
  const s = c.get('serverIndex')
  const session = c.get('session')
  const login = session.servers[String(s)]!
  login.cache ??= {}
  const executed = c.get('executed')
  const conn = await deps.pools.acquire(
    session.id,
    s,
    c.get('creds'),
    executed,
    undefined,
    c.get('language').mysqlLocale,
  )
  // the configuration storage through the metadata layer (one discovery per session)
  const meta = new MetaRequest(c)
  try {
    return await fn({
      cfg: deps.cfg,
      server: getServer(deps.cfg, s)!,
      serverIndex: s,
      username: login.user,
      conn,
      meta,
      cache: login.cache,
      tr: c.get('tr'),
      lang: c.get('language').code,
    })
  } finally {
    conn.raw.release()
    meta.close()
  }
}

/** GET /api/servers/:s — server scope (pma: Menu::getServerTabs + breadcrumb) */
shellRoutes.get('/', async (c) => {
  const body: ServerScope = await withShell(c, serverScope)
  return c.json(body)
})

/** GET /api/servers/:s/home — pma: HomeController */
shellRoutes.get('/home', async (c) => {
  const session = c.get('session')
  const partialLogout = session.partialLogout === true
  delete session.partialLogout
  const deps = c.get('deps')
  const login = session.servers[String(c.get('serverIndex'))]
  const body: HomeResponse = await withShell(c, (ctx) =>
    homeData(ctx, {
      httpHost: c.req.header('host') ?? '',
      configuredSecret: deps.configuredSecret ?? deps.cfg.blowfish_secret,
      secretGenerated: deps.secretGenerated === true,
      partialLogout,
      connectionCollation: login?.collation ?? deps.cfg.DefaultConnectionCollation,
    }),
  )
  return c.json(body)
})

/** GET /api/servers/:s/databases/:db — database scope (pma: Menu::getDbTabs) */
shellRoutes.get('/databases/:db', async (c) => {
  const db = c.req.param('db')
  const body: DatabaseScope = await withShell(c, (ctx) => databaseScope(ctx, db))
  return c.json(body)
})

/** GET /api/servers/:s/databases/:db/tables/:t/capabilities — table scope (pma: Menu::getTableTabs) */
shellRoutes.get('/databases/:db/tables/:t/capabilities', async (c) => {
  const db = c.req.param('db')
  const table = c.req.param('t')
  const body: TableScope = await withShell(c, (ctx) => tableScope(ctx, db, table))
  return c.json(body)
})

/**
 * POST /api/servers/:s/session/collation (pma: /collation-connection): stores
 * DefaultConnectionCollation for this login; new pooled connections run SET collation_connection.
 */
shellRoutes.post('/session/collation', async (c) => {
  const req = await parseJson(c, SetCollationRequest)
  const login = c.get('session').servers[String(c.get('serverIndex'))]!
  login.collation = req.collation_connection
  c.get('creds').collation = login.collation
  // open (and set up) a connection with the new collation right away, like the redirect to / does
  await withShell(c, async () => null)
  const body: SetCollationResponse = { ok: true, collation: login.collation }
  return c.json(body)
})

/** GET /api/servers/:s/account/password — the change-password form (pma: GET /user-password) */
shellRoutes.get('/account/password', async (c) => {
  const body: PasswordForm = await withShell(c, passwordForm)
  return c.json(body)
})

/** POST /api/servers/:s/account/password (pma: POST /user-password) */
shellRoutes.post('/account/password', async (c) => {
  const req = await parseJson(c, ChangePasswordRequest)
  const result = await withShell(c, (ctx) => changePassword(ctx, req))
  // AuthenticationCookie::handlePasswordChange: keep the session logged in with the new password
  const deps = c.get('deps')
  const login = c.get('session').servers[String(c.get('serverIndex'))]!
  login.credEnc = deps.credBox.encrypt(JSON.stringify({ password: result.password }))
  await deps.pools.dropSession(c.get('session').id, c.get('serverIndex'))
  return c.json({ ok: result.ok, message: result.message, sql: result.sql })
})

/**
 * POST /api/servers/:s/themes/set — the part of ThemeSetController the client-side theme store
 * cannot do: `ThemeDefault` in the user preferences, always written (load, set, save — also for
 * `original`). With `sync` (a stored theme differs from the preferences on page load): the
 * "save theme" of UserPreferencesHandler::loadUserPreferences, setUserValue with the default
 * `original` (the key removed for `original`). Configuration storage or session.
 */
shellRoutes.post('/themes/set', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { theme?: unknown; sync?: unknown } | null
  const theme = typeof body?.theme === 'string' ? body.theme : ''
  const { cfg } = c.get('deps')
  if (!cfg.ThemeManager || theme === '') return c.json({ ok: false })
  return withMeta(c, {}, async (m) => {
    const prefs = (await m.meta()).userPreferences()
    if (body?.sync === true) {
      const r = await prefs.persistOption('ThemeDefault', theme, 'original')
      return c.json({ ok: r === true })
    }
    // ThemeSetController: $preferences['config_data']['ThemeDefault'] = $theme; save()
    const loaded = await prefs.load()
    const r = await prefs.save({ ...loaded.config_data, ThemeDefault: theme })
    return c.json({ ok: r === true })
  })
})
