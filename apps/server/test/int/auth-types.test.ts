import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { decodeSignonSession, encodeSignonSession } from '../../src/auth/signon.ts'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/** Auth types besides the cookie form: config, http, signon; the captcha and the login rate limit. */
const USERS = ['f01a_cfg', 'f01a_http', 'f01a_sso', 'f01a_lim'] as const
const SECRET = 'test-secret-test-secret-test-secret!'
const TRIED =
  'phpMyAdmin tried to connect to the MySQL server, and the server rejected the connection. You should check the host, username and password in your configuration and make sure that they correspond to the information given by the administrator of the MySQL server.'

let root: mysql.Connection
let t: ReturnType<typeof testApp>
const basic = (u: string, p: string) => ({
  authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`,
})

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  for (const u of USERS)
    await root.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}';`)
})
afterAll(async () => {
  for (const u of USERS) await root.query(`DROP USER IF EXISTS '${u}'@'%'`)
  await root.end()
})
afterEach(async () => t?.close())

describe('config auth', () => {
  it('[p01-03cad3] logs in with the configured user, without a form', async () => {
    t = testApp(testConfig({}, { auth_type: 'config', user: 'f01a_cfg', password: 'f01a_cfg' }))
    const s = await t.req('GET', '/api/auth/state')
    expect(s.json).toMatchObject({ authenticated: true, user: 'f01a_cfg', authType: 'config', failure: null })
    // a server request logs in by itself too (fresh session)
    t.jar.clear()
    const home = await t.req('GET', '/api/servers/1')
    expect(home.status).toBe(200)
  })

  it('[p01-03cad3] failure page: connection error then the "rejected the connection" error', async () => {
    t = testApp(testConfig({}, { auth_type: 'config', user: 'f01a_cfg', password: 'wrong' }))
    t.deps.configFile = '/etc/bettermyadmin.config.json'
    const s = await t.req('GET', '/api/auth/state')
    const f = s.json.failure as { kind: string; errors: string[]; noConfigFile: boolean; notice: null }
    expect(f.kind).toBe('config')
    expect(f.notice).toBeNull()
    expect(f.noConfigFile).toBe(false)
    expect(f.errors[0]).toMatch(/^1045: Access denied for user 'f01a_cfg'@/)
    expect(f.errors[1]).toBe(TRIED)
    const api = await t.req('GET', '/api/servers/1')
    expect(api.status).toBe(401)
  })

  it('[p01-03cad3] without a configuration file the setup hint replaces the second error', async () => {
    t = testApp(testConfig({}, { auth_type: 'config', user: 'f01a_cfg', password: 'wrong' }))
    const f = (await t.req('GET', '/api/auth/state')).json.failure as {
      noConfigFile: boolean
      errors: string[]
    }
    expect(f.noConfigFile).toBe(true)
    expect(f.errors).toHaveLength(1)
  })

  it('[p01-c1d562] AllowNoPassword / AllowDeny run before the connection', async () => {
    t = testApp(testConfig({}, { auth_type: 'config', user: 'f01a_cfg', password: '' }))
    t.deps.configFile = 'x'
    const f = (await t.req('GET', '/api/auth/state')).json.failure as { errors: string[] }
    // no connection error: only the configuration hint
    expect(f.errors).toEqual([TRIED])
    await t.close()
    t = testApp(
      testConfig(
        {},
        {
          auth_type: 'config',
          user: 'f01a_cfg',
          password: 'f01a_cfg',
          AllowDeny: { order: 'explicit', rules: ['allow root from all'] },
        },
      ),
    )
    const g = (await t.req('GET', '/api/auth/state')).json.failure as { notice: string; errors: string[] }
    expect(g).toMatchObject({ notice: 'Access denied!', errors: [] })
  })
})

