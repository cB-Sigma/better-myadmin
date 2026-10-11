import { sprintf } from '@bettermyadmin/i18n'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app.ts'
import { AuthMessages } from '../auth/cookie.ts'
import { getServer } from '../config.ts'
import type { AppConfig } from '../config.ts'
import type { Credentials } from '../db/pool-manager.ts'
import { AuthExpiredError, AuthRequiredError, NotFoundError } from '../http/errors.ts'
import { withMeta } from '../metadata/service.ts'
import type { SecretBox } from '../session/crypto.ts'
import type { ServerLogin } from '../session/store.ts'
import { browseRoutes } from './browse.ts'
import { consoleRoutes } from './console.ts'
import { databaseRoutes } from './database.ts'
import { exportRoutes } from './export.ts'
import { importRoutes } from './import.ts'
import { insertEditRoutes } from './insert-edit.ts'
import { metadataRoutes } from './metadata.ts'
import { navigationRoutes } from './navigation.ts'
import { preferencesRoutes } from './preferences.ts'
import { queryRoutes } from './query.ts'
import { serverAdminRoutes } from './server-admin.ts'
import { shellRoutes } from './shell.ts'
import { sqlRoutes } from './sql.ts'
import { tableLevelRoutes } from './table-level.ts'
import { tableStructureRoutes } from './table-structure.ts'

export type ServerEnv = AppEnv & {
  Variables: AppEnv['Variables'] & {
    serverIndex: number
    creds: Credentials
    /**
     * Config::$baseSettings: the configuration without user preferences. `deps.cfg` of a server
     * request is Config::$settings, the user's preferences of that server applied.
     */
    baseCfg: AppConfig
  }
}

export const serverRoutes = new Hono<ServerEnv>()

/** Resolves `:s` → configured server + the session's decrypted credentials for it. */
const resolveServer: MiddlewareHandler<ServerEnv> = async (c, next) => {
  const { cfg, credBox } = c.get('deps')
  const s = Number(c.req.param('s'))
  if (!Number.isInteger(s) || getServer(cfg, s) === undefined)
    throw new NotFoundError(c.get('tr').gettext('Invalid server index!'))
  const session = c.get('session')
  const login = session.servers[String(s)]
  if (login === undefined || !login.twoFactorOk) {
    if (session.expired === true) {
      throw new AuthExpiredError(
        sprintf(c.get('tr').gettext(AuthMessages.noActivity), String(cfg.LoginCookieValidity)),
      )
    }
    throw new AuthRequiredError()
  }
  const creds = loginCredentials(credBox, login)
  if (creds === null) throw new AuthRequiredError()
  session.currentServer = s
  c.set('serverIndex', s)
  c.set('creds', creds)
  await applyUserPreferences(c)
  await next()
}

/**
 * UserPreferencesHandler::loadUserPreferences for the request: every handler below reads the
 * configuration with the user's preferences (cached per session and server).
 */
async function applyUserPreferences(c: Context<ServerEnv>): Promise<void> {
  if (c.get('baseCfg') !== undefined) return
  const deps = c.get('deps')
  c.set('baseCfg', deps.cfg)
  try {
    const effective = await withMeta(c, {}, (m) => m.effectiveConfig())
    if (effective !== deps.cfg) c.set('deps', { ...deps, cfg: effective })
  } catch {
    // the preferences cannot be read (storage unreachable): the configuration alone
  }
}

/** The decrypted credentials of a server login (null when the ciphertext is stale). */
export function loginCredentials(credBox: SecretBox, login: ServerLogin): Credentials | null {
  const plain = credBox.decrypt(login.credEnc)
  if (plain === null) return null
  const { password } = JSON.parse(plain) as { password: string }
  const creds: Credentials = { user: login.user, password }
  if (login.host !== undefined) creds.host = login.host
  if (login.port !== undefined) creds.port = login.port
  if (login.collation !== undefined) creds.collation = login.collation
  return creds
}

/**
 * Runs `fn` with this request bound to a server login like resolveServer does (for the routes
 * outside /servers/:s that read the user's preferences: login, config-public).
 */
export async function asServerRequest<T>(
  c: Context<AppEnv>,
  server: number,
  creds: Credentials,
  fn: (c: Context<ServerEnv>) => Promise<T>,
): Promise<T> {
  const sc = c as unknown as Context<ServerEnv>
  sc.set('serverIndex', server)
  sc.set('creds', creds)
  return fn(sc)
}
serverRoutes.use('/:s', resolveServer)
serverRoutes.use('/:s/*', resolveServer)

serverRoutes.route('/:s/query', queryRoutes)
serverRoutes.route('/:s/browse', browseRoutes)
serverRoutes.route('/:s/navigation', navigationRoutes)
serverRoutes.route('/:s/sql', sqlRoutes)
serverRoutes.route('/:s/console', consoleRoutes)
serverRoutes.route('/:s/export', exportRoutes)
serverRoutes.route('/:s/import', importRoutes)
serverRoutes.route('/:s/preferences', preferencesRoutes)
serverRoutes.route('/:s', metadataRoutes)
serverRoutes.route('/:s', shellRoutes)
serverRoutes.route('/:s/databases', tableStructureRoutes)
serverRoutes.route('/:s/databases', tableLevelRoutes)
serverRoutes.route('/:s/databases', databaseRoutes)
serverRoutes.route('/:s/databases', insertEditRoutes)
serverRoutes.route('/:s', serverAdminRoutes)
