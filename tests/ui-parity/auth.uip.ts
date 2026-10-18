import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { ROOT } from './lib/env.ts'
import { type BmaInstance, type PmaInstance, startBmaInstance, startPmaInstance } from './lib/instances.ts'
import { pageParity } from './lib/parity.ts'

/**
 * The login variants of docs/features/01 (captcha, arbitrary server), the config auth failure
 * page, the http auth 401 page and the signon redirect, each against its own phpMyAdmin instance
 * and our server with the same configuration. Only f01a_* objects are used.
 */
let stub: Server
let stubUrl = ''
const instances: Record<string, { pma: PmaInstance; ours: BmaInstance }> = {}

const host = { host: ROOT.host, port: String(ROOT.port) }
const pmaServer = (extra: string) => `$cfg['blowfish_secret'] = 'f01a-uip-secret-0123456789abcdefgh!';
$i = 1;
$cfg['Servers'][$i]['host'] = ${JSON.stringify(ROOT.host)};
$cfg['Servers'][$i]['port'] = ${JSON.stringify(String(ROOT.port))};
${extra}`

const VARIANTS = {
  captcha: {
    pma: () =>
      pmaServer(`$cfg['CaptchaApi'] = '${stubUrl}/api.js';
$cfg['CaptchaMethod'] = 'checkbox';
$cfg['CaptchaLoginPublicKey'] = 'site-key';
$cfg['CaptchaLoginPrivateKey'] = 'secret-key';`),
    ours: () => ({
      CaptchaApi: `${stubUrl}/api.js`,
      CaptchaMethod: 'checkbox',
      CaptchaLoginPublicKey: 'site-key',
      CaptchaLoginPrivateKey: 'secret-key',
      Servers: [host],
    }),
  },
  arbitrary: {
    pma: () => pmaServer(`$cfg['AllowArbitraryServer'] = true;`),
    ours: () => ({ AllowArbitraryServer: true, Servers: [host] }),
  },
  config: {
    pma: () =>
      pmaServer(`$cfg['Servers'][$i]['auth_type'] = 'config';
$cfg['Servers'][$i]['user'] = 'f01a_uip_nobody';
$cfg['Servers'][$i]['password'] = 'wrong';`),
    ours: () => ({ Servers: [{ ...host, auth_type: 'config', user: 'f01a_uip_nobody', password: 'wrong' }] }),
  },
  http: {
    pma: () =>
      pmaServer(`$cfg['Servers'][$i]['auth_type'] = 'http';
$cfg['Servers'][$i]['auth_http_realm'] = 'F01a';`),
    ours: () => ({ Servers: [{ ...host, auth_type: 'http', auth_http_realm: 'F01a' }] }),
  },
  signon: {
    pma: () =>
      pmaServer(`$cfg['Servers'][$i]['auth_type'] = 'signon';
$cfg['Servers'][$i]['SignonSession'] = 'SignonSession';
$cfg['Servers'][$i]['SignonURL'] = '${stubUrl}/sso';`),
    ours: () => ({
      Servers: [
        { ...host, auth_type: 'signon', SignonSession: 'SignonSession', SignonURL: `${stubUrl}/sso` },
      ],
    }),
  },
} as const
type Variant = keyof typeof VARIANTS

test.beforeAll(async () => {
  // the captcha script (empty) and the signon application's page
  stub = createServer((req, res) => {
    if (req.url?.startsWith('/api.js')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' })
      res.end('')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!doctype html><title>SSO</title><h1>Single signon</h1>')
  })
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r))
  stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`
  // the instances boot at once (each of ours is a tsx process: slow under load, one by one it
  // outran the hook timeout)
  test.setTimeout(180_000)
  await Promise.all(
    Object.entries(VARIANTS).map(async ([name, v]) => {
      const [pma, ours] = await Promise.all([startPmaInstance(v.pma()), startBmaInstance(v.ours())])
      instances[name] = { pma, ours }
    }),
  )
})
test.afterAll(async () => {
  for (const i of Object.values(instances)) {
    await i.pma.stop()
    await i.ours.stop()
  }
  await new Promise<void>((r) => stub?.close(() => r()))
})

const bases = (v: Variant) => () => ({ pma: instances[v]?.pma.url, ours: instances[v]?.ours.url })

pageParity('login-captcha', {
  auth: false,
  map: 'login',
  bases: bases('captcha'),
  pma: { route: '/' },
  ours: { path: '/' },
  scope: 'page',
  ready: { pma: '#input_username', ours: '#input_username' },
})

pageParity('login-arbitrary-server', {
  auth: false,
  map: 'login',
  bases: bases('arbitrary'),
  pma: { route: '/' },
  ours: { path: '/' },
  scope: 'page',
  ready: { pma: '#serverNameInput', ours: '#serverNameInput' },
})

pageParity('login-config-failure', {
  auth: false,
  bases: bases('config'),
  pma: { route: '/' },
  ours: { path: '/' },
  scope: 'page',
  ready: { pma: '#loginform', ours: '#loginform' },
})

pageParity('login-http-401', {
  auth: false,
  bases: bases('http'),
  context: {
    pma: { httpCredentials: { username: 'f01a_uip_nobody', password: 'wrong' } },
    ours: { httpCredentials: { username: 'f01a_uip_nobody', password: 'wrong' } },
  },
  pma: { route: '/' },
  ours: { path: '/' },
  scope: 'page',
  ready: { pma: '#loginform', ours: '#loginform' },
})

test('login-signon-redirect', async ({ browser }) => {
  // AuthenticationSignon::showLoginForm: without credentials both go to SignonURL
  const urls: string[] = []
  for (const app of ['pma', 'ours'] as const) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const base = instances.signon?.[app].url ?? ''
    await page.goto(app === 'pma' ? `${base}/index.php?route=/` : `${base}/`)
    await expect(page.locator('h1')).toHaveText('Single signon')
    urls.push(page.url())
    await ctx.close()
  }
  expect(urls[1]).toBe(urls[0])
  expect(urls[0]).toBe(`${stubUrl}/sso`)
})
