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
  it('[p08-38b5dc] configures the application backend in two steps and asks at login [p08-71a0b1] [p01-83d6b9]', async () => {
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

describe('storage and the running app', () => {
  it('[p08-3ef43d] without pmadb the preferences live in the session, with the notice flag [p08-5de125]', async () => {
    const t = await app({ ZeroConf: false }, { pmadb: 'f08_no_storage' })
    const g = (await t.req('GET', '/api/servers/1/preferences/forms/main-panel')).json as Json
    expect(g.storage).toBe('session')
    expect(g.hasConfigStorage).toBe(false)
    expect((await t.req('GET', '/api/servers/1/preferences/autoload')).json).toEqual({ show: true })
    const s = (
      await t.req('POST', '/api/servers/1/preferences/forms/main-panel', {
        values: posted(g.formSet, { TabsMode: 'text', MaxRows: '50' }),
      })
    ).json as Json
    expect(s.saved).toBe(true)
    // the session holds them, the running app applies them (config-public)
    const pub = (await t.req('GET', '/api/meta/config-public')).json as Json
    expect(pub.TabsMode).toBe('text')
    expect(pub.MaxRows).toBe(50)
    const tf = (await t.req('GET', '/api/servers/1/preferences/two-factor')).json as Json
    expect(tf.enabled).toBe(false)
    // answering the offer hides it for the session
    await t.req('POST', '/api/servers/1/preferences/autoload/hide', {})
    expect((await t.req('GET', '/api/servers/1/preferences/autoload')).json).toEqual({ show: false })
    await t.close()
  })

  it('[p08-8fd8fd] UserprefsDisallow: the field is marked, stored but not applied', async () => {
    await root.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER])
    const t = await app({ UserprefsDisallow: ['TabsMode'] })
    const g = (await t.req('GET', '/api/servers/1/preferences/forms/main-panel')).json as Json
    const fields = (g.formSet.forms as Json[])
      .flatMap((f) => (f.items as Json[]).map((i) => i.field as Json | undefined))
      .filter((f): f is Json => f !== undefined)
    expect(fields.find((f) => f.path === 'TabsMode')?.disabled).toBe(true)
    expect(fields.find((f) => f.path === 'MaxRows')?.disabled).toBe(false)
    await t.req('POST', '/api/servers/1/preferences/forms/main-panel', {
      values: posted(g.formSet, { TabsMode: 'text' }),
    })
    expect((await storedPrefs())?.TabsMode).toBe('text')
    const pub = (await t.req('GET', '/api/meta/config-public')).json as Json
    expect(pub.TabsMode).toBe('both')
    await t.close()
  })

  it('[p08-69a15f] page settings save like a form [p08-6f0e6e]', async () => {
    await root.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER])
    const t = await app()
    const g = (await t.req('GET', '/api/servers/1/preferences/page/Edit')).json as Json
    // the Edit popup: Edit mode and Text fields
    expect((g.formSet.forms as Json[]).map((f) => f.name)).toEqual(['Edit', 'Text_fields'])
    const bad = (
      await t.req('POST', '/api/servers/1/preferences/page/Edit', {
        values: posted(g.formSet, { InsertRows: '-1' }),
      })
    ).json as Json
    expect(bad.saved).toBe(false)
    expect(bad.formSet.errorList).toEqual([
      { name: 'Number of inserted rows', errors: ['Not a positive number!'] },
    ])
    const ok = (
      await t.req('POST', '/api/servers/1/preferences/page/Edit', {
        values: posted(g.formSet, { InsertRows: '4' }),
      })
    ).json as Json
    expect(ok.saved).toBe(true)
    expect((await storedPrefs())?.InsertRows).toBe(4)
    expect((await t.req('GET', '/api/servers/1/preferences/page/Nope')).status).toBe(404)
    await t.close()
  })
})

