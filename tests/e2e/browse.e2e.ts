import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Browse tab end to end: default browse, sorting, paging, Extra options, grid editing and the
 * row Delete link with its confirmation.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f02_e2e'
const DB = 'f02_e2e'

async function value(sql: string): Promise<unknown> {
  const c = await mysql.createConnection(ROOT)
  const [rows] = await c.query({ sql, rowsAsArray: true })
  await c.end()
  return (rows as unknown[][])[0]?.[0]
}

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(80) COMMENT 'the name', qty INT) ENGINE=InnoDB;
    INSERT INTO t (name, qty) VALUES ${Array.from({ length: 30 }, (_, i) => `('item${i + 1}', ${i % 7})`).join(',')};
    UPDATE t SET name = REPEAT('x', 70) WHERE id = 3;
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f02\\_e2e\`.* TO '${USER}'@'%';`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

test('browse, sort, page, options, grid edit and delete [p02-50ad5b p02-8c16e6 p02-dc194e p02-26b09f p02-5293ef]', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()

  await page.goto(`/s/1/db/${DB}/t/t/browse`)
  const results = page.locator('.sqlqueryresults')
  await expect(results.getByText(/Showing rows 0 - 24 \(30 total/)).toBeVisible()
  await expect(page.locator('table.table_results tbody tr')).toHaveCount(25)
  await expect(page.locator('th[data-column="name"] small')).toHaveText('the name')
  // a truncated cell
  await expect(page.locator('td[data-originallength="70"]')).toHaveCount(1)

  // sort by name descending (plain click twice)
  await page.locator('th[data-column="name"] .sortlink').click()
  await expect(results.getByText(/\[name: ITEM1\.\.\./)).toBeVisible()
  await page.locator('th[data-column="name"] .sortlink').click()
  await expect(results.getByText(/\[name: XXX/)).toBeVisible()

  // next page
  await page.locator('table.navigation').first().getByRole('button', { name: '>', exact: true }).click()
  await expect(results.getByText(/Showing rows 25 - 29/)).toBeVisible()

  // Extra options → Full texts
  await page.getByRole('button', { name: 'Extra options' }).click()
  await page.getByRole('radio', { name: 'Full texts' }).check()
  await page.getByRole('button', { name: 'Go', exact: true }).click()
  await expect(page.locator('td.truncated')).toHaveCount(0)

  // back to an unsorted first page, edit a cell with a double click + Enter
  await page.goto(`/s/1/db/${DB}/t/t/browse`)
  const cell = page.locator('table.table_results tbody tr').first().locator('td[data-type="string"]').first()
  await cell.dblclick()
  await page.locator('.cEdit .edit_box').fill('edited')
  await page.locator('.cEdit .edit_box').press('Enter')
  await expect(page.getByText('1 row affected.')).toBeVisible()
  await expect.poll(() => value(`SELECT name FROM ${DB}.t ORDER BY name LIMIT 1`)).not.toBeNull()
  await expect.poll(() => value(`SELECT COUNT(*) FROM ${DB}.t WHERE name = 'edited'`)).toBe(1)

  // delete a row with the confirmation modal
  const rows = page.locator('table.table_results tbody tr')
  const before = await rows.count()
  await rows.first().locator('.delete_row').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'OK' }).click()
  await expect(rows).toHaveCount(before - 1)
  await expect.poll(() => value(`SELECT COUNT(*) FROM ${DB}.t`)).toBe(29)
})
