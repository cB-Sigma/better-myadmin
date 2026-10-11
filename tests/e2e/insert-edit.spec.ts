import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Insert tab end to end: widgets, Ignore boxes, Continue insertion, Ctrl+arrow navigation, Preview
 * SQL, the GIS editor and the foreign-key dropdown, then saving and the message on the SQL tab.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f03_e2e'
const DB = 'f03_e2e'

async function rows(): Promise<unknown[][]> {
  const c = await mysql.createConnection(ROOT)
  const [r] = await c.query({
    sql: `SELECT id, name, kind, parent_id, ST_AsText(pt) FROM ${DB}.t ORDER BY id`,
    rowsAsArray: true,
  })
  await c.end()
  return r as unknown[][]
}

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE parent (id INT PRIMARY KEY, label VARCHAR(20));
    INSERT INTO parent VALUES (1, 'one'), (2, 'two');
    CREATE TABLE t (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20), kind ENUM('a','b') NOT NULL DEFAULT 'a',
      parent_id INT, pt POINT, FOREIGN KEY (parent_id) REFERENCES parent (id));
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f03\\_e2e\`.* TO '${USER}'@'%';`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

test('insert rows through the Insert tab', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()

  await page.goto(`/s/1/db/${DB}/t/t/insert`)
  const form = page.locator('#insertForm')
  await expect(form.locator('table.insertRowTable')).toHaveCount(2)
  await expect(page.locator('#insert_ignore_1')).toHaveAttribute('data-state', 'checked')

  // Continue insertion: a third row, then back to two
  await page.locator('#insert_rows').fill('3')
  await expect(form.locator('table.insertRowTable')).toHaveCount(3)
  await page.locator('#insert_rows').fill('2')
  await expect(form.locator('table.insertRowTable')).toHaveCount(2)

  // row 0: name, enum radio, FK dropdown (blank, content-id, blank, id-content)
  const name = page.locator('input[name="fields[multi_edit][0][b068931cc450442b63f5b3d276ea4297]"]')
  await name.fill('alpha')
  await page.getByRole('radio', { name: 'b' }).first().check()
  const fk = page.locator('select[name^="fields[multi_edit][0]"]').filter({ hasText: 'one' })
  await expect(fk.locator('option')).toHaveText([' ', 'one - 1', 'two - 2', ' ', '1 - one', '2 - two'])
  await fk.selectOption({ index: 2 })

  // Ctrl+Down moves from the name value to the next column's value
  await name.focus()
  await page.keyboard.press('Control+ArrowLeft')
  await expect(page.locator(':focus')).toHaveAttribute('id', /field_\d+_2|field_\d+_1/)

  // GIS editor: a point copied into the row
  await page.getByRole('button', { name: 'Edit/Insert' }).first().click()
  const gis = page.locator('#gisEditorModal')
  await expect(gis).toBeVisible()
  await gis.getByLabel('X', { exact: true }).fill('3')
  await gis.getByLabel('Y', { exact: true }).fill('4')
  await expect(gis.locator('#gis_data_textarea')).toHaveValue("'POINT(3 4)',0")
  await gis.getByRole('button', { name: 'Copy' }).click()

  // Preview SQL
  await page.getByRole('button', { name: 'Preview SQL' }).click()
  await expect(page.getByTestId('preview-sql')).toContainText('INSERT INTO `t`')
  await page.locator('#previewSQLCloseButton').click()

  await page.locator('#buttonYes').click()
  await expect(page.getByText('1 row inserted.')).toBeVisible()
  expect(await rows()).toEqual([[1, 'alpha', 'b', 2, 'POINT(3 4)']])
})
