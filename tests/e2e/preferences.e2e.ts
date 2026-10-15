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

async function login(page: Page, done = true) {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  if (done) await expect(page.locator('#pma_navigation')).toBeVisible()
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

test('two-factor: configure the application backend, then the login asks for the code [p08-38b5dc] [p08-71a0b1] [p08-bce194]', async ({
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
  await login(page, false)
  await expect(
    page.getByText('You have enabled two factor authentication, please confirm your login.'),
  ).toBeVisible()
  await page.locator('[id="2faCodeInput"]').fill('000000')
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText('Two-factor authentication failed.')).toBeVisible()
  await page.locator('[id="2faCodeInput"]').fill(oathTotp(secret, Math.floor(Date.now() / 30000)))
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.locator('#pma_navigation')).toBeVisible()

  // disable again (asks for the current code)
  await page.goto('/s/1/preferences/two-factor')
  await page.getByRole('button', { name: 'Disable two-factor authentication' }).click()
  await expect(page.getByText('Confirm disabling two-factor authentication')).toBeVisible()
  await page.locator('[id="2faCodeInput"]').fill(oathTotp(secret, Math.floor(Date.now() / 30000)))
  await page.getByRole('button', { name: 'Disable two-factor authentication' }).click()
  await expect(page.getByText('Two-factor authentication has been removed.')).toBeVisible()
})

test('settings pages: eight pills in order, the current one marked, no navigation gear [p08-b1ce07] [p08-cd4d34]', async ({
  page,
}) => {
  await login(page)
  // the navigation gear (Navi page settings) on an ordinary page…
  await expect(page.locator('#pma_navigation_settings_icon')).toBeVisible()
  await page.goto('/s/1/preferences/sql')
  const pills = page.locator('#user_prefs_tabs a')
  await expect(pills).toHaveText([
    'Manage your settings',
    'Two-factor authentication',
    'Features',
    'SQL queries',
    'Navigation panel',
    'Main panel',
    'Export',
    'Import',
  ])
  await expect(page.locator('#user_prefs_tabs a[aria-current="page"]')).toHaveText('SQL queries')
  // TabsMode both (the default): an icon next to the labels of the form pages
  await expect(pills.nth(2).locator('[data-icon="ic_b_tblops"]')).toHaveCount(1)
  await expect(pills.nth(0).locator('[data-icon]')).toHaveCount(0)
  // …is hidden on the settings pages (disableNaviSettings)
  await expect(page.locator('#pma_navigation_settings_icon')).toHaveCount(0)
  await pills.nth(4).click()
  await expect(page).toHaveURL(/\/preferences\/navigation/)
  await expect(page.locator('#user_prefs_tabs a[aria-current="page"]')).toHaveText('Navigation panel')
})

test('browser storage: no saved settings, save to it, then import from it [p08-0d82bc] [p08-6b7a63] [p08-10a75c]', async ({
  page,
}) => {
  await login(page)
  await page.goto('/s/1/preferences/manage')
  await page.evaluate(() => {
    for (const k of ['config', 'configMtime', 'configMtimeLocal']) localStorage.removeItem(k)
  })
  await page.reload()
  await page.locator('#import_local_storage').check()
  await expect(page.getByText('You have no saved settings!')).toBeVisible()
  await expect(page.locator('form[name="prefs_import"] input[name="submit_import"]')).toBeDisabled()

  // Save to browser's storage: an Ajax round trip, the three keys, the form hidden, a message
  await page.locator('#export_local_storage').check()
  const exported = page.waitForResponse((r) => /\/preferences\/manage\/json$/.test(r.url()))
  await page.locator('input[name="submit_export"]').click()
  expect((await exported).ok()).toBe(true)
  const message = page.getByText('Configuration has been saved.')
  await expect(message).toBeVisible()
  const stored = await page.evaluate(() => ({
    config: localStorage.getItem('config'),
    mtime: localStorage.getItem('configMtime'),
    local: localStorage.getItem('configMtimeLocal'),
  }))
  expect(() => JSON.parse(stored.config ?? '')).not.toThrow()
  expect(stored.mtime).toMatch(/^\d+$/)
  expect(stored.local).not.toBeNull()
  await message.click()
  await expect(message).toBeHidden()

  await page.reload()
  await page.locator('#import_local_storage').check()
  await expect(page.getByText(/^Saved on: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)).toBeVisible()
})

test('browser storage unsupported: the notice, nothing to submit [p08-0d82bc]', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('blocked')
      },
    })
  })
  await login(page)
  await page.goto('/s/1/preferences/manage')
  // the radios stay usable; choosing one shows the notice and disables its form's submit
  await page.locator('#import_local_storage').check()
  await expect(page.locator('#opts_import_local_storage')).toContainText(
    'This feature is not supported by your web browser',
  )
  await expect(page.locator('form[name="prefs_import"] input[name="submit_import"]')).toBeDisabled()
  await page.locator('#export_local_storage').check()
  await expect(page.locator('#opts_export_local_storage')).toContainText(
    'This feature is not supported by your web browser',
  )
  await expect(page.locator('input[name="submit_export"]')).toBeDisabled()
})

test('import of a file with a theme and a language applies both at once [p08-5c8c99]', async ({ page }) => {
  await login(page)
  await page.goto('/s/1/preferences/manage')
  await page.locator('#import_text_file').check()
  await page.locator('#input_import_file').setInputFiles({
    name: 'prefs.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ThemeDefault: 'metro', lang: 'de' })),
  })
  await page.locator('form[name="prefs_import"] input[name="submit_import"]').click()
  await expect(page).toHaveURL(/saved=1/)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'metro')
  await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  // back to the defaults (and English for the next tests)
  await page.goto('/s/1/preferences/manage')
  page.once('dialog', (d) => void d.accept())
  await page.locator('input[name="submit_clear"]').click()
  await expect(page).toHaveURL(/saved=1/)
  // the language cookie back to English (the selector's ?lang=)
  await page.goto('/api/i18n?lang=en')
})
