import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * The console strip starts after the navigation panel (pma: navigation.ts sets #pma_console's margin
 * to the panel's width plus the resizer), so with a long database list the last database is not
 * hidden under it, and it follows when the panel is collapsed.
 */
// no '_' (NavigationTreeDbSeparator): the databases stay top-level instead of in a group
const PREFIX = 'conavdb'
const COUNT = 40

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(
    Array.from(
      { length: COUNT },
      (_, i) => `CREATE DATABASE IF NOT EXISTS ${PREFIX}${String(i).padStart(2, '0')};`,
    ).join(''),
  )
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(
    Array.from(
      { length: COUNT },
      (_, i) => `DROP DATABASE IF EXISTS ${PREFIX}${String(i).padStart(2, '0')};`,
    ).join(''),
  )
  await c.end()
})

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).boundingBox()
  if (b === null) throw new Error(`${selector} is not rendered`)
  return b
}

test('the console does not cover the navigation tree', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  await login(page)
  await expect(page.locator('#pma_console')).toBeVisible()
  const nav = await box(page, '#pma_navigation')
  const console = await box(page, '#pma_console')
  // the console starts at the panel's end (its resizer included)
  expect(console.x).toBeGreaterThanOrEqual(nav.x + nav.width)

  // the last database, scrolled into view, is clear of the console
  const last = page.locator(`[role=treeitem][data-kind=database][data-name=${PREFIX}${COUNT - 1}]`)
  // the tree is virtualized: scroll it to the end, as a user would
  await page.locator('#pma_navigation_tree_content').evaluate((e) => {
    e.scrollTop = e.scrollHeight
  })
  await expect(last).toBeVisible()
  const item = await box(page, `[role=treeitem][data-kind=database][data-name=${PREFIX}${COUNT - 1}]`)
  const over = await page.evaluate(
    ([x, y]) =>
      (document.elementFromPoint(x as number, y as number)?.closest('#pma_console') ?? null) !== null,
    [item.x + 10, item.y + item.height / 2],
  )
  expect(over).toBe(false)

  // a collapsed panel: the console starts at its collapsed edge
  await page.locator('#pma_navigation_collapser').click()
  await expect.poll(async () => (await box(page, '#pma_console')).x).toBeLessThan(console.x)
  await page.locator('#pma_navigation_collapser').click()
  await expect.poll(async () => (await box(page, '#pma_console')).x).toBe(console.x)
})
