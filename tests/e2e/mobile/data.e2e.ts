import { existsSync } from 'node:fs'
import { type Locator, type Page, devices, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from '../fixtures'

/**
 * The data pages on a phone (iPhone 13, 390×844, touch): wide tables scroll in their own box, the
 * results grid's row actions are one menu, grid cells edit by a double tap or a long press, and the
 * insert / search forms stack (label above a full-width, 16px field). Desktop is covered by the
 * other suites and tests/visual.
 */
const chromium =
  process.env.PW_CHROMIUM ?? process.env.BMA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
test.use({
  ...devices['iPhone 13'],
  defaultBrowserType: 'chromium',
  ...(existsSync(chromium) ? { launchOptions: { executablePath: chromium } } : {}),
})

const DB = `m_data_e2e${process.env.BMA_E2E_PORT ?? '8099'}`
const ROOT = { ...MYSQL, multipleStatements: true }

async function value(sql: string): Promise<unknown> {
  const c = await mysql.createConnection(ROOT)
  const [rows] = await c.query({ sql, rowsAsArray: true })
  await c.end()
  return (rows as unknown[][])[0]?.[0]
}

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(80), qty INT,
      description VARCHAR(200), category VARCHAR(40), created DATE, note TEXT) ENGINE=InnoDB;
    INSERT INTO t (name, qty, description, category, created, note) VALUES ${Array.from(
      { length: 30 },
      (_, i) =>
        `('item${i + 1}', ${i}, 'a fairly long description for row ${i + 1}', 'cat${i % 4}', '2026-01-0${(i % 9) + 1}', 'n${i}')`,
    ).join(',')};
    CREATE TABLE u (id INT PRIMARY KEY) ENGINE=InnoDB;`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}`)
  await c.end()
})

test.beforeEach(async ({ page }) => {
  await login(page)
})

/** the page itself never scrolls sideways: wide content scrolls in its own box */
async function noPageOverflow(page: Page) {
  const o = await page.locator('#page_scroll').evaluate((e) => e.scrollWidth - e.clientWidth)
  expect(o).toBeLessThanOrEqual(1)
  // nor does the document (a stray absolutely placed element would widen the layout viewport)
  const d = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(d).toBeLessThanOrEqual(0)
}

async function box(l: Locator) {
  const b = await l.boundingBox()
  expect(b).not.toBeNull()
  return b!
}

test('browse: the grid scrolls in its own box and each row has one actions menu', async ({ page }) => {
  await page.goto(`/s/1/db/${DB}/t/t/browse`)
  await expect(page.locator('table.table_results tbody tr')).toHaveCount(25)
  await noPageOverflow(page)
  const wrap = page.locator('.table-responsive-md')
  expect(await wrap.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true)
  expect(await wrap.evaluate((e) => getComputedStyle(e).overflowX)).toBe('auto')

  const row = page.locator('table.table_results tbody tr').first()
  // no Edit / Copy / Delete links in the row: a ⋮ button, touch sized
  await expect(row.locator('.edit_row_anchor')).toHaveCount(0)
  const menu = row.getByRole('button', { name: 'Actions' })
  const b = await box(menu)
  expect(b.width).toBeGreaterThanOrEqual(40)
  expect(b.height).toBeGreaterThanOrEqual(40)
  // the data starts within the first ~110px (checkbox + menu), not after ~200px of links
  const firstData = await box(row.locator('td[data-type]').first())
  expect(firstData.x).toBeLessThan(130)
  // header spans match the row cells: the first column heading sits over the first data cell
  const th = await box(page.locator('table.table_results thead th[data-column="id"]'))
  expect(Math.abs(th.x - firstData.x)).toBeLessThan(2)

  await menu.tap()
  const items = page.getByRole('menuitem')
  await expect(items).toHaveText(['Edit', 'Copy', 'Delete'])
  await items.filter({ hasText: 'Edit' }).tap()
  await expect(page).toHaveURL(/\/t\/t\/edit/)
  await expect(page.locator('#insertForm')).toBeVisible()
})

