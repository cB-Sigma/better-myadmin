import { type Page, expect, test } from '@playwright/test'

/**
 * The main pages on the acme_store demo database, at desktop and phone size (playwright.config.ts).
 * Pages with live numbers (Status, Processes, Monitor, Dashboard) are left out; query timings are
 * masked.
 */
const DB = 'acme_store'
const PAGES: Array<[name: string, path: string]> = [
  ['home', '/s/1'],
  ['server-databases', '/s/1/databases'],
  ['server-sql', '/s/1/sql'],
  ['server-variables', '/s/1/variables'],
  ['server-privileges', '/s/1/privileges'],
  ['server-export', '/s/1/export'],
  ['server-import', '/s/1/import'],
  ['server-preferences', '/s/1/preferences'],
  ['server-engines', '/s/1/engines'],
  ['server-collations', '/s/1/collations'],
  ['db-structure', `/s/1/db/${DB}/structure`],
  ['db-sql', `/s/1/db/${DB}/sql`],
  ['db-search', `/s/1/db/${DB}/search`],
  ['db-query', `/s/1/db/${DB}/multi-table-query`],
  ['db-export', `/s/1/db/${DB}/export`],
  ['db-operations', `/s/1/db/${DB}/operations`],
  ['db-routines', `/s/1/db/${DB}/routines`],
  ['db-designer', `/s/1/db/${DB}/designer`],
  ['db-diagram', `/s/1/db/${DB}/diagram`],
  ['table-browse', `/s/1/db/${DB}/t/products/browse`],
  ['table-structure', `/s/1/db/${DB}/t/products/structure`],
  ['table-sql', `/s/1/db/${DB}/t/products/sql`],
  ['table-search', `/s/1/db/${DB}/t/products/search`],
  ['table-insert', `/s/1/db/${DB}/t/products/insert`],
  ['table-operations', `/s/1/db/${DB}/t/products/operations`],
  ['table-relation', `/s/1/db/${DB}/t/order_items/relation`],
  ['table-triggers', `/s/1/db/${DB}/t/products/triggers`],
]

async function login(page: Page) {
  await page.goto('/')
  await page.fill('#input_username', process.env.BMA_TEST_USER ?? 'root')
  await page.fill('#input_password', process.env.BMA_TEST_PASSWORD ?? 'root')
  await page.click('#input_go')
  await page.locator('#maincontainer').waitFor()
}

test.beforeEach(async ({ page }) => {
  await login(page)
})

for (const [name, path] of PAGES) {
  test(name, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(400)
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      mask: [page.getByText(/Query took [\d.]+ seconds/), page.getByText(/^Last update:/)],
    })
  })
}