describe('http auth', () => {
  it('[p01-03cad3] 401 with the realm, then Basic credentials log in; logout asks for another user', async () => {
    t = testApp(testConfig({}, { auth_type: 'http' }))
    const challenge = await t.req('GET', '/')
    expect(challenge.status).toBe(401)
    expect(challenge.res.headers.get('www-authenticate')).toBe(`Basic realm="BetterMyAdmin ${MYSQL.host}"`)
    expect(challenge.text).toContain('Wrong username/password. Access denied.')
    expect((await t.req('GET', '/api/auth/state')).json.failure).toEqual({ kind: 'http' })

    const ok = await t.req('GET', '/s/1/', undefined, basic('f01a_http', 'f01a_http'))
    expect(ok.status).toBe(404) // past the gate (no SPA in the in-process app)
    const s = await t.req('GET', '/api/auth/state')
    expect(s.json).toMatchObject({ authenticated: true, user: 'f01a_http', authType: 'http', failure: null })

    const out = await t.req('POST', '/api/auth/logout', {})
    expect(out.json.logoutUrl).toBe('/?old_usr=f01a_http')
    const again = await t.req('GET', '/?old_usr=f01a_http', undefined, basic('f01a_http', 'f01a_http'))
    expect(again.status).toBe(401)
  })

  it('[p01-03cad3] auth_http_realm, non-ASCII removed; wrong password answers 401', async () => {
    t = testApp(testConfig({}, { auth_type: 'http', auth_http_realm: 'Zoë DB' }))
    const r = await t.req('GET', '/', undefined, basic('f01a_http', 'bad'))
    expect(r.status).toBe(401)
    expect(r.res.headers.get('www-authenticate')).toBe('Basic realm="Zo DB"')
    expect((await t.req('GET', '/api/auth/state')).json.authenticated).toBe(false)
  })
})

