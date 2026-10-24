import { createClient } from 'redis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type RedisSessionStore, connectRedisStore } from '../../src/session/store.ts'
import { testApp, testConfig } from '../support/app.ts'

/**
 * `SessionStore: 'redis'`: the sessions in Redis, shared by several BetterMyAdmin processes.
 * Needs a Redis server: BMA_TEST_REDIS_URL (default redis://:s3cret@127.0.0.1:6379/5, the dev compose
 * file's); skipped when none answers.
 */
const URL = process.env.BMA_TEST_REDIS_URL ?? 'redis://:s3cret@127.0.0.1:6379/5'

async function reachable(): Promise<boolean> {
  const c = createClient({ url: URL, socket: { connectTimeout: 1000, reconnectStrategy: false } })
  c.on('error', () => {})
  try {
    await c.connect()
    await c.ping()
    await c.close()
    return true
  } catch {
    return false
  }
}
const available = await reachable()

describe.skipIf(!available)('SessionStore: redis', () => {
  let store: RedisSessionStore
  let raw: ReturnType<typeof createClient>
  const key = (sid: string) => `bettermyadmin:session:${sid}`
  beforeAll(async () => {
    store = await connectRedisStore(URL, 120)
    raw = createClient({ url: URL })
    await raw.connect()
  })
  afterAll(async () => {
    await store?.close()
    await raw?.close()
  })

  it('stores a session under its key with the TTL, renews it on every request, deletes it', async () => {
    const t = testApp(testConfig(), store)
    await t.req('GET', '/api/auth/state')
    const sid = t.jar.get('bma_sid')!
    expect((await store.get(sid))?.id).toBe(sid)
    const ttl = await raw.ttl(key(sid))
    expect(ttl).toBeGreaterThan(100)
    expect(ttl).toBeLessThanOrEqual(120)
    await raw.expire(key(sid), 5)
    await t.req('GET', '/api/auth/state')
    expect(await raw.ttl(key(sid))).toBeGreaterThan(100)
    await store.delete(sid)
    expect(await store.get(sid)).toBeNull()
    await t.close()
  })

  it('two processes share the logins: a session made by one is used by the other', async () => {
    const cfg = testConfig()
    const a = testApp(cfg, store)
    const b = testApp(cfg, store)
    await a.login()
    expect((await a.req('GET', '/api/auth/state')).json.authenticated).toBe(true)
    for (const [k, v] of a.jar) b.jar.set(k, v)
    expect((await b.req('GET', '/api/auth/state')).json.authenticated).toBe(true)
    // logging out through one ends the session for both
    await b.req('POST', '/api/auth/logout')
    expect((await a.req('GET', '/api/auth/state')).json.authenticated).toBe(false)
    await a.close()
    await b.close()
  })

  it('refuses to start without RedisUrl or with credentials the server rejects', async () => {
    await expect(connectRedisStore('', 60)).rejects.toThrow('RedisUrl is empty')
    // fails fast with the server's reason, the password hidden
    const err = await connectRedisStore('redis://:wrong@127.0.0.1:6379/5', 60).catch((e: Error) => e)
    expect(String(err)).toMatch(
      /cannot use Redis at redis:\/\/:\*\*\*@127\.0\.0\.1:6379\/5: .*(WRONGPASS|invalid)/i,
    )
    const down = await connectRedisStore('redis://127.0.0.1:1/0', 60).catch((e: Error) => e)
    expect(String(down)).toContain('cannot use Redis at redis://127.0.0.1:1/0')
  })
})
