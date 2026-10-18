import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * phpMyAdmin script behaviours of the database and export pages (tools/parity/inventory/js.json):
 * the multi-table query's inert results, Enter in the routine execute dialog, the real row count
 * throbber, the export output page (F5, Refresh, Copy), the export time-out check and the alias
 * dialog's table and column lists. Objects prefixed f06js_, per e2e server port.
 */
const RUN = process.env.BMA_E2E_PORT ?? '8099'
const DB = `f06js_e2e_${RUN}`
const base = `/s/1/db/${DB}`

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE a (id INT PRIMARY KEY, v VARCHAR(10)); INSERT INTO a VALUES (1, 'x'), (2, 'y');
    CREATE TABLE b (id INT PRIMARY KEY, w INT); INSERT INTO b VALUES (1, 10);
    CREATE TABLE g (id INT PRIMARY KEY, p POINT);
    INSERT INTO g VALUES (1, ST_GeomFromText('POINT(1 2)', 4326)), (2, ST_GeomFromText('POINT(3 4)'));
    CREATE PROCEDURE twice(IN n INT) SELECT n * 2 AS doubled;`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection(MYSQL)
  await c.query(`DROP DATABASE IF EXISTS ${DB}`)
  await c.end()
})

const posts = (page: Page, re: RegExp) => {
  const seen: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && re.test(r.url())) seen.push(r.url())
  })
  return seen
}

test('multi-table query: the results card links do nothing (multi_table_query.ts preventDefault)', async ({
  page,
}) => {
  await login(page)
  await page.goto(`${base}/multi-table-query`)
  await page.locator('select.tableNameSelect').first().selectOption('a')
  await page.locator('select.columnNameSelect').first().selectOption('*')
  await page.locator('#update_query_button').click()
  await expect(page.locator('#copy_query')).toBeEnabled()
  const ran = page.waitForResponse((r) => r.request().method() === 'POST' && /\/query$/.test(r.url()))
  await page.locator('#submit_query').click()
  await ran
  const card = page.locator('#sql_results .result_query').first()
  await expect(card).toBeVisible()
  const queries = posts(page, /\/query$/)
  const url = page.url()
  const links = card.locator('.tools button, .tools a')
  expect(await links.count()).toBeGreaterThan(0)
  for (const l of await links.all()) await l.click()
  await page.waitForTimeout(300)
  expect(queries).toEqual([])
  expect(page.url()).toBe(url)
})

test('routine execute dialog: Enter in a parameter executes (routines.ts keyup form.rte_form)', async ({
  page,
}) => {
  await login(page)
  await page.goto(`${base}/routines`)
  await page.locator('tr', { hasText: 'twice' }).getByRole('button', { name: 'Execute' }).first().click()
  const dialog = page.locator('#routinesExecuteModal')
  await expect(dialog).toBeVisible()
  const value = dialog.locator('form.rte_form input').first()
  await value.fill('21')
  await value.press('Enter')
  await expect(dialog).toContainText('42')
})

test('real row count: the throbber replaces the count while it loads and takes no clicks (structure.ts)', async ({
  page,
}) => {
  await login(page)
  // an approximate count (InnoDB above MaxExactCount) for table a
  await page.route(/\/databases\/[^/]+\/structure(\?.*)?$/, async (route) => {
    const r = await route.fetch()
    const json = await r.json()
    json.tables = json.tables.map((t: { name: string }) => (t.name === 'a' ? { ...t, approx: true } : t))
    await route.fulfill({ response: r, json })
  })
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let counts = 0
  await page.route(/\/structure\/real-row-count/, async (route) => {
    counts++
    await held
    await route.continue()
  })
  await page.goto(`${base}/structure`)
  const cell = page.locator('td.tbl_rows[data-table="a"]')
  await cell.locator('.real_row_count').click()
  const throbber = cell.locator('.throbber')
  await expect(throbber).toBeVisible()
  await throbber.click()
  await page.waitForTimeout(200)
  expect(counts).toBe(1)
  release()
  await expect(cell).toHaveText('2')
  expect(counts).toBe(1)
})

test('GIS editor: OpenStreetMaps base layer on for a value with an SRID, the SVG preview without (gis_data_editor.ts)', async ({
  page,
}) => {
  await login(page)
  // OpenStreetMap tiles are not fetched in the test
  await page.route(/tile\.openstreetmap\.org/, (r) => r.abort())
  const open = async (id: number) => {
    await page.goto(`${base}/t/g/browse`)
    // rows in primary key order: row `id` is the id-th edit link
    await page
      .locator('td.edit_row_anchor a')
      .nth(id - 1)
      .click()
    await page.getByRole('button', { name: 'Edit/Insert' }).first().click()
    const gis = page.locator('#gisEditorModal')
    await expect(gis).toBeVisible()
    return gis
  }
  let gis = await open(1)
  const osm = gis.locator('#useOsmAsBaseLayerSwitch')
  await expect(osm).toBeChecked()
  await expect(gis.locator('.visualization-target-ol .ol-viewport')).toBeVisible()
  await osm.uncheck()
  // like gis_data_editor_form.twig: the SVG preview inside #visualization-placeholder, the map target kept but hidden
  await expect(gis.locator('#visualization-placeholder svg').first()).toBeVisible()
  await expect(gis.locator('.visualization-target-ol')).toBeHidden()

  gis = await open(2)
  await expect(gis.locator('#useOsmAsBaseLayerSwitch')).not.toBeChecked()
  await expect(gis.locator('#visualization-placeholder svg').first()).toBeVisible()
})

test.describe('export', () => {
  test('output as text: F5 and Refresh export again, Copy to clipboard copies the dump (export_output.ts)', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await login(page)
    await page.goto(`${base}/export`)
    await page.getByLabel('Custom - display all possible options').check()
    await page.getByLabel('View output as text').check()
    await page.locator('#buttonGo').click()
    const dump = page.locator('#textSQLDUMP')
    await expect(dump).toHaveValue(/CREATE TABLE `a`/)
    const exports = posts(page, /\/export$/)
    await page.locator('.export_refresh_btn').first().click()
    await expect.poll(() => exports.length).toBe(1)
    await expect(dump).toHaveValue(/CREATE TABLE `a`/)
    await page.keyboard.press('F5')
    await expect.poll(() => exports.length).toBe(2)
    await expect(page).toHaveURL(new RegExp(`${base}/export`))
    await page.locator('.export_copy_to_clipboard_btn').first().click()
    await expect(page.getByText('Successfully copied!')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await dump.inputValue())
  })

  test('a run past ExecTimeLimit asks /export/check-time-out and reports the time-out (export.ts checkTimeOut)', async ({
    page,
  }) => {
    await page.clock.install()
    await login(page)
    await page.goto(`${base}/export`)
    let asked = 0
    await page.route(/\/export\/check-time-out/, async (route) => {
      asked++
      await route.fulfill({ json: { message: 'timeout' } })
    })
    // the export itself: a download that never ends in this test
    await page.route(/\/export$/, () => {})
    await page.locator('#buttonGo').click()
    await page.clock.runFor(5000)
    expect(asked).toBe(0)
    // ExecTimeLimit (300 s) plus the one-second margin
    await page.clock.runFor(300_000)
    await expect.poll(() => asked).toBe(1)
    await expect(
      page.getByText('Your export is incomplete, due to a low execution time limit at the PHP level!'),
    ).toBeVisible()
  })

  test('aliases: the database select lists its tables (POST /tables), the table select its columns (POST /columns)', async ({
    page,
  }) => {
    await login(page)
    await page.goto(`${base}/export`)
    await page.getByLabel('Custom - display all possible options').check()
    await page.locator('#btn_alias_config').click()
    const modal = page.getByRole('dialog')
    const tables = page.waitForResponse((r) => r.request().method() === 'POST' && /\/tables$/.test(r.url()))
    await modal.locator('#db_alias_select').selectOption(DB)
    await tables
    await expect(modal.locator('#table_alias_select option')).toContainText(['a', 'b'])
    const columns = page.waitForResponse((r) => r.request().method() === 'POST' && /\/columns$/.test(r.url()))
    await modal.locator('#table_alias_select').selectOption('a')
    await columns
    await expect(modal.locator('#column_alias_select option')).toContainText(['id', 'v'])
  })
})