test('browse: Delete from the row menu asks and deletes', async ({ page }) => {
  await page.goto(`/s/1/db/${DB}/t/t/browse`)
  const rows = page.locator('table.table_results tbody tr')
  await expect(rows).toHaveCount(25)
  const before = Number(await value(`SELECT COUNT(*) FROM ${DB}.t`))
  await rows.first().getByRole('button', { name: 'Actions' }).tap()
  await page.getByRole('menuitem', { name: 'Delete' }).tap()
  await page.getByRole('alertdialog').getByRole('button', { name: 'OK' }).tap()
  await expect.poll(() => value(`SELECT COUNT(*) FROM ${DB}.t`)).toBe(before - 1)
})

test('browse: a tap opens the editor sheet; Save saves, Cancel leaves the value', async ({ page }) => {
  await page.goto(`/s/1/db/${DB}/t/t/browse`)
  const cell = page.locator('table.table_results tbody tr').nth(1).locator('td[data-type="string"]').first()
  const before = (await cell.innerText()).trim()
  // Cancel
  await cell.tap()
  const sheet = page.getByRole('dialog', { name: /Edit: name/ })
  await expect(sheet).toBeVisible()
  const vw = page.viewportSize()!.width
  const sb = await box(sheet)
  expect(sb.x).toBeLessThanOrEqual(0)
  expect(sb.width).toBeGreaterThanOrEqual(vw)
  const editor = sheet.locator('.edit_box')
  await expect(editor).toHaveValue(before)
  expect(await editor.evaluate((e) => e.tagName)).toBe('TEXTAREA')
  expect(
    await editor.evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize)),
  ).toBeGreaterThanOrEqual(16)
  expect((await box(editor)).height).toBeGreaterThanOrEqual(150)
  await editor.fill('not saved')
  await sheet.getByRole('button', { name: 'Cancel' }).tap()
  await expect(sheet).toBeHidden()
  await expect(cell).toHaveText(before)
  // Enter makes a new line in the text area; Save saves
  await cell.tap()
  await expect(sheet).toBeVisible()
  await editor.fill('tapped')
  await editor.press('Enter')
  await expect(sheet).toBeVisible()
  await editor.fill('tapped')
  const save = sheet.getByRole('button', { name: 'Save' })
  expect((await box(save)).height).toBeGreaterThanOrEqual(40)
  await save.tap()
  await expect(sheet).toBeHidden()
  await expect(page.getByText('1 row affected.')).toBeVisible()
  await expect.poll(() => value(`SELECT COUNT(*) FROM ${DB}.t WHERE name = 'tapped'`)).toBe(1)
})

test('browse: a long press edits a cell', async ({ page }) => {
  await page.goto(`/s/1/db/${DB}/t/t/browse`)
  const cell = page.locator('table.table_results tbody tr').nth(2).locator('td[data-type="string"]').first()
  await expect(cell).toBeVisible()
  // hold the finger on the cell (Playwright's touchscreen only taps)
  const touch = (type: 'touchstart' | 'touchend') =>
    cell.evaluate((el, type) => {
      const r = el.getBoundingClientRect()
      const t = new Touch({ identifier: 1, target: el, clientX: r.x + 5, clientY: r.y + 5 })
      const down = type === 'touchstart'
      el.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: down ? [t] : [],
          targetTouches: down ? [t] : [],
          changedTouches: [t],
        }),
      )
    }, type)
  await touch('touchstart')
  await page.waitForTimeout(700)
  await touch('touchend')
  await expect(page.locator('.cEdit .edit_box')).toBeVisible()
  await page.locator('.cEdit .edit_box').press('Escape')
  await expect(page.locator('.cEdit')).toHaveCount(0)
})

