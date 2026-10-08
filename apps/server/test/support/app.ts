import { type ConfigInput, type ServerInput, resolveConfig } from '@bettermyadmin/config'
import { type AppDeps, createApp } from '../../src/app.ts'
import type { AppConfig } from '../../src/config.ts'
import { PoolManager } from '../../src/db/pool-manager.ts'
import { SecretBox } from '../../src/session/crypto.ts'
import { MemorySessionStore } from '../../src/session/store.ts'

export const MYSQL = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: process.env.BMA_TEST_USER ?? 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}

/**
 * A resolved config (phpMyAdmin defaults) with one test server; overrides use phpMyAdmin names.
 * No local metadata store unless a test sets `DataDir` (the default ~/.bettermyadmin would be shared
 * between runs): without pmadb the tests see phpMyAdmin's behaviour without configuration storage.
 */
export function testConfig(o: ConfigInput = {}, server: ServerInput = {}): AppConfig {
  return resolveConfig(
    {
      blowfish_secret: 'test-secret-test-secret-test-secret!',
      DataDir: '',
      Servers: [{ host: MYSQL.host, port: MYSQL.port, ...server }],
    },
    o,
  )
}

/** In-process app + a tiny cookie-jar client. */
export function testApp(cfg = testConfig()) {
  const deps: AppDeps = {
    cfg,
    store: new MemorySessionStore(),
    pools: new PoolManager(cfg),
    credBox: new SecretBox(cfg.blowfish_secret, 'credentials'),
    userBox: new SecretBox(cfg.blowfish_secret, 'username'),
  }
  const app = createApp(deps)
  const jar = new Map<string, string>()
  let token = ''
  async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { ...headers }
    if (jar.size > 0) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    if (body !== undefined) h['content-type'] = 'application/json'
    if (method !== 'GET' && token !== '' && !('X-BMA-Token' in headers)) h['X-BMA-Token'] = token
    const res = await app.request(path, {
      method,
      headers: h,
      body: body === undefined ? null : JSON.stringify(body),
    })
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';')
      const [k, v] = kv!.split('=')
      if (k !== undefined && v !== undefined) jar.set(k, v)
    }
    const json = (await res.json()) as Record<string, unknown>
    if (typeof json.csrfToken === 'string') token = json.csrfToken
    return { status: res.status, json, res }
  }
  async function login(user = MYSQL.user, password = MYSQL.password) {
    await req('GET', '/api/auth/state')
    return req('POST', '/api/auth/login', { server: 1, username: user, password })
  }
  return { app, deps, jar, req, login, close: () => deps.pools.closeAll() }
}
