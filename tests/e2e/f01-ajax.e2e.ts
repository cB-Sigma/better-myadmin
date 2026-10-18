import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * Feature 01 checklist: the AJAX model (docs/features/01-shell-navigation-auth.md#ajax-model), as
 * the SPA does it: client-side routes instead of page swaps, the API client instead of jQuery.
 * Objects prefixed f01a_.
 */
const DB = 'f01a_e2e'

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY); INSERT INTO ${DB}.t VALUES (1), (2);
    CREATE TABLE ${DB}.u (id INT PRIMARY KEY);`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection(MYSQL)
  await c.query(`DROP DATABASE IF EXISTS ${DB}`)
  await c.end()
})

test('[p01-03005f] [p01-b3cadb] a link loads the page in place: the navigation, the console and its messages stay; content, title and footer link change', async ({
  page,
}) => {
  await login(page)
  await page.evaluate(() => {
    ;(window as unknown as { f01Marker: number }).f01Marker = 1
  })
  await page.locator('.console_switch').click()
  const messages = page.getByTestId('console-messages')
  await page.locator('.console_query_input .cm-content').click()
  await page.keyboard.insertText('SELECT 1 AS f01a_kept')
  await page.keyboard.press('Control+Enter')
  await expect(messages.locator('.message', { hasText: 'f01a_kept' })).toBeVisible()
  // the console shows its result on the SQL page; let that navigation finish first
  await expect(page).toHaveURL(/\/s\/1\/sql$/)
  await expect(page.getByText(/Showing rows/).first()).toBeVisible({ timeout: 15000 })
  const db = page.locator(`#pma_navigation [role=treeitem][data-kind=database][data-name="${DB}"]`)
  await db.getByRole('link', { name: DB, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/db/${DB}/`))
  await expect(page).toHaveTitle(new RegExp(` / ${DB} \\|`))
  expect(await page.locator('#selflink a').getAttribute('href')).toContain(`/db/${DB}/`)
  // no page reload: the window state, the console messages are kept
  expect(await page.evaluate(() => (window as unknown as { f01Marker?: number }).f01Marker)).toBe(1)
  await expect(messages.locator('.message', { hasText: 'f01a_kept' })).toBeVisible()
  // a link with a target is left to the browser
  await expect(page.locator('#selflink a')).toHaveAttribute('target', '_blank')
})

test('[p01-f41bfa] every navigation is a history entry; Back shows the previous page again', async ({
  page,
}) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/structure`)
  await expect(page.locator('#tablesForm, #structure_content').first()).toBeVisible()
  await page.locator('#topmenu [data-tab="sql"]').click()
  await expect(page).toHaveURL(/\/sql$/)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/db/${DB}/structure$`))
  await expect(page.locator('#tablesForm, #structure_content').first()).toBeVisible()
})

test('[p01-40520e] every POST carries the token; API answers are never cached', async ({ page }) => {
  await login(page)
  const posts: Array<Record<string, string>> = []
  const gets: string[] = []
  page.on('request', (r) => {
    if (!r.url().includes('/api/')) return
    if (r.method() === 'POST') posts.push(r.headers())
  })
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.request().method() === 'GET')
      gets.push(r.headers()['cache-control'] ?? '')
  })
  await page.goto(`/s/1/db/${DB}/sql`)
  const editor = page.locator('#sqlquery .cm-content')
  // under load the editor can mount after the first keystrokes: type until it holds the query
  await expect(async () => {
    await editor.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.insertText('SELECT 1')
    await expect(editor).toHaveText('SELECT 1', { timeout: 1000 })
  }).toPass({ timeout: 15000 })
  await page.locator('#button_submit_query').click()
  await expect(page.getByText(/Showing rows/).first()).toBeVisible({ timeout: 15000 })
  expect(posts.length).toBeGreaterThan(0)
  for (const h of posts) expect(h['x-bma-token']).toBeTruthy()
  expect(gets.length).toBeGreaterThan(0)
  for (const c of gets) expect(c).toBe('no-store')
})

test('[p01-211041] a failing request shows its error; a lost session brings back the login form', async ({
  page,
  context,
}) => {
  await login(page)
  await page.route('**/api/servers/1/status', (r) =>
    r.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL', message: 'f01a broken' } }),
    }),
  )
  await page.goto('/s/1/status')
  await expect(page.getByText('f01a broken')).toBeVisible()
  await page.unroute('**/api/servers/1/status')
  await context.clearCookies()
  // a page not loaded (nor preloaded) yet in this session; a background request may bring the
  // login form back first, which detaches the menu
  await page
    .locator('#topmenu a[href$="/variables"]')
    .click({ timeout: 5000 })
    .catch(() => undefined)
  await expect(page.locator('#login_form')).toBeVisible({ timeout: 15000 })
})

test('[p01-47c1c5] a new click replaces a navigation still loading', async ({ page }) => {
  await login(page)
  // the database Structure page answers slowly
  await page.route('**/api/servers/1/databases/*/structure*', async (r) => {
    await new Promise((res) => setTimeout(res, 1500))
    await r.continue()
  })
  await page.goto('/s/1')
  const db = page.locator(`#pma_navigation [role=treeitem][data-kind=database][data-name="${DB}"]`)
  await db.getByRole('link', { name: DB, exact: true }).click()
  // the server link of the breadcrumb, before the structure answered
  await page.locator('#server-breadcrumb a').first().click()
  await expect(page).toHaveURL(/\/s\/1\/?$/)
  await page.waitForTimeout(2000)
  await expect(page).toHaveURL(/\/s\/1\/?$/)
  await expect(page.locator('#maincontainer')).toBeVisible()
})

test('[p01-9c9c53] the confirmation modal "Confirm" with OK / Close', async ({ page }) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/structure`)
  const row = page.locator('tr', { has: page.getByRole('link', { name: 'u', exact: true }) })
  await row.locator('.truncate_table_anchor').click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Confirm')
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
})
