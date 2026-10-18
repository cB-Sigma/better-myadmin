import { expect, test } from '@playwright/test'
import { MYSQL } from './fixtures.ts'

/**
 * Feature 01: the login form's server choice, against the two-server e2e server
 * (bma-two-servers.config.ts). phpMyAdmin's AuthenticationCookie::rememberCredentials answers the
 * login with a redirect to `index.php?route=/&server=<chosen>`.
 */
test.use({ baseURL: `http://127.0.0.1:${process.env.BMA_E2E_TWO_SERVERS_PORT}` })

test('[p01-570894] logging in with server 2 chosen opens server 2, from / and from a page of server 1', async ({
  page,
}) => {
  for (const start of ['/', '/s/1/databases']) {
    await page.context().clearCookies()
    await page.goto(start)
    await expect(page.locator('#select_server')).toBeVisible()
    await page.locator('#select_server').selectOption({ label: 'f01 second' })
    await page.fill('#input_username', MYSQL.user)
    await page.fill('#input_password', MYSQL.password)
    await page.click('#input_go')
    await expect(page).toHaveURL(/\/s\/2\/?$/)
    await expect(page.locator('#server-breadcrumb')).toContainText('f01 second')
    // server 1 has no login in this session
    await page.request.post('/api/auth/logout', {
      headers: {
        'X-BMA-Token': (await page.context().cookies()).find((c) => c.name === 'bma_token')?.value ?? '',
      },
    })
  }
})

test('[p01-570894] the page shown stays when the login is on its server', async ({ page }) => {
  await page.goto('/s/1/databases')
  await page.fill('#input_username', MYSQL.user)
  await page.fill('#input_password', MYSQL.password)
  await page.click('#input_go')
  await expect(page).toHaveURL(/\/s\/1\/databases(\?|$)/)
  await expect(page.locator('#server-breadcrumb')).toContainText('f01 first')
})
