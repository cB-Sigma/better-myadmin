import { afterEach, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/** Feature 01 checklist: the login form's server choice (docs/features/01-shell-navigation-auth.md#auth). */
let t: ReturnType<typeof testApp>
afterEach(async () => t?.close())

describe('login form', () => {
  it('[p01-4faba9] the server dropdown lists the configured servers; the arbitrary server field follows ArbitraryServerRegexp', async () => {
    t = testApp(
      testConfig({
        Servers: [
          { host: MYSQL.host, port: MYSQL.port },
          { host: MYSQL.host, port: MYSQL.port, verbose: 'second' },
        ],
      } as never),
    )
    let s = (await t.req('GET', '/api/auth/state')).json
    expect((s.servers as Array<{ label: string }>).map((x) => x.label)).toEqual([
      `${MYSQL.host}:${MYSQL.port}`,
      'second',
    ])
    expect(s.allowArbitraryServer).toBe(false)
    await t.close()

    t = testApp(testConfig({ AllowArbitraryServer: true, ArbitraryServerRegexp: '/^127\\.0\\.0\\.1$/' }))
    s = (await t.req('GET', '/api/auth/state')).json
    expect(s.allowArbitraryServer).toBe(true)
    const refused = await t.req('POST', '/api/auth/login', {
      server: 1,
      username: MYSQL.user,
      password: MYSQL.password,
      arbitraryServer: 'db.example',
    })
    expect((refused.json.error as { message: string }).message).toBe(
      'You are not allowed to log in to this MySQL server!',
    )
    const ok = await t.req('POST', '/api/auth/login', {
      server: 1,
      username: MYSQL.user,
      password: MYSQL.password,
      arbitraryServer: `${MYSQL.host} ${MYSQL.port}`,
    })
    expect(ok.status, JSON.stringify(ok.json)).toBe(200)
  })
})
