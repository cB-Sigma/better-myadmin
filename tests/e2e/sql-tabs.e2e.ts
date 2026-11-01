import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures'

/**
 * Query tabs of the SQL page (BetterMyAdmin only, parity exception X62; docs/features/09
 * "Query tabs"): one tab is phpMyAdmin's page, more tabs each keep their query, results and scroll.
 */
const DB = `sqltabs_e2e${process.env.BMA_E2E_PORT ?? '8099'}`
const PAGE = `/s/1/db/${DB}/sql`

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY, name VARCHAR(20)); INSERT INTO t VALUES (1, 'a'), (2, 'b');`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(MYSQL)
  await c.query(`DROP DATABASE IF EXISTS ${DB}`)
  await c.end()
})

/** The shown tab's page (the inactive ones stay mounted, hidden). */
const panel = (page: Page) => page.locator('[id^="sqltabpanel-"]:not([hidden])')
const editor = (page: Page) => panel(page).locator('#sqlquery .cm-content')
const results = (page: Page) => panel(page).locator('#sqlqueryresultsouter')
const tabs = (page: Page) => page.getByRole('tab')

async function setQuery(page: Page, sql: string) {
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(sql)
}

async function run(page: Page, sql: string) {
  await setQuery(page, sql)
  await page.keyboard.press('Control+Enter')
}

const stored = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('bmaSqlTabs:')))

test.describe('SQL query tabs [X62]', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('one tab is the page as phpMyAdmin has it, plus a discreet New tab button', async ({ page }) => {
    await page.goto(PAGE)
    await expect(editor(page)).toBeVisible()
    await expect(page.getByRole('tablist')).toHaveCount(0)
    await expect(page.locator('#sqlqueryform')).toHaveCount(1)
    await expect(page.locator('#sql_new_tab')).toHaveText(/New tab/)
    await expect(page.getByRole('button', { name: 'New query tab' })).toBeVisible()
    await run(page, 'SELECT name AS single_tab FROM t')
    await expect(results(page)).toContainText('single_tab')
    // nothing stored for a single tab
    expect(await stored(page)).toEqual([])
  })

  test('each tab has its own query and results; rename, reload, close with confirmation', async ({
    page,
  }) => {
    await page.goto(PAGE)
    await run(page, 'SELECT 1 AS one_col')
    await expect(results(page)).toContainText('one_col')

    // "+": a second, empty tab with the focus in its editor
    await page.locator('#sql_new_tab').click()
    await expect(tabs(page)).toHaveText(['Query 1', 'Query 2'])
    await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(editor(page)).toHaveText('')
    await expect(editor(page)).toBeFocused()
    await run(page, 'SELECT 2 AS two_col')
    await expect(results(page)).toContainText('two_col')
    await expect(results(page)).not.toContainText('one_col')

    // Ctrl+Alt+T: a third tab, its query not run
    await page.keyboard.press('Control+Alt+t')
    await expect(tabs(page)).toHaveCount(3)
    await expect(editor(page)).toBeFocused()
    await page.keyboard.insertText('SELECT 3 AS three_col')

    // back to the first tab: its results are still there
    await page.getByRole('tab', { name: 'Query 1' }).click()
    await expect(results(page)).toContainText('one_col')
    await expect(results(page)).not.toContainText('two_col')
    // arrow keys move between tabs (tablist pattern)
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Query 2' })).toBeFocused()
    await expect(results(page)).toContainText('two_col')

    // double-click renames
    await page.getByRole('tab', { name: 'Query 2' }).dblclick()
    const name = page.getByRole('textbox', { name: 'Rename' })
    await name.fill('Report')
    await name.press('Enter')
    await expect(tabs(page)).toHaveText(['Query 1', 'Report', 'Query 3'])

    // the tabs, their names and queries survive a reload (results do not)
    await page.reload()
    await expect(tabs(page)).toHaveText(['Query 1', 'Report', 'Query 3'])
    await expect(page.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true')
    await expect(editor(page)).toHaveText('SELECT 2 AS two_col')
    await page.getByRole('tab', { name: 'Query 3' }).click()
    await expect(editor(page)).toHaveText('SELECT 3 AS three_col')
    await page.getByRole('tab', { name: 'Query 1' }).click()
    await expect(editor(page)).toHaveText('SELECT 1 AS one_col')

    // a tab with a query that was not run asks before closing
    await page.getByRole('tab', { name: 'Query 3' }).click()
    await setQuery(page, 'SELECT 33')
    await page.getByRole('button', { name: 'Close Query 3' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('“Query 3” has changes that were not run')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(tabs(page)).toHaveCount(3)
    await page.getByRole('button', { name: 'Close Query 3' }).click()
    await page.locator('#functionConfirmOkButton').click()
    await expect(tabs(page)).toHaveText(['Query 1', 'Report'])
    // the tab to the left of a closed last tab is shown
    await expect(page.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true')

    // Ctrl+Alt+W closes the shown tab (unchanged since the reload: no question)
    await editor(page).click()
    await page.keyboard.press('Control+Alt+w')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    // one tab left: the strip is gone, the page is the single query box again, nothing stored
    await expect(page.getByRole('tablist')).toHaveCount(0)
    await expect(page.locator('#sql_new_tab')).toHaveText(/New tab/)
    await expect(editor(page)).toHaveText('SELECT 1 AS one_col')
    expect(await stored(page)).toEqual([])

    // middle click closes a tab
    await page.locator('#sql_new_tab').click()
    await expect(tabs(page)).toHaveCount(2)
    await page.getByRole('tab', { name: 'Query 4' }).click({ button: 'middle' })
    await expect(page.getByRole('tablist')).toHaveCount(0)
  })

  test('a running query keeps its tab; the auto-saved query follows the tab typed in', async ({ page }) => {
    await page.goto(PAGE)
    await run(page, 'SELECT SLEEP(1.5) AS slept')
    // switch away while it runs
    await page.locator('#sql_new_tab').click()
    await run(page, 'SELECT 22 AS second_tab')
    await expect(results(page)).toContainText('second_tab')
    await page.getByRole('tab', { name: 'Query 1' }).click()
    await expect(results(page)).toContainText('slept', { timeout: 10_000 })
    await expect(results(page)).not.toContainText('second_tab')

    // "Get auto-saved query" (phpMyAdmin's Sql.autoSave, one per scope) gives the last typed text
    await page.getByRole('tab', { name: 'Query 2' }).click()
    await panel(page).locator('#togglequerybox').click()
    await panel(page).locator('#clear').click()
    await expect(editor(page)).toHaveText('')
    await panel(page).locator('#saved').click()
    await expect(editor(page)).toHaveText('SELECT 22 AS second_tab')
  })

  test("a query card's Edit link fills the shown tab; the other tabs keep their results", async ({
    page,
  }) => {
    await page.goto(PAGE)
    await run(page, 'SELECT 1 AS kept_col')
    await expect(results(page)).toContainText('kept_col')
    await page.locator('#sql_new_tab').click()
    await run(page, 'SELECT 2 AS edited_col')
    await expect(results(page)).toContainText('edited_col')
    await panel(page).locator('.result_query .tools').first().getByText('Edit', { exact: true }).click()
    await expect(page).toHaveURL(/sql=/)
    await expect(page.getByRole('tab', { name: 'Query 2' })).toHaveAttribute('aria-selected', 'true')
    await expect(editor(page)).toHaveText(/SELECT 2 AS edited_col/)
    await expect(results(page)).not.toContainText('edited_col')
    await page.getByRole('tab', { name: 'Query 1' }).click()
    await expect(results(page)).toContainText('kept_col')
    // its query box is still collapsed after its run (Retain query box off)
    await expect(panel(page).locator('#togglequerybox')).toHaveText('Show query box')
  })

  test('tabs are per scope', async ({ page }) => {
    await page.goto(PAGE)
    await page.locator('#sql_new_tab').click()
    await expect(tabs(page)).toHaveCount(2)
    await page.goto(`/s/1/db/${DB}/t/t/sql`)
    await expect(editor(page)).toBeVisible()
    await expect(page.getByRole('tablist')).toHaveCount(0)
    await page.goto(PAGE)
    await expect(tabs(page)).toHaveCount(2)
  })
})
