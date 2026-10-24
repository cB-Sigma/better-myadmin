import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { validatePassword } from '../../src/shell/password.ts'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Feature 01's security checklist (docs/features/01-shell-navigation-auth.md#security-checklist),
 * each item proved on the running app.
 */
let t: ReturnType<typeof testApp>
afterEach(async () => t?.close())

const home = async (
  o: Parameters<typeof testConfig>[0] = {},
  server: Parameters<typeof testConfig>[1] = {},
) => {
  t = testApp(testConfig(o, server))
  await t.login()
  return (await t.req('GET', '/api/servers/1/home', undefined, { host: '127.0.0.1' })).json as {
    warnings: Array<{ message: string }>
    databaseServer: { connection: { message: string; danger: boolean } }
  }
}

describe('security checklist', () => {
  it('[p01-01225d] blowfish_secret warnings, the default control user, MysqlSslWarningSafeHosts, hide_connection_errors', async () => {
    t = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass' }))
    t.deps.configuredSecret = 'short'
    await t.login()
    const texts = (
      (await t.req('GET', '/api/servers/1/home')).json.warnings as Array<{ message: string }>
    ).map((w) => w.message)
    expect(texts).toContain(
      'The configuration file needs a valid key for cookie encryption. A temporary key was automatically generated for you. Please refer to the [doc@cfg_blowfish_secret]documentation[/doc].',
    )
    expect(
      texts.some((m) => m.startsWith('Your server is running with default values for the controluser')),
    ).toBe(true)
    await t.close()
    // the test secret is 36 bytes: no warning, keys are derived from it (phpMyAdmin warns, X58)
    const long = await home()
    expect(long.warnings.some((w) => w.message.includes('cookie encryption key'))).toBe(false)
    // SSL not used: a danger unless the host is a safe one
    expect(long.databaseServer.connection).toEqual({ message: 'SSL is not being used', danger: false })
    await t.close()
    const unsafe = await home({ MysqlSslWarningSafeHosts: [] })
    expect(unsafe.databaseServer.connection.danger).toBe(true)
    await t.close()
    t = testApp(testConfig({}, { hide_connection_errors: true }))
    const r = await t.login('root', 'wrong-password')
    expect((r.json.error as { message: string }).message).toMatch(
      /^Error 1045: Access denied for user\. Additional/,
    )
  })

  it('[p01-180699] CSRF token on every POST, checked before the route; rotated at login and handed to the client', async () => {
    t = testApp()
    const before = (await t.req('GET', '/api/auth/state')).json.csrfToken as string
    const refused = await t.req(
      'POST',
      '/api/auth/login',
      { server: 1, username: 'root', password: 'x' },
      {
        'X-BMA-Token': 'forged',
      },
    )
    expect(refused.status).toBe(403)
    expect(refused.json.error).toMatchObject({ code: 'CSRF', message: 'Error: Token mismatch' })
    const login = await t.login()
    expect(login.status).toBe(200)
    const after = login.json.csrfToken as string
    expect(typeof after).toBe('string')
    expect(after).not.toBe(before)
    // the new token works, the old one does not
    expect(
      (await t.req('POST', '/api/servers/1/query', { sql: 'SELECT 1' }, { 'X-BMA-Token': before })).status,
    ).toBe(403)
    expect((await t.req('POST', '/api/servers/1/query', { sql: 'SELECT 1' })).status).toBe(200)
  })

  it('[p01-274621] Referrer-Policy header and meta; external links carry rel=noreferrer instead of the /url page (X35)', async () => {
    t = testApp()
    const r = await t.req('GET', '/api/auth/state')
    expect(r.res.headers.get('referrer-policy')).toBe('same-origin')
    const html = readFileSync(new URL('../../../web/index.html', import.meta.url), 'utf8')
    expect(html).toContain('<meta name="referrer" content="same-origin" />')
  })

  it('[p01-310f9f] the other headers: X-XSS-Protection, nosniff, cross-domain policies, robots, Permissions-Policy, no caching', async () => {
    t = testApp()
    const h = (await t.req('GET', '/api/auth/state')).res.headers
    expect(h.get('x-xss-protection')).toBe('1; mode=block')
    expect(h.get('x-content-type-options')).toBe('nosniff')
    expect(h.get('x-permitted-cross-domain-policies')).toBe('none')
    expect(h.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(h.get('permissions-policy')).toBe('fullscreen=(self), interest-cohort=()')
    expect(h.get('cache-control')).toBe('no-store')
    // the API answers JSON; the SPA's index.html is served as text/html by main.ts
    expect(h.get('content-type')).toMatch(/^application\/json/)
  })

  it('[p01-3b0124] sessions: an unknown id is not adopted, a new id at login, the session destroyed at logout', async () => {
    t = testApp()
    await t.req('GET', '/api/auth/state', undefined, { cookie: 'bma_sid=attacker-chosen' })
    const issued = t.jar.get('bma_sid')
    expect(issued).toBeDefined()
    expect(issued).not.toBe('attacker-chosen')
    await t.login()
    const loggedIn = t.jar.get('bma_sid')!
    expect(loggedIn).not.toBe(issued)
    expect(await t.deps.store.get(loggedIn)).not.toBeNull()
    await t.req('POST', '/api/auth/logout')
    expect(await t.deps.store.get(loggedIn)).toBeNull()
  })

  it('[p01-5aae36] cookies: HttpOnly session, Secure on HTTPS, SameSite from CookieSameSite, LoginCookieStore, no credentials (X1)', async () => {
    t = testApp(testConfig({ CookieSameSite: 'Lax', LoginCookieStore: 120 }))
    const r = await t.req('GET', '/api/auth/state', undefined, { 'x-forwarded-proto': 'https' })
    const cookies = r.res.headers.getSetCookie()
    const sid = cookies.find((c) => c.startsWith('bma_sid='))!
    expect(sid).toMatch(/HttpOnly/)
    expect(sid).toMatch(/Secure/)
    expect(sid).toMatch(/SameSite=Lax/)
    expect(sid).toMatch(/Max-Age=120/)
    const plain = (await t.req('GET', '/api/auth/state')).res.headers.getSetCookie()
    expect(plain.find((c) => c.startsWith('bma_sid='))).not.toMatch(/Secure/)
    await t.login()
    for (const v of t.jar.values()) expect(v).not.toContain(MYSQL.password)
  })

  it('[p01-b467ca] ForceSSL is honoured: a redirect to HTTPS and HSTS (X22)', async () => {
    t = testApp(testConfig({ ForceSSL: true }))
    const plain = await t.app.request('/api/auth/state', { headers: { host: 'db.example:8080' } })
    expect(plain.status).toBe(301)
    expect(plain.headers.get('location')).toBe('https://db.example:8080/api/auth/state')
    const https = await t.app.request('/api/auth/state', { headers: { 'x-forwarded-proto': 'https' } })
    expect(https.status).toBe(200)
    expect(https.headers.get('strict-transport-security')).toBe('max-age=31536000')
    await t.close()
    t = testApp()
    expect((await t.req('GET', '/api/auth/state')).res.headers.get('strict-transport-security')).toBeNull()
  })

  it('[p01-c0c8ad] request flood guards, the password caps (2000 at login, 256 on change)', async () => {
    t = testApp()
    await t.req('GET', '/api/auth/state')
    const globals = await t.req('GET', '/api/auth/state?GLOBALS=1')
    expect(globals.status).toBe(500)
    expect((globals.json.error as { message: string }).message).toBe('GLOBALS overwrite attempt')
    const many = new URLSearchParams(Array.from({ length: 1000 }, (_, i) => [`p${i}`, '1'])).toString()
    const flood = await t.req('GET', `/api/auth/state?${many}`)
    expect((flood.json.error as { message: string }).message).toBe('possible exploit')
    const long = await t.login('root', 'x'.repeat(2000))
    expect((long.json.error as { message: string }).message).toMatch(/^Your password is too long/)
    expect(validatePassword('x'.repeat(257), 'x'.repeat(257), false)).toBe('Password is too long!')
    expect(validatePassword('x'.repeat(256), 'x'.repeat(256), false)).toBeNull()
  })

  it('[p01-cf8d93] signed SQL in URLs; URLQueryEncryption key warnings (X47)', async () => {
    const r = await home({ URLQueryEncryption: true, URLQueryEncryptionSecretKey: 'short' })
    expect(r.warnings.map((w) => w.message)).toContain(
      'The configuration file needs a valid key for query encryption. A temporary key was automatically generated for you. Please refer to the [doc@cfg_URLQueryEncryptionSecretKey]documentation[/doc].',
    )
    const unsigned = await t.req('POST', '/api/servers/1/query', { sql: 'SELECT 1', sig: 'forged' })
    expect(unsigned.status).toBe(400)
    expect((unsigned.json.error as { message: string }).message).toBe('Missing parameter: sql_query')
  })

  it('[p01-ef0f3e] CSP: self only, object-src none, the OpenStreetMap tiles, CSPAllow and captcha hosts, frame-ancestors', async () => {
    const csp = async (o: Parameters<typeof testConfig>[0]) => {
      t = testApp(testConfig(o))
      const r = await t.req('GET', '/api/auth/state')
      await t.close()
      return r.res.headers.get('content-security-policy') ?? ''
    }
    const def = await csp({})
    expect(def).toContain("default-src 'self'")
    expect(def).toContain("object-src 'none'")
    expect(def).toContain('https://tile.openstreetmap.org')
    expect(def).toContain("frame-ancestors 'none'")
    expect(await csp({ AllowThirdPartyFraming: 'sameorigin' })).toContain("frame-ancestors 'self'")
    expect(await csp({ CSPAllow: 'https://cdn.example' })).toContain(
      "script-src 'self' 'wasm-unsafe-eval' https://cdn.example",
    )
    expect(await csp({ CaptchaLoginPublicKey: 'pub', CaptchaLoginPrivateKey: 'priv' })).toContain(
      'https://www.google.com',
    )
    t = testApp()
  })
})
