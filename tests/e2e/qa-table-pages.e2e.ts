import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL } from './fixtures.ts'

/**
 * Exploratory QA against phpMyAdmin, second round (search / find and replace, create table,
 * multi-table query, designer, central columns, normalization, charts): each difference pinned
 * here. Objects prefixed m1qaf_.
 */
const USER = 'm1qaf_user'
const DB = 'm1qaf_db'

async function sql(q: string): Promise<unknown[]> {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  try {
    return (await c.query(q))[0] as unknown[]
  } finally {
    await c.end()
  }
}

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB} CHARACTER SET utf8mb4; USE ${DB};
    CREATE TABLE dept (id INT PRIMARY KEY, name VARCHAR(30), city VARCHAR(30));
    CREATE TABLE emp (id INT PRIMARY KEY, dept_id INT, name VARCHAR(30), salary DECIMAL(10,2),
      CONSTRAINT fk_d FOREIGN KEY (dept_id) REFERENCES dept(id));
    INSERT INTO dept VALUES (1, 'Eng', 'Paris'), (2, 'Sales', 'Rome');
    INSERT INTO emp VALUES (1, 1, 'Ann', 100), (2, 1, 'Bob', 200), (3, 2, 'Cy', 150);
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`m1qaf\\_db\`.* TO '${USER}'@'%';`)
})

test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
})

async function login(page: Page) {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('find and replace: the result message with its query card comes before the search pills', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/t/dept/find-replace`)
  await page.locator('#findInput').fill('Rome')
  await page.locator('#replaceWithInput').fill('Roma')
  await page.locator('#columnIndexSelect').selectOption({ label: 'city' })
  await page.locator('#find_replace_form').getByRole('button', { name: 'Go' }).click()
  await page.locator('#buttonReplace').click()
  const card = page.locator('.result_query').first()
  await expect(card).toContainText('Your SQL query has been executed successfully.')
  await expect(
    card.getByRole('button', { name: 'Edit inline' }).or(card.getByText('Edit inline')),
  ).toBeVisible()
  await expect(card.getByText('Create PHP code')).toBeVisible()
  // Generator::getMessage is added before the find and replace page (pills included)
  const above = await page.evaluate(() => {
    const c = document.querySelector('.result_query')
    const pills = document.querySelector('[data-testid="search-pills"]')
    return (
      c !== null &&
      pills !== null &&
      (c.compareDocumentPosition(pills) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    )
  })
  expect(above).toBe(true)
  expect(await sql(`SELECT city FROM ${DB}.dept WHERE id = 2`)).toEqual([{ city: 'Roma' }])
})

test('create table: the column grid keeps its natural width and scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.goto(`/s/1/db/${DB}/create-table`)
  const grid = page.locator('#table_columns')
  await expect(grid).toBeVisible()
  const { table, box } = await grid.evaluate((el) => ({
    table: el.scrollWidth,
    box: (el.parentElement as HTMLElement).clientWidth,
  }))
  // phpMyAdmin's table is as wide as its inputs; the wrapper scrolls
  expect(table).toBeGreaterThan(box)
  // _common.scss #table_columns: text inputs and selects are 10em wide
  for (const c of [
    'select.column_type',
    'input[name="field_name[0]"]',
    'select[name="field_collation[0]"]',
  ]) {
    const w = (await page.locator(`#table_columns ${c}`).first().boundingBox())?.width ?? 0
    expect(w).toBeGreaterThan(120)
    expect(w).toBeLessThan(140)
  }
})

test('central columns: after a column is added the page shows the Add new column form folded (main.twig)', async ({
  page,
}) => {
  // the e2e server has no configuration storage: the central list is played by the routes
  const names: string[] = []
  const col = (name: string) => ({
    name,
    type: 'varchar',
    length: '30',
    collation: '',
    isNull: true,
    extra: '',
    attribute: '',
    default: null,
    defaultType: 'NONE',
    defaultValue: '',
  })
  await page.route(new RegExp(`/databases/${DB}/central-columns(\\?.*)?$`), async (route) => {
    if (route.request().method() === 'POST') {
      names.push('name')
      await route.fulfill({ json: { ok: true, message: { type: 'success', text: 'done' } } })
      return
    }
    const json = await (await route.fetch()).json()
    await route.fulfill({
      json: {
        ...json,
        enabled: true,
        totalRows: names.length,
        columns: names.map(col),
        message: { type: 'success', text: `Showing rows 1 - ${names.length}.` },
      },
    })
  })
  await page.goto(`/s/1/db/${DB}/central-columns`)
  await expect(page.locator('#add_new')).toBeVisible()
  await page.locator('#table-select').selectOption('emp')
  await page.locator('#column-select').selectOption('name')
  await page.locator('#add_column').getByRole('button').first().click()
  await expect(page.locator('#tableslistcontainer')).toContainText('name')
  await expect(page.locator('#add_new')).toBeHidden()
  await expect(page.locator('#add_col_div')).toContainText('+Add new column')
})
