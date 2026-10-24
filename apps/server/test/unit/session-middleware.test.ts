import { describe, expect, it } from 'vitest'
import { newSession } from '../../src/session/manager.ts'
import { testApp } from '../support/app.ts'

/** The session middleware merges a request's changes over the stored session (app.ts). */
describe('session middleware', () => {
  async function seeded() {
    const t = testApp()
    const s = newSession(1)
    s.servers = { '1': { user: 'u', cred: 'sealed' } as never }
    s.lastSeenAt = 1
    await t.deps.store.set(s)
    return { t, s, cookie: `bma_sid=${s.id}` }
  }

  it('keeps the inactivity logout: the logins are gone from the stored session', async () => {
    const { t, s, cookie } = await seeded()
    await t.app.request('/api/auth/state', { headers: { cookie } })
    const stored = await t.deps.store.get(s.id)
    expect(stored?.servers).toEqual({})
    expect(stored?.expired).toBe(true)
  })
})
