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
  await r0.getByLabel('Column', { exact: true }).fill('id')
  await r0.getByLabel('AUTO_INCREMENT').check()
  // ticking A_I selects PRIMARY in the Index column (the option values carry the row number, as in column_attributes.twig)
  await expect(r0.getByLabel('Index')).toHaveValue('primary_0')
  const r1 = page.getByTestId('column-row-1')
  await r1.getByLabel('Column', { exact: true }).fill('title')
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
  await a0.getByLabel('Column', { exact: true }).fill('qty')
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
  await expect(c0.getByLabel('Column', { exact: true })).toHaveValue('title')
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

/**
 * The column form's helpers (functions.ts): Enter in "Add … column(s)", the ENUM/SET editor, a
 * NULL default dropped with Null, and UNSIGNED / ZEROFILL on a type without it.
 */
test('column form: added_fields Enter, ENUM/SET editor, NULL default, UNSIGNED notice', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
  await page.goto(`/s/1/db/${DB}/create-table`)
  await expect(page.locator('[data-testid^=column-row-]')).toHaveCount(4)

  // Enter in added_fields adds the rows (the form is not sent)
  const added = page.locator('input[name=added_fields]')
  await added.fill('2')
  await added.press('Enter')
  await expect(page.locator('[data-testid^=column-row-]')).toHaveCount(6)
  await expect(page).toHaveURL(/\/create-table$/)

  // the ENUM/SET editor
  const r0 = page.getByTestId('column-row-0')
  await r0.getByLabel('Column', { exact: true }).fill('kind')
  await r0.getByLabel('Type').selectOption('ENUM')
  await r0.getByRole('button', { name: 'Edit ENUM/SET values' }).click()
  const ed = page.getByRole('dialog', { name: 'ENUM/SET editor' })
  await expect(ed).toContainText('Values for column "kind"')
  await expect(ed).toContainText('Enter each value in a separate field.')
  await expect(ed.locator('table.values input')).toHaveCount(4)
  const slider = ed.locator('input.slider')
  await expect(slider).toHaveAttribute('max', '9')
  await slider.fill('3')
  await ed.getByRole('button', { name: 'Add 3 value(s)' }).click()
  await expect(ed.locator('table.values input')).toHaveCount(7)
  await ed.locator('table.values input').nth(0).fill('a')
  await ed.locator('table.values input').nth(1).fill("it's")
  await ed.locator('td.drop button').nth(2).click()
  await expect(ed.locator('table.values input')).toHaveCount(6)
  await ed.getByRole('button', { name: 'Go' }).click()
  await expect(r0.getByLabel('Length/Values')).toHaveValue("'a','it''s'")

  // validateDefaultValue: unticking Null drops a NULL default
  const r1 = page.getByTestId('column-row-1')
  await r1.getByLabel('Null').check()
  await r1.getByLabel('Default').selectOption('NULL')
  await r1.getByLabel('Null').uncheck()
  await expect(r1.getByLabel('Default')).toHaveValue('NONE')

  // showWarningForIntTypes: the integer width notice while a row has an integer type
  await expect(page.locator('#length_not_allowed')).toContainText(
    'The column width of integer types is ignored in your MySQL version unless defining a TINYINT(1) column',
  )
  // resetAttributeForNonNumericType: a non-numeric type drops UNSIGNED
  const r2 = page.getByTestId('column-row-2')
  await r2.getByLabel('Type').selectOption('INT')
  await r2.getByLabel('Attributes').selectOption('UNSIGNED')
  await r2.getByLabel('Type').selectOption('DATE')
  await expect(r2.getByLabel('Attributes')).toHaveValue('')

  // checkTableEditForm: UNSIGNED / ZEROFILL on a text type is refused with a notification
  await page.getByRole('textbox', { name: 'Table name:' }).fill('checks')
  await r1.getByLabel('Column', { exact: true }).fill('label')
  await r1.getByLabel('Type').selectOption('TEXT')
  await r1.getByLabel('Attributes').selectOption('UNSIGNED ZEROFILL')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.ajax_notification')).toContainText(
    'TEXT does not support the UNSIGNED attribute.',
  )
  await expect(page).toHaveURL(/\/create-table$/)
})
