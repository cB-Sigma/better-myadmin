import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { GeneralLog, type LogEntry } from './lib/general-log.ts'
import { type PmaInstance, phpAvailable, startPmaInstance } from './lib/pma-instance.ts'
import { PmaClient, asPma, visibleText } from './lib/pma.ts'

/**
 * Golden parity of the login under each auth type (docs/features/01 "Login page & authentication"):
 * the connection set-up statements (DatabaseInterface::postConnect and the connection collation)
 * the login runs, and the visible failure messages, phpMyAdmin vs BetterMyAdmin. Each role exists
 * twice (f01a_pa_* for phpMyAdmin, f01a_pb_* for BetterMyAdmin) so the general log separates the
 * tools. Only f01a_* users are created.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const ROLES = ['cfg', 'http', 'sso', 'ck'] as const
const user = (tool: 'pa' | 'pb', role: (typeof ROLES)[number]) => `f01a_${tool}_${role}`
const available = phpAvailable()
const basic = (u: string, p: string) => ({
  authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`,
})

/**
 * The session set-up statements of the last connection (X24: BetterMyAdmin runs them once per
 * pooled connection; phpMyAdmin per request, the login request of cookie auth redirecting before
 * the connection collation is set), compared as a sequence.
 */
const SETUP =
  /^(SELECT @@version, @@version_comment, @@sql_mode|SET NAMES |SET lc_messages |SET collation_connection |SET `time_zone` )/
const setup = (log: LogEntry[]) => {
  let out: string[] = []
  for (const e of log) {
    const sql = e.sql.replace(/;$/, '')
    if (!SETUP.test(sql)) continue
    if (sql.startsWith('SELECT @@version')) out = []
    out.push(sql)
  }
  return out
}

let root: mysql.Connection
let log: GeneralLog
let inst: PmaInstance
let dir: string
let bmaDir: string

const pmaServers = (script: string) => `$cfg['blowfish_secret'] = 'f01a-parity-secret-0123456789abcdef!';
$i = 1;
$cfg['Servers'][$i]['host'] = ${JSON.stringify(ROOT.host)};
$cfg['Servers'][$i]['port'] = ${JSON.stringify(String(ROOT.port))};
$cfg['Servers'][$i]['auth_type'] = 'config';
$cfg['Servers'][$i]['user'] = '${user('pa', 'cfg')}';
$cfg['Servers'][$i]['password'] = '${user('pa', 'cfg')}';
$i++;
$cfg['Servers'][$i]['host'] = ${JSON.stringify(ROOT.host)};
$cfg['Servers'][$i]['port'] = ${JSON.stringify(String(ROOT.port))};
$cfg['Servers'][$i]['auth_type'] = 'http';
$cfg['Servers'][$i]['auth_http_realm'] = 'F01a realm';
$i++;
$cfg['Servers'][$i]['host'] = ${JSON.stringify(ROOT.host)};
$cfg['Servers'][$i]['port'] = ${JSON.stringify(String(ROOT.port))};
$cfg['Servers'][$i]['auth_type'] = 'signon';
$cfg['Servers'][$i]['SignonScript'] = ${JSON.stringify(script)};
$cfg['Servers'][$i]['SignonURL'] = 'https://sso.example/login';
$i++;
$cfg['Servers'][$i]['host'] = ${JSON.stringify(ROOT.host)};
$cfg['Servers'][$i]['port'] = ${JSON.stringify(String(ROOT.port))};
$cfg['Servers'][$i]['auth_type'] = 'cookie';`

const pmaScript = (u: string, p: string) =>
  `<?php\nfunction get_login_credentials($user) { return [${JSON.stringify(u)}, ${JSON.stringify(p)}]; }\n`
const bmaScript = (u: string, p: string) =>
  `export function getLoginCredentials() { return [${JSON.stringify(u)}, ${JSON.stringify(p)}] }\n`

