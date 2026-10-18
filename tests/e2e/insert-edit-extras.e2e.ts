import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Insert/Edit form details end to end (docs/features/03-insert-edit-transformations.md ›
 * Micro-behaviours checklist): Ignore and NULL boxes, the Function/Type toggles, Reset, the
 * calendar button and the unsaved-changes guard.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f04_e2e_ie'
const DB = 'f04_e2e_ie'
const NAME = 'b068931cc450442b63f5b3d276ea4297' // md5('name')
const D = '8277e0910d750195b448797616e091ad' // md5('d')

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE w (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) NULL, d DATE NULL);
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f04\\_e2e\\_ie\`.* TO '${USER}'@'%';`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

async function insertForm(page: Page) {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
  await page.goto(`/s/1/db/${DB}/t/w/insert`)
  await expect(page.locator('#insertForm table.insertRowTable')).toHaveCount(2)
}
const value = (page: Page, row: number, md5: string) =>
  page.locator(`input[name="fields[multi_edit][${row}][${md5}]"]`)
/** the NULL checkbox of the first nullable column (name) of a row */
const nullBox = (page: Page, row: number) =>
  page
    .locator('table.insertRowTable')
    .nth(row)
    .getByRole('checkbox', { name: 'Use the NULL value for this column.' })
    .first()

test('typing into a field unchecks the row Ignore box and the field NULL box; NULL clears the value [p03-2fe3ee p03-d6d2b2]', async ({
  page,
}) => {
  await insertForm(page)
  await expect(page.locator('#insert_ignore_1')).toHaveAttribute('data-state', 'checked')
  const name = value(page, 1, NAME)
  // the NULL default pre-checks the box
  await expect(nullBox(page, 1)).toBeChecked()
  await name.fill('typed')
  await expect(page.locator('#insert_ignore_1')).toHaveAttribute('data-state', 'unchecked')
  await expect(nullBox(page, 1)).not.toBeChecked()
  await nullBox(page, 1).click()
  await expect(name).toHaveValue('')
})

test('the Function and Type columns hide and come back through "Show : Function : Type" [p03-7dd885]', async ({
  page,
}) => {
  await insertForm(page)
  const form = page.locator('#insertForm')
  await form.getByRole('button', { name: 'Type' }).first().click()
  await form.getByRole('button', { name: 'Function' }).first().click()
  await expect(form.locator('div').filter({ hasText: /^Show : Function : Type$/ })).toBeVisible()
  await expect(form.locator('th', { hasText: /^Type$/ })).toHaveCount(0)
  await form.getByRole('button', { name: 'Function' }).click()
  await form.getByRole('button', { name: 'Type' }).click()
  await expect(form.locator('th').filter({ hasText: 'Type' }).first()).toBeVisible()
})

test('Reset restores the rendered values; date fields have the calendar button [p03-366905 p03-812c66]', async ({
  page,
}) => {
  await insertForm(page)
  await value(page, 0, NAME).fill('x')
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(value(page, 0, NAME)).toHaveValue('')
  // a Go button under each row table and one in the actions panel
  expect(
    await page.locator('#insertForm').getByRole('button', { name: 'Go' }).count(),
  ).toBeGreaterThanOrEqual(3)
  const picker = page.locator('table.insertRowTable').first().locator('.ui-datepicker-trigger')
  await expect(picker).toHaveCount(1)
  await expect(value(page, 0, D)).toBeVisible()
})

test('leaving the form with a modified field asks for confirmation [p03-06384d]', async ({ page }) => {
  await insertForm(page)
  await value(page, 0, NAME).fill('unsaved')
  await expect(page.locator('#lock_page_icon img, #lock_page_icon svg')).toHaveCount(1)
  const messages: string[] = []
  page.once('dialog', (d) => {
    messages.push(d.message())
    void d.dismiss()
  })
  await page.getByRole('link', { name: 'Structure' }).first().click()
  await expect.poll(() => messages.length).toBe(1)
  await expect(page).toHaveURL(/\/t\/w\/insert/)
})
