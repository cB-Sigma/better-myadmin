import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * The results grid's browser behaviours (resources/js/makegrid.ts): Ctrl+arrow moves the cell
 * editor, Esc cancels it, the square cell selection and its copy text, Ctrl+A, column resizing,
 * ENUM values from the list only, and the datetime picker of date cells.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f05_grid_e2e'
const DB = 'f05_grid_e2e'

async function sql(q: string): Promise<unknown[][]> {
  const c = await mysql.createConnection(ROOT)
  try {
    return (await c.query({ sql: q, rowsAsArray: true }))[0] as unknown[][]
  } finally {
    await c.end()
  }
}

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY, name VARCHAR(20), kind ENUM('a','b'), d DATE) ENGINE=InnoDB;
    INSERT INTO t VALUES (1, 'one', 'a', '2024-01-01'), (2, 'two', 'b', '2024-02-02'), (3, 'three', 'a', NULL);
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f05\\_grid\\_e2e\`.* TO '${USER}'@'%';`)
})

test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
})

test('grid editing keys, cell selection and copy, column resize', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
  await page.goto(`/s/1/db/${DB}/t/t/browse`)
  const rows = page.locator('table.table_results tbody tr')
  await expect(rows).toHaveCount(3)
  const cell = (r: number, col: string) =>
    rows.nth(r).locator('td[data-type]').nth(['id', 'name', 'kind', 'd'].indexOf(col))

  // ---- Ctrl+ArrowDown saves nothing (unchanged) and opens the editor one row below
  await cell(0, 'name').dblclick()
  await expect(cell(0, 'name').locator('.cEdit .edit_box')).toHaveValue('one')
  await cell(0, 'name').locator('.edit_box').press('Control+ArrowDown')
  await expect(cell(1, 'name').locator('.cEdit .edit_box')).toHaveValue('two')
  // Ctrl+ArrowRight: the next grid-editable cell of the row
  await cell(1, 'name').locator('.edit_box').press('Control+ArrowRight')
  await expect(cell(1, 'kind').locator('.cEdit')).toBeVisible()
  // ENUM values come from the list: typing does not change the text box
  await cell(1, 'kind').locator('.edit_box').press('x')
  await expect(cell(1, 'kind').locator('.edit_box')).not.toHaveValue(/x/)
  // Esc cancels wherever the focus is
  await page.locator('body').press('Escape')
  await expect(page.locator('.cEdit')).toHaveCount(0)

  // ---- a date cell offers the datetime picker
  await cell(0, 'd').dblclick()
  await expect(cell(0, 'd').locator('.cEdit .ui-datepicker-trigger')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.cEdit')).toHaveCount(0)

  // ---- drag a square selection over two rows and two columns, then copy it
  const a = await cell(0, 'id').boundingBox()
  const b = await cell(1, 'name').boundingBox()
  if (a === null || b === null) throw new Error('no cell box')
  await page.mouse.move(a.x + 5, a.y + 5)
  await page.mouse.down()
  await page.mouse.move(b.x + 5, b.y + 5, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('td.cell-selected')).toHaveCount(4)
  await expect(page.locator('td.cell-selected.with-bg-color')).toHaveCount(4)
  const copied = await page.evaluate(() => {
    const data = new DataTransfer()
    document.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }),
    )
    return data.getData('text/plain')
  })
  expect(copied).toBe('1\tone\n2\ttwo')
  // Esc resets the selection; Ctrl+A selects every cell and header
  await page.keyboard.press('Escape')
  await expect(page.locator('td.cell-selected')).toHaveCount(0)
  await page
    .locator('h2, .sqlqueryresults')
    .first()
    .click({ position: { x: 1, y: 1 } })
  await page.keyboard.press('Control+a')
  await expect(page.locator('td.cell-selected')).toHaveCount(12)
  await expect(page.locator('th.draggable.cell-selected')).toHaveCount(4)

  // ---- drag the column border to widen "name"
  const th = page.locator('th[data-column="name"]')
  const before = (await th.locator('span.th-content').boundingBox())?.width ?? 0
  const handle = await th.locator('.colborder').boundingBox()
  if (handle === null) throw new Error('no resize handle')
  await page.mouse.move(handle.x + 2, handle.y + 5)
  await page.mouse.down()
  await page.mouse.move(handle.x + 82, handle.y + 5, { steps: 4 })
  await page.mouse.up()
  await expect
    .poll(async () => (await th.locator('span.th-content').boundingBox())?.width ?? 0)
    .toBeGreaterThan(before + 60)
})
