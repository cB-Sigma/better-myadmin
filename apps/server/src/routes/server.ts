import { Hono } from 'hono'
import type { AppEnv } from '../app.ts'
import { AuthMessages } from '../auth/cookie.ts'
import { getServer } from '../config.ts'
import type { Credentials } from '../db/pool-manager.ts'
import { AuthExpiredError, AuthRequiredError, NotFoundError } from '../http/errors.ts'
import { queryRoutes } from './query.ts'

export type ServerEnv = AppEnv & { Variables: AppEnv['Variables'] & { serverIndex: number; creds: Credentials } }

export const serverRoutes = new Hono<ServerEnv>()

/** Resolves `:s` → configured server + the session's decrypted credentials for it. */
serverRoutes.use('/:s/*', async (c, next) => {
  const { cfg, credBox } = c.get('deps')
  const s = Number(c.req.param('s'))
  if (!Number.isInteger(s) || getServer(cfg, s) === undefined) throw new NotFoundError('Invalid server index!')
  const session = c.get('session')
  const login = session.servers[String(s)]
  if (login === undefined || !login.twoFactorOk) {
    if (session.expired === true) {
      throw new AuthExpiredError(AuthMessages.noActivity.replace('%s', String(cfg.LoginCookieValidity)))
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
  c.set('creds', creds)
  await next()
})

serverRoutes.route('/:s/query', queryRoutes)
