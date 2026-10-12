import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { encodeSignonSession } from '../../apps/server/src/auth/signon.ts'
import { type BmaInstance, startBmaInstance } from '../ui-parity/lib/instances.ts'

/**
 * The auth types without a login form, the login captcha and rate limit, and the setup wizard,
 * each against its own server instance (docs/features/01). Only the f01a_e2e user is created.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f01a_e2e'
const SECRET = 'f01a-e2e-secret-0123456789abcdefgh!'
const host = { host: ROOT.host, port: ROOT.port }

let stub: Server
let stubUrl = ''
const verified: string[] = []
const running: BmaInstance[] = []
const start = async (cfg?: Record<string, unknown>) => {
  const i = await startBmaInstance(cfg === undefined ? undefined : { blowfish_secret: SECRET, ...cfg })
  running.push(i)
  return i
}

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';`)
  await c.end()
  // a captcha API whose widget answers at once, its verify endpoint and a signon page
  stub = createServer((req, res) => {
    if (req.url?.startsWith('/api.js')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' })
      res.end(`for (const el of document.querySelectorAll('.g-recaptcha')) {
  const t = document.createElement('textarea'); t.name = 'g-recaptcha-response'; t.value = 'token-1'; t.hidden = true; el.append(t)
}`)
      return
    }
    if (req.url === '/siteverify') {
      let body = ''
      req.on('data', (d) => {
        body += d
      })
      req.on('end', () => {
        verified.push(body)
        res.end('{"success": true}')
      })
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!doctype html><title>SSO</title><h1>Single signon</h1>')
  })
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r))
  stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  for (const i of running) await i.stop()
  await new Promise<void>((r) => stub?.close(() => r()))
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

test('config auth opens the home page without a form [p01-03cad3]', async ({ page }) => {
  const i = await start({ Servers: [{ ...host, auth_type: 'config', user: USER, password: USER }] })
  await page.goto(`${i.url}/`)
  await expect(page.locator('#pma_navigation')).toBeVisible()
  await expect(page.locator('#input_username')).toHaveCount(0)
})

test('config auth with a wrong password shows the failure page [p01-03cad3]', async ({ page }) => {
  const i = await start({ Servers: [{ ...host, auth_type: 'config', user: USER, password: 'wrong' }] })
  await page.goto(`${i.url}/`)
  await expect(page.getByText(/^1045: Access denied for user 'f01a_e2e'@/)).toBeVisible()
  await expect(page.getByText(/phpMyAdmin tried to connect to the MySQL server/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Retry to connect' })).toBeVisible()
})

test('http auth: Basic credentials log in, logout asks again [p01-03cad3]', async ({ browser }) => {
  const i = await start({ Servers: [{ ...host, auth_type: 'http' }] })
  const ctx = await browser.newContext({ httpCredentials: { username: USER, password: USER } })
  const page = await ctx.newPage()
  await page.goto(`${i.url}/`)
  await expect(page.locator('#pma_navigation')).toBeVisible()
  await page.locator('#userAccountDropdown button').first().click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  // ?old_usr=f01a_e2e refuses the same user: the 401 page
  await expect(page).toHaveURL(/old_usr=f01a_e2e/)
  await expect(page.getByText('Wrong username/password. Access denied.')).toBeVisible()
  await ctx.close()
})

test('signon: no session goes to SignonURL, the SignonSession cookie logs in [p01-03cad3]', async ({
  browser,
}) => {
  const i = await start({
    Servers: [{ ...host, auth_type: 'signon', SignonSession: 'SignonSession', SignonURL: `${stubUrl}/sso` }],
  })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`${i.url}/`)
  await expect(page).toHaveURL(`${stubUrl}/sso`)
  await ctx.addCookies([
    {
      name: 'SignonSession',
      value: encodeSignonSession(SECRET, { PMA_single_signon_user: USER, PMA_single_signon_password: USER }),
      url: i.url,
    },
  ])
  await page.goto(`${i.url}/`)
  await expect(page.locator('#pma_navigation')).toBeVisible()
  await ctx.close()
})

test('captcha: the widget token is verified at login [p01-cdb8f8] [p01-f1880c]', async ({ page }) => {
  const i = await start({
    Servers: [host],
    CaptchaApi: `${stubUrl}/api.js`,
    CaptchaCsp: stubUrl,
    CaptchaMethod: 'checkbox',
    CaptchaLoginPublicKey: 'site-key',
    CaptchaLoginPrivateKey: 'secret-key',
    CaptchaSiteVerifyURL: `${stubUrl}/siteverify`,
  })
  await page.goto(`${i.url}/`)
  await expect(page.locator('.g-recaptcha[data-sitekey="site-key"]')).toBeAttached()
  await expect(page.locator('textarea[name="g-recaptcha-response"]')).toBeAttached()
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
  expect(new URLSearchParams(verified.at(-1)).get('response')).toBe('token-1')
})

test('login rate limit: locked out after the failed attempts (X2)', async ({ page }) => {
  const i = await start({
    Servers: [host],
    LoginRateLimit: { maxAttempts: 2, windowSeconds: 900, lockoutSeconds: 300 },
  })
  await page.goto(`${i.url}/`)
  for (let n = 0; n < 2; n++) {
    await page.locator('#input_username').fill(USER)
    await page.locator('#input_password').fill('bad')
    await page.locator('#input_go').click()
    await expect(page.getByText(/^1045: Access denied/)).toBeVisible()
  }
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(
    page.getByText(/^Too many failed login attempts\. Please try again in \d+ seconds\.$/),
  ).toBeVisible()
})

test('setup wizard: add a server, display the files, delete it [p01-984896]', async ({ page }) => {
  const i = await start()
  await page.goto(`${i.url}/setup`)
  await expect(page.getByText('There are no configured servers')).toBeVisible()
  await page.getByRole('button', { name: 'New server' }).click()
  await expect(page.getByRole('heading', { name: 'Add a new server' })).toBeVisible()
  await page.locator('#Servers-0-host').fill('db.example')
  await page.getByRole('tab', { name: 'Authentication' }).click()
  await page.locator('#Servers-0-auth_type').selectOption('http')
  await page.locator('#Server_auth input[name=submit_save]').click()
  await expect(page.getByRole('cell', { name: 'mysqli://db.example' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'http' })).toBeVisible()

  await page.getByRole('button', { name: 'Display' }).click()
  const text = page.locator('textarea[name=textconfig]')
  await expect(text).toHaveValue(/\$cfg\['Servers'\]\[\$i\]\['host'\] = 'db\.example';/)
  await page.getByRole('tab', { name: 'bettermyadmin.config.json' }).click()
  await expect(text).toHaveValue(/"auth_type": "http"/)

  await page.getByRole('link', { name: 'Overview' }).click()
  await page.getByText('Delete').click()
  await expect(page.getByText('There are no configured servers')).toBeVisible()
})

test('setup is disabled once a configuration file exists [p01-e2f8e5]', async ({ page }) => {
  const i = await start({ Servers: [host] })
  await page.goto(`${i.url}/setup`)
  await expect(page.getByText('Configuration already exists, setup is disabled!')).toBeVisible()
})
