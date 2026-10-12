import { sprintf } from '@bettermyadmin/i18n'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app.ts'
import { configLogin } from '../auth/config.ts'
import { AuthMessages, LoginFailure } from '../auth/failure.ts'
import { loginCredentials } from '../auth/session-login.ts'
import { getServer } from '../config.ts'
import type { AppConfig } from '../config.ts'
import type { Credentials } from '../db/pool-manager.ts'
import { AuthExpiredError, AuthRequiredError, NotFoundError } from '../http/errors.ts'
import { withMeta } from '../metadata/service.ts'
import type { SecretBox } from '../session/crypto.ts'
import type { ServerLogin } from '../session/store.ts'
import { aboutRoutes } from './about.ts'
import { browseRoutes } from './browse.ts'
import { consoleRoutes } from './console.ts'
import { databaseRoutes } from './database.ts'
import { exportRoutes } from './export.ts'
import { importRoutes } from './import.ts'
import { insertEditRoutes } from './insert-edit.ts'
import { metadataRoutes } from './metadata.ts'
import { nameListRoutes } from './name-lists.ts'
import { navigationRoutes } from './navigation.ts'
import { preferencesRoutes } from './preferences.ts'
import { privilegesRoutes } from './privileges.ts'
import { queryRoutes } from './query.ts'
import { serverAdminRoutes } from './server-admin.ts'
import { shellRoutes } from './shell.ts'
import { sqlRoutes } from './sql.ts'
import { tableLevelRoutes } from './table-level.ts'
import { tableStructureRoutes } from './table-structure.ts'
import { serverVisualizationRoutes } from './table-visualization.ts'

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
  let login = session.servers[String(s)]
  // AuthenticationConfig: a config server logs in with the configured credentials
  if (login === undefined && getServer(cfg, s)?.auth_type === 'config') {
    try {
      login = await configLogin(c as unknown as Context<AppEnv>, s)
    } catch (e) {
      if (!(e instanceof LoginFailure)) throw e
      session.currentServer = s
      throw new AuthRequiredError()
    }
  }
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

export { asServerRequest, loginCredentials } from '../auth/session-login.ts'

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
serverRoutes.route('/:s/visualization', serverVisualizationRoutes)
serverRoutes.route('/:s/about', aboutRoutes)
serverRoutes.route('/:s', metadataRoutes)
serverRoutes.route('/:s', shellRoutes)
serverRoutes.route('/:s/databases', tableStructureRoutes)
serverRoutes.route('/:s/databases', tableLevelRoutes)
serverRoutes.route('/:s/databases', databaseRoutes)
serverRoutes.route('/:s/databases', insertEditRoutes)
serverRoutes.route('/:s', serverAdminRoutes)
serverRoutes.route('/:s', privilegesRoutes)
serverRoutes.route('/:s', nameListRoutes)
