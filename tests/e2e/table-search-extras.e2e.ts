import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Table Search form details end to end (docs/features/04-table-level.md › Search / Zoom /
 * Find-Replace): unary operators, the Range dialog, the value widgets and what is posted.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f04_e2e_srch'
const DB = 'f04_e2e_srch'

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE p (id INT PRIMARY KEY, label VARCHAR(10));
    INSERT INTO p VALUES (1, 'one'), (2, 'two');
    CREATE TABLE t (id INT PRIMARY KEY, qty INT, name VARCHAR(20), kind ENUM('a','b'), pid INT, d DATE,
      FOREIGN KEY (pid) REFERENCES p (id)) ENGINE=InnoDB;
    INSERT INTO t VALUES (1, 5, 'x', 'a', 1, '2020-01-01'), (2, 40, NULL, 'b', 2, '2021-06-30');
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f04\\_e2e\\_srch\`.* TO '${USER}'@'%';`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

async function searchPage(page: Page) {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
  await page.goto(`/s/1/db/${DB}/t/t/search`)
  await expect(page.locator('#tbl_search_form')).toBeVisible()
}
const row = (page: Page, column: string) => page.getByTestId(`criteria-${column}`)

test('a unary operator disables the value; BETWEEN opens the Range dialog with the column min/max [p04-47b7c3]', async ({
  page,
}) => {
  await searchPage(page)
  await row(page, 'name').getByLabel('Operator').selectOption('IS NULL')
  await expect(row(page, 'name').getByLabel('Value')).toBeDisabled()
  await row(page, 'name').getByLabel('Operator').selectOption('LIKE')
  await expect(row(page, 'name').getByLabel('Value')).toBeEnabled()
  await row(page, 'qty').getByLabel('Operator').selectOption('BETWEEN')
  const dlg = page.locator('#rangeSearchModal')
  await expect(dlg).toBeVisible()
  await expect(dlg).toContainText('Column minimum: 5')
  await expect(dlg).toContainText('Column maximum: 40')
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  // a text input takes "min, max" (a number input, in phpMyAdmin too, drops it)
  await row(page, 'd').getByLabel('Operator').selectOption('BETWEEN')
  await expect(dlg).toContainText('Column minimum: 2020-01-01')
  await dlg.locator('#min_value').fill('2020-01-01')
  await dlg.getByRole('button', { name: 'Go' }).click()
  await expect(row(page, 'd').getByLabel('Value')).toHaveValue('')
  await row(page, 'd').getByLabel('Operator').selectOption('=')
  await row(page, 'd').getByLabel('Operator').selectOption('BETWEEN')
  await dlg.locator('#min_value').fill('2020-01-01')
  await dlg.locator('#max_value').fill('2020-12-31')
  await dlg.getByRole('button', { name: 'Go' }).click()
  await expect(row(page, 'd').getByLabel('Value')).toHaveValue('2020-01-01, 2020-12-31')
})

test('foreign key and ENUM columns get dropdowns, numbers a number input [p04-b4527e]', async ({ page }) => {
  await searchPage(page)
  await expect(row(page, 'pid').getByLabel('Value').locator('option')).toContainText(['one - 1', 'two - 2'])
  await expect(row(page, 'kind').getByLabel('Value').locator('option')).toHaveText(['', 'a', 'b'])
  await expect(row(page, 'qty').getByLabel('Value')).toHaveAttribute('type', 'number')
})

test('empty criteria are left out; all columns selected posts no column list [p04-a5c01b]', async ({
  page,
}) => {
  await searchPage(page)
  await row(page, 'qty').getByLabel('Value').fill('5')
  await row(page, 'name').getByLabel('Operator').selectOption('IS NULL')
  const req = page.waitForRequest((r) => r.method() === 'POST' && /\/tables\/t\/search$/.test(r.url()))
  await page.getByRole('button', { name: 'Go' }).click()
  const body = (await req).postDataJSON() as {
    criteria: Array<{ name: string; operator: string; value: string }>
    columns: string[] | null
  }
  expect(body.criteria.map((c) => [c.name, c.operator, c.value])).toEqual([
    ['qty', '=', '5'],
    ['name', 'IS NULL', ''],
  ])
  expect(body.columns).toBeNull()
  await expect(page).toHaveURL(/\/t\/t\/browse\?/)
})