test('insert: stacked fields, full width, 16px, and a row is inserted', async ({ page }) => {
  await page.goto(`/s/1/db/${DB}/t/t/insert`)
  await expect(page.locator('#insertForm')).toBeVisible()
  await noPageOverflow(page)
  const vw = page.viewportSize()!.width
  const name = page
    .locator('.insertRowTable')
    .first()
    .locator('tbody tr')
    .filter({ has: page.locator('td.bma-mname', { hasText: /^name$/ }) })
  const input = name.locator('td[data-label="Value"] :is(input, textarea)').first()
  const ib = await box(input)
  expect(ib.width).toBeGreaterThan(vw * 0.7)
  expect(ib.x + ib.width).toBeLessThanOrEqual(vw)
  expect(await input.evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(
    16,
  )
  // the label (column name) is above the field
  const lb = await box(name.locator('td.bma-mname'))
  expect(lb.y + lb.height).toBeLessThanOrEqual(ib.y)
  // the second Go stays below the rows
  const gos = page.locator('.insertRowTable').first().getByRole('button', { name: 'Go' })
  expect((await box(gos.last())).y).toBeGreaterThan(ib.y)

  await input.fill('from-phone')
  await page.locator('#buttonYes').tap()
  await expect.poll(() => value(`SELECT COUNT(*) FROM ${DB}.t WHERE name = 'from-phone'`)).toBe(1)
})

test('table search: operator and value fields fit the screen', async ({ page }) => {
  await page.goto(`/s/1/db/${DB}/t/t/search`)
  const row = page.getByTestId('criteria-name')
  await expect(row).toBeVisible()
  await noPageOverflow(page)
  const vw = page.viewportSize()!.width
  const value = row.locator('td[data-label="Value"] input').first()
  const vb = await box(value)
  expect(vb.x + vb.width).toBeLessThanOrEqual(vw)
  expect(vb.width).toBeGreaterThan(vw * 0.6)
  await value.fill('item1%')
  await page.getByRole('button', { name: 'Go', exact: true }).last().tap()
  await expect(page.locator('table.table_results tbody tr').first()).toBeVisible()
})

test('db structure: the table list scrolls with the name column kept in view', async ({ page }) => {
  await page.goto(`/s/1/db/${DB}/structure`)
  const table = page.locator('#structureTable')
  await expect(table).toBeVisible()
  await noPageOverflow(page)
  const wrap = page.locator('div.overflow-x-auto:has(> #structureTable)')
  expect(await wrap.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true)
  const name = table.locator('tbody tr').first().locator('th')
  await wrap.evaluate((e) => {
    e.scrollLeft = 200
  })
  const wb = await box(wrap)
  const nb = await box(name)
  expect(Math.abs(nb.x - wb.x)).toBeLessThan(2)
  // action links are icons, touch sized
  const browse = table.locator('tbody tr').first().getByRole('link', { name: 'Browse' })
  const bb = await box(browse)
  expect(bb.width).toBeGreaterThanOrEqual(40)
  expect(bb.height).toBeGreaterThanOrEqual(40)
})

test('SQL page: the column list sits below the editor and a query runs', async ({ page }) => {
  await page.goto(`/s/1/db/${DB}/t/t/sql`)
  await expect(page.locator('#fieldsSelect')).toBeVisible()
  await noPageOverflow(page)
  const vw = page.viewportSize()!.width
  const editor = await box(page.locator('.bma-sql-editorrow > div').first())
  const fields = await box(page.locator('#fieldsSelect'))
  expect(fields.y).toBeGreaterThanOrEqual(editor.y + editor.height - 1)
  for (const id of ['#selectall', '#select', '#insert', '#update', '#delete', '#clear']) {
    const l = page.locator(id)
    if ((await l.count()) === 0) continue
    const b = await box(l)
    expect(b.x + b.width).toBeLessThanOrEqual(vw)
    expect(b.height).toBeGreaterThanOrEqual(40)
  }
  // Go is on screen without scrolling (the footer stays at the bottom, above the console strip); the
  // delimiter and checkboxes fold under Options
  const goBottom = async () => {
    const g = await box(page.locator('#button_submit_query'))
    return g.y + g.height
  }
  const strip = await box(page.locator('#pma_console'))
  // (the console reports its height once it has rendered)
  await expect.poll(goBottom).toBeLessThanOrEqual(strip.y)
  await expect(page.locator('#id_sql_delimiter')).toBeHidden()
  await page.getByRole('button', { name: 'Options' }).tap()
  await expect(page.locator('#id_sql_delimiter')).toBeVisible()
  await page.locator('#button_submit_query').tap()
  await expect(page.locator('table.table_results tbody tr').first()).toBeVisible()
})
