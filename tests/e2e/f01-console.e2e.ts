import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * Feature 01 checklist: the console (docs/features/01-shell-navigation-auth.md#console). The
 * console options are user preferences: every test starts from the defaults. Objects prefixed f01c_.
 */
const DB = 'f01c_db'

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, name VARCHAR(20)); INSERT INTO ${DB}.t VALUES (1, 'a'), (2, 'b');`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection(MYSQL)
  await c.query(`DROP DATABASE IF EXISTS ${DB}`)
  await c.end()
})

test.beforeEach(async ({ page }) => {
  await login(page)
  await page.evaluate(async () => {
    const token = document.cookie
      .split('; ')
      .find((c) => c.startsWith('bma_token='))
      ?.slice('bma_token='.length)
    await fetch('/api/servers/1/prefs/reset', {
      method: 'POST',
      headers: { 'X-BMA-Token': decodeURIComponent(token ?? '') },
    })
  })
})

const messages = (page: Page) => page.getByTestId('console-messages')
const input = (page: Page) => page.locator('.console_query_input .cm-content')
async function openConsole(page: Page) {
  await expect(page.locator('.console_switch')).toBeVisible()
  // the console may come back open (Console/Mode)
  await page.waitForTimeout(300)
  if ((await messages(page).count()) === 0) await page.locator('.console_switch').click()
  await expect(messages(page)).toBeVisible()
}
/** the entry's actions show on hover above it: click them directly */
const act = (entry: ReturnType<Page['locator']>, name: string) =>
  entry.getByRole('button', { name, exact: true }).dispatchEvent('click')
async function run(page: Page, sql: string) {
  await input(page).click()
  await page.keyboard.insertText(sql)
  await page.keyboard.press('Control+Enter')
}

test('[p01-0acf73] an executed query is a pending entry, then successful or failed; browsing queries only with "Show current browsing query"', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/sql`)
  await openConsole(page)
  await run(page, 'SELECT id FROM t')
  await expect(messages(page).locator('.message[data-state="successed"]').last()).toContainText(
    'SELECT id FROM t',
  )
  await run(page, 'SELECT nope FROM t')
  await expect(messages(page).locator('.message[data-state="failed"]').last()).toContainText(
    'SELECT nope FROM t',
  )
  // a query of the page (the SQL tab's Go): shown with "Show current browsing query" (on by default)
  const sqlTab = async (sql: string) => {
    // the SQL tab of another scope, without reloading the app (the console keeps its messages)
    await page.locator('#topmenu [data-tab="structure"]').click()
    await page.locator('#topmenu [data-tab="sql"]').click()
    await page.locator('#sqlquery .cm-content').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.insertText(sql)
    await page.locator('#button_submit_query').click()
    await expect(page.getByText(/Showing rows|returned an empty result/).first()).toBeVisible()
  }
  await sqlTab('SELECT name AS f01c_page FROM t')
  await expect(messages(page).locator('.message', { hasText: 'f01c_page' }).first()).toBeVisible()
  await page.locator('#pma_console .toolbar .options').click()
  await page.locator('#consoleOptionsCurrentQueryCheckbox').uncheck()
  await page.locator('#pma_console_options .switch_button').click()
  await sqlTab('SELECT id AS f01c_hidden FROM t')
  await expect(messages(page).locator('.message:visible', { hasText: 'f01c_hidden' })).toHaveCount(0)
})

test('[p01-52d377] entry actions: Collapse, Expand, Requery, Edit, Explain, Profiling, Bookmark; Clear removes failed entries', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/sql`)
  await openConsole(page)
  await run(page, 'SELECT name FROM t WHERE id = 1')
  const entry = messages(page).locator('.message[data-state="successed"]').first()
  await expect(entry).toBeVisible()
  await entry.hover()
  for (const label of ['Expand', 'Requery', 'Edit', 'Explain', 'Profiling', 'Bookmark']) {
    await expect(entry.getByRole('button', { name: label, exact: true })).toBeAttached()
  }
  await act(entry, 'Expand')
  await expect(entry.getByRole('button', { name: 'Collapse', exact: true })).toBeVisible()
  // Requery asks first
  page.once('dialog', (d) => void d.accept())
  await act(entry, 'Requery')
  await expect(messages(page).locator('.message[data-state="successed"]')).toHaveCount(2)
  // Edit puts the query back into the input
  await act(entry, 'Edit')
  await expect(input(page)).toContainText('SELECT name FROM t WHERE id = 1')
  await page.keyboard.press('Control+l')
  await run(page, 'SELECT broken FROM t')
  await expect(messages(page).locator('.message[data-state="failed"]')).toContainText('Query failed')
  await page.locator('#pma_console .toolbar .clear').click()
  await expect(messages(page).locator('.message[data-state="failed"]')).toHaveCount(0)
})

test('[p01-665316] Ctrl+Enter executes, Shift+Enter is a new line, Enter with the option; Ctrl+L, Ctrl+U, history with the arrows', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/sql`)
  await openConsole(page)
  await input(page).click()
  await page.keyboard.insertText('SELECT 1')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.insertText('+ 1')
  await expect(input(page).locator('.cm-line')).toHaveCount(2)
  await page.keyboard.press('Control+Enter')
  await expect(messages(page).locator('.message[data-state="successed"]').last()).toContainText('+ 1')
  await input(page).click()
  await page.keyboard.press('ArrowUp')
  await expect(input(page)).toContainText('SELECT 1')
  await page.keyboard.press('Control+l')
  await expect(input(page)).toHaveText('')
  await page.keyboard.press('Control+u')
  await expect(messages(page).locator('.message:not(.welcome)')).toHaveCount(0)
})