describe('manage your settings', () => {
  it('[p08-1c37f1] exports JSON (pretty) and PHP', async () => {
    await root.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER])
    const t = await app()
    const g = (await t.req('GET', '/api/servers/1/preferences/forms/navigation')).json as Json
    await t.req('POST', '/api/servers/1/preferences/forms/navigation', {
      values: posted(g.formSet, { NavigationTreeDbSeparator: '__' }),
    })
    const cookie = [...t.jar].map(([k, v]) => `${k}=${v}`).join('; ')
    const json = await t.app.request('/api/servers/1/preferences/manage/export?type=json', {
      headers: { cookie, host: 'example.org:8080' },
    })
    expect(json.headers.get('content-disposition')).toBe(
      'attachment; filename="phpMyAdmin-config-example.org_3A8080.json"',
    )
    expect(await json.text()).toBe(
      '{\n    "NavigationTreeDbSeparator": "__",\n    "2fa": {\n        "backend": "",\n        "settings": [],\n        "type": "db"\n    }\n}',
    )
    const php = await t.app.request('/api/servers/1/preferences/manage/export?type=php', {
      headers: { cookie },
    })
    expect(await php.text()).toBe(
      "/* phpMyAdmin configuration snippet */\n\n/* Paste it to your config.inc.php */\n\n$cfg['NavigationTreeDbSeparator'] = '__';\n$cfg['2fa'] = array (\n  'backend' => '',\n  'settings' => \n  array (\n  ),\n  'type' => 'db',\n);\n",
    )
    const ls = (await t.req('GET', '/api/servers/1/preferences/manage/json')).json as Json
    expect(JSON.parse(ls.prefs)).toEqual({
      NavigationTreeDbSeparator: '__',
      '2fa': { backend: '', settings: [], type: 'db' },
    })
    await t.close()
  })

  it('[p08-f18efc] import: bad values ask first, Yes imports the rest; merge keeps the current prefs [p08-d20c19]', async () => {
    await root.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER])
    const t = await app()
    const g = (await t.req('GET', '/api/servers/1/preferences/forms/navigation')).json as Json
    await t.req('POST', '/api/servers/1/preferences/forms/navigation', {
      values: posted(g.formSet, { NavigationTreeDbSeparator: '__' }),
    })
    const json = JSON.stringify({ MaxRows: 33, TabsMode: 'text', ThemeDefault: 'metro', lang: 'de' })
    const first = (await t.req('POST', '/api/servers/1/preferences/manage/import', { json, merge: true }))
      .json as Json
    expect(first.status).toBe('errors')
    expect(first.errorList).toEqual([
      { name: 'Maximum number of rows to display', errors: ['Incorrect value!'] },
    ])
    const yes = (
      await t.req('POST', '/api/servers/1/preferences/manage/import', { json, merge: true, fixErrors: true })
    ).json as Json
    expect(yes).toEqual({ status: 'saved', themeDefault: 'metro', lang: 'de', returnUrl: null })
    const stored = await storedPrefs()
    expect(stored?.NavigationTreeDbSeparator).toBe('__')
    expect(stored?.MaxRows).toBeUndefined()
    // without merge the import starts from the defaults
    await t.req('POST', '/api/servers/1/preferences/manage/import', {
      json: JSON.stringify({ ShowSQL: false }),
    })
    const after = await storedPrefs()
    expect(after?.NavigationTreeDbSeparator).toBeUndefined()
    expect(after?.ShowSQL).toBe(false)
    const broken = (await t.req('POST', '/api/servers/1/preferences/manage/import', { json: 'nope' }))
      .json as Json
    expect(broken).toEqual({
      status: 'failed',
      message: { type: 'error', text: 'Could not import configuration' },
    })
    await t.close()
  })

  it('[p08-e23faa] reset keeps only 2fa', async () => {
    await root.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER])
    const t = await app({ DBG: { simple2fa: true } })
    await t.req('POST', '/api/servers/1/preferences/two-factor/configure', { backend: 'simple' })
    const g = (await t.req('GET', '/api/servers/1/preferences/forms/sql')).json as Json
    await t.req('POST', '/api/servers/1/preferences/forms/sql', {
      values: posted(g.formSet, { ShowSQL: null }),
    })
    expect((await storedPrefs())?.ShowSQL).toBe(false)
    const r = (await t.req('POST', '/api/servers/1/preferences/manage/reset', {})).json as Json
    expect(r.ok).toBe(true)
    expect(await storedPrefs()).toEqual({ '2fa': { backend: 'simple', settings: [], type: 'db' } })
    await t.close()
  })
})

describe('preferences applied to the running app', () => {
  it('[p08-5102df] Server/hide_db hides databases from the navigation and the database list', async () => {
    await root.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER])
    await root.query('CREATE DATABASE IF NOT EXISTS f08_hidden_db')
    await root.query(`GRANT SELECT ON \`f08\\_hidden\\_db\`.* TO '${USER}'@'%'`)
    const t = await app()
    const names = async () =>
      JSON.stringify((await t.req('GET', '/api/servers/1/navigation/tree')).json).includes('f08_hidden_db')
    expect(await names()).toBe(true)
    const g = (await t.req('GET', '/api/servers/1/preferences/forms/features')).json as Json
    const s = (
      await t.req('POST', '/api/servers/1/preferences/forms/features', {
        values: posted(g.formSet, { 'Servers-1-hide_db': '^f08_hidden' }),
      })
    ).json as Json
    expect(s.saved).toBe(true)
    expect((await storedPrefs())?.['Server/hide_db']).toBe('^f08_hidden')
    expect(await names()).toBe(false)
    await t.close()
    await root.query('DROP DATABASE IF EXISTS f08_hidden_db')
  })
})
