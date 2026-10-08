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
import { ValidationError } from '../http/errors.ts'
import { ControlConnections } from '../pmadb/control.ts'
import { homeData } from '../shell/home.ts'
import { changePassword, passwordForm } from '../shell/password.ts'
import { type ShellCtx, databaseScope, serverScope, tableScope } from '../shell/scope.ts'
import type { ServerEnv } from './server.ts'

/**
 * Shell endpoints: the server/database/table scope payloads behind the breadcrumb and tab bars,
 * the home page blocks, the connection collation and the change-password dialog.
 */
export const shellRoutes = new Hono<ServerEnv>()

const controls = new WeakMap<object, ControlConnections>()

/** One ControlConnections per app (keyed by its deps object); closed with closeControlConnections. */
export function controlConnections(deps: ServerEnv['Variables']['deps']): ControlConnections {
  let cc = controls.get(deps)
  if (cc === undefined) {
    cc = new ControlConnections(deps.cfg)
    controls.set(deps, cc)
  }
  return cc
}

export async function closeControlConnections(deps: ServerEnv['Variables']['deps']): Promise<void> {
  await controls.get(deps)?.closeAll()
}

// biome-ignore lint/suspicious/noExplicitAny: any route path/input
async function withShell<T>(c: Context<ServerEnv, any, any>, fn: (ctx: ShellCtx) => Promise<T>): Promise<T> {
  const deps = c.get('deps')
  const s = c.get('serverIndex')
  const session = c.get('session')
  const login = session.servers[String(s)]!
  login.cache ??= {}
  const executed = c.get('executed')
  const conn = await deps.pools.acquire(session.id, s, c.get('creds'), executed)
  let control: ShellCtx['control'] = null
  try {
    control = await controlConnections(deps).acquire(s, executed)
    return await fn({
      cfg: deps.cfg,
      server: getServer(deps.cfg, s)!,
      serverIndex: s,
      username: login.user,
      conn,
      control,
      cache: login.cache,
    })
  } finally {
    conn.raw.release()
    control?.raw.release()
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
  const parsed = SetCollationRequest.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new ValidationError('Invalid request.')
  const login = c.get('session').servers[String(c.get('serverIndex'))]!
  login.collation = parsed.data.collation_connection
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
  const parsed = ChangePasswordRequest.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new ValidationError('Invalid request.')
  const result = await withShell(c, (ctx) => changePassword(ctx, parsed.data))
  // AuthenticationCookie::handlePasswordChange: keep the session logged in with the new password
  const deps = c.get('deps')
  const login = c.get('session').servers[String(c.get('serverIndex'))]!
  login.credEnc = deps.credBox.encrypt(JSON.stringify({ password: result.password }))
  await deps.pools.dropSession(c.get('session').id, c.get('serverIndex'))
  return c.json({ ok: result.ok, message: result.message, sql: result.sql })
})
