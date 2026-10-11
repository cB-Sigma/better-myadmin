import { type Page, expect } from '@playwright/test'

/** MySQL used by both tools (the reference phpMyAdmin's server 1 must point at the same one). */
export const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: process.env.BMA_TEST_USER ?? 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}

export const PMA_URL = (process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081').replace(/\/$/, '')

/** One account per tool (same privileges), so the two sessions never share server-side state. */
export const USERS = { pma: 'uip_pma', ours: 'uip_bma' } as const

/** Objects created by global-setup for the cases (all prefixed uip_). */
export const FIX = { db: 'uip_db', table: 'uip_t', pmadb: 'uip_pmadb' } as const

export type App = 'pma' | 'ours'
export const APPS: App[] = ['pma', 'ours']

export const pmaReachable = (): Promise<boolean> =>
  fetch(`${PMA_URL}/index.php`)
    .then((r) => r.ok)
    .catch(() => false)

/** phpMyAdmin URL of `route` with `params` (server=1 added). */
export function pmaUrl(route: string, params: Record<string, string> = {}): string {
  return `${PMA_URL}/index.php?${new URLSearchParams({ route, server: '1', ...params })}`
}

/** Logs in through the login form; both apps use phpMyAdmin's ids. */
export async function login(page: Page, app: App, baseURL: string): Promise<void> {
  const user = USERS[app]
  await page.goto(app === 'pma' ? pmaUrl('/') : `${baseURL}/`)
  await page.locator('#input_username').fill(user)
  await page.locator('#input_password').fill(user)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible({ timeout: 30_000 })
}
