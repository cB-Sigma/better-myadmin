import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Results grid details end to end (docs/features/02-browse-results-grid.md › Micro-behaviours):
 * cell rendering, repeated headers, the navigation bars, header hints, row selection, the bulk
 * bar and the column visibility menu.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f04_e2e_grid'
const DB = 'f04_e2e_grid'

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE c (id INT PRIMARY KEY, n INT NULL, b BIT(3), s VARCHAR(20), d DATETIME) ENGINE=InnoDB;
    INSERT INTO c VALUES (1, NULL, b'101', 'a  b', '2024-01-02 03:04:05'), (2, 42, b'011', '', NULL), (3, 7, b'0', 'z', NULL);
    CREATE TABLE big (id INT PRIMARY KEY, v VARCHAR(10)) ENGINE=InnoDB;
    INSERT INTO big VALUES ${Array.from({ length: 120 }, (_, i) => `(${i + 1}, 'v${i + 1}')`).join(',')};
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f04\\_e2e\\_grid\`.* TO '${USER}'@'%';`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

async function browse(page: Page, table: string) {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
  await page.goto(`/s/1/db/${DB}/t/${table}/browse`)
  await expect(page.locator('table.table_results')).toBeVisible()
}

/** the data cell of a row under the header of `column` (the action cells come first) */
async function cell(page: Page, row: number, column: string) {
  const heads = page.locator('table.table_results thead tr').first().locator('> th, > td')
  const names = await heads.evaluateAll((els) => els.map((e) => e.getAttribute('data-column')))
  const span =
    names[0] === null ? await heads.first().evaluate((e) => (e as HTMLTableCellElement).colSpan) : 0
  const index = span + names.filter((n) => n !== null).indexOf(column)
  return page.locator('table.table_results tbody tr').nth(row).locator('> td').nth(index)
}

test('cells: italic NULL, right-aligned numbers, date/time no-wrap, BIT as binary digits [p02-f6be27 p02-9cc265 p02-57815e]', async ({
  page,
}) => {
  await browse(page, 'c')
  const nul = await cell(page, 0, 'n')
  await expect(nul).toHaveClass(/\bnull\b/)
  await expect(nul.locator('em')).toHaveText('NULL')
  await expect(await cell(page, 1, 'n')).toHaveText('42')
  await expect(await cell(page, 1, 'n')).toHaveClass(/text-end/)
  await expect(await cell(page, 0, 'd')).toHaveClass(/text-nowrap/)
  await expect(await cell(page, 0, 's')).toHaveClass(/pre_wrap/)
  await expect(await cell(page, 0, 'b')).toHaveText('101')
  await expect(await cell(page, 1, 'b')).toHaveText('011')
  await expect(await cell(page, 2, 'b')).toHaveText('000')
})

test('the header row repeats every RepeatCells rows; navigation above and below, not printed [p02-684d83 p02-42e1d3]', async ({
  page,
}) => {
  await browse(page, 'big')
  await expect(page.locator('table.navigation')).toHaveCount(2)
  await page.locator('table.navigation').first().getByLabel('Number of rows:').selectOption('250')
  await expect(page.locator('table.table_results tbody tr:not(.repeating_header_row)')).toHaveCount(120)
  // RepeatCells = 100: one repeated header after the 100th row
  await expect(page.locator('table.table_results .repeating_header_row')).toHaveCount(1)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('table.navigation').first()).toBeHidden()
})

test('header hints: sort and multi-sort, edit tooltip on the row action [p02-0ad93b p02-e392ea]', async ({
  page,
}) => {
  await browse(page, 'c')
  const sortLink = page.locator('th[data-column="s"] .sortlink')
  await expect(sortLink).toHaveAttribute('title', /^Click to sort results by this column\.\nShift\+Click/)
  await expect(
    page.locator('table.table_results tbody tr').first().locator('[title*="edit most values"]').first(),
  ).toHaveAttribute('title', 'You can also edit most values by double-clicking directly on them.')
})

test('Shift+click selects a range of rows; the bulk bar needs a selection [p02-a662d5 p02-6ae687 p02-9afb97]', async ({
  page,
}) => {
  await browse(page, 'c')
  await page.getByRole('button', { name: 'Delete' }).last().click()
  await expect(page.getByText('No row selected.')).toBeVisible()
  const boxes = page.locator('table.table_results tbody input.multi_checkbox')
  await boxes.nth(0).click()
  await boxes.nth(2).click({ modifiers: ['Shift'] })
  for (const i of [0, 1, 2]) await expect(boxes.nth(i)).toBeChecked()
  await expect(page.locator('table.table_results tbody tr.marked')).toHaveCount(3)
  await page.locator('#resultsForm_checkall, [id^=resultsForm][id$=checkall]').first().click()
  for (const i of [0, 1, 2]) await expect(boxes.nth(i)).not.toBeChecked()
})

test('the column visibility menu keeps one column visible; Show all restores [p02-f866f3]', async ({
  page,
}) => {
  await browse(page, 'c')
  await page.getByLabel("Click the drop-down arrow to toggle column's visibility.").first().click()
  const menu = page.locator('.cList')
  for (const name of ['id', 'n', 'b', 's']) await menu.getByLabel(name, { exact: true }).uncheck()
  await expect(page.locator('th[data-column="s"]')).toHaveClass(/\bhide\b/)
  await expect(menu.getByLabel('d', { exact: true })).toBeDisabled()
  await menu.getByRole('button', { name: 'Show all' }).click()
  await expect(page.locator('th.hide')).toHaveCount(0)
})

test('Copy to clipboard and the header double-click copy the results and the column name [p02-5aad8b p02-ba813c]', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await browse(page, 'c')
  await page.getByText('Copy to clipboard').click()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  const lines = text.split('\n')
  expect(lines[0]).toMatch(new RegExp(`^${DB}/c\\t\\thttp`))
  expect(lines).toContain('id\tn\tb\ts\td')
  expect(lines).toContain('1\tNULL\t101\ta  b\t2024-01-02 03:04:05')
  await page.locator('th[data-column="s"]').dblclick({ position: { x: 2, y: 2 } })
  await expect(page.getByText('Column name successfully copied to clipboard!')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('s')
})
