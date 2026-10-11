import { sprintf } from '@bettermyadmin/i18n'
import { Hono, type MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app.ts'
import { AuthMessages } from '../auth/cookie.ts'
import { getServer } from '../config.ts'
import type { Credentials } from '../db/pool-manager.ts'
import { AuthExpiredError, AuthRequiredError, NotFoundError } from '../http/errors.ts'
import { consoleRoutes } from './console.ts'
import { insertEditRoutes } from './insert-edit.ts'
import { metadataRoutes } from './metadata.ts'
import { navigationRoutes } from './navigation.ts'
import { queryRoutes } from './query.ts'
import { serverAdminRoutes } from './server-admin.ts'
import { shellRoutes } from './shell.ts'
import { sqlRoutes } from './sql.ts'
import { tableStructureRoutes } from './table-structure.ts'

export type ServerEnv = AppEnv & {
  Variables: AppEnv['Variables'] & { serverIndex: number; creds: Credentials }
}

export const serverRoutes = new Hono<ServerEnv>()

/** Resolves `:s` → configured server + the session's decrypted credentials for it. */
const resolveServer: MiddlewareHandler<ServerEnv> = async (c, next) => {
  const { cfg, credBox } = c.get('deps')
  const s = Number(c.req.param('s'))
  if (!Number.isInteger(s) || getServer(cfg, s) === undefined)
    throw new NotFoundError('Invalid server index!')
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
  const plain = credBox.decrypt(login.credEnc)
  if (plain === null) throw new AuthRequiredError()
  const { password } = JSON.parse(plain) as { password: string }
  const creds: Credentials = { user: login.user, password }
  if (login.host !== undefined) creds.host = login.host
  if (login.port !== undefined) creds.port = login.port
  session.currentServer = s
  c.set('serverIndex', s)
  if (login.collation !== undefined) creds.collation = login.collation
  c.set('creds', creds)
  await next()
}
serverRoutes.use('/:s', resolveServer)
serverRoutes.use('/:s/*', resolveServer)

serverRoutes.route('/:s/query', queryRoutes)
serverRoutes.route('/:s/navigation', navigationRoutes)
serverRoutes.route('/:s/sql', sqlRoutes)
serverRoutes.route('/:s/console', consoleRoutes)
serverRoutes.route('/:s', metadataRoutes)
serverRoutes.route('/:s', shellRoutes)
serverRoutes.route('/:s/databases', tableStructureRoutes)
serverRoutes.route('/:s/databases', insertEditRoutes)
serverRoutes.route('/:s', serverAdminRoutes)
