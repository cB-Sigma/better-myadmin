import { expect, test } from '@playwright/test'
import { MYSQL } from './fixtures.ts'

/**
 * Feature 01: the login form's server choice, against the second e2e server
 * (bma-replica.config.ts: server 1 the dev replica, server 2 the primary). phpMyAdmin's
 * AuthenticationCookie::rememberCredentials answers the login with a redirect to
 * `index.php?route=/&server=<chosen>`.
 */
const port = Number(process.env.BMA_E2E_PORT ?? 8099)
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.BMA_E2E_REPLICA_PORT ?? port + 1)}` })

async function logIn(page: import('@playwright/test').Page, server: string | null) {
  if (server !== null) await page.locator('#select_server').selectOption(server)
  await page.fill('#input_username', MYSQL.user)
  await page.fill('#input_password', MYSQL.password)
  await page.click('#input_go')
}

test('[p01-570894] logging in with server 2 chosen opens server 2, from / and from a page of server 1', async ({
  page,
}) => {
  for (const start of ['/', '/s/1/databases']) {
    await page.context().clearCookies()
    await page.goto(start)
    await expect(page.locator('#select_server')).toBeVisible()
    await logIn(page, '2')
    await expect(page).toHaveURL(/\/s\/2\/?$/)
    await expect(page.locator('#server-breadcrumb')).toContainText(`${MYSQL.host}:${MYSQL.port}`)
    // end the session on the server (a response in flight could restore a cleared cookie)
    const token = (await page.context().cookies()).find((c) => c.name === 'bma_token')?.value ?? ''
    await page.request.post('/api/auth/logout', { headers: { 'X-BMA-Token': token } })
  }
})

test('[p01-570894] the page shown stays when the login is on its server', async ({ page }) => {
  await page.goto('/s/1/databases')
  await logIn(page, '1')
  await expect(page).toHaveURL(/\/s\/1\/databases(\?|$)/)
  await expect(page.locator('#server-breadcrumb')).toContainText('Dev replica')
})
