import type { Context } from 'hono'
import type { AppEnv } from '../app.ts'
import type { Credentials } from '../db/pool-manager.ts'
import { forgetServerMetadata, withMeta } from '../metadata/service.ts'
import { prefsCtx, twoFactorCtx } from '../preferences/service.ts'
import { TwoFactor } from '../preferences/two-factor.ts'
import type { ServerEnv } from '../routes/server.ts'
import type { SecretBox } from '../session/crypto.ts'
import { regenerate } from '../session/manager.ts'
import type { ServerLogin } from '../session/store.ts'

/** The decrypted credentials of a server login (null when the ciphertext is stale). */
export function loginCredentials(credBox: SecretBox, login: ServerLogin): Credentials | null {
  const plain = credBox.decrypt(login.credEnc)
  if (plain === null) return null
  const { password } = JSON.parse(plain) as { password: string }
  const creds: Credentials = { user: login.user, password }
  if (login.host !== undefined) creds.host = login.host
  if (login.port !== undefined) creds.port = login.port
  if (login.collation !== undefined) creds.collation = login.collation
  if (login.cfgUpdate !== undefined) creds.overrides = login.cfgUpdate
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

/**
 * The login's TwoFactor (user preferences of that server). `fallback` when the preferences cannot
 * be read (no reachable server or storage).
 */
export async function withTwoFactor<T>(
  c: Context<AppEnv>,
  server: number,
  login: ServerLogin,
  fn: (tf: TwoFactor) => Promise<T>,
  fallback: T,
): Promise<T> {
  const creds = loginCredentials(c.get('deps').credBox, login)
  if (creds === null) return fallback
  try {
    return await asServerRequest(c, server, creds, (sc) =>
      withMeta(sc, {}, async (m) => {
        const ctx = await prefsCtx(m)
        return fn(await TwoFactor.create(ctx.prefs, twoFactorCtx(ctx)))
      }),
    )
  } catch {
    return fallback
  }
}

/**
 * AuthenticationPlugin::storeCredentials + checkTwoFactor: keeps the verified credentials in the
 * session for that server. `secure`: Session::secure() (a new session id and token, cookie auth's
 * readCredentials on a form login); the logins on other servers are kept.
 */
// biome-ignore lint/suspicious/noExplicitAny: any route context
export async function storeLogin(
  c: Context<any, any, any>,
  server: number,
  creds: Credentials,
  opts: { secure: boolean },
): Promise<ServerLogin> {
  const ac = c as Context<AppEnv>
  const { credBox, store } = ac.get('deps')
  const session = opts.secure ? regenerate(store, ac.get('session'), server) : ac.get('session')
  session.currentServer = server
  const login: ServerLogin = {
    user: creds.user,
    credEnc: credBox.encrypt(JSON.stringify({ password: creds.password })),
    twoFactorOk: false,
    ...(creds.host !== undefined ? { host: creds.host } : {}),
    ...(creds.port !== undefined ? { port: creds.port } : {}),
    ...(creds.overrides !== undefined ? { cfgUpdate: creds.overrides } : {}),
  }
  session.servers[String(server)] = login
  delete session.expired
  forgetServerMetadata(session, server)
  ac.set('session', session)
  // AuthenticationPlugin::checkTwoFactor: the configured backend's check (none passes)
  login.twoFactorOk = await withTwoFactor(ac, server, login, (tf) => tf.check({}), true)
  return login
}
