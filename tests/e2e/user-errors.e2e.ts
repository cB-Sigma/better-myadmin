import { expect, test } from '@playwright/test'
import { login } from './fixtures.ts'

/**
 * `#pma_errors` (base.twig): the user errors the server sends with an answer (X-BMA-User-Errors,
 * ErrorHandler::addUserError) show under the page, after the "Open new window" link, and go when
 * another page loads. The server side is apps/server/test/int/user-errors.test.ts.
 */
test('user errors of an answer show in #pma_errors and go with the next page', async ({ page }) => {
  await login(page)
  const html =
    'Unable to use timezone &quot;Nowhere/F05&quot; for server 1. Please check your configuration setting for <em>$cfg[&#039;Servers&#039;][1][&#039;SessionTimeZone&#039;]</em>. phpMyAdmin is currently using the default time zone of the database server.'
  await page.route(/\/api\/servers\/1\/databases(\?|$)/, async (route) => {
    const res = await route.fetch()
    await route.fulfill({
      response: res,
      headers: {
        ...res.headers(),
        'x-bma-user-errors': encodeURIComponent(JSON.stringify([{ level: 'error', html }])),
      },
    })
  })
  await page.goto('/s/1/databases')
  const box = page.locator('#selflink + #pma_errors [role="alert"]')
  await expect(box).toHaveCount(1)
  await expect(box).toContainText('Unable to use timezone "Nowhere/F05" for server 1.')
  await expect(box.locator('em')).toHaveText("$cfg['Servers'][1]['SessionTimeZone']")
  await page.unroute(/\/api\/servers\/1\/databases(\?|$)/)
  await page.goto('/s/1/variables')
  await expect(page.locator('#pma_errors [role="alert"]')).toHaveCount(0)
})
