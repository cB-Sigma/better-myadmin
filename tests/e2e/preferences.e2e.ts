import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { oathTotp } from '../../apps/server/src/preferences/totp.ts'

/**
 * User preferences end to end (docs/features/08-settings-preferences-pmadb.md): a Settings form
 * with validation, restore-default and save; the Browse page settings gear applied to the grid;
 * two-factor authentication configured and asked at the next login. The e2e server stores
 * preferences in its local metadata store (no pmadb).
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f08_e2e'
const DB = 'f08_e2e'

async function login(page: Page) {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
}

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  const values = Array.from({ length: 40 }, (_, i) => `(${i + 1})`).join(',')
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY); INSERT INTO t VALUES ${values};
    CREATE TABLE t2 (id INT PRIMARY KEY); INSERT INTO t2 VALUES ${values};
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f08\\_e2e\`.* TO '${USER}'@'%';`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

test('Settings form: validation, restore default and save [p08-779a14] [p08-a8211e]', async ({ page }) => {
  await login(page)
  await page.goto('/s/1/preferences/features')
  await page.locator('#Databases-tab').click()
  const box = page.locator('#MaxTableList')
  await expect(box).toHaveValue('250')
  // validation runs on change (blur), like config.ts
  await box.fill('0')
  await box.blur()
  await expect(page.locator('#Databases .inline_errors')).toHaveText('Not a positive number!')
  await expect(box).toHaveClass(/custom/)
  // restore default value
  await page.locator('#Databases a.restore-default[href="#MaxTableList"]').click()
  await expect(box).toHaveValue('250')
  await expect(box).not.toHaveClass(/custom/)
  await box.fill('120')
  await box.blur()
  await page.locator('#Databases input[name=submit_save]').click()
  await expect(page.getByText('Configuration has been saved.')).toBeVisible()
  await expect(page).toHaveURL(/saved=1/)
  await page.reload()
  await page.locator('#Databases-tab').click()
  await expect(page.locator('#MaxTableList')).toHaveValue('120')
})

test('Browse page settings: Maximum number of rows applies to the grid [p08-4eeac3] [p08-8abc69]', async ({
  page,
}) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/t/browse`)
  await expect(page.getByText('Showing rows 0 - 24', { exact: false })).toBeVisible()
  await page.locator('#page_settings_icon button').click()
  const modal = page.locator('#pageSettingsModal')
  await expect(modal.getByText('Page-related settings')).toBeVisible()
  await modal.locator('select#MaxRows').selectOption('50')
  await modal.locator('#pageSettingsModalApplyButton').click()
  await expect(modal).toBeHidden()
  // a query browsed for the first time takes the new MaxRows (a browsed one keeps its session max_rows)
  await page.goto(`/s/1/db/${DB}/t/t2/browse`)
  await expect(page.getByText('Showing rows 0 - 39', { exact: false })).toBeVisible()
  await page.locator('#page_settings_icon button').click()
  await expect(page.locator('#pageSettingsModal select#MaxRows')).toHaveValue('50')
})

test('two-factor: configure the application backend, then the login asks for the code [p08-38b5dc] [p08-71a0b1]', async ({
  page,
}) => {
  await login(page)
  await page.goto('/s/1/preferences/two-factor')
  await expect(
    page.getByText('Two-factor authentication is available, but not configured for this account.'),
  ).toBeVisible()
  await page.getByRole('radio', { name: /^Authentication Application/ }).check()
  await page.getByRole('button', { name: 'Configure two-factor authentication' }).click()
  const secret =
    (await page
      .locator('strong')
      .filter({ hasText: /^[A-Z2-7]{16}$/ })
      .textContent()) ?? ''
  expect(secret).toMatch(/^[A-Z2-7]{16}$/)
  await expect(page.getByRole('img', { name: 'QR code' })).toBeVisible()
  await page.locator('input[name="2fa_code"]').fill(oathTotp(secret, Math.floor(Date.now() / 30000)))
  await page.getByRole('button', { name: 'Enable two-factor authentication' }).click()
  await expect(page.getByText('Two-factor authentication has been configured.')).toBeVisible()

  // a new login: password first, then the code
  await page.context().clearCookies()
  await login(page)
  await expect(
    page.getByText('You have enabled two factor authentication, please confirm your login.'),
  ).toBeVisible()
  await page.locator('#2faCodeInput').fill('000000')
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText('Two-factor authentication failed.')).toBeVisible()
  await page.locator('#2faCodeInput').fill(oathTotp(secret, Math.floor(Date.now() / 30000)))
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.locator('#pma_navigation')).toBeVisible()

  // disable again (asks for the current code)
  await page.goto('/s/1/preferences/two-factor')
  await page.getByRole('button', { name: 'Disable two-factor authentication' }).click()
  await expect(page.getByText('Confirm disabling two-factor authentication')).toBeVisible()
  await page.locator('#2faCodeInput').fill(oathTotp(secret, Math.floor(Date.now() / 30000)))
  await page.getByRole('button', { name: 'Disable two-factor authentication' }).click()
  await expect(page.getByText('Two-factor authentication has been removed.')).toBeVisible()
})
