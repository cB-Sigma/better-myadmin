import { type Page, expect, test } from '@playwright/test'
import { MYSQL, login } from './fixtures.ts'

/**
 * The home page's General / Appearance settings (docs/features/06-server-level.md "Home",
 * templates/home/index.twig, Server\Select::render): server selection as a select and as a list
 * (DisplayServersList), Change password, connection collation, More settings, language and theme.
 * The server selection needs two servers: the second e2e server (bma-replica.config.ts) has them.
 */
const port = Number(process.env.BMA_E2E_PORT ?? 8099)
const twoServers = `http://127.0.0.1:${Number(process.env.BMA_E2E_REPLICA_PORT ?? port + 1)}`

/** logs in on that instance's server 2 (the e2e database server; server 1 is the replica, absent on MariaDB) */
async function loginAt(page: Page, base: string) {
  await page.goto(`${base}/`)
  await page.locator('#select_server').selectOption('2')
  await page.locator('#input_username').fill(MYSQL.user)
  await page.locator('#input_password').fill(MYSQL.password)
  await page.locator('#input_go').click()
  // the chosen server opens (rememberCredentials: index.php?route=/&server=2)
  await expect(page).toHaveURL(/\/s\/2\/?$/)
  await expect(page.locator('#maincontainer')).toBeVisible()
}

test.describe('home page [p06-c67ed8]', () => {
  test('server selection: labels (verbose, host:port - only_db), the select switches the server', async ({
    page,
  }) => {
    await loginAt(page, twoServers)
    const select = page.locator('#li_select_server #select_server')
    await expect(page.locator('#li_select_server')).toContainText('Current server:')
    await expect(select.locator('option')).toHaveText([
      '(Servers) ...',
      'Dev replica',
      `${MYSQL.host}:${MYSQL.port} - f06j_home_a, f06j_home_b`,
    ])
    await expect(select).toHaveValue('2')
    await select.selectOption('1')
    await expect(page).toHaveURL(/\/s\/1\b/)
  })

  test('server selection as a list of links with DisplayServersList', async ({ page }) => {
    await page.route(/\/api\/servers\/2\/home$/, async (route) => {
      const r = await route.fetch()
      await route.fulfill({ response: r, json: { ...(await r.json()), displayServersList: true } })
    })
    await loginAt(page, twoServers)
    const list = page.locator('#li_select_server #list_server')
    await expect(list.locator('strong')).toHaveText(`${MYSQL.host}:${MYSQL.port} - f06j_home_a, f06j_home_b`)
    await expect(list.getByRole('link')).toHaveText(['Dev replica'])
    await expect(page.locator('#li_select_server select')).toHaveCount(0)
  })

  test('change password link, connection collation, More settings, language and theme', async ({ page }) => {
    await login(page)
    await page.goto('/s/1')
    // one server: no selection
    await expect(page.locator('#li_select_server')).toHaveCount(0)

    await page.locator('#change_password_anchor').click()
    const dialog = page.getByRole('dialog', { name: 'Change password' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)

    // the collations grouped per character set; a change posts /collation-connection
    const collation = page.locator('#collationConnectionSelect')
    await expect(collation.locator('optgroup[label="utf8mb4"]')).toHaveCount(1)
    const posted = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/session\/collation$/.test(r.url()),
    )
    await collation.selectOption('utf8mb4_unicode_ci')
    expect((await posted).ok()).toBe(true)

    await expect(page.locator('#li_select_lang select')).toBeVisible()
    await expect(page.locator('#themeSelect')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Color mode for the theme' })).toBeVisible()
    await page.locator('#li_select_theme').getByRole('button', { name: 'View all' }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Take it' }).first()).toBeVisible()
    await page.keyboard.press('Escape')

    await page.locator('#li_user_preferences').getByRole('link', { name: 'More settings' }).click()
    await expect(page).toHaveURL(/\/s\/1\/preferences\/manage/)
  })
})
