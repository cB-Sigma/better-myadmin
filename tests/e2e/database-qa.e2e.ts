import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * Database-level pages next to phpMyAdmin's (side by side QA): the search's Browse result is the
 * full results page, a criteria column has "Add as", a routine's execution result replaces the
 * dialog on the page, its export opens in the SQL editor, a copied database is a toast; tracking
 * creates the version with the form's statements and opens a version's report and snapshot.
 */
const DB = 'f07_e2e_qa'

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB}_c; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE authors (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50));
    CREATE TABLE books (id INT AUTO_INCREMENT PRIMARY KEY, author_id INT, title VARCHAR(100),
      FOREIGN KEY (author_id) REFERENCES authors (id));
    INSERT INTO authors (name) VALUES ('Ann'); INSERT INTO books (author_id, title) VALUES (1, 'Delta zeta');
    CREATE PROCEDURE p_out(IN a INT, OUT doubled INT, INOUT acc VARCHAR(20))
      BEGIN SET doubled = a * 2; SET acc = CONCAT(acc, '!'); END;`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(
    `DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB}_c; DROP DATABASE IF EXISTS ${DB}_d`,
  )
  await c.end()
})
const base = `/s/1/db/${DB}`

test('search: Browse of a table shows the results page with its row and result operations', async ({
  page,
}) => {
  await login(page)
  await page.goto(`${base}/search`)
  await page.locator('#criteriaSearchString').fill('zeta')
  await page.locator('#buttonGo').click()
  await page.locator('#searchresults tr', { hasText: 'books' }).getByText('Browse').click()
  const results = page.locator('#browse-results')
  await expect(results).toContainText('Delta zeta')
  await expect(results).toContainText('Query results operations')
  await expect(results.getByRole('link', { name: 'Edit' }).first()).toBeVisible()
})

test('query: a column used in criteria has the "Add as" AND / OR row, even the first one', async ({
  page,
}) => {
  await login(page)
  await page.goto(`${base}/multi-table-query`)
  await page.locator('select.tableNameSelect').first().selectOption('books')
  await page.locator('.criteria_col').first().click()
  await expect(page.locator('.logical_operator').first()).toContainText('Add as')
})

async function executeDialog(page: Page) {
  await page.goto(`${base}/routines`)
  await page.locator('tr', { hasText: 'p_out' }).getByText('Execute').click()
  return page.locator('#routinesExecuteModal')
}

test('routines: the execution result (OUT parameters) is shown on the page once the dialog closes', async ({
  page,
}) => {
  await login(page)
  const dialog = await executeDialog(page)
  // Generator::getFunctionsForField: the list ends with the PHP password_hash() entry
  await expect(dialog.locator('select[name="funcs[a]"] option').last()).toHaveText(
    'password_hash() PHP function',
  )
  await dialog.locator('input[name="params[a]"]').fill('21')
  await dialog.locator('input[name="params[acc]"]').fill('hi')
  await dialog.getByRole('button', { name: 'Execute' }).click()
  await expect(dialog).toHaveCount(0)
  const result = page.locator('#PMA_slidingMessage')
  await expect(result).toContainText('Execution results of routine `p_out`')
  await expect(result).toContainText('42')
  await expect(result).toContainText('hi!')
})

test('routines: Export shows the routine in the SQL editor', async ({ page }) => {
  await login(page)
  await page.goto(`${base}/routines`)
  await page.locator('tr', { hasText: 'p_out' }).getByText('Export').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Export of routine `p_out`')
  await expect(dialog.locator('#routinesExportTextarea, .cm-content').first()).toContainText('DELIMITER $$')
})

test('operations: a copied database is announced as a toast, the page stays', async ({ page }) => {
  await login(page)
  await page.goto(`${base}/operations`)
  await page.locator('#renameDbNameInput').fill(`${DB}_c`)
  await page.locator('#copy_db_form').getByRole('button', { name: 'Go', exact: true }).click()
  await expect(page.getByText(`Database ${DB} has been copied to ${DB}_c.`)).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/db/${DB}/operations$`))
})

const trackingPage = {
  db: DB,
  table: 'authors',
  type: 'table',
  available: true,
  activeMessage: false,
  trackedTables: [],
  lastVersion: 0,
  versions: [],
  defaultStatements:
    'CREATE TABLE,ALTER TABLE,DROP TABLE,RENAME TABLE,CREATE INDEX,DROP INDEX,INSERT,UPDATE,DELETE,TRUNCATE,REPLACE,CREATE VIEW,ALTER VIEW,DROP VIEW',
}

test('tracking: "Create version" of a table posts the statements of its form only (no VIEW statements)', async ({
  page,
}) => {
  let posted: { statements: string[] } | null = null
  await page.route(/\/tables\/authors\/tracking$/, (route) => route.fulfill({ json: trackingPage }))
  await page.route(/\/tables\/authors\/tracking\/versions$/, async (route) => {
    posted = route.request().postDataJSON()
    await route.fulfill({ json: { messages: [] } })
  })
  await login(page)
  await page.goto(`${base}/t/authors/tracking`)
  await page.getByRole('button', { name: 'Create version' }).click()
  await expect.poll(() => posted?.statements ?? null).not.toBeNull()
  expect(posted!.statements.filter((s) => s.includes('VIEW'))).toEqual([])
  expect(posted!.statements).toContain('CREATE TABLE')
})

test("tracking: the database page's Structure snapshot opens the version's snapshot with its query card", async ({
  page,
}) => {
  await page.route(/\/tables\/authors\/tracking$/, (route) =>
    route.fulfill({
      json: {
        ...trackingPage,
        lastVersion: 1,
        versions: [
          { version: '1', created: '2026-01-01 00:00:00', updated: '2026-01-01 00:00:00', active: true },
        ],
      },
    }),
  )
  await page.route(/\/tables\/authors\/tracking\/snapshot/, (route) =>
    route.fulfill({
      json: {
        version: '1',
        sql: 'DROP TABLE IF EXISTS `authors`;\nCREATE TABLE `authors` (`id` int);',
        columns: [],
        indexes: [],
      },
    }),
  )
  await login(page)
  await page.goto(`${base}/t/authors/tracking?snapshot=true&version=1`)
  await expect(page.getByText('Version 1 snapshot (SQL code)')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit inline' })).toBeVisible()
})

test('operations: Drop the database announces "has been dropped. (Query took …)" on the databases list', async ({
  page,
}) => {
  const c = await mysql.createConnection(MYSQL)
  await c.query(`CREATE DATABASE IF NOT EXISTS ${DB}_d`)
  await c.end()
  await login(page)
  await page.goto(`/s/1/db/${DB}_d/operations`)
  await page.locator('#drop_db_anchor').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'OK' }).click()
  await expect(
    page.getByText(
      new RegExp(`^Database \`${DB}_d\` has been dropped\\. \\(Query took \\d\\.\\d{4} seconds\\.\\)$`),
    ),
  ).toBeVisible()
})
