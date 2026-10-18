import { type Page, expect } from '@playwright/test'

export const MYSQL = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: process.env.BMA_TEST_USER ?? 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}

/**
 * Objects of the shell e2e suite (all prefixed m1shell_), per e2e server port: runs of other
 * checkouts on the same MySQL create, ALTER and drop their own (the database name has no `_` before
 * the port, so two runs' databases are siblings in the navigation tree, not a group).
 */
const RUN = process.env.BMA_E2E_PORT ?? '8099'
export const E2E = {
  db: `m1shell_e2e${RUN}`,
  limited: `m1shell_e2e_lim${RUN}`,
  pw: `m1shell_e2e_pw${RUN}`,
} as const

export async function login(page: Page, user = MYSQL.user, password = MYSQL.password) {
  await page.goto('/')
  await page.fill('#input_username', user)
  await page.fill('#input_password', password)
  await page.click('#input_go')
  await expect(page.locator('#maincontainer')).toBeVisible()
}

/** Labels of every tab of the current bar, inline and in "More". */
export async function allTabs(page: Page): Promise<string[]> {
  await expect(page.locator('#topmenu [data-tab]').first()).toBeVisible()
  const inline = await page
    .locator('#topmenu > li [data-tab]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-tab') ?? ''))
  const more = page.locator('#navbarDropdown')
  if ((await more.count()) === 0) return inline
  await more.click()
  const hidden = await page
    .locator('[role="menu"] [data-tab]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-tab') ?? ''))
  await page.keyboard.press('Escape')
  return [...inline, ...hidden]
}
