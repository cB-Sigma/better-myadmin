import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

/** MySQL used by both tools (the reference phpMyAdmin's server 1 must point at the same one). */
export const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: process.env.BMA_TEST_USER ?? 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}

export const PMA_URL = (process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081').replace(/\/$/, '')

/**
 * This checkout's suffix for every account and database of the run: several worktrees (agents) share
 * one MySQL, and a fixed `uip_pma` could be dropped or recreated by another run mid-way. Stable per
 * worktree (hash of its path), so global-setup, the workers and the teardown agree; `BMA_UIP_RUN`
 * overrides it (e.g. two runs from one checkout).
 */
export const BASE_RUN = (
  process.env.BMA_UIP_RUN ??
  createHash('sha1')
    .update(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'))
    .digest('hex')
    .slice(0, 6)
).replace(/[^a-z0-9]/gi, '')

/** Playwright workers of the run (playwright.config.ts); each has its own accounts and databases. */
export const WORKERS = Math.max(1, Number(process.env.BMA_UIP_WORKERS ?? 4))

/** The suffix of worker `index` (Playwright's TEST_PARALLEL_INDEX: 0 … WORKERS-1). */
export const runOf = (index: number): string => `${BASE_RUN}w${index}`

/**
 * This worker's suffix. Workers run cases in parallel, so everything a case creates or reads by
 * name (accounts, databases, configuration storage rows of its user) carries it; the main process
 * (global-setup, teardown) iterates over all of them with runOf().
 */
export const RUN = runOf(Number(process.env.TEST_PARALLEL_INDEX ?? 0))

/** One account per tool (same privileges), so the two sessions never share server-side state. */
export const usersOf = (run: string) => ({ pma: `uip_pma_${run}`, ours: `uip_bma_${run}` }) as const
export const USERS = usersOf(RUN)

/**
 * Objects created by global-setup for the cases and dropped by global-teardown (all prefixed uip_,
 * suffixed with the worker's run): the shared fixture and the Insert/Edit database. Our
 * configuration storage is one per checkout (the server reads its name once); its rows are keyed by
 * the worker's user.
 */
export const fixturesOf = (run: string) =>
  ({
    db: `uip_db_${run}`,
    table: 'uip_t',
    pmadb: `uip_pmadb_${BASE_RUN}`,
    insertDb: `uip_ie_${run}`,
  }) as const
export const FIX = fixturesOf(RUN)

/** The databases and accounts the cases create themselves (per worker), dropped by global-teardown. */
export const caseObjectsOf = (run: string) => ({
  dbs: [`f05_uip_${run}`, `f05d_uip_${run}`, `f08_uip_${run}`],
  accounts: [`'f06u_uip1_${run}'@'%'`, `'f06u_uip1_${run}'@'localhost'`, `'f06u_uip2_${run}'@'%'`],
})

/**
 * The "Users having access to …" rows (database and table privileges) of other runs, agents and
 * suites, whose accounts come and go between the two captures: only this worker's two accounts are
 * compared (and the rowspan continuation rows, which have no checkbox, belong to the others).
 */
export const OTHER_ACCOUNT_ROWS = `#page_content table tbody tr:not(:has(${Object.values(USERS)
  .map((u) => `input[name="selected_usr[]"][value^="${u}&"]`)
  .join(', ')}))`

export type App = 'pma' | 'ours'
export const APPS: App[] = ['pma', 'ours']

export const pmaReachable = (): Promise<boolean> =>
  fetch(`${PMA_URL}/index.php`)
    .then((r) => r.ok)
    .catch(() => false)

/** phpMyAdmin URL of `route` with `params` (server=1 added). */
export function pmaUrl(route: string, params: Record<string, string> = {}, base = PMA_URL): string {
  return `${base}/index.php?${new URLSearchParams({ route, server: '1', ...params })}`
}

/**
 * Logs the case's browser context in through its request API: the session cookie lands in the
 * context, so the case's first page load is its own page. A fresh session per case, as through the
 * login form, without rendering the login page and the home page of both apps first (the login
 * pages themselves are compared by auth.uip.ts and pages.uip.ts).
 */
export async function login(page: Page, app: App, baseURL: string): Promise<void> {
  const user = USERS[app]
  const http = page.context().request
  if (app === 'pma') {
    const form = await (await http.get(pmaUrl('/'))).text()
    const field = (name: string) => form.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1] ?? ''
    const home = await http.post(`${PMA_URL}/index.php?route=/`, {
      form: {
        token: field('token'),
        set_session: field('set_session'),
        pma_username: user,
        pma_password: user,
        server: '1',
      },
    })
    if (/id="login_form"/.test(await home.text())) throw new Error(`phpMyAdmin login of ${user} failed`)
    return
  }
  const state = (await (await http.get(`${baseURL}/api/auth/state`)).json()) as { csrfToken?: string }
  const r = await http.post(`${baseURL}/api/auth/login`, {
    data: { server: 1, username: user, password: user },
    headers: state.csrfToken !== undefined ? { 'X-BMA-Token': state.csrfToken } : {},
  })
  if (!r.ok()) throw new Error(`BetterMyAdmin login of ${user} failed: ${r.status()} ${await r.text()}`)
}
