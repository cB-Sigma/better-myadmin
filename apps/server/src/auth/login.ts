import type { Gettext } from '@bettermyadmin/i18n'
import type { Context } from 'hono'
import type { ServerConfig } from '../config.ts'
import type { Credentials, PoolManager } from '../db/pool-manager.ts'
import { isMysqlError } from '../http/errors.ts'
import { AuthMessages, LoginFailure, connectionErrorMessage } from './failure.ts'
import { getClientIp, isForbiddenByRules } from './ip-allow-deny.ts'

/**
 * The steps every auth type shares once it has read credentials: the configured rules, then the
 * connection to the server.
 * pma: src/Plugins/AuthenticationPlugin.php::authenticate, ::checkRules,
 *      src/Http/Middleware/Authentication.php (connect → showFailure(deniedByDatabaseServer))
 */

/** pma: AuthenticationPlugin::checkRules (AllowDeny, AllowRoot, AllowNoPassword) */
export function checkRules(
  server: ServerConfig,
  user: string,
  password: string,
  remoteIp: string | false,
  tr: Gettext,
): void {
  if (server.AllowDeny.order !== '') {
    const forbidden = isForbiddenByRules(server.AllowDeny.order, {
      remoteIp,
      username: user,
      rules: server.AllowDeny.rules,
      serverAddr: process.env.SERVER_ADDR ?? '',
    })
    if (forbidden) throw new LoginFailure('allow-denied', tr.gettext(AuthMessages.allowDenied))
  }
  if (!server.AllowRoot && user === 'root')
    throw new LoginFailure('root-denied', tr.gettext(AuthMessages.rootDenied))
  if (!server.AllowNoPassword && password === '')
    throw new LoginFailure('empty-denied', tr.gettext(AuthMessages.emptyDenied))
}

/** DatabaseInterface::connect for the login: the connection error becomes a server-denied failure. */
export async function connectLogin(
  pools: PoolManager,
  serverIndex: number,
  creds: Credentials,
  tr: Gettext,
): Promise<void> {
  const server = pools.server(serverIndex)
  try {
    await pools.probe(serverIndex, creds)
  } catch (e) {
    const errno = isMysqlError(e) ? e.errno : connectionErrno(e)
    throw new LoginFailure(
      'server-denied',
      connectionErrorMessage(e, server.hide_connection_errors, tr),
      errno,
    )
  }
}

/** The mysqli error number of a network failure (2003 refused/unreachable, 2002 host/socket). */
function connectionErrno(e: unknown): number | undefined {
  const code = (e as { code?: string }).code
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH') return 2003
  if (code === 'ENOTFOUND' || code === 'ENOENT' || code === 'EAI_AGAIN') return 2002
  return undefined
}

/** Core::getIp: Node's socket address, a forwarded header only from TrustedProxies. */
export function requestClientIp(
  // biome-ignore lint/suspicious/noExplicitAny: any route context
  c: Context<any, any, any>,
  trustedProxies: Record<string, string>,
): string | false {
  const remote = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
    ?.socket?.remoteAddress
  return getClientIp(remote?.replace(/^::ffff:/, ''), trustedProxies, (n) => c.req.header(n))
}
