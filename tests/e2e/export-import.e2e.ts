import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Export and import end to end (docs/features/07-export-import.md): a quick SQL export downloaded
 * and viewed as text, then the dump imported into an empty database with progress and the result
 * message, and a CSV imported into a new table.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f07_e2e'
const DB = 'f07_e2e'
const TARGET = 'f07_e2e_in'

async function value(sql: string): Promise<unknown> {
  const c = await mysql.createConnection(ROOT)
  const [rows] = await c.query({ sql, rowsAsArray: true })
  await c.end()
  return (rows as unknown[][])[0]?.[0]
}

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${TARGET}; CREATE DATABASE ${DB}; CREATE DATABASE ${TARGET}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY, name VARCHAR(20)); INSERT INTO t VALUES (1, 'one'), (2, 'two');
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f07\\_e2e%\`.* TO '${USER}'@'%';`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(
    `DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${TARGET}; DROP USER IF EXISTS '${USER}'@'%'`,
  )
  await c.end()
})

test('export a database, view it as text, import it back, import a CSV', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()

  // quick SQL export: a download named after the database
  await page.goto(`/s/1/db/${DB}/export`)
  await expect(page.getByRole('heading', { name: `Exporting tables from "${DB}" database` })).toBeVisible()
  const downloading = page.waitForEvent('download')
  await page.locator('#buttonGo').click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe(`${DB}.sql`)
  const dump = readFileSync((await download.path()) as string, 'utf8')
  expect(dump).toContain('CREATE TABLE `t`')
  expect(dump).toContain("(1, 'one')")

  // custom: view output as text
  await page.getByLabel('Custom - display all possible options').check()
  await page.getByLabel('View output as text').check()
  await page.locator('#buttonGo').click()
  await expect(page.locator('#textSQLDUMP')).toHaveValue(/INSERT INTO `t`/)

  // import the dump into the empty database
  await page.goto(`/s/1/db/${TARGET}/import`)
  await expect(page.getByRole('heading', { name: `Importing into the database "${TARGET}"` })).toBeVisible()
  await page
    .locator('#input_import_file')
    .setInputFiles({ name: 'dump.sql', mimeType: 'text/plain', buffer: Buffer.from(dump) })
  await page.locator('#buttonGo').click()
  await expect(page.getByText(/rows? inserted|Import has been successfully finished/).first()).toBeVisible()
  expect(Number(await value(`SELECT COUNT(*) FROM ${TARGET}.t`))).toBe(2)

  // a CSV file selects the CSV format and becomes a new table
  await page.goto(`/s/1/db/${TARGET}/import`)
  await page.locator('#input_import_file').setInputFiles({
    name: 'people.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,age\nann,31\nbob,42\n'),
  })
  await expect(page.locator('#plugins')).toHaveValue('csv')
  await expect(
    page.getByText('Note: If the file contains multiple tables, they will be combined into one.'),
  ).toBeVisible()
  await page.locator('#checkbox_csv_col_names').check()
  await page.locator('#buttonGo').click()
  await expect(page.getByText('Import has been successfully finished, 2 queries executed.')).toBeVisible()
  expect(Number(await value(`SELECT SUM(age) FROM ${TARGET}.people`))).toBe(73)
})
