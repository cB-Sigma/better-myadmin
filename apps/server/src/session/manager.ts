import { randomToken } from './crypto.ts'
import type { SessionData, SessionStore } from './store.ts'

export const nowSeconds = () => Math.floor(Date.now() / 1000)

export function newSession(currentServer: number): SessionData {
  const t = nowSeconds()
  return {
    id: randomToken(32),
    createdAt: t,
    lastSeenAt: t,
    csrfToken: randomToken(24),
    hmacSecret: randomToken(32),
    currentServer,
    servers: {},
  }
}

/**
 * Session::secure(): a new id and a new CSRF token, carrying nothing over except what the caller copies.
 * pma: src/Session.php::secure
 */
export function regenerate(store: SessionStore, old: SessionData | null, currentServer: number): SessionData {
  if (old !== null) store.delete(old.id)
  const s = newSession(currentServer)
  if (old !== null) s.servers = old.servers
  return s
}
