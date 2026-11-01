import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, allTabs, login } from './fixtures.ts'

/**
 * Database → Diagram, the BetterMyAdmin-only read-only ER diagram (X63,
 * docs/features/05-database-level.md): boxes and relation lines, search, click-through to the
 * Structure page, collapse, hover highlighting, zoom, the SVG / PNG export and the list view.
 */
const RUN = process.env.BMA_E2E_PORT ?? '8099'
const DB = `erd_e2e${RUN}`

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.customer (id INT PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, note TEXT) ENGINE=InnoDB;
    CREATE TABLE ${DB}.\`order\` (id INT PRIMARY KEY, customer_id INT NULL,
      CONSTRAINT fk_cust FOREIGN KEY (customer_id) REFERENCES customer (id)) ENGINE=InnoDB;
    CREATE TABLE ${DB}.product (id INT PRIMARY KEY, name VARCHAR(64)) ENGINE=InnoDB;
    CREATE TABLE ${DB}.order_line (id INT PRIMARY KEY, order_id INT NOT NULL, product_id INT NOT NULL,
      CONSTRAINT fk_order FOREIGN KEY (order_id) REFERENCES \`order\` (id),
      CONSTRAINT fk_product FOREIGN KEY (product_id) REFERENCES product (id)) ENGINE=InnoDB;
    CREATE TABLE ${DB}.lonely (id INT) ENGINE=InnoDB;
    CREATE VIEW ${DB}.v_customers AS SELECT id, email FROM ${DB}.customer;`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}`)
  await c.end()
})

const base = `/s/1/db/${DB}`
const table = (page: import('@playwright/test').Page, name: string) => page.locator(`[data-table="${name}"]`)

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('the Diagram tab after Designer; every table and view as a box, a line per foreign key', async ({
  page,
}) => {
  await page.goto(`${base}/structure`)
  const tabs = await allTabs(page)
  expect(tabs.slice(tabs.indexOf('designer'), tabs.indexOf('designer') + 2)).toEqual(['designer', 'diagram'])
  // the tab sits inline or in "More", depending on the width
  const inline = page.locator('#topmenu > li [data-tab="diagram"]')
  if ((await inline.count()) > 0) await inline.click()
  else {
    await page.locator('#navbarDropdown').click()
    await page.locator('[role="menu"] [data-tab="diagram"]').click()
  }
  await expect(page).toHaveURL(new RegExp(`${base}/diagram$`))
  const canvas = page.getByTestId('er-canvas')
  await expect(canvas).toBeVisible()
  for (const t of ['customer', 'order', 'order_line', 'product', 'lonely', 'v_customers'])
    await expect(table(page, t)).toBeVisible()
  await expect(table(page, 'v_customers')).toHaveAttribute('data-view', 'true')
  await expect(table(page, 'customer').locator('[data-column]')).toHaveCount(3)
  await expect(table(page, 'customer')).toContainText('varchar(255)')
  await expect(table(page, 'customer')).toContainText('PK')
  await expect(table(page, 'customer')).toContainText('UQ')
  await expect(table(page, 'order')).toContainText('FK')
  // three FOREIGN KEYs, three lines with a visible path each
  const edges = canvas.locator('.er-edge')
  await expect(edges).toHaveCount(3)
  await expect(canvas.locator('[data-edge][data-from="order"][data-to="customer"]')).toHaveCount(1)
  // referenced tables are laid out left of the tables referencing them
  const x = async (n: string) => (await table(page, n).boundingBox())?.x ?? 0
  expect(await x('customer')).toBeLessThan(await x('order'))
  expect(await x('order')).toBeLessThan(await x('order_line'))
})

test('hovering a relation highlights both tables; zoom buttons and the wheel zoom', async ({ page }) => {
  await page.goto(`${base}/diagram`)
  const edge = page.locator('[data-edge][data-from="order"][data-to="customer"]')
  await expect(edge).toHaveCount(1)
  await edge.locator('path').first().hover({ force: true })
  await expect(edge).toHaveAttribute('data-highlighted', 'true')
  await expect(table(page, 'order')).toHaveAttribute('data-highlighted', 'true')
  await expect(table(page, 'customer')).toHaveAttribute('data-highlighted', 'true')
  await expect(table(page, 'product')).not.toHaveAttribute('data-highlighted', 'true')

  const zoom = page.getByTestId('er-zoom')
  const before = await zoom.textContent()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom).not.toHaveText(before ?? '')
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await expect(zoom).toHaveText('100%')
  const box = await page.getByTestId('er-canvas').boundingBox()
  if (box === null) throw new Error('no canvas')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 300)
  await expect(zoom).not.toHaveText('100%')
  await page.getByRole('button', { name: 'Zoom to fit' }).click()
  await expect(table(page, 'lonely')).toBeInViewport()
})

test('search highlights and centres the table; a click opens its Structure page', async ({ page }) => {
  await page.goto(`${base}/diagram`)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('searchbox', { name: 'Search' }).fill('order')
  await expect(page.getByTestId('er-search-count')).toHaveText('1 / 2')
  await expect(table(page, 'order')).toHaveAttribute('data-current', 'true')
  await expect(table(page, 'order_line')).toHaveAttribute('data-found', 'true')
  await expect(table(page, 'customer')).not.toHaveAttribute('data-found', 'true')
  // centred in the canvas
  const canvas = await page.getByTestId('er-canvas').boundingBox()
  const found = await table(page, 'order').boundingBox()
  if (canvas === null || found === null) throw new Error('no box')
  expect(Math.abs(found.x + found.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThan(5)
  expect(Math.abs(found.y + found.height / 2 - (canvas.y + canvas.height / 2))).toBeLessThan(5)
  // Enter: the next match
  await page.getByRole('searchbox', { name: 'Search' }).press('Enter')
  await expect(page.getByTestId('er-search-count')).toHaveText('2 / 2')
  await expect(table(page, 'order_line')).toHaveAttribute('data-current', 'true')
  await page.getByRole('searchbox', { name: 'Search' }).fill('nothing here')
  await expect(page.getByTestId('er-search-count')).toHaveText('No matching table')

  await table(page, 'product').locator('a').click()
  await expect(page).toHaveURL(new RegExp(`${base}/t/product/structure$`))
})

test('tables collapse to the header, one by one or all together', async ({ page }) => {
  await page.goto(`${base}/diagram`)
  const customer = table(page, 'customer')
  await expect(customer.locator('[data-column]')).toHaveCount(3)
  const h = (await customer.boundingBox())?.height ?? 0
  await customer.getByRole('button', { name: 'Collapse' }).click()
  await expect(customer).toHaveAttribute('data-collapsed', 'true')
  await expect(customer.locator('[data-column]')).toHaveCount(0)
  expect((await customer.boundingBox())?.height ?? 0).toBeLessThan(h)
  await customer.getByRole('button', { name: 'Expand' }).click()
  await expect(customer.locator('[data-column]')).toHaveCount(3)

  await page.locator('#er_diagram').getByRole('button', { name: 'Collapse all' }).click()
  await expect(page.locator('[data-table][data-collapsed="true"]')).toHaveCount(6)
  await expect(page.locator('[data-column]')).toHaveCount(0)
  // the lines stay, anchored at the headers
  await expect(page.locator('.er-edge')).toHaveCount(3)
  await page.locator('#er_diagram').getByRole('button', { name: 'Expand all' }).click()
  await expect(page.locator('[data-table][data-collapsed="true"]')).toHaveCount(0)
})

test('export as SVG and PNG produce files of the whole diagram', async ({ page }) => {
  await page.goto(`${base}/diagram`)
  await expect(table(page, 'customer')).toBeVisible()
  const [svg] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export as SVG' }).click(),
  ])
  expect(svg.suggestedFilename()).toBe(`${DB}.svg`)
  const text = readFileSync((await svg.path()) ?? '', 'utf8')
  expect(text).toContain('<svg')
  for (const t of ['customer', 'order_line', 'v_customers', 'varchar(255)']) expect(text).toContain(t)
  // theme tokens resolved to colours, no interactive leftovers
  expect(text).not.toContain('var(--')
  expect(text).not.toContain('role="button"')

  const [png] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export as PNG' }).click(),
  ])
  expect(png.suggestedFilename()).toBe(`${DB}.png`)
  const bytes = readFileSync((await png.path()) ?? '')
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
  expect(bytes.length).toBeGreaterThan(2000)
})

test('the list view is the text alternative: tables, columns and relations', async ({ page }) => {
  await page.goto(`${base}/diagram`)
  await page.getByRole('button', { name: 'List view' }).click()
  const list = page.getByTestId('er-list')
  await expect(list).toBeVisible()
  await expect(page.getByTestId('er-canvas')).toHaveCount(0)
  await expect(list.getByRole('link', { name: 'v_customers' })).toBeVisible()
  const rel = list.locator('section').filter({ hasText: 'Relations' }).locator('tbody tr')
  await expect(rel).toHaveCount(3)
  await expect(rel.filter({ hasText: 'fk_cust' })).toContainText('customer (id)')
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('er-canvas')).toBeVisible()
})
