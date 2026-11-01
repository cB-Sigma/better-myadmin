import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * Status › Dashboard (BetterMyAdmin only, parity exception X64): the cards render and update with
 * every poll, the poll interval and the pause button, no polling while the tab is hidden, the
 * threshold colouring and the privilege note.
 */
const DASHBOARD = /\/api\/servers\/1\/status\/dashboard$/

/** Counts the dashboard requests sent from now on. */
function countPolls(page: Page): { n: number } {
  const c = { n: 0 }
  page.on('request', (r) => {
    if (DASHBOARD.test(r.url())) c.n++
  })
  return c
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (h ? 'hidden' : 'visible'),
    })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}

test('the Status pills lead to the dashboard; phpMyAdmin landing page stays the default', async ({
  page,
}) => {
  await login(page)
  await page.goto('/s/1/status')
  await expect(page.locator('#statusPills a[aria-current="page"]')).toHaveText('Server')
  await expect(page.locator('#statusPills li').first()).toHaveText('Dashboard')
  await page.locator('#statusPills').getByRole('link', { name: 'Dashboard' }).click()
  await expect(page).toHaveURL(/\/s\/1\/status\/dashboard$/)
  await expect(page.locator('#statusPills a[aria-current="page"]')).toHaveText('Dashboard')
})

test('cards render and update with each poll; the rate and pause controls', async ({ page }) => {
  await login(page)
  const polls = countPolls(page)
  await page.goto('/s/1/status/dashboard')
  for (const id of [
    'qps',
    'connections',
    'threads',
    'bufferPoolHitRate',
    'bufferPoolUsage',
    'bytesIn',
    'bytesOut',
    'slow',
    'tableLocks',
    'tmpDisk',
  ])
    await expect(page.locator(`[data-card="${id}"]`)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.locator('[data-uptime]')).toContainText('Uptime:')
  // the first reading has no rate yet; the second one fills the queries per second
  await page.locator('#dashboardRate').selectOption('2')
  await expect(page.locator('[data-card="qps"] [data-value]')).not.toHaveText('–', { timeout: 10_000 })
  await expect(page.locator('[data-card="qps"] svg path').last()).toHaveAttribute('d', /^M/)
  const before = polls.n
  await expect.poll(() => polls.n, { timeout: 10_000 }).toBeGreaterThanOrEqual(before + 2)
  await expect(page.locator('#dashboardState')).toContainText('Last update:')

  // pause: no more requests; resume reads at once
  await page.locator('#dashboardPause').click()
  await expect(page.locator('#dashboardPause')).toHaveText('Resume monitor')
  await expect(page.locator('#dashboardState')).toHaveText('Paused')
  const paused = polls.n
  await page.waitForTimeout(4500)
  expect(polls.n).toBe(paused)
  await page.locator('#dashboardPause').click()
  await expect(page.locator('#dashboardPause')).toHaveText('Pause monitor')
  await expect.poll(() => polls.n, { timeout: 5_000 }).toBeGreaterThan(paused)
})

test('no polling while the tab is hidden', async ({ page }) => {
  await login(page)
  const polls = countPolls(page)
  await page.goto('/s/1/status/dashboard')
  await page.locator('#dashboardRate').selectOption('2')
  await expect.poll(() => polls.n, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
  await setHidden(page, true)
  await expect(page.locator('#dashboardState')).toHaveAttribute('data-state', 'stopped')
  const hidden = polls.n
  await page.waitForTimeout(4500)
  expect(polls.n).toBe(hidden)
  await setHidden(page, false)
  await expect.poll(() => polls.n, { timeout: 5_000 }).toBeGreaterThan(hidden)
  await expect(page.locator('#dashboardState')).toHaveAttribute('data-state', 'running')
})

test('thresholds colour a card; a missing privilege is a note, not an error page', async ({ page }) => {
  await login(page)
  let questions = 1000
  await page.route(DASHBOARD, async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    questions += 500
    body.status = {
      ...body.status,
      Threads_connected: '90',
      Questions: String(questions),
      Created_tmp_tables: '100',
      Created_tmp_disk_tables: '10',
    }
    body.variables = { ...body.variables, max_connections: '100' }
    body.replica = 'denied'
    await route.fulfill({ response: res, json: body })
  })
  await page.goto('/s/1/status/dashboard')
  const connections = page.locator('[data-card="connections"]')
  await expect(connections).toHaveAttribute('data-level', 'warning')
  await expect(connections).toContainText('Warning')
  await expect(connections.locator('[data-value]')).toHaveText('90 / 100')
  await expect(page.locator('[data-card="tmpDisk"]')).toHaveAttribute('data-level', 'ok')
  await expect(page.locator('#dashboardReplicaNote')).toContainText('REPLICATION CLIENT')
  await expect(page.locator('[data-card="replicaLag"]')).toHaveCount(0)
})

test('on a replica: the replication lag card', async ({ page, baseURL }) => {
  const replica = { ...MYSQL, port: Number(process.env.BMA_PARITY_REPLICA_PORT ?? 3308) }
  const isReplica = await mysql
    .createConnection(replica)
    .then(async (c) => {
      const [rows] = (await c.query('SHOW REPLICA STATUS')) as unknown as [unknown[]]
      await c.end()
      return rows.length > 0
    })
    .catch(() => false)
  test.skip(!isReplica, 'the dev replica is not running')
  const port = Number(process.env.BMA_E2E_REPLICA_PORT ?? Number(new URL(baseURL!).port) + 1)
  await page.goto(`http://127.0.0.1:${port}/`)
  await page.fill('#input_username', MYSQL.user)
  await page.fill('#input_password', MYSQL.password)
  await page.click('#input_go')
  await expect(page.locator('#maincontainer')).toBeVisible()
  await page.goto(`http://127.0.0.1:${port}/s/1/status/dashboard`)
  await expect(page.locator('[data-card="qps"]')).toBeVisible()
  const lag = page.locator('[data-card="replicaLag"]')
  await expect(lag).toBeVisible()
  await expect(lag).toContainText('SQL:')
})
