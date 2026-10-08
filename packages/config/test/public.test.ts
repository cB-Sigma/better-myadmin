import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/defaults.ts'
import type { AnyNode } from '../src/nodes.ts'
import { publicConfig } from '../src/public.ts'
import { resolveConfig } from '../src/resolve.ts'
import { CLIENT_VISIBLE_EXTRA_PATHS, configNode, directives } from '../src/schema.ts'

function flatten(v: unknown, prefix = ''): string[] {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.entries(v).flatMap(([k, x]) => {
      const p = prefix === '' ? k : `${prefix}/${k}`
      // tuple/record/Inline-like leaves are objects too; stop at leaves known to the schema
      return directives.some((d) => d.path === p) ? [p] : flatten(x, p)
    })
  }
  return [prefix]
}

describe('publicConfig', () => {
  const secretValues = {
    blowfish_secret: 'BLOWFISH-SECRET-VALUE-0123456789ab',
    ProxyPass: 'PROXY-PASS-VALUE',
    URLQueryEncryptionSecretKey: 'URL-KEY-VALUE',
    CaptchaLoginPrivateKey: 'CAPTCHA-PRIVATE-VALUE',
    RedisUrl: 'redis://:REDIS-PASS@redis:6379',
    Servers: [{ password: 'SERVER-PASSWORD', controlpass: 'CONTROL-PASS', host: 'internal-db.local' }],
  }
  const pub = publicConfig(resolveConfig(secretValues))
  const json = JSON.stringify(pub)

  it('excludes every directive tagged secret', () => {
    const secrets = directives.filter((d) => d.node.flags.secret)
    expect(secrets.length).toBeGreaterThan(0)
    for (const d of secrets) expect(d.node.flags.clientVisible, d.path).toBe(false)
    for (const v of [
      'BLOWFISH',
      'PROXY-PASS',
      'URL-KEY',
      'CAPTCHA-PRIVATE',
      'REDIS-PASS',
      'SERVER-PASSWORD',
      'CONTROL-PASS',
    ]) {
      expect(json).not.toContain(v)
    }
  })

  it('excludes Servers, filesystem paths and network settings', () => {
    expect(pub).not.toHaveProperty('Servers')
    expect(json).not.toContain('internal-db.local')
    for (const k of [
      'UploadDir',
      'SaveDir',
      'TempDir',
      'DataDir',
      'SessionSavePath',
      'ProxyUrl',
      'ProxyUser',
      'TrustedProxies',
      'CSPAllow',
      'ArbitraryServerRegexp',
      'CaptchaSiteVerifyURL',
      'SessionStore',
      'LoginRateLimit',
    ]) {
      expect(pub, k).not.toHaveProperty(k)
    }
    expect(pub.Listen).toStrictEqual({ basePath: '/' })
  })

  it('includes what the SPA needs', () => {
    const d = defaultConfig()
    expect(pub.MaxRows).toBe(d.MaxRows)
    expect(pub.GridEditing).toBe('double-click')
    expect(pub.Confirm).toBe(true)
    expect(pub.NavigationTreeEnableGrouping).toBe(true)
    expect(pub.NavigationTreeTableSeparator).toBe('__')
    expect(pub.NavigationTreeDisplayDbFilterMinimum).toBe(30)
    expect(pub.Console?.Mode).toBe('info')
    expect(pub.SQLQuery).toStrictEqual(d.SQLQuery)
    expect(pub.DefaultTransformations).toStrictEqual(d.DefaultTransformations)
    expect(pub.Export?.format).toBe('sql')
    expect(pub.Export).not.toHaveProperty('remove_definer_from_definitions')
    expect(pub.CaptchaLoginPublicKey).toBe('')
    expect(pub.LoginCookieValidity).toBe(1440)
  })

  it('is exactly the clientVisible leaves', () => {
    const visible = directives
      .filter((d) => d.node.flags.clientVisible)
      .map((d) => d.path)
      .sort()
    expect(flatten(pub).sort()).toStrictEqual(visible)
  })

  it('every extra allow-list path names a real directive or group', () => {
    const paths = new Set<string>()
    const walk = (n: AnyNode): void => {
      paths.add(n.path)
      if (n.kind === 'group') for (const c of Object.values(n.fields as Record<string, AnyNode>)) walk(c)
    }
    walk(configNode)
    for (const p of CLIENT_VISIBLE_EXTRA_PATHS) expect(paths.has(p), p).toBe(true)
  })
})
