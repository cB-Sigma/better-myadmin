import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Table Structure flows end to end: create a table, add a column, change a column, add an index
 * (row action and index dialog) and drop a column with its confirmation.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'm2tbl_e2e'
const DB = 'm2tbl_e2e'

async function showCreate(table: string): Promise<string> {
  const c = await mysql.createConnection(ROOT)
  const [rows] = await c.query({ sql: `SHOW CREATE TABLE ${DB}.${table}`, rowsAsArray: true })
  await c.end()
  return String((rows as unknown[][])[0]?.[1])
}

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`m2tbl\\_e2e\`.* TO '${USER}'@'%';`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

test('create table, add / change a column, add indexes, drop a column', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.accept()
  })
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()

  // ---- create table (4 rows by default, empty names are skipped)
  await page.goto(`/s/1/db/${DB}/create-table`)
  await page.getByRole('textbox', { name: 'Table name:' }).fill('items')
  await expect(page.locator('[data-testid^=column-row-]')).toHaveCount(4)
  const r0 = page.getByTestId('column-row-0')
  await r0.getByLabel('Name').fill('id')
  await r0.getByLabel('AUTO_INCREMENT').check()
  // ticking A_I selects PRIMARY in the Index column
  await expect(r0.getByLabel('Index')).toHaveValue('primary')
  const r1 = page.getByTestId('column-row-1')
  await r1.getByLabel('Name').fill('title')
  await r1.getByLabel('Type').selectOption('VARCHAR')
  // VARCHAR without a length is refused like checkTableEditForm
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => dialogs.at(-1)).toBe('Please enter a valid length!')
  await r1.getByLabel('Length/Values').fill('40')
  await page.getByRole('button', { name: 'Preview SQL' }).click()
  await expect(page.getByTestId('preview-sql')).toHaveText(
    'CREATE TABLE `m2tbl_e2e`.`items` (`id` INT NOT NULL AUTO_INCREMENT , `title` VARCHAR(40) NOT NULL , PRIMARY KEY (`id`)) ENGINE = InnoDB;',
  )
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(/\/t\/items\/structure$/)
  await expect(page.getByTestId('structure-row-id')).toContainText('AUTO_INCREMENT')
  await expect(page.getByTestId('structure-row-title')).toContainText('varchar(40)')

  // ---- add a column after "title"
  await page.locator('#addColumns select[name=after_field]').selectOption('title')
  await page.locator('#addColumns').getByRole('button', { name: 'Go' }).click()
  await expect(page).toHaveURL(/\/structure\/add\?/)
  const a0 = page.getByTestId('column-row-0')
  await a0.getByLabel('Name').fill('qty')
  await a0.getByLabel('Null').check()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(/\/t\/items\/structure$/)
  await expect(page.getByTestId('message-text').first()).toHaveText(
    'Table items has been altered successfully.',
  )
  await expect(page.getByTestId('structure-row-qty')).toContainText('Yes')

  // ---- change "title": longer, with a comment
  await page.getByTestId('structure-row-title').getByRole('link', { name: 'Change' }).click()
  const c0 = page.getByTestId('column-row-0')
  await expect(c0.getByLabel('Name')).toHaveValue('title')
  await expect(c0.getByLabel('Length/Values')).toHaveValue('40')
  await c0.getByLabel('Length/Values').fill('80')
  await c0.getByLabel('Comments').fill('the title')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(/\/t\/items\/structure$/)
  await expect(page.getByTestId('structure-row-title')).toContainText('varchar(80)')
  // the change form re-posts the column's collation, so the CHANGE states it (as phpMyAdmin)
  expect(await showCreate('items')).toMatch(/`title` varchar\(80\) .*NOT NULL COMMENT 'the title'/)

  // ---- add an index from the row's "More" menu (confirm with the statement)
  const qty = page.getByTestId('structure-row-qty')
  await qty.getByText('More').click()
  await qty.getByRole('button', { name: 'Index', exact: true }).click()
  await expect
    .poll(() => dialogs.at(-1))
    .toBe('Do you really want to execute "ALTER TABLE `items` ADD INDEX(`qty`);"?')
  await expect(page.getByTestId('index-qty')).toBeVisible()

  // ---- and a named composite one from the index dialog
  await page.locator('#index_div').getByRole('spinbutton').fill('2')
  await page.locator('#index_div').getByRole('button', { name: 'Go' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.locator('#input_index_name').fill('t_q')
  await dlg.locator('#select_index_choice').selectOption('INDEX')
  await dlg.getByTestId('index-column-0').getByLabel('Column').selectOption('title')
  await dlg.getByTestId('index-column-0').getByLabel('Size').fill('10')
  await dlg.getByTestId('index-column-1').getByLabel('Column').selectOption('qty')
  await dlg.getByRole('button', { name: 'Go' }).click()
  await expect(page.getByTestId('index-t_q')).toContainText('title (10)')
  expect(await showCreate('items')).toContain('KEY `t_q` (`title`(10),`qty`)')

  // ---- drop "qty" from its row (JS confirm with the exact statement)
  await qty.getByRole('button', { name: 'Drop' }).click()
  await expect
    .poll(() => dialogs.at(-1))
    .toBe('Do you really want to execute "ALTER TABLE `items` DROP `qty`;"?')
  await expect(page.getByTestId('structure-row-qty')).toHaveCount(0)
  await expect(page.getByTestId('message-text').first()).toContainText('Column qty has been dropped.')
  expect(await showCreate('items')).not.toContain('`qty`')
})
