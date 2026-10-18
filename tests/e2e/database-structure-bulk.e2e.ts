import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * The Structure tab's "With selected:" pages as phpMyAdmin's AJAX page loads show them: the
 * maintenance result and the Drop / Empty confirmation replace the list, the Structure tab brings
 * it back; a failed TRUNCATE is mysqlDie's error.
 */
const DB = 'f07_e2e_bulk'

const seed = async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE authors (id INT PRIMARY KEY) ENGINE=InnoDB;
    CREATE TABLE books (id INT, author_id INT, FOREIGN KEY (author_id) REFERENCES authors (id)) ENGINE=InnoDB;
    CREATE TABLE logs (id INT) ENGINE=MyISAM;
    INSERT INTO authors VALUES (1); INSERT INTO books VALUES (1, 1); INSERT INTO logs VALUES (1);`)
  await c.end()
}
test.beforeEach(seed)
test.afterAll(async () => {
  const c = await mysql.createConnection(MYSQL)
  await c.query(`DROP DATABASE IF EXISTS ${DB}`)
  await c.end()
})

async function withSelected(page: Page, tables: string[], action: string) {
  await page.goto(`/s/1/db/${DB}/structure`)
  for (const t of tables) await page.locator(`button[role="checkbox"][value="${t}"]`).click()
  await page.locator('select[name="submit_mult"]').selectOption(action)
}
const structureTab = (page: Page) => page.locator('#topmenu').getByRole('link', { name: 'Structure' })

test('Analyze table: the result page with the query card and `db`.`table` cards, the Structure tab shows the list again', async ({
  page,
}) => {
  await login(page)
  await withSelected(page, ['authors', 'logs'], 'analyze_tbl')
  const result = page.getByTestId('maintenance-result')
  await expect(result.getByRole('heading', { name: 'Analyze table' })).toBeVisible()
  await expect(result).toContainText('Your SQL query has been executed successfully.')
  await expect(result.getByRole('button', { name: 'Refresh' })).toBeVisible()
  await expect(result.getByText('Profiling')).toBeVisible()
  await expect(result).toContainText(`${DB}.authors`)
  await expect(result).toContainText(`${DB}.logs`)
  await expect(page.locator('#tablesForm')).toHaveCount(0)
  await structureTab(page).click()
  await expect(page.locator('#tablesForm')).toBeVisible()
  await expect(result).toHaveCount(0)
})

test('Drop: the confirmation replaces the list; No gives "No change", Yes drops', async ({ page }) => {
  await login(page)
  await withSelected(page, ['logs'], 'drop_tbl')
  await expect(page.getByText('Do you really want to execute the following query?')).toBeVisible()
  await expect(page.locator('#page_content')).toContainText('DROP TABLE `logs`;')
  await expect(page.locator('#tablesForm')).toHaveCount(0)
  await page.locator('#buttonNo').click()
  await expect(page.locator('#page_content')).toContainText('No change')
  await expect(page.locator('#tablesForm')).toContainText('logs')
  await withSelected(page, ['logs'], 'drop_tbl')
  await page.locator('#buttonYes').click()
  await expect(page.locator('#page_content')).toContainText('Your SQL query has been executed successfully.')
  await expect(page.locator('#tablesForm')).not.toContainText('logs')
})

test('Empty of a referenced table: the error page of the failed TRUNCATE (Generator::mysqlDie)', async ({
  page,
}) => {
  await login(page)
  await withSelected(page, ['authors'], 'empty_tbl')
  await page.locator('#buttonYes').click()
  const err = page.getByRole('alert')
  await expect(err.getByRole('heading', { name: 'Error' })).toBeVisible()
  await expect(err).toContainText('TRUNCATE `authors`')
  await expect(err).toContainText('#1701 - Cannot truncate a table referenced in a foreign key constraint')
  await expect(err.getByRole('link', { name: 'Edit' })).toBeVisible()
  await expect(page.locator('#tablesForm')).toHaveCount(0)
})