describe.skipIf(!available)('parity: auth types (src/Plugins/Auth/*, postConnect at login)', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    for (const r of ROLES)
      for (const tool of ['pa', 'pb'] as const) {
        const u = user(tool, r)
        await root.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}';`)
      }
    log = await GeneralLog.open(ROOT)
    dir = mkdtempSync(join(tmpdir(), 'f01a-pma-'))
    writeFileSync(join(dir, 'signon.php'), pmaScript(user('pa', 'sso'), user('pa', 'sso')))
    inst = await startPmaInstance(pmaServers(join(dir, 'signon.php')))
    // the test runner loads modules from the workspace only
    mkdirSync(join(process.cwd(), '.data'), { recursive: true })
    bmaDir = mkdtempSync(join(process.cwd(), '.data', 'f01a-'))
  })
  afterAll(async () => {
    for (const r of ROLES)
      for (const tool of ['pa', 'pb'] as const)
        await root?.query(`DROP USER IF EXISTS '${user(tool, r)}'@'%'`)
    await root?.end()
    await log?.close()
    await inst?.stop()
    rmSync(dir, { recursive: true, force: true })
    rmSync(bmaDir, { recursive: true, force: true })
  })

  /** BetterMyAdmin's statements of `u` while `fn` runs. */
  async function bmaLog(u: string, fn: () => Promise<unknown>): Promise<LogEntry[]> {
    const m = await log.marker()
    await fn()
    return log.since(u, m)
  }
  async function pmaLog(u: string, fn: () => Promise<unknown>): Promise<LogEntry[]> {
    const m = await log.marker()
    await fn()
    return log.since(u, m)
  }
  const server = { host: ROOT.host, port: String(ROOT.port) }

  it('[p01-03cad3] config: the connection set-up of the auto-login; the failure page messages', async () => {
    const pc = new PmaClient(inst.url)
    const pa = await pmaLog(user('pa', 'cfg'), () => pc.getPage('/index.php?route=/&server=1'))
    const t = testApp(
      testConfig(
        {},
        { ...server, auth_type: 'config', user: user('pb', 'cfg'), password: user('pb', 'cfg') },
      ),
    )
    try {
      const pb = await bmaLog(user('pb', 'cfg'), async () => {
        expect((await t.req('GET', '/api/auth/state')).json.authenticated).toBe(true)
        await t.req('GET', '/api/servers/1')
      })
      expect(setup(pb)).toEqual(setup(pa))
      expect(setup(pa).length).toBeGreaterThanOrEqual(3)
    } finally {
      await t.close()
    }

    // a wrong password: the connection error and "phpMyAdmin tried to connect…"
    inst.setConfig(
      pmaServers(join(dir, 'signon.php')).replace(
        `['password'] = '${user('pa', 'cfg')}'`,
        "['password'] = 'wrong'",
      ),
    )
    try {
      const html = await new PmaClient(inst.url).getPage('/index.php?route=/&server=1')
      const pmaErrors = [
        ...html.matchAll(/<div class="alert alert-danger" role="alert">([\s\S]*?)<\/div>/g),
      ].map((m) => visibleText(m[1] as string))
      const t2 = testApp(
        testConfig({}, { ...server, auth_type: 'config', user: user('pb', 'cfg'), password: 'wrong' }),
      )
      t2.deps.configFile = 'bettermyadmin.config.json'
      try {
        const f = (await t2.req('GET', '/api/auth/state')).json.failure as { errors: string[] }
        const norm = (l: string[]) =>
          l.map((x) => x.replace(/f01a_p[ab]_cfg/, 'USER').replace(/'@'[^']*'/, "'@'HOST'"))
        expect(norm(asPma(f.errors))).toEqual(norm(pmaErrors.filter((e) => !e.startsWith('Javascript'))))
        expect(html).toContain('Retry to connect')
      } finally {
        await t2.close()
      }
    } finally {
      inst.setConfig(pmaServers(join(dir, 'signon.php')))
    }
  })

  it('[p01-03cad3] http: 401 with the realm, the set-up statements, logout asks for another user', async () => {
    const pc = new PmaClient(inst.url)
    let status = 0
    let realm: string | null = null
    const denied = await pc.getPage(
      '/index.php?route=/&server=2',
      {},
      {
        headers: basic(user('pa', 'http'), 'bad'),
        onHeaders: (s, h) => {
          status = s
          realm = h.get('www-authenticate')
        },
      },
    )
    const t = testApp(testConfig({}, { ...server, auth_type: 'http', auth_http_realm: 'F01a realm' }))
    try {
      const bd = await t.req('GET', '/', undefined, basic(user('pb', 'http'), 'bad'))
      expect(bd.status).toBe(status)
      expect(bd.res.headers.get('www-authenticate')).toBe(realm)
      expect(visibleText(denied)).toContain('Wrong username/password. Access denied.')
      expect(bd.text).toContain('Wrong username/password. Access denied.')

      const pa = await pmaLog(user('pa', 'http'), () =>
        pc.getPage(
          '/index.php?route=/&server=2',
          {},
          { headers: basic(user('pa', 'http'), user('pa', 'http')) },
        ),
      )
      const pb = await bmaLog(user('pb', 'http'), async () => {
        await t.req('GET', '/', undefined, basic(user('pb', 'http'), user('pb', 'http')))
        await t.req('GET', '/api/servers/1')
      })
      expect(setup(pb)).toEqual(setup(pa))

      // logout: getLoginFormURL with old_usr, then the same user is asked again
      const token = (
        await pc.getPage(
          '/index.php?route=/&server=2',
          {},
          { headers: basic(user('pa', 'http'), user('pa', 'http')) },
        )
      ).match(/name="token" value="([^"]+)"/)?.[1]
      let location = ''
      await pc.postPage(
        '/index.php?route=/logout',
        { server: '2', token: token ?? '' },
        {
          headers: basic(user('pa', 'http'), user('pa', 'http')),
          noRedirect: true,
          onHeaders: (_s, h) => {
            location = h.get('location') ?? ''
          },
        },
      )
      await t.req('GET', '/api/auth/state') // the CSRF token
      const out = await t.req('POST', '/api/auth/logout', {})
      expect(location).toMatch(new RegExp(`old_usr=${user('pa', 'http')}$`))
      expect(String(out.json.logoutUrl)).toBe(`/?old_usr=${user('pb', 'http')}`)
      let again = 0
      await pc.getPage(
        `/index.php?route=/&server=2&old_usr=${user('pa', 'http')}`,
        {},
        {
          headers: basic(user('pa', 'http'), user('pa', 'http')),
          onHeaders: (s) => {
            again = s
          },
        },
      )
      const bAgain = await t.req(
        'GET',
        `/?old_usr=${user('pb', 'http')}`,
        undefined,
        basic(user('pb', 'http'), user('pb', 'http')),
      )
      expect(bAgain.status).toBe(again)
      expect(again).toBe(401)
    } finally {
      await t.close()
    }
  })

  it('[p01-03cad3] signon (SignonScript): the set-up statements; rejected credentials go to SignonURL', async () => {
    const pc = new PmaClient(inst.url)
    const script = join(bmaDir, 'signon-script.mjs')
    writeFileSync(script, bmaScript(user('pb', 'sso'), user('pb', 'sso')))
    const cfg = (s: string) =>
      testConfig(
        {},
        { ...server, auth_type: 'signon', SignonScript: s, SignonURL: 'https://sso.example/login' },
      )
    const t = testApp(cfg(script))
    try {
      const pa = await pmaLog(user('pa', 'sso'), () => pc.getPage('/index.php?route=/&server=3'))
      const pb = await bmaLog(user('pb', 'sso'), async () => {
        expect((await t.req('GET', '/')).status).toBe(404) // past the gate
        await t.req('GET', '/api/servers/1')
      })
      expect(setup(pb)).toEqual(setup(pa))
    } finally {
      await t.close()
    }

    writeFileSync(join(dir, 'signon-bad.php'), pmaScript(user('pa', 'sso'), 'bad'))
    inst.setConfig(pmaServers(join(dir, 'signon-bad.php')))
    const bad = join(bmaDir, 'signon-bad.mjs')
    writeFileSync(bad, bmaScript(user('pb', 'sso'), 'bad'))
    const t2 = testApp(cfg(bad))
    try {
      let status = 0
      let location = ''
      await new PmaClient(inst.url).getPage(
        '/index.php?route=/&server=3',
        {},
        {
          noRedirect: true,
          onHeaders: (s, h) => {
            status = s
            location = h.get('location') ?? ''
          },
        },
      )
      const r = await t2.req('GET', '/')
      expect(r.status).toBe(status)
      expect(r.res.headers.get('location')).toBe(location)
    } finally {
      await t2.close()
      inst.setConfig(pmaServers(join(dir, 'signon.php')))
    }
  })

  it('[p01-c1d562] cookie: the set-up statements of a form login; AllowRoot / AllowNoPassword messages', async () => {
    const pc = new PmaClient(inst.url)
    const pa = await pmaLog(user('pa', 'ck'), () => pc.login(user('pa', 'ck'), user('pa', 'ck'), 4))
    const t = testApp(testConfig({}, server))
    try {
      const pb = await bmaLog(user('pb', 'ck'), async () => {
        expect((await t.login(user('pb', 'ck'), user('pb', 'ck'))).status).toBe(200)
        await t.req('GET', '/api/servers/1')
      })
      expect(setup(pb)).toEqual(setup(pa))

      // AllowNoPassword false: phpMyAdmin's message for an empty password
      const tokenOf = (h: string) => h.match(/name="token" value="([^"]+)"/)?.[1] ?? ''
      const p2 = new PmaClient(inst.url)
      const form = await p2.getPage('/index.php?route=/')
      const res = await p2.postPage('/index.php?route=/', {
        token: tokenOf(form),
        set_session: form.match(/name="set_session" value="([^"]+)"/)?.[1] ?? '',
        pma_username: user('pa', 'ck'),
        pma_password: '',
        server: '4',
      })
      // after the <noscript> and the hidden HTTPS-mismatch alerts of login/header.twig
      const pmaMsg =
        [...res.matchAll(/<div class="alert alert-danger" role="alert">([\s\S]*?)<\/div>/g)]
          .map((m) => visibleText(m[1] as string))
          .find((x) => !x.startsWith('Javascript') && !x.startsWith('There is a mismatch')) ?? ''
      const b = await t.login(user('pb', 'ck'), '')
      expect((b.json.error as { message: string }).message).toBe(pmaMsg)
      expect(pmaMsg).toBe('Login without a password is forbidden by configuration (see AllowNoPassword).')
    } finally {
      await t.close()
    }
  })
})
