import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * Feature 08 checklist (docs/features/08-settings-preferences-pmadb.md): the settings pages' tabs,
 * the navigation gear on them, the browser-storage import / export of Manage your settings, the
 * import applying theme and language, and two-factor authentication without permanent storage.
 * Uses the user f08b_e2e (its preferences live in the e2e server's local store).
 */
const USER = 'f08b_e2e'

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection(MYSQL)
  await c.query(`DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

const TABS = [
  'Manage your settings',
  'Two-factor authentication',
  'Features',
  'SQL queries',
  'Navigation panel',
  'Main panel',
  'Export',
  'Import',
]

test('[p08-b1ce07] eight pills in phpMyAdmin’s order, icons per TabsMode, the current one marked [p08-cd4d34]', async ({
  page,
}) => {
  await login(page, USER, USER)
  await page.goto('/s/1/preferences/sql')
  const pills = page.locator('#user_prefs_tabs a.nav-link')
  await expect(pills).toHaveText(TABS)
  await expect(page.locator('#user_prefs_tabs a[aria-current="page"]')).toHaveText('SQL queries')
  await expect(page.locator('#user_prefs_tabs a[aria-current="page"]')).toHaveClass(/active/)
  // TabsMode both: the six setting pages have an icon, the first two never
  await expect(page.locator('#user_prefs_tabs a.nav-link:has([data-icon])')).toHaveCount(6)
  await expect(page.locator('#user_prefs_tabs a[data-tab="manage"] [data-icon]')).toHaveCount(0)
  // the navigation gear is hidden on the settings pages
  await expect(page.locator('#pma_navigation_settings_icon')).toHaveCount(0)
  await page.goto('/s/1/')
  await expect(page.locator('#pma_navigation_settings_icon')).toBeVisible()

  // TabsMode text: no icons
  await page.route('**/api/meta/config-public', async (r) => {
    const res = await r.fetch()
    await r.fulfill({ response: res, json: { ...(await res.json()), TabsMode: 'text' } })
  })
  await page.goto('/s/1/preferences/features')
  await expect(pills).toHaveText(TABS)
  await expect(page.locator('#user_prefs_tabs [data-icon]')).toHaveCount(0)
})

test('[p08-6b7a63] Save to browser’s storage: config, configMtime and configMtimeLocal; the form is replaced by a click-to-dismiss message', async ({
  page,
}) => {
  await login(page, USER, USER)
  await page.goto('/s/1/preferences/manage')
  await page.locator('#export_local_storage').check()
  await expect(page.locator('#opts_export_local_storage .localStorage-supported')).toBeVisible()
  await page.locator('form[name=prefs_export] input[name=submit_export]').click()
  const saved = page.locator('.click-hide-message')
  await expect(saved).toHaveText('Configuration has been saved.')
  await expect(page.locator('form[name=prefs_export]')).toHaveCount(0)
  const stored = await page.evaluate(() => ({
    config: localStorage.getItem('config'),
    mtime: localStorage.getItem('configMtime'),
    local: localStorage.getItem('configMtimeLocal'),
  }))
  expect(JSON.parse(stored.config ?? 'null')).toEqual(expect.any(Object))
  expect(stored.mtime).toMatch(/^\d+$/)
  expect(new Date(stored.local ?? '').toString()).not.toBe('Invalid Date')
  await saved.click()
  await expect(page.locator('form[name=prefs_export]')).toBeVisible()
  await expect(page.locator('#opts_export_local_storage .localStorage-exists')).toHaveText(
    'Existing settings will be overwritten!',
  )
})

test('[p08-0d82bc] without localStorage both browser-storage options show the unsupported notice and cannot submit', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
  })
  await login(page, USER, USER)
  await page.goto('/s/1/preferences/manage')
  await page.locator('#import_local_storage').check()
  await expect(page.locator('#opts_import_local_storage .localStorage-unsupported')).toHaveText(
    'This feature is not supported by your web browser',
  )
  await expect(page.locator('form[name=prefs_import] input[name=submit_import]')).toBeDisabled()
  await page.locator('#export_local_storage').check()
  await expect(page.locator('#opts_export_local_storage .localStorage-unsupported')).toHaveText(
    'This feature is not supported by your web browser',
  )
  await expect(page.locator('form[name=prefs_export] input[name=submit_export]')).toBeDisabled()
})

test('[p08-5c8c99] an imported ThemeDefault applies at once; a different lang switches the language', async ({
  page,
}) => {
  await login(page, USER, USER)
  await page.goto('/s/1/preferences/manage')
  await page.locator('#input_import_file').setInputFiles({
    name: 'prefs.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ThemeDefault: 'metro', lang: 'fr' })),
  })
  await page.locator('form[name=prefs_import] input[name=submit_import]').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'metro')
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(page).toHaveURL(/preferences\/manage\?saved=1/)
  // back to English and the default theme, then the preferences reset
  await page.evaluate(() => fetch('/api/i18n?lang=en'))
  await page.goto('/s/1/preferences/manage')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.locator('form[name=prefs_reset] input[name=submit_clear]').click()
})

test('[p08-d68897] without permanent storage the two-factor tab says it is not available', async ({
  page,
}) => {
  await login(page, USER, USER)
  await page.route('**/api/servers/1/preferences/two-factor', async (r) => {
    const res = await r.fetch()
    await r.fulfill({ response: res, json: { ...(await res.json()), enabled: false } })
  })
  await page.goto('/s/1/preferences/two-factor')
  await expect(
    page.getByText(
      'Two-factor authentication is not available, enable phpMyAdmin configuration storage to use it.',
    ),
  ).toBeVisible()
  // main.twig: the status card says so; the configure card still follows (has_backends)
  await expect(page.getByText('Two-factor authentication is available, but not configured')).toHaveCount(0)
})
