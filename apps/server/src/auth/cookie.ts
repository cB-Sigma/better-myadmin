import type { AppConfig } from '../config.ts'
import type { Credentials, PoolManager } from '../db/pool-manager.ts'
import { BmaError, isMysqlError } from '../http/errors.ts'
import { phpRegex } from '../util/php-regex.ts'
import { isForbiddenByRules } from './ip-allow-deny.ts'

/** Failure kinds and texts. pma: src/Exceptions/AuthenticationFailure.php */
export const AuthMessages = {
  serverDenied: 'Cannot log in to the database server.',
  allowDenied: 'Access denied!',
  rootDenied: 'Access denied!',
  emptyDenied: 'Login without a password is forbidden by configuration (see AllowNoPassword).',
  noActivity:
    'You have been automatically logged out due to inactivity of %s seconds. Once you log in again, you should be able to resume the work where you left off.',
  sessionExpired: 'Your session has expired. Please log in again.',
  passwordTooLong:
    'Your password is too long. To prevent denial-of-service attacks, phpMyAdmin restricts passwords to less than 2000 characters.',
  arbitraryNotAllowed: 'You are not allowed to log in to this MySQL server!',
  hiddenConnectionError:
    "Error 1045: Access denied for user. Additional error information may be available, but is being hidden by the $cfg['Servers'][$i]['hide_connection_errors'] configuration directive.",
} as const

export class LoginFailure extends BmaError {
  readonly failureType: 'server-denied' | 'allow-denied' | 'root-denied' | 'empty-denied' | 'form'
  constructor(failureType: LoginFailure['failureType'], message: string) {
    super('FORBIDDEN', message, 403)
    this.failureType = failureType
  }
}

/** Core::sanitizeMySQLUser — cut at the first NUL byte. */
export function sanitizeMySQLUser(name: string): string {
  const i = name.indexOf('\0')
  return i === -1 ? name : name.slice(0, i)
}

/** Core::sanitizeMySQLHost — strip leading `p:` (persistent) prefixes. */
export function sanitizeMySQLHost(name: string): string {
  let n = name
  while (n.toLowerCase().startsWith('p:')) n = n.slice(2)
  return n
}

export interface LoginInput {
  serverIndex: number
  username: string
  password: string
  arbitraryServer?: string | undefined
  remoteIp: string | false
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
  const user = sanitizeMySQLUser(input.username)
  if (Buffer.byteLength(input.password, 'utf8') >= 2000) {
    throw new LoginFailure('form', AuthMessages.passwordTooLong)
  }

  const creds: Credentials = { user, password: input.password }

  if (cfg.AllowArbitraryServer && input.arbitraryServer !== undefined) {
    if (cfg.ArbitraryServerRegexp !== '') {
      const parts = input.arbitraryServer.split(' ')
      const tmpHost = parts.length === 2 ? parts[0]! : input.arbitraryServer
      const re = phpRegex(cfg.ArbitraryServerRegexp)
      if (re === null || !re.test(tmpHost)) throw new LoginFailure('form', AuthMessages.arbitraryNotAllowed)
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

  // checkRules
  if (server.AllowDeny.order !== '') {
    const forbidden = isForbiddenByRules(server.AllowDeny.order, {
      remoteIp: input.remoteIp,
      username: user,
      rules: server.AllowDeny.rules,
      serverAddr: process.env.SERVER_ADDR ?? '',
    })
    if (forbidden) throw new LoginFailure('allow-denied', AuthMessages.allowDenied)
  }
  if (!server.AllowRoot && user === 'root') throw new LoginFailure('root-denied', AuthMessages.rootDenied)
  if (!server.AllowNoPassword && creds.password === '') {
    throw new LoginFailure('empty-denied', AuthMessages.emptyDenied)
  }

  try {
    await pools.probe(input.serverIndex, creds)
  } catch (e) {
    throw new LoginFailure('server-denied', connectionErrorMessage(e, server.hide_connection_errors))
  }
  return creds
}

/** pma: src/Dbal/DbiMysqli.php::connect (ConnectionException message) */
export function connectionErrorMessage(e: unknown, hideConnectionErrors: boolean): string {
  if (isMysqlError(e)) {
    if (e.errno === 1045 && hideConnectionErrors) return AuthMessages.hiddenConnectionError
    return `${e.errno}: ${e.sqlMessage ?? e.message}`
  }
  const err = e as { code?: string; message?: string }
  // Network errors have no MySQL errno; mysqli reports 2002 (socket/host) or 2003 (refused/unreachable).
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'EHOSTUNREACH') {
    return `2003: ${err.message ?? ''}`
  }
  if (err.code === 'ENOTFOUND' || err.code === 'ENOENT' || err.code === 'EAI_AGAIN') {
    return `2002: ${err.message ?? ''}`
  }
  return AuthMessages.serverDenied
}
