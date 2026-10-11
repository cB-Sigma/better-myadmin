import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { oathTotp } from '../../src/preferences/totp.ts'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * User preferences against a live MySQL with the shared pmadb (`phpmyadmin`, control user pma):
 * Settings forms, Manage your settings, page settings and two-factor authentication
 * (docs/features/08-settings-preferences-pmadb.md). The stored rows are compared with
 * phpMyAdmin in tests/parity/preferences.parity.test.ts. Only f08_* users are touched.
 */
const USER = 'f08_int'
const PASS = 'f08_int_pw'
const SRV = { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }

// biome-ignore lint/suspicious/noExplicitAny: loosely typed API payloads in tests
type Json = Record<string, any>
let root: mysql.Connection

async function storedPrefs(user = USER): Promise<Json | null> {
  const [rows] = (await root.query('SELECT config_data FROM phpmyadmin.pma__userconfig WHERE username = ?', [
    user,
  ])) as unknown as [Array<{ config_data: string }>]
  return rows[0] === undefined ? null : (JSON.parse(rows[0].config_data) as Json)
}

/** the browser-style values of a form set: every input as phpMyAdmin's form posts it */
function posted(formSet: Json, changes: Record<string, string | null> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const form of formSet.forms as Json[]) {
    for (const item of form.items as Json[]) {
      if (item.kind !== 'field') continue
      const f = item.field as Json
      if (f.type === 'checkbox') {
        if (f.value === true) out[f.id] = 'on'
      } else if (f.type === 'select') {
        // no selected option: the browser submits the first one
        const opts = f.options as Json[]
        out[f.id] = opts.some((o) => o.value === f.value) ? f.value : (opts[0]?.value ?? '')
      } else out[f.id] = String(f.value)
    }
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete out[k]
    else out[k] = v
  }
  return out
}

async function app(cfg: Parameters<typeof testConfig>[0] = {}, server: Json = SRV) {
  const t = testApp(testConfig(cfg, server))
  const r = await t.login(USER, PASS)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return t
}

beforeAll(async () => {
  root = await mysql.createConnection(MYSQL)
  await root.query(`DROP USER IF EXISTS '${USER}'@'%'`)
  await root.query(`CREATE USER '${USER}'@'%' IDENTIFIED BY '${PASS}'`)
  await root.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username LIKE ?', ['f08\\_%'])
})

afterAll(async () => {
  await root.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username LIKE ?', ['f08\\_%'])
  await root.query(`DROP USER IF EXISTS '${USER}'@'%'`)
  await root.end()
})

describe('settings forms', () => {
  it('[p08-ee115b] renders every tab, saves the whole form set and re-persists 2fa [p08-0b1f72]', async () => {
    const t = await app()
    const g = await t.req('GET', '/api/servers/1/preferences/forms/features')
    expect(g.status, JSON.stringify(g.json)).toBe(200)
    expect(g.json.storage).toBe('db')
    const names = ((g.json as Json).formSet.forms as Json[]).map((f) => f.name)
    expect(names).toEqual(['General', 'Databases', 'Text_fields', 'Page_titles', 'Warnings', 'Console'])
    const s = await t.req('POST', '/api/servers/1/preferences/forms/features', {
      values: posted((g.json as Json).formSet, { MaxTableList: '100', NaturalOrder: null }),
    })
    expect((s.json as Json).formSet?.errorList ?? s.json).toEqual({ saved: true })
    const stored = await storedPrefs()
    expect(stored).toEqual({
      NaturalOrder: false,
      FirstDayOfCalendar: 1,
      MaxTableList: 100,
      '2fa': { backend: '', settings: [], type: 'db' },
    })
    for (const tab of ['sql', 'navigation', 'main-panel', 'export', 'import']) {
      const r = await t.req('GET', `/api/servers/1/preferences/forms/${tab}`)
      expect(r.status, tab).toBe(200)
    }
    await t.close()
  })
})

describe('two-factor', () => {
  it('[p08-38b5dc] configures the application backend in two steps and asks at login [p08-71a0b1]', async () => {
    await root.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER])
    const t = await app()
    const st = await t.req('GET', '/api/servers/1/preferences/two-factor')
    expect(st.json.enabled).toBe(true)
    const step1 = await t.req('POST', '/api/servers/1/preferences/two-factor/configure', {
      backend: 'application',
    })
    expect(step1.json.status).toBe('setup')
    expect(step1.json.error).toBeNull()
    const secret = (step1.json as Json).form.secret as string
    expect(secret).toMatch(/^[A-Z2-7]{16}$/)
    const wrong = await t.req('POST', '/api/servers/1/preferences/two-factor/configure', {
      backend: 'application',
      fields: { '2fa_code': '000000' },
    })
    expect(wrong.json.status).toBe('setup')
    expect((wrong.json as Json).form.secret).toBe(secret)
    expect(wrong.json.error).toBe('Two-factor authentication failed.')
    const code = oathTotp(secret, Math.floor(Date.now() / 30000))
    const ok = await t.req('POST', '/api/servers/1/preferences/two-factor/configure', {
      backend: 'application',
      fields: { '2fa_code': code },
    })
    expect(ok.json).toEqual({ status: 'done', message: 'Two-factor authentication has been configured.' })
    expect((await storedPrefs())?.['2fa']).toEqual({ backend: 'application', settings: { secret } })
    await t.close()

    const t2 = testApp(testConfig({}, SRV))
    const login = await t2.login(USER, PASS)
    expect(login.json.twoFactorRequired).toBe(true)
    const state = await t2.req('GET', '/api/auth/state')
    expect(state.json.authenticated).toBe(false)
    expect(state.json.twoFactorPending).toBe(true)
    expect((await t2.req('GET', '/api/servers/1/preferences/two-factor')).status).toBe(401)
    const ch = await t2.req('GET', '/api/auth/two-factor')
    expect((ch.json as Json).form.kind).toBe('application')
    const bad = await t2.req('POST', '/api/auth/two-factor', { fields: { '2fa_code': '111111' } })
    expect(bad.json.ok).toBe(false)
    expect((bad.json as Json).challenge.error).toBe('Two-factor authentication failed.')
    const good = await t2.req('POST', '/api/auth/two-factor', {
      fields: { '2fa_code': oathTotp(secret, Math.floor(Date.now() / 30000)) },
    })
    expect(good.json.ok).toBe(true)
    expect((await t2.req('GET', '/api/auth/state')).json.authenticated).toBe(true)

    // disabling needs the current code
    const rm1 = await t2.req('POST', '/api/servers/1/preferences/two-factor/remove', {})
    expect(rm1.json.status).toBe('confirm')
    const rm2 = await t2.req('POST', '/api/servers/1/preferences/two-factor/remove', {
      fields: { '2fa_code': oathTotp(secret, Math.floor(Date.now() / 30000)) },
    })
    expect(rm2.json.status).toBe('done')
    expect((await storedPrefs())?.['2fa']).toEqual({ backend: '', settings: [] })
    await t2.close()
  })
})
