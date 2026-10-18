import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * Texts phpMyAdmin shows on the table pages that we now show too: the "Searching" and "Dropping …"
 * notifications while a request runs, the column form's header hints and type groups, the bulk
 * drop dialog, and the normalization wait text. Each slow request is held back by page.route so the
 * notification can be seen.
 */
const DB = 'f05_tmsg'

async function sql(q: string): Promise<void> {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  try {
    await c.query(q)
  } finally {
    await c.end()
  }
}

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE p (id INT PRIMARY KEY) ENGINE=InnoDB;
    CREATE TABLE t (id INT, k INT, a VARCHAR(10), b INT, PRIMARY KEY (id, k), KEY ib (b),
      CONSTRAINT fk_b FOREIGN KEY (b) REFERENCES p (id)) ENGINE=InnoDB;
    INSERT INTO p VALUES (1); INSERT INTO t VALUES (1, 1, 'x', 1), (2, 1, 'y', 1)`)
})
test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}`)
})

/** holds the requests to `pattern` back so the notification of the running request shows */
async function slow(page: Page, pattern: string) {
  await page.route(pattern, async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.continue()
  })
}

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('table and database search show "Searching" while the query runs', async ({ page }) => {
  await slow(page, '**/tables/t/search')
  await page.goto(`/s/1/db/${DB}/t/t/search`)
  await page.locator('#tbl_search_form').getByRole('button', { name: 'Go' }).click()
  await expect(page.getByText('Searching', { exact: true })).toBeVisible()
  await slow(page, `**/databases/${DB}/search`)
  await page.goto(`/s/1/db/${DB}/search`)
  await page.locator('#criteriaSearchString').fill('x')
  await page.locator('#db_search_form').getByRole('button', { name: 'Search' }).click()
  await expect(page.getByText('Searching', { exact: true })).toBeVisible()
})

test('structure: header hints, type groups, the bulk drop dialog and "Dropping …" notices', async ({
  page,
}) => {
  page.on('dialog', (d) => void d.accept())
  await page.goto(`/s/1/db/${DB}/t/t/structure/change?fields[]=a`)
  const head = page.locator('thead th')
  await expect(head.filter({ hasText: 'Length/Values' }).locator('.pma_hint')).toHaveAttribute(
    'title',
    /^If column type is "enum" or "set", please enter the values using this format: 'a','b','c'…\nIf you ever need/,
  )
  await expect(head.filter({ hasText: 'Default' }).locator('.pma_hint')).toHaveAttribute(
    'title',
    'For default values, please enter just a single value, without backslash escaping or quotes, using this format: a',
  )
  await expect(page.locator('select.column_type').first().locator('optgroup[label="String"]')).toHaveCount(1)

  await page.goto(`/s/1/db/${DB}/t/t/structure`)
  await page.getByTestId('structure-row-a').getByRole('checkbox').check()
  await page
    .locator('em', { hasText: 'With selected:' })
    .locator('..')
    .getByRole('button', { name: 'Drop', exact: true })
    .click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByRole('heading', { name: 'Dropping columns from the table' })).toBeVisible()
  await expect(dlg).toContainText('Do you really want to execute the following query?')
  await dlg.getByRole('button', { name: 'No' }).click()

  await slow(page, '**/tables/t/columns/drop')
  await page.getByTestId('structure-row-a').getByRole('button', { name: 'Drop' }).click()
  await expect(page.getByText('Dropping column', { exact: true })).toBeVisible()
  await expect(page.getByTestId('structure-row-a')).toHaveCount(0)

  await slow(page, '**/tables/t/indexes/drop')
  await page.getByTestId('index-ib').getByRole('button', { name: 'Drop' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click()
  await expect(page.getByText('Dropping Primary Key/Index', { exact: true })).toBeVisible()
})

test('relation view: "Dropping Foreign key." while the constraint is dropped', async ({ page }) => {
  await slow(page, '**/relation/drop-foreign-key')
  await page.goto(`/s/1/db/${DB}/t/t/relation`)
  await page.locator('.drop_foreign_key_anchor').first().click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'OK' }).click()
  await expect(page.getByText('Dropping Foreign key.', { exact: true })).toBeVisible()
})
