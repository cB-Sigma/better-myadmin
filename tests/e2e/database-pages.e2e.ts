import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * Smoke test of the database-level pages (docs/features/05-database-level.md): each page renders
 * its phpMyAdmin texts; Search finds a row. The actions themselves are covered by the parity suites.
 */
const DB = 'f05_e2e'
const USER = 'f05_e2e_user'

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.parent (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20));
    INSERT INTO ${DB}.parent (name) VALUES ('alpha'), ('beta');
    CREATE TABLE ${DB}.child (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES ${DB}.parent (id));
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON *.* TO '${USER}'@'%'`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

const base = `/s/1/db/${DB}`

test('structure lists the tables and the summary', async ({ page }) => {
  await login(page, USER, USER)
  await page.goto(`${base}/structure`)
  await expect(page.locator('#tablesForm')).toContainText('parent')
  await expect(page.locator('#tablesForm')).toContainText('child')
  await expect(page.getByText('Sum', { exact: true })).toBeVisible()
})

test('search finds the rows in each table', async ({ page }) => {
  await login(page, USER, USER)
  await page.goto(`${base}/search`)
  await page.locator('#criteriaSearchString').fill('alpha')
  await page.locator('#buttonGo').click()
  await expect(page.getByText(/1 match in .*parent/)).toBeVisible()
})

test('routines, events, triggers, query, operations, dictionary and privileges render', async ({ page }) => {
  await login(page, USER, USER)
  const pages: Array<[string, string | RegExp]> = [
    ['routines', 'There are no routines to display.'],
    ['events', 'There are no events to display.'],
    ['triggers', 'There are no triggers to display.'],
    ['multi-table-query', 'Update query'],
    ['operations', 'Rename database to'],
    ['data-dictionary', 'parent'],
    ['privileges', /Users having access to/],
  ]
  for (const [path, text] of pages) {
    await page.goto(`${base}/${path}`)
    await expect(page.locator('#page_content').getByText(text).first()).toBeVisible()
  }
})