describe('signon auth', () => {
  const sso = (extra = {}) =>
    testConfig(
      {},
      {
        auth_type: 'signon',
        SignonSession: 'SignonSession',
        SignonURL: 'https://sso.example/login',
        ...extra,
      },
    )

  it('[p01-03cad3] redirects to SignonURL without a session, logs in from it, logout goes back', async () => {
    t = testApp(sso())
    const r = await t.req('GET', '/')
    expect(r.status).toBe(302)
    expect(r.res.headers.get('location')).toBe('https://sso.example/login')

    t.jar.set(
      'SignonSession',
      encodeSignonSession(SECRET, {
        PMA_single_signon_user: 'f01a_sso',
        PMA_single_signon_password: 'f01a_sso',
      }),
    )
    const ok = await t.req('GET', '/s/1/')
    expect(ok.status).toBe(404)
    expect((await t.req('GET', '/api/auth/state')).json).toMatchObject({
      authenticated: true,
      user: 'f01a_sso',
    })
    const out = await t.req('POST', '/api/auth/logout', {})
    expect(out.json.logoutUrl).toBe('https://sso.example/login')
  })

  it('[p01-03cad3] a failed login writes the error into the signon session and redirects', async () => {
    t = testApp(sso())
    t.jar.set(
      'SignonSession',
      encodeSignonSession(SECRET, { PMA_single_signon_user: 'f01a_sso', PMA_single_signon_password: 'bad' }),
    )
    const r = await t.req('GET', '/')
    expect(r.status).toBe(302)
    const data = decodeSignonSession(SECRET, decodeURIComponent(t.jar.get('SignonSession') ?? ''))
    expect(data?.PMA_single_signon_error_message).toBe('Cannot log in to the database server.')
  })

  it('SignonPage serves the login page at SignonURL itself (X54)', async () => {
    // inside the workspace: the test runner loads modules from there only
    mkdirSync(join(process.cwd(), '.data'), { recursive: true })
    const dir = mkdtempSync(join(process.cwd(), '.data', 'f01a-page-'))
    try {
      const page = join(dir, 'signon-page.mjs')
      writeFileSync(
        page,
        `export default async function (request, ctx) {
          const url = new URL(request.url)
          if (url.searchParams.has('logout')) return new Response('bye', { headers: { 'Set-Cookie': ctx.sessionCookie(null) } })
          if (request.method === 'POST') {
            const f = await request.json()
            return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': ctx.sessionCookie({ PMA_single_signon_user: f.user, PMA_single_signon_password: f.password }) } })
          }
          return new Response('form for server ' + ctx.server.index + (ctx.session?.PMA_single_signon_error_message ? ': ' + ctx.session.PMA_single_signon_error_message : ''), { headers: { 'Content-Type': 'text/html' } })
        }\n`,
      )
      t = testApp(sso({ SignonURL: '/signon/', SignonPage: page }))
      // the page is served, not redirected to itself by the gate
      const form = await t.req('GET', '/signon/')
      expect(form.status).toBe(200)
      expect(form.text).toBe('form for server 1')
      // a page load without a session goes to the page
      const gate = await t.req('GET', '/')
      expect(gate.status).toBe(302)
      expect(gate.res.headers.get('location')).toBe('/signon/')
      // wrong credentials: BetterMyAdmin writes the error into the session, the page shows it
      await t.req('POST', '/signon/', { user: 'f01a_sso', password: 'bad' })
      expect((await t.req('GET', '/')).status).toBe(302)
      expect((await t.req('GET', '/signon/')).text).toBe(
        'form for server 1: Cannot log in to the database server.',
      )
      // right credentials: logged in
      const post = await t.req('POST', '/signon/', { user: 'f01a_sso', password: 'f01a_sso' })
      expect(post.status).toBe(302)
      expect((await t.req('GET', '/s/1/')).status).toBe(404) // past the gate (no SPA in the in-process app)
      expect((await t.req('GET', '/api/auth/state')).json).toMatchObject({
        authenticated: true,
        user: 'f01a_sso',
      })
      // logout clears the SignonSession
      await t.req('GET', '/signon/?logout')
      expect(t.jar.get('SignonSession')).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('phpMyAdmin addresses redirect, and a SignonPage returns to the page asked for', async () => {
    mkdirSync(join(process.cwd(), '.data'), { recursive: true })
    const dir = mkdtempSync(join(process.cwd(), '.data', 'f01a-return-'))
    try {
      const page = join(dir, 'signon-page.mjs')
      writeFileSync(
        page,
        `export default async function (request, ctx) {
          if (request.method !== 'POST') return new Response('return to ' + ctx.returnTo)
          return new Response(null, { status: 302, headers: { Location: ctx.returnTo, 'Set-Cookie': ctx.sessionCookie({ PMA_single_signon_user: 'f01a_sso', PMA_single_signon_password: 'f01a_sso' }) } })
        }\n`,
      )
      t = testApp(sso({ SignonURL: '/signon/', SignonPage: page }))
      // an old bookmark: index.php?route=… goes to the page it names (and through the gate)
      const old = await t.req('GET', '/index.php?route=/database/structure&db=shop&server=1')
      expect(old.status).toBe(302)
      expect(old.res.headers.get('location')).toBe('/s/1/db/shop/structure')
      const gate = await t.req('GET', '/s/1/db/shop/structure')
      expect(gate.res.headers.get('location')).toBe('/signon/')
      expect((await t.req('GET', '/signon/')).text).toBe('return to /s/1/db/shop/structure')
      // signed on: back to that page, and the remembered page is used up
      const post = await t.req('POST', '/signon/', {})
      expect(post.res.headers.get('location')).toBe('/s/1/db/shop/structure')
      expect(t.jar.get('bma_signon_return') ?? '').toBe('')
      expect((await t.req('GET', '/signon/')).text).toBe('return to /')
      // only a path on this host is returned to
      t.jar.set('bma_signon_return', '//evil.example/')
      expect((await t.req('GET', '/signon/')).text).toBe('return to /')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('[p01-03cad3] "You must set SignonURL!" and the SignonScript hook', async () => {
    t = testApp(sso({ SignonURL: '' }))
    await t.req('GET', '/')
    expect((await t.req('GET', '/api/auth/state')).json.failure).toEqual({
      kind: 'error',
      message: 'You must set SignonURL!',
    })
    await t.close()

    // inside the workspace: the test runner loads modules from there only
    mkdirSync(join(process.cwd(), '.data'), { recursive: true })
    const dir = mkdtempSync(join(process.cwd(), '.data', 'f01a-'))
    try {
      const script = join(dir, 'signon-script.mjs')
      writeFileSync(script, "export function getLoginCredentials(user) { return ['f01a_sso', 'f01a_sso'] }\n")
      t = testApp(sso({ SignonScript: script }))
      expect((await t.req('GET', '/')).status).toBe(404)
      expect((await t.req('GET', '/api/auth/state')).json).toMatchObject({
        authenticated: true,
        user: 'f01a_sso',
      })
      await t.close()
      t = testApp(sso({ SignonScript: join(dir, 'missing.mjs') }))
      await t.req('GET', '/')
      expect((await t.req('GET', '/api/auth/state')).json.failure).toEqual({
        kind: 'error',
        message: "Can not find signon authentication script: $cfg['Servers'][$i]['SignonScript']",
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('captcha', () => {
  let verify: Server
  let url = ''
  let answer = '{"success": true}'
  const posted: string[] = []
  beforeAll(async () => {
    verify = createServer((req, res) => {
      let body = ''
      req.on('data', (d) => {
        body += d
      })
      req.on('end', () => {
        posted.push(body)
        res.end(answer)
      })
    })
    await new Promise<void>((r) => verify.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(verify.address() as AddressInfo).port}/siteverify`
  })
  afterAll(() => new Promise<void>((r) => verify.close(() => r())))

  const cfg = () =>
    testConfig({
      CaptchaLoginPublicKey: 'site-key',
      CaptchaLoginPrivateKey: 'secret-key',
      CaptchaSiteVerifyURL: url,
      CaptchaMethod: 'checkbox',
    })
  const login = (token?: string) =>
    t.req('POST', '/api/auth/login', {
      server: 1,
      username: MYSQL.user,
      password: MYSQL.password,
      ...(token !== undefined ? { captchaToken: token } : {}),
    })

  it('[p01-cdb8f8] state carries the widget settings; CSP lists the captcha hosts', async () => {
    t = testApp(cfg())
    const s = await t.req('GET', '/api/auth/state')
    expect(s.json.captcha).toEqual({
      api: 'https://www.google.com/recaptcha/api.js',
      requestParam: 'g-recaptcha',
      responseParam: 'g-recaptcha-response',
      siteKey: 'site-key',
      checkbox: true,
    })
    expect(s.res.headers.get('content-security-policy')).toContain('https://www.google.com/recaptcha/')
  })

  it('[p01-f1880c] verifies the token against the verify URL, with phpMyAdmin messages', async () => {
    t = testApp(cfg())
    await t.req('GET', '/api/auth/state')
    const missing = await login()
    expect((missing.json.error as { message: string }).message).toBe(
      'Missing Captcha verification, maybe it has been blocked by adblock?',
    )
    answer = '{"success": false, "error-codes": ["invalid-input-response"]}'
    expect(((await login('tok')).json.error as { message: string }).message).toBe(
      'Entered captcha is wrong, try again!',
    )
    answer = '<html>'
    expect(((await login('tok')).json.error as { message: string }).message).toBe(
      'Failed to connect to the reCAPTCHA service!',
    )
    answer = '{"success": true}'
    const ok = await login('tok')
    expect(ok.status).toBe(200)
    const last = new URLSearchParams(posted.at(-1))
    expect(Object.fromEntries(last)).toMatchObject({
      secret: 'secret-key',
      response: 'tok',
      version: 'php_1.3.1',
    })
  })
})

describe('login rate limit (X2)', () => {
  it('locks the (IP, user) pair out after maxAttempts failures within the window', async () => {
    t = testApp(testConfig({ LoginRateLimit: { maxAttempts: 3, windowSeconds: 900, lockoutSeconds: 300 } }))
    for (let i = 0; i < 3; i++) {
      const r = await t.login('f01a_lim', 'bad')
      expect((r.json.error as { message: string }).message).toMatch(/^1045:/)
    }
    // the right password is refused while locked out
    const locked = await t.login('f01a_lim', 'f01a_lim')
    expect((locked.json.error as { message: string }).message).toMatch(
      /^Too many failed login attempts\. Please try again in (300|299) seconds\.$/,
    )
    // another user from the same address is not affected
    expect((await t.login('root', MYSQL.password)).status).toBe(200)
  })

  it('can be switched off', async () => {
    t = testApp(testConfig({ LoginRateLimit: { enabled: false, maxAttempts: 1 } }))
    await t.login('f01a_lim', 'bad')
    expect((await t.login('f01a_lim', 'f01a_lim')).status).toBe(200)
  })
})
