import { type AppDeps, createApp } from '../../src/app.ts'
import type { AppConfig, ServerConfig } from '../../src/config.ts'
import { PoolManager } from '../../src/db/pool-manager.ts'
import { SecretBox } from '../../src/session/crypto.ts'
import { MemorySessionStore } from '../../src/session/store.ts'

export const MYSQL = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: process.env.BMA_TEST_USER ?? 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}

/** phpMyAdmin defaults for the directives the server reads (Settings.php / Settings/Server.php). */
export function testServer(o: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: MYSQL.host,
    port: MYSQL.port,
    socket: '',
    ssl: false,
    ssl_key: null,
    ssl_cert: null,
    ssl_ca: null,
    ssl_ca_path: null,
    ssl_ciphers: null,
    ssl_verify: true,
    compress: false,
    auth_type: 'cookie',
    user: 'root',
    password: '',
    verbose: '',
    AllowRoot: true,
    AllowNoPassword: false,
    AllowDeny: { order: '', rules: [] },
    SessionTimeZone: '',
    hide_connection_errors: false,
    LogoutURL: '',
    ...o,
  }
}

export function testConfig(o: Partial<AppConfig> = {}): AppConfig {
  return {
    Servers: [testServer()],
    ServerDefault: 1,
    blowfish_secret: 'test-secret-test-secret-test-secret!',
    LoginCookieValidity: 1440,
    LoginCookieStore: 0,
    LoginCookieRecall: true,
    LoginCookieDeleteAll: true,
    AllowArbitraryServer: false,
    ArbitraryServerRegexp: '',
    CookieSameSite: 'Strict',
    TrustedProxies: {},
    DefaultConnectionCollation: 'utf8mb4_unicode_ci',
    MaxRows: 25,
    MaxExactCount: 50000,
    MaxExactCountViews: 0,
    IgnoreMultiSubmitErrors: false,
    AllowUserDropDatabase: false,
    CSPAllow: '',
    AllowThirdPartyFraming: false,
    DBG: { sql: false },
    DataDir: '.data/test',
    ...o,
  }
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
    const res = await app.request(path, { method, headers: h, body: body === undefined ? null : JSON.stringify(body) })
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
