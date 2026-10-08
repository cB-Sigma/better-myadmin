import { afterEach, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig, testServer } from '../support/app.ts'

let t: ReturnType<typeof testApp>
afterEach(async () => t?.close())

describe('cookie auth', () => {
  it('state is anonymous and hands out a CSRF token', async () => {
    t = testApp()
    const r = await t.req('GET', '/api/auth/state')
    expect(r.status).toBe(200)
    expect(r.json.authenticated).toBe(false)
    expect(typeof r.json.csrfToken).toBe('string')
    expect(r.json.servers).toEqual([{ index: 1, label: `${MYSQL.host}:${MYSQL.port}`, authType: 'cookie' }])
  })

  it('rejects a POST without the CSRF token', async () => {
    t = testApp()
    await t.req('GET', '/api/auth/state')
    const r = await t.req('POST', '/api/auth/login', { server: 1, username: 'root', password: 'x' }, { 'X-BMA-Token': '' })
    expect(r.status).toBe(403)
    expect(r.json.error).toMatchObject({ code: 'CSRF', message: 'Error: Token mismatch' })
  })

  it('logs in, rotates the session id, recalls the username', async () => {
    t = testApp()
    await t.req('GET', '/api/auth/state')
    const before = t.jar.get('bma_sid')
    const r = await t.login()
    expect(r.status).toBe(200)
    expect(t.jar.get('bma_sid')).not.toBe(before)
    const s = await t.req('GET', '/api/auth/state')
    expect(s.json).toMatchObject({ authenticated: true, user: MYSQL.user, recalledUser: MYSQL.user })
    // no credential material in cookies
    for (const v of t.jar.values()) expect(v).not.toContain(MYSQL.password)
  })

  it('reports the MySQL error as "errno: message" on bad credentials', async () => {
    t = testApp()
    const r = await t.login('root', 'wrong-password')
    expect(r.status).toBe(403)
    expect(String((r.json.error as { message: string }).message)).toMatch(/^1045: Access denied for user 'root'@/)
  })

  it('hide_connection_errors masks 1045', async () => {
    t = testApp(testConfig({ Servers: [testServer({ hide_connection_errors: true })] }))
    const r = await t.login('root', 'wrong-password')
    expect((r.json.error as { message: string }).message).toMatch(/^Error 1045: Access denied for user\. Additional/)
  })

  it('AllowRoot=false denies root before connecting', async () => {
    t = testApp(testConfig({ Servers: [testServer({ AllowRoot: false })] }))
    const r = await t.login()
    expect((r.json.error as { message: string }).message).toBe('Access denied!')
  })

  it('AllowNoPassword=false denies an empty password', async () => {
    t = testApp()
    const r = await t.login('root', '')
    expect((r.json.error as { message: string }).message).toBe(
      'Login without a password is forbidden by configuration (see AllowNoPassword).',
    )
  })

  it('password of 2000 bytes is refused', async () => {
    t = testApp()
    const r = await t.login('root', 'x'.repeat(2000))
    expect((r.json.error as { message: string }).message).toMatch(/^Your password is too long/)
  })

  it('expires after LoginCookieValidity of inactivity with the no-activity message', async () => {
    t = testApp(testConfig({ LoginCookieValidity: 1 }))
    await t.login()
    const sid = t.jar.get('bma_sid')!
    const s = t.deps.store.get(sid)!
    s.lastSeenAt -= 5
    t.deps.store.set(s)
    const r = await t.req('POST', '/api/servers/1/query', { sql: 'SELECT 1' })
    expect(r.status).toBe(401)
    expect(r.json.error).toMatchObject({
      code: 'AUTH_EXPIRED',
      message:
        'You have been automatically logged out due to inactivity of 1 seconds. Once you log in again, you should be able to resume the work where you left off.',
    })
  })

  it('logout clears every server login (LoginCookieDeleteAll)', async () => {
    t = testApp()
    await t.login()
    const r = await t.req('POST', '/api/auth/logout')
    expect(r.json).toEqual({ ok: true, logoutUrl: null })
    const s = await t.req('GET', '/api/auth/state')
    expect(s.json.authenticated).toBe(false)
  })

  it('sets security headers', async () => {
    t = testApp()
    const r = await t.req('GET', '/api/auth/state')
    expect(r.res.headers.get('x-frame-options')).toBe('DENY')
    expect(r.res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(r.res.headers.get('cache-control')).toBe('no-store')
  })
})
