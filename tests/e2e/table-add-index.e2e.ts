import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * The create table / add columns form's Index selects (resources/js/modules/indexes.ts): the Add
 * index dialog, the single / composite choice, Cancel, and the indexes the form then creates.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f05_addidx_e2e'
const DB = 'f05_addidx_e2e'

async function sql(q: string): Promise<unknown> {
  const c = await mysql.createConnection(ROOT)
  try {
    return (await c.query({ sql: q, rowsAsArray: true }))[0]
  } finally {
    await c.end()
  }
}
const showCreate = async (table: string) =>
  String(((await sql(`SHOW CREATE TABLE ${DB}.${table}`)) as unknown[][])[0]?.[1])

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f05\\_addidx\\_e2e\`.* TO '${USER}'@'%';`)
})

test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
})

test('create table: the Index selects open the Add index dialogs (indexes.ts)', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()

  await page.goto(`/s/1/db/${DB}/create-table`)
  await page.getByRole('textbox', { name: 'Table name:' }).fill('keyed')
  const row = (i: number) => page.getByTestId(`column-row-${i}`)
  for (const [i, n] of ['a', 'b', 'c'].entries()) await row(i).getByLabel('Column', { exact: true }).fill(n)
  const modal = page.locator('#addIndexModal')

  // the first UNIQUE: the index form of that column, Go adds it and names it under the select
  await row(0).getByLabel('Index').selectOption('unique_0')
  await expect(modal.locator('#select_index_choice')).toBeDisabled()
  await expect(modal.locator('select[name="index[columns][names][]"]')).toHaveValue('0')
  await modal.locator('#addIndexModalGoButton').click()
  await expect(modal).toHaveCount(0)
  await expect(page.locator('#index_name_0_8')).toHaveText('[a]')

  // a second UNIQUE: single-column or composite; composite with [a] gives one two-column index
  await row(1).getByLabel('Index').selectOption('unique_1')
  await expect(modal.locator('#advance_index_creator legend')).toHaveText('UNIQUE')
  await modal.locator('#composite_index').check()
  await expect(modal.locator('#composite_index_list')).toContainText('Composite with:')
  // no index picked: "Missing value in the form!"
  await modal.locator('#addIndexModalGoButton').click()
  await expect(modal).toContainText('Missing value in the form!')
  await modal.locator('#composite_index_0').check()
  await modal.locator('#addIndexModalGoButton').click()
  await expect(modal.locator('select[name="index[columns][names][]"]')).toHaveCount(2)
  await modal.locator('#input_index_name').fill('u_ab')
  await modal.locator('#addIndexModalGoButton').click()
  await expect(page.locator('#index_name_0_8')).toHaveText('u_ab')
  await expect(page.locator('#index_name_1_8')).toHaveText('u_ab')

  // Cancel puts the select back to the index it was in
  await row(2).getByLabel('Index').selectOption('index_2')
  await modal.locator('#addIndexModalCancelButton').click()
  await expect(row(2).getByLabel('Index')).toHaveValue('none_2')

  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(/\/t\/keyed\/structure$/)
  expect(await showCreate('keyed')).toContain('UNIQUE KEY `u_ab` (`a`,`b`)')
})