test('[p01-b992bd] the options persist through /console/update-config; "Restore default values"', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/sql`)
  await openConsole(page)
  await page.locator('#pma_console .toolbar .options').click()
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/console/config') && r.request().method() === 'POST',
  )
  await page.locator('#consoleOptionsAlwaysExpandCheckbox').check()
  await saved
  await page.reload()
  await openConsole(page)
  await page.locator('#pma_console .toolbar .options').click()
  await expect(page.locator('#consoleOptionsAlwaysExpandCheckbox')).toBeChecked()
  await page.getByRole('button', { name: 'Restore default values' }).click()
  await expect(page.locator('#consoleOptionsAlwaysExpandCheckbox')).not.toBeChecked()
})

test('[p01-24e482] the session history is shown at start with "Show query history at start"', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/sql`)
  await openConsole(page)
  await run(page, 'SELECT 7 AS f01c_hist')
  await expect(messages(page).locator('.message[data-state="successed"]').last()).toContainText('f01c_hist')
  await page.locator('#pma_console .toolbar .options').click()
  await page.locator('#consoleOptionsStartHistoryCheckbox').check()
  await page.reload()
  await openConsole(page)
  await expect(messages(page).locator('.message.history', { hasText: 'f01c_hist' }).first()).toBeVisible()
})

test('[p01-e58832] collapsed, the toolbar shows only "Console"; dragging the bar resizes; the mode and height persist', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/sql`)
  const bar = page.locator('#pma_console .toolbar').first()
  await expect(bar.locator('.console_switch')).toBeVisible()
  await expect(bar.locator('.clear')).toBeHidden()
  await bar.hover()
  await expect(bar.locator('.clear')).toBeVisible()
  await openConsole(page)
  const consoleEl = page.locator('#pma_console')
  const before = (await consoleEl.boundingBox())!.height
  const box = (await bar.boundingBox())!
  const heightSaved = page.waitForResponse(
    (r) => r.url().endsWith('/console/config') && r.request().method() === 'POST',
  )
  await page.mouse.move(box.x + box.width / 2, box.y + 5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 6 })
  await page.mouse.up()
  await heightSaved
  const after = (await consoleEl.boundingBox())!.height
  expect(after).toBeGreaterThan(before + 60)
  await page.reload()
  // the open mode and the height come back
  await expect(messages(page)).toBeVisible()
  expect(Math.abs((await consoleEl.boundingBox())!.height - after)).toBeLessThan(10)
})

test('[p01-63933b] the bookmarks card: add (label, target database, shared), list, refresh, delete after a confirmation', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/sql`)
  await openConsole(page)
  await page.locator('#pma_console .toolbar .bookmarks').click()
  const card = page.locator('#pma_bookmarks')
  await card.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator('.add_bookmark input[name="label"]').fill('f01c bookmark')
  await page.locator('.add_bookmark input[name="targetdb"]').fill(DB)
  await page.locator('.add_bookmark input[name="shared"]').check()
  await page.locator('.bookmark_add_input .cm-content').click()
  await page.keyboard.insertText('SELECT 3')
  await page.locator('.add_bookmark [name="submit"]').click()
  await card.getByRole('button', { name: 'Refresh' }).click()
  const entry = card.locator('.message.bookmark', { hasText: 'f01c bookmark' })
  await expect(entry).toBeVisible()
  page.once('dialog', (d) => {
    expect(d.message()).toContain('f01c bookmark')
    void d.accept()
  })
  await entry.getByRole('button', { name: 'Delete' }).dispatchEvent('click')
  await expect(card.locator('.message.bookmark', { hasText: 'f01c bookmark' })).toHaveCount(0)
})
