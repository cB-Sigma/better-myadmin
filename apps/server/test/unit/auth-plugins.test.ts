import { englishTranslator } from '@bettermyadmin/i18n'
import { describe, expect, it } from 'vitest'
import { siteVerify } from '../../src/auth/captcha.ts'
import { httpRealm, readBasicCredentials } from '../../src/auth/http.ts'
import { isPageRequest } from '../../src/auth/page-gate.ts'
import { LoginRateLimiter } from '../../src/auth/rate-limit.ts'
import { decodeSignonSession, encodeSignonSession, signonCookieOptions } from '../../src/auth/signon.ts'
import { getServer } from '../../src/config.ts'
import { testConfig } from '../support/app.ts'

const tr = englishTranslator()
const b64 = (s: string) => `Basic ${Buffer.from(s).toString('base64')}`

describe('AuthenticationHttp::readCredentials', () => {
  it('splits user:password at the first colon, cuts the user at NUL, needs a user', () => {
    expect(readBasicCredentials(b64('bob:pa:ss'))).toEqual({ user: 'bob', password: 'pa:ss' })
    expect(readBasicCredentials(b64('bo\0b:x'))).toEqual({ user: 'bo', password: 'x' })
    expect(readBasicCredentials(b64(':x'))).toBeNull()
    expect(readBasicCredentials(b64('nocolon'))).toBeNull()
    expect(readBasicCredentials('Bearer x')).toBeNull()
    expect(readBasicCredentials(undefined)).toBeNull()
  })

  it('realm: auth_http_realm, else product + verbose / host, US-ASCII only', () => {
    const s = (o: object) => getServer(testConfig({}, { host: 'db', ...o }), 1)!
    expect(httpRealm(s({}))).toBe('BetterMyAdmin db')
    expect(httpRealm(s({ verbose: 'Prod' }))).toBe('BetterMyAdmin Prod')
    expect(httpRealm(s({ auth_http_realm: 'Ünïcode realm' }))).toBe('ncode realm')
  })
})

describe('login rate limiter', () => {
  it('locks after maxAttempts within the window, unlocks after the lockout', () => {
    let now = 0
    const l = new LoginRateLimiter(
      { enabled: true, maxAttempts: 2, windowSeconds: 10, lockoutSeconds: 30 },
      () => now,
    )
    l.failed('1.2.3.4', 'u')
    now = 11_000 // outside the window: the first failure no longer counts
    l.failed('1.2.3.4', 'u')
    expect(l.lockedMessage('1.2.3.4', 'u', tr)).toBeNull()
    l.failed('1.2.3.4', 'u')
    expect(l.lockedMessage('1.2.3.4', 'u', tr)).toBe(
      'Too many failed login attempts. Please try again in 30 seconds.',
    )
    expect(l.lockedMessage('1.2.3.5', 'u', tr)).toBeNull()
    now += 30_000
    expect(l.lockedMessage('1.2.3.4', 'u', tr)).toBeNull()
  })
})

describe('signon session cookie', () => {
  it('round-trips with the secret only', () => {
    const v = encodeSignonSession('s'.repeat(32), {
      PMA_single_signon_user: 'a',
      PMA_single_signon_password: 'b',
    })
    expect(decodeSignonSession('s'.repeat(32), v)).toEqual({
      PMA_single_signon_user: 'a',
      PMA_single_signon_password: 'b',
    })
    expect(decodeSignonSession('t'.repeat(32), v)).toBeNull()
  })

  it('SignonCookieParams defaults (AuthenticationSignon::setCookieParams)', () => {
    const s = getServer(
      testConfig({}, { SignonCookieParams: { lifetime: 60, samesite: 'Lax', httponly: true } }),
      1,
    )!
    expect(signonCookieOptions(s)).toEqual({
      path: '/',
      secure: false,
      httpOnly: true,
      maxAge: 60,
      sameSite: 'Lax',
    })
  })
})

describe('ReCaptcha::verify', () => {
  const answer = (body: string | Error): typeof fetch =>
    (async () => {
      if (body instanceof Error) throw body
      return new Response(body)
    }) as unknown as typeof fetch
  it('maps the verify responses like the PHP client', async () => {
    const v = (b: string | Error) => siteVerify('http://x', 's', 'r', false, answer(b))
    expect(await v('{"success":true}')).toEqual([])
    expect(await v('{"success":false,"error-codes":["timeout-or-duplicate"]}')).toEqual([
      'timeout-or-duplicate',
    ])
    expect(await v('{"success":false}')).toEqual(['unknown-error'])
    expect(await v('{}')).toEqual(['invalid-json'])
    expect(await v('not json')).toEqual(['invalid-json'])
    expect(await v(new Error('down'))).toEqual(['connection-failed'])
  })
})

describe('page gate scope', () => {
  it('only SPA page loads, never the API, assets or the setup script', () => {
    expect(isPageRequest('GET', '/')).toBe(true)
    expect(isPageRequest('GET', '/s/1/db/x')).toBe(true)
    expect(isPageRequest('GET', '/index.html')).toBe(true)
    expect(isPageRequest('POST', '/')).toBe(false)
    expect(isPageRequest('GET', '/api/auth/state')).toBe(false)
    expect(isPageRequest('GET', '/assets/app.js')).toBe(false)
    expect(isPageRequest('GET', '/favicon.ico')).toBe(false)
    expect(isPageRequest('GET', '/setup')).toBe(false)
  })
})
