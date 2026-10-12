import type { ConfigAuthFailure } from '@bettermyadmin/contracts'
import type { Gettext } from '@bettermyadmin/i18n'
import type { Context } from 'hono'
import type { AppEnv } from '../app.ts'
import { getServer } from '../config.ts'
import type { Credentials } from '../db/pool-manager.ts'
import type { ServerLogin } from '../session/store.ts'
import { logUser } from './auth-log.ts'
import { LoginFailure } from './failure.ts'
import { checkRules, connectLogin, requestClientIp } from './login.ts'
import { storeLogin } from './session-login.ts'

/**
 * `auth_type = 'config'`: the configured user and password log in without a form. The
 * `BMA_USER` / `BMA_PASSWORD` variables are only the `Servers[1].user` / `.password` directives
 * (packages/config/src/env.ts); nothing else logs in automatically.
 * pma: src/Plugins/Auth/AuthenticationConfig.php::readCredentials
 */
export async function configLogin(c: Context<AppEnv>, server: number): Promise<ServerLogin> {
  const { pools } = c.get('deps')
  const cfg = c.get('deps').cfg
  const s = getServer(cfg, server)
  if (s === undefined) throw new Error(`Unknown server ${server}`)
  const tr = c.get('tr')
  const creds: Credentials = { user: s.user, password: s.password }
  const ip = requestClientIp(c, cfg.TrustedProxies)
  try {
    checkRules(s, creds.user, creds.password, ip, tr)
    await connectLogin(pools, server, creds, tr)
  } catch (e) {
    if (e instanceof LoginFailure) logUser(cfg, creds.user, e.failureType, ip)
    throw e
  }
  return storeLogin(c, server, creds, { secure: false })
}

const TRIED_TO_CONNECT =
  'phpMyAdmin tried to connect to the MySQL server, and the server rejected the connection. You should check the host, username and password in your configuration and make sure that they correspond to the information given by the administrator of the MySQL server.'

/**
 * AuthenticationConfig::showFailure: the allow/deny notice, or the connection error (added by
 * DatabaseInterface::connect) then the setup hint (no configuration file) or the "rejected the
 * connection" error (unless the server did not respond, 2002 / 2003).
 */
export function configFailure(e: LoginFailure, hasConfigFile: boolean, tr: Gettext): ConfigAuthFailure {
  if (e.failureType === 'allow-denied') return { notice: e.message, noConfigFile: false, errors: [] }
  const errors = e.failureType === 'server-denied' ? [e.message] : []
  const noConfigFile = !hasConfigFile
  if (hasConfigFile && e.errno !== 2002 && e.errno !== 2003) errors.push(tr.gettext(TRIED_TO_CONNECT))
  return { notice: null, noConfigFile, errors }
}
