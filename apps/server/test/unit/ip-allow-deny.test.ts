import { describe, expect, it } from 'vitest'
import { allow, deny, getClientIp, ipMaskTest, isForbiddenByRules } from '../../src/auth/ip-allow-deny.ts'
import fixtures from './fixtures/ip-allow-deny.json' with { type: 'json' }

describe('ipMaskTest matches phpMyAdmin IpAllowDeny', () => {
  for (const [range, ip, expected] of fixtures.mask as Array<[string, string, boolean]>) {
    it(`${range} ∋ ${ip} = ${expected}`, () => {
      expect(ipMaskTest(range, ip)).toBe(expected)
    })
  }
})

describe('getClientIp matches Core::getIp', () => {
  for (const c of fixtures.getIp) {
    it(JSON.stringify(c), () => {
      const proxies: Record<string, string> = c.proxy === null ? {} : { [c.proxy]: 'HTTP_X_FORWARDED_FOR' }
      const result = getClientIp(c.remote, proxies, (n) =>
        n === 'x-forwarded-for' ? (c.header ?? undefined) : undefined,
      )
      expect(result).toBe(c.result)
    })
  }
})

describe('allow()/deny() match phpMyAdmin for every user/ip', () => {
  for (const c of fixtures.allowDeny) {
    it(`${c.user}@${c.ip}`, () => {
      const ctx = { remoteIp: c.ip, username: c.user, rules: fixtures.rules }
      expect([allow(ctx), deny(ctx)]).toEqual([c.allow, c.deny])
      // checkRules decision derived from the same two booleans
      expect(isForbiddenByRules('deny,allow', ctx)).toBe(c.deny && !c.allow)
      expect(isForbiddenByRules('allow,deny', ctx)).toBe(!(c.allow && !c.deny))
      expect(isForbiddenByRules('', ctx)).toBe(false)
    })
  }
})
