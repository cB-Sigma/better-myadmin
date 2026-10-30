import { createHash } from 'node:crypto'
import type { Translator } from '@bettermyadmin/i18n'
import type { Context } from 'hono'
import type { AppDeps } from '../app.ts'
import { readBasicCredentials } from '../auth/http.ts'
import { checkRules, requestClientIp } from '../auth/login.ts'
import { loginRateLimiter } from '../auth/rate-limit.ts'
import { loadAgentCredentials, signonPageFile } from '../auth/signon-page.ts'
import { getServer } from '../config.ts'
import type { Conn } from '../db/connection.ts'
import { AuthRequiredError, BmaError, NotFoundError, isMysqlError } from '../http/errors.ts'
import type { AgentCtx } from './service.ts'

/**
 * Who an agent API request is (docs/features/16-agent-api.md): every request carries its own
 * credentials, there is no session and so no CSRF token.
 *
 *   config   the configured user
 *   cookie   HTTP Basic (the MySQL user and password, as typed in the login form)
 *   http     HTTP Basic
 *   signon   the SignonPage module's `agentCredentials(request)` (e.g. a single sign-on proxy's
 *            header); without that export, none
 *
 * The credentials pass the login rules (AllowDeny, AllowRoot, AllowNoPassword) and the failed-login
 * limiter like a login, then connect: the MySQL user's privileges decide the rest.
 */

/** A 401 that asks for HTTP Basic credentials (auth_type cookie / http). */
export class AgentAuthRequired extends AuthRequiredError {
  readonly basic: boolean
  constructor(message: string, basic: boolean) {
    super(message)
    this.basic = basic
  }
}

/** The pool of a credential set: its own (session-less) pool key, never one of a login session. */
export function agentPoolId(serverIndex: number, user: string, password: string): string {
  return `agent:${createHash('sha256').update(`${serverIndex}\u0000${user}\u0000${password}`).digest('hex')}`
}

const ACCESS_DENIED = new Set([1044, 1045, 1698])

/**
 * Cross-site requests are refused: a browser sends HTTP Basic credentials and a sign-on proxy's
 * cookie on its own, so a POST must be JSON (a form cannot send it without a CORS preflight, which
 * is never granted) and a request from a page of another origin is turned away.
 */
export function checkAgentRequest(c: Context): void {
  const origin = c.req.header('Origin')
  if (origin !== undefined && origin !== 'null') {
    let host = ''
    try {
      host = new URL(origin).host
    } catch {}
    if (host !== (c.req.header('Host') ?? new URL(c.req.url).host))
      throw new BmaError('FORBIDDEN', 'Cross-origin requests are not allowed.', 403)
  } else if (origin === 'null') {
    throw new BmaError('FORBIDDEN', 'Cross-origin requests are not allowed.', 403)
  }
  if (c.req.method === 'POST' && !/^application\/json\b/i.test(c.req.header('Content-Type') ?? ''))
    throw new BmaError('VALIDATION', 'The request body must be JSON (Content-Type: application/json).', 415)
}

/** Authenticates the request for server `serverIndex` and runs `fn` on its connection. */
export async function withAgent<T>(
  c: Context,
  deps: AppDeps,
  serverIndex: number,
  tr: Translator,
  fn: (ctx: AgentCtx) => Promise<T>,
): Promise<T> {
  const { cfg, pools } = deps
  if (!cfg.AgentApi) throw new NotFoundError('The agent API is not enabled (AgentApi).')
  const server = getServer(cfg, serverIndex)
  if (server === undefined) throw new NotFoundError(`Unknown server ${serverIndex}.`)
  checkAgentRequest(c)

  let creds: { user: string; password: string } | null = null
  const basic = server.auth_type === 'cookie' || server.auth_type === 'http'
  if (server.auth_type === 'config') {
    creds = { user: server.user, password: server.password }
  } else if (basic) {
    creds = readBasicCredentials(c.req.header('Authorization'))
  } else if (server.auth_type === 'signon' && server.SignonPage !== '') {
    const hook = await loadAgentCredentials(signonPageFile(server))
    if (hook !== null)
      creds = await hook(c.req.raw, {
        server: { index: serverIndex, config: server },
        clientIp: requestClientIp(c, cfg.TrustedProxies) || '',
      })
  }
  if (creds === null || creds.user === '')
    throw new AgentAuthRequired(
      basic
        ? 'Authentication required: send the MySQL user and password with HTTP Basic.'
        : server.auth_type === 'signon'
          ? 'Authentication required: the sign-on module found no credentials in this request.'
          : 'Authentication required.',
      basic,
    )

  const ip = requestClientIp(c, cfg.TrustedProxies)
  const limiter = loginRateLimiter(cfg)
  const locked = limiter.lockedMessage(ip, creds.user, tr)
  if (locked !== null) throw new BmaError('FORBIDDEN', locked, 429)
  checkRules(server, creds.user, creds.password, ip, tr)

  let conn: Conn
  try {
    conn = await pools.acquire(agentPoolId(serverIndex, creds.user, creds.password), serverIndex, creds, [])
  } catch (e) {
    if (isMysqlError(e) && e.errno !== undefined && ACCESS_DENIED.has(e.errno)) {
      limiter.failed(ip, creds.user)
      throw new AgentAuthRequired(tr.gettext('Cannot log in to the MySQL server'), basic)
    }
    throw e
  }
  limiter.succeeded(ip, creds.user)
  try {
    return await fn({ cfg, server, serverIndex, conn, tr })
  } finally {
    conn.raw.release()
  }
}
