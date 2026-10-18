import { type Gettext, sprintf } from '@bettermyadmin/i18n'
import type { AppConfig } from '../config.ts'

/**
 * Failed-login limiter (parity exception X2; phpMyAdmin has none): `maxAttempts` failures of one
 * (IP, username) pair within `windowSeconds` lock that pair out for `lockoutSeconds`. A successful
 * login clears the pair's failures. Directive `LoginRateLimit`, on by default (5 / 900 s / 300 s).
 */
export class LoginRateLimiter {
  readonly #failures = new Map<string, number[]>()
  readonly #lockedUntil = new Map<string, number>()
  readonly #opts: AppConfig['LoginRateLimit']
  readonly #now: () => number

  constructor(opts: AppConfig['LoginRateLimit'], now: () => number = () => Date.now()) {
    this.#opts = opts
    this.#now = now
  }

  #key(ip: string | false, user: string): string {
    return `${ip === false ? '' : ip}\u0000${user}`
  }

  /** The lockout message while the pair is locked out, else null. */
  lockedMessage(ip: string | false, user: string, tr: Gettext): string | null {
    if (!this.#opts.enabled) return null
    const key = this.#key(ip, user)
    const until = this.#lockedUntil.get(key)
    if (until === undefined) return null
    const left = Math.ceil((until - this.#now()) / 1000)
    if (left <= 0) {
      this.#lockedUntil.delete(key)
      return null
    }
    return sprintf(
      // i18n-new: login rate limiting (phpMyAdmin has none)
      tr.gettext('Too many failed login attempts. Please try again in %s seconds.'),
      String(left),
    )
  }

  failed(ip: string | false, user: string): void {
    if (!this.#opts.enabled) return
    const key = this.#key(ip, user)
    const now = this.#now()
    const since = now - this.#opts.windowSeconds * 1000
    const list = (this.#failures.get(key) ?? []).filter((t) => t > since)
    list.push(now)
    if (list.length >= this.#opts.maxAttempts) {
      this.#lockedUntil.set(key, now + this.#opts.lockoutSeconds * 1000)
      this.#failures.delete(key)
      return
    }
    this.#failures.set(key, list)
  }

  succeeded(ip: string | false, user: string): void {
    const key = this.#key(ip, user)
    this.#failures.delete(key)
    this.#lockedUntil.delete(key)
  }

  readonly #queues = new Map<string, Promise<unknown>>()

  /**
   * Runs the attempts of one (IP, username) pair one after the other: each sees the failures of the
   * attempts before it. Concurrent requests would otherwise all pass the lockout check before the
   * first failure is recorded.
   */
  serialize<T>(ip: string | false, user: string, fn: () => Promise<T>): Promise<T> {
    const key = this.#key(ip, user)
    const prev = this.#queues.get(key) ?? Promise.resolve()
    const run = prev.then(fn, fn)
    const tail = run.catch(() => {})
    this.#queues.set(key, tail)
    void tail.then(() => {
      if (this.#queues.get(key) === tail) this.#queues.delete(key)
    })
    return run
  }

  /** Forgets pairs whose failures and lockout are over (memory bound). */
  sweep(): void {
    const now = this.#now()
    const since = now - this.#opts.windowSeconds * 1000
    for (const [key, list] of this.#failures) if (!list.some((t) => t > since)) this.#failures.delete(key)
    for (const [key, until] of this.#lockedUntil) if (until <= now) this.#lockedUntil.delete(key)
  }
}

const limiters = new WeakMap<AppConfig['LoginRateLimit'], LoginRateLimiter>()

/** The process-wide limiter of a configuration. */
export function loginRateLimiter(cfg: AppConfig): LoginRateLimiter {
  let l = limiters.get(cfg.LoginRateLimit)
  if (l === undefined) {
    l = new LoginRateLimiter(cfg.LoginRateLimit)
    limiters.set(cfg.LoginRateLimit, l)
  }
  return l
}
