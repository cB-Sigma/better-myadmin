import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { testApp } from '../support/app.ts'

let t: ReturnType<typeof testApp>
afterEach(async () => t?.close())

const start = async () => {
  t = testApp()
  await t.req('GET', '/api/auth/state')
}

describe('setup script', () => {
  it('[p01-e2f8e5] is disabled once a configuration file exists [p08-f2ccb9]', async () => {
    await start()
    t.deps.configFile = '/srv/bettermyadmin.config.json'
    const r = await t.req('GET', '/api/setup')
    expect(r.status).toBe(404)
    expect(r.json.error).toMatchObject({ message: 'Configuration already exists, setup is disabled!' })
    // the demo server keeps it
    t.deps.cfg.DBG.demo = true
    expect((await t.req('GET', '/api/setup')).status).toBe(200)
    t.deps.cfg.DBG.demo = false
  })

  it('[p01-984896] overview, menu pages, unknown form set [p08-7737a8]', async () => {
    await start()
    const o = await t.req('GET', '/api/setup')
    expect((o.json.pages as Array<{ formset: string }>).map((p) => p.formset)).toEqual([
      'Export',
      'Features',
      'Import',
      'Main',
      'Navi',
      'Sql',
    ])
    expect((o.json.messages as Array<{ id: string }>).map((m) => m.id)).toContain('no_https')
    const bad = await t.req('GET', '/api/setup/form/Nope')
    expect(bad.status).toBe(404)
    expect(bad.json.error).toMatchObject({ message: 'Incorrect form specified!' })
  })

  it('[p01-984896] AJAX validation keeps empty lists for valid fields', async () => {
    await start()
    const r = await t.req('POST', '/api/setup/validate', {
      id: 'Servers/1/port',
      values: JSON.stringify({ 'Servers-1-port': 'x' }),
    })
    expect(r.json).toEqual({ 'Servers-1-port': ['Not a valid port number!'] })
    const none = await t.req('POST', '/api/setup/validate', { id: 'Nothing', values: '{}' })
    expect(none.json).toEqual({ success: false, message: 'Wrong data or no validation for Nothing' })
  })

  it('[p01-984896] Save writes bettermyadmin.config.json into a writable config/ directory', async () => {
    const dir = join(process.cwd(), 'config')
    mkdirSync(dir, { recursive: true })
    try {
      await start()
      expect((await t.req('GET', '/api/setup')).json.canSave).toBe(true)
      await t.req('POST', '/api/setup/config', {
        DefaultLang: 'de',
        ServerDefault: '1',
        eol: 'unix',
        action: 'save',
      })
      const cfg = await t.req('GET', '/api/setup/config')
      expect(cfg.json.saved).toBe(join(dir, 'bettermyadmin.config.json'))
      expect(JSON.parse(readFileSync(join(dir, 'bettermyadmin.config.json'), 'utf8'))).toMatchObject({
        DefaultLang: 'de',
        ServerDefault: 1,
      })
      // a configuration file in the working directory would disable setup; config/ does not
      expect((await t.req('GET', '/api/setup')).status).toBe(200)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
