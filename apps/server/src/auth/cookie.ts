import { type Gettext, englishTranslator } from '@bettermyadmin/i18n'
import type { AppConfig } from '../config.ts'
import type { Credentials, PoolManager } from '../db/pool-manager.ts'
import { phpRegex } from '../util/php-regex.ts'
import { AuthMessages, LoginFailure, sanitizeMySQLHost, sanitizeMySQLUser } from './failure.ts'
import { checkRules, connectLogin } from './login.ts'

export {
  AuthMessages,
  LoginFailure,
  connectionErrorMessage,
  sanitizeMySQLHost,
  sanitizeMySQLUser,
} from './failure.ts'

const english = englishTranslator()

export interface LoginInput {
  serverIndex: number
  username: string
  password: string
  arbitraryServer?: string | undefined
  remoteIp: string | false
  /** The request language (messages are translated like phpMyAdmin's). */
  tr?: Gettext | undefined
}

/**
 * Cookie auth login: readCredentials → storeCredentials → checkRules → connect.
 * pma: src/Plugins/Auth/AuthenticationCookie.php::readCredentials/storeCredentials,
 *      src/Plugins/AuthenticationPlugin.php::checkRules, src/Http/Middleware/Authentication.php
 */
export async function cookieLogin(
  cfg: AppConfig,
  pools: PoolManager,
  input: LoginInput,
): Promise<Credentials> {
  const server = pools.server(input.serverIndex)
  const tr = input.tr ?? english
  const user = sanitizeMySQLUser(input.username)
  if (Buffer.byteLength(input.password, 'utf8') >= 2000) {
    throw new LoginFailure('form', tr.gettext(AuthMessages.passwordTooLong))
  }

  const creds: Credentials = { user, password: input.password }

  if (cfg.AllowArbitraryServer && input.arbitraryServer !== undefined) {
    if (cfg.ArbitraryServerRegexp !== '') {
      const parts = input.arbitraryServer.split(' ')
      const tmpHost = parts.length === 2 ? parts[0]! : input.arbitraryServer
      const re = phpRegex(cfg.ArbitraryServerRegexp)
      if (re === null || !re.test(tmpHost))
        throw new LoginFailure('form', tr.gettext(AuthMessages.arbitraryNotAllowed))
    }
    const authServer = sanitizeMySQLHost(input.arbitraryServer)
    if (authServer !== '') {
      const parts = authServer.split(' ')
      const [tmpHost, tmpPort] = parts.length === 2 ? [parts[0]!, parts[1]!] : [authServer, '']
      if (server.host !== authServer) {
        creds.host = tmpHost
        if (tmpPort !== '') creds.port = Number(tmpPort)
      }
    }
  }

  checkRules(server, user, creds.password, input.remoteIp, tr)
  await connectLogin(pools, input.serverIndex, creds, tr)
  return creds
}

