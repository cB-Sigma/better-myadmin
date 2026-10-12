import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../support/app.ts'

/**
 * Shell / authentication directives with an effect on a running app: `CheckConfigurationPermissions`,
 * `MysqlMinVersion`, `LogoutURL`, `AuthLog`, `Console`.
 */
const tmp = mkdtempSync(join(tmpdir(), 'f01a-dirsrv-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('server directives', () => {
  it('CheckConfigurationPermissions: a world-writable configuration file stops every request', async () => {
    const file = join(tmp, 'bettermyadmin.config.json')
    writeFileSync(file, '{}')
    chmodSync(file, 0o666)
    for (const check of [true, false]) {
      const t = testApp(testConfig({ CheckConfigurationPermissions: check }))
      t.deps.configFile = file
      try {
        const api = await t.req('GET', '/api/auth/state')
        const page = await t.req('GET', '/')
        if (check) {
          expect(api.status).toBe(500)
          expect((api.json.error as { message: string }).message).toBe(
            'Wrong permissions on configuration file, should not be world writable!',
          )
          expect(page.status).toBe(500)
          expect(page.text).toContain('should not be world writable')
        } else {
          expect(api.status).toBe(200)
        }
      } finally {
        await t.close()
      }
    }
  })

  it('MysqlMinVersion: an older server is refused at login', async () => {
    const t = testApp(testConfig({ MysqlMinVersion: { internal: 990000, human: '99.0.0' } }))
    try {
      const r = await t.login()
      expect(r.status).toBe(500)
      expect((r.json.error as { message: string }).message).toBe(
        'You should upgrade to MySQL 99.0.0 or later.',
      )
    } finally {
      await t.close()
    }
  })

  it('LogoutURL and AuthLog: logout goes to the URL; a failed and a successful login are logged', async () => {
    const log = join(tmp, 'auth.log')
    const t = testApp(
      testConfig({ AuthLog: log, AuthLogSuccess: true }, { LogoutURL: 'https://example.org/bye' }),
    )
    try {
      expect((await t.login('f01a_nobody', 'x')).status).not.toBe(200)
      expect((await t.login()).status).toBe(200)
      const out = (await t.req('POST', '/api/auth/logout')).json
      expect(out.logoutUrl).toBe('https://example.org/bye')
      const lines = (await import('node:fs')).readFileSync(log, 'utf8').trim().split('\n')
      expect(lines[0]).toMatch(
        /^\w{3} \d{2} \d{2}:\d{2}:\d{2} phpmyadmin: user denied: f01a_nobody \(server-denied\) from /,
      )
      expect(lines[1]).toMatch(/phpmyadmin: user authenticated: \S+ from/)
    } finally {
      await t.close()
    }
  })

  it('Console: the configured settings reach the console', async () => {
    const Console = {
      StartHistory: true,
      AlwaysExpand: true,
      CurrentQuery: false,
      EnterExecutes: true,
      DarkTheme: true,
      Mode: 'show',
      Height: 120,
      GroupQueries: true,
      OrderBy: 'count',
      Order: 'desc',
    } as const
    // the user's stored preferences (Console/Mode of earlier runs) must not apply
    const t = testApp(
      testConfig({ Console, UserprefsDisallow: Object.keys(Console).map((k) => `Console/${k}`) }),
    )
    try {
      await t.login()
      const r = await t.req('GET', '/api/servers/1/console/config')
      expect(r.json.settings).toMatchObject(Console)
    } finally {
      await t.close()
    }
  })
})
