import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Smoke test of the navigation panel: log in, expand a database, open a table from the tree, and
 * find the tree state restored and linked with the main panel after a reload.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'm1nav_e2e'
const DB = 'm1nav_e2e'

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.customers (id INT PRIMARY KEY, name VARCHAR(20));
    CREATE TABLE ${DB}.orders (id INT PRIMARY KEY);
    CREATE VIEW ${DB}.recent AS SELECT 1 AS x;
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`m1nav\\_e2e\`.* TO '${USER}'@'%';`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

test('expand a database, open a table, state restored after reload', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()

  const nav = page.locator('#pma_navigation')
  const dbRow = nav.locator('[role=treeitem][data-kind=database][data-name=m1nav_e2e]')
  await expect(dbRow).toBeVisible()
  // no "New" node: the account cannot create databases (its only grant is on an existing one)
  const names = await nav
    .locator('[role=treeitem]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-name')))
  expect(names).toEqual(['information_schema', 'm1nav_e2e', 'performance_schema'])

  // expand the database: Tables and Views containers
  await dbRow.getByRole('button', { name: 'Expand/Collapse' }).click()
  const tables = nav.locator('[role=treeitem][data-kind=container][data-name=tables]')
  await expect(tables).toBeVisible()
  await expect(nav.locator('[role=treeitem][data-kind=container][data-name=views]')).toBeVisible()

  // expand Tables, then open a table with its text link (DefaultTabTable = Browse)
  await tables.getByRole('button', { name: 'Expand/Collapse' }).click()
  const orders = nav.locator('[role=treeitem][data-kind=table][data-name=orders]')
  await expect(orders).toBeVisible()
  await expect(orders.getByRole('link', { name: 'Structure' })).toHaveAttribute(
    'href',
    '/s/1/db/m1nav_e2e/t/orders/structure',
  )
  await orders.getByRole('link', { name: 'orders', exact: true }).click()
  await expect(page).toHaveURL(/\/s\/1\/db\/m1nav_e2e\/t\/orders\/$/)
  await expect(page.getByTestId('scope-table')).toHaveText('Table: m1nav_e2e.orders')
  // link with main panel: the current table is highlighted
  await expect(orders).toHaveAttribute('aria-selected', 'true')

  // a reload restores the expanded branches from sessionStorage
  await page.reload()
  await expect(nav.locator('[role=treeitem][data-kind=table][data-name=customers]')).toBeVisible()
  await expect(nav.locator('[role=treeitem][data-kind=table][data-name=orders]')).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // collapse all, then the panel collapser hides and shows the panel
  await nav.getByRole('button', { name: 'Collapse all' }).click()
  await expect(nav.locator('[role=treeitem][data-kind=container][data-name=tables]')).toHaveCount(0)
  await page.getByTitle('Hide panel').click()
  await expect(nav).toBeHidden()
  await page.getByTitle('Show panel').click()
  await expect(nav).toBeVisible()
})

test.describe('fast filter and paging of a container', () => {
  const U = 'm1nav_e2f'
  test.beforeAll(async () => {
    const c = await mysql.createConnection(ROOT)
    await c.query(`DROP DATABASE IF EXISTS ${U}; CREATE DATABASE ${U};
      ${Array.from({ length: 60 }, (_, i) => `CREATE TABLE ${U}.tbl_${i + 1} (x INT);`).join('\n')}
      DROP USER IF EXISTS '${U}'@'%'; CREATE USER '${U}'@'%' IDENTIFIED BY '${U}';
      GRANT ALL ON \`m1nav\\_e2f\`.* TO '${U}'@'%';`)
    await c.end()
  })
  test.afterAll(async () => {
    const c = await mysql.createConnection(ROOT)
    await c.query(`DROP DATABASE IF EXISTS ${U}; DROP USER IF EXISTS '${U}'@'%'`)
    await c.end()
  })

  test('item filter (client and server) and page selector', async ({ page }) => {
    // tall enough for the virtualized tree to render a whole page of 50 tables
    await page.setViewportSize({ width: 1280, height: 1600 })
    await page.goto('/')
    await page.locator('#input_username').fill(U)
    await page.locator('#input_password').fill(U)
    await page.locator('#input_go').click()
    const nav = page.locator('#pma_navigation')
    const tables = () => nav.locator('[role=treeitem][data-kind=table]')

    // the database's only container is Tables: tables, item filter and page selector show under it
    await nav
      .locator('[role=treeitem][data-name=m1nav_e2f]')
      .getByRole('button', { name: 'Expand/Collapse' })
      .click()
    await expect(tables().first()).toBeVisible()
    await expect(tables()).toHaveCount(50)
    const filter = nav.getByRole('textbox', { name: 'Type to filter these, Enter to search all' })
    await expect(filter).toBeVisible()
    const pageSelect = nav.locator('select.pageselector')
    await expect(pageSelect).toHaveValue('0')

    // next page
    await nav.getByRole('button', { name: '>', exact: true }).click()
    await expect(pageSelect).toHaveValue('50')
    await expect(tables()).toHaveCount(10)
    await expect(tables().first()).toHaveAttribute('data-name', 'tbl_51')

    // typing filters the loaded items and hides the page selector; Enter searches the server
    await filter.fill('tbl_5')
    await expect(pageSelect).toHaveCount(0)
    // tbl_51 … tbl_59 of this page (case-insensitive regular expression on the link text)
    await expect(tables()).toHaveCount(9)
    await filter.press('Enter')
    // tbl_5 and tbl_50..tbl_59 across both pages; with fewer than 30 results phpMyAdmin's
    // response has no fast filter any more (the count comes from the filtered object list)
    await expect(tables()).toHaveCount(11)
    await expect(filter).toHaveCount(0)
    // "Reload navigation panel" brings the full list back
    await nav.getByRole('button', { name: 'Reload navigation panel' }).click()
    await expect(tables()).toHaveCount(50)
    await expect(filter).toBeVisible()
  })
})
