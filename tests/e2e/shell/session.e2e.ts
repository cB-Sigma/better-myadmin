import { expect, test } from '@playwright/test'
import { E2E, login } from '../fixtures.ts'

/**
 * The session timeout and failed requests (docs/features/01-shell-navigation-auth.md):
 * functions.ts onloadIdleEvent (the idle check, the login form over the page) and
 * ajax.ts getFatalErrorHandler ("Error in processing request").
 */
test.describe('session', () => {
  test('the idle check finds the login gone: the login form opens over the page, which then goes on [p01-66071e]', async ({
    page,
  }) => {
    await page.clock.install()
    await login(page)
    await page.goto(`/s/1/db/${E2E.db}/structure`)
    await expect(page.locator('[data-tab="structure"][aria-current="page"]')).toBeVisible()
    // the server answers that the session ended for inactivity
    let checks = 0
    await page.route('**/api/auth/check-timeout', async (route) => {
      checks++
      await route.fulfill({
        json: {
          success: false,
          message:
            'You have been automatically logged out due to inactivity of 1440 seconds. Once you log in again, you should be able to resume the work where you left off.',
        },
      })
    })
    // LoginCookieValidity (1440 s) less 5 s without activity: the check runs
    await page.clock.fastForward(1440 * 1000)
    const overlay = page.locator('#modalOverlay')
    await expect(overlay).toBeVisible()
    expect(checks).toBe(1)
    await expect(overlay).toContainText('automatically logged out due to inactivity of 1440 seconds')
    // the page is still there below
    await expect(page.locator('[data-tab="structure"][aria-current="page"]')).toBeAttached()
    await overlay.locator('#input_username').fill('root')
    await overlay.locator('#input_password').fill(process.env.BMA_TEST_PASSWORD ?? 'root')
    await overlay.locator('#input_go').click()
    await expect(overlay).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`/db/${E2E.db}/structure$`))
  })

  test('a request without an answer shows "Error in processing request" with the connection hint', async ({
    page,
  }) => {
    await login(page)
    await page.route('**/api/servers/1/databases/**', (route) => route.abort('connectionfailed'))
    await page.goto(`/s/1/db/${E2E.db}/structure`)
    const note = page.locator('.ajax_notification').filter({ hasText: 'Error in processing request' })
    await expect(note).toBeVisible()
    await expect(note).toContainText(
      'It seems that the connection to server has been lost. Please check your network connectivity and server status.',
    )
  })

  test('a 401 answer shows the login form again ("Your session has expired")', async ({ page }) => {
    await login(page)
    await page.goto(`/s/1/db/${E2E.db}/structure`)
    await expect(page.locator('[data-tab="structure"][aria-current="page"]')).toBeVisible()
    // the login is gone server-side (logged out in another window)
    const token = await page.evaluate(() => document.cookie.match(/bma_token=([^;]+)/)?.[1] ?? '')
    await page.request.post('/api/auth/logout', { headers: { 'X-BMA-Token': decodeURIComponent(token) } })
    // the next request of the page answers 401 (the navigation reload here): the gate reads the
    // login state and shows the form, without a page load
    const loads: string[] = []
    page.on('framenavigated', (f) => loads.push(f.url()))
    // (a request already under way may get there first: the page is then gone already)
    await page
      .locator('#pma_navigation_reload')
      .click({ timeout: 3000 })
      .catch(() => {})
    await expect(page.locator('#login_form')).toBeVisible()
    await expect(page.getByText('Your session has expired. Please log in again.')).toBeVisible()
    expect(loads).toEqual([])
  })
})
