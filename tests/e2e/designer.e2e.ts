import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * Smoke test of the Designer (docs/features/05-database-level.md): tables and their relation on
 * the canvas, a dragged table saved as a new page and loaded again, the schema exported as SVG and
 * the visual query builder's SELECT. The pmadb writes are covered by the parity suite.
 */
const DB = 'f05d_e2e'
const USER = 'f05d_e2e_user'

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.parent (id INT PRIMARY KEY, name VARCHAR(20)) ENGINE=InnoDB;
    CREATE TABLE ${DB}.child (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES ${DB}.parent (id)) ENGINE=InnoDB;
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON *.* TO '${USER}'@'%'`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

const base = `/s/1/db/${DB}/designer`

test('the canvas: tables, the relation line, drag and save as a new page', async ({ page }) => {
  await login(page, USER, USER)
  await page.goto(base)
  const parent = page.locator(`[id="${DB}.parent"]`)
  await expect(parent).toContainText('id : int')
  await expect(page.locator(`[id="${DB}.child"]`)).toContainText('parent_id : int')
  await expect(page.locator('#canvas line')).toHaveCount(3)
  await expect(page.locator('#page_name')).toHaveText('Untitled')

  // drag the parent table by its header
  const head = page.locator(`[id="id_zag_${DB}.parent"]`)
  const box = await head.boundingBox()
  if (box === null) throw new Error('no header')
  await page.mouse.move(box.x + 5, box.y + 5)
  await page.mouse.down()
  await page.mouse.move(box.x + 65, box.y + 45, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('#saved_state')).toHaveText('*')

  await page.locator('#savePos').click()
  await page.locator('#designerGoModal input[name="selected_value"]').fill('e2e page')
  await page.locator('#designerModalGoButton').click()
  await expect(page.locator('#page_name')).toHaveText('e2e page')
  await expect(page.locator('#saved_state')).toHaveText('')

  // the database's only page is loaded again
  await page.goto(base)
  await expect(page.locator('#page_name')).toHaveText('e2e page')
})

test('export schema as SVG', async ({ page }) => {
  await login(page, USER, USER)
  await page.goto(base)
  await page.locator('#exportPages').click({ force: true })
  await page.locator('#plugins').selectOption('svg')
  const download = page.waitForEvent('download')
  await page.locator('#designerModalGoButton').click()
  expect((await download).suggestedFilename()).toMatch(/\.svg$/)
})

test('visual query builder: Build Query', async ({ page }) => {
  await login(page, USER, USER)
  await page.goto(`${base}?query=1`)
  await page.locator(`[id="select_${DB}.parent._name"]`).check()
  await page.locator('#build_query_button').click({ force: true })
  await expect(page.locator('#buildQueryModal')).toContainText('SELECT `parent`.`name`')
})
