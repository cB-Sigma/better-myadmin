import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from '../fixtures.ts'

/**
 * Shell behaviours of phpMyAdmin's common scripts (docs/features/01-shell-navigation-auth.md):
 * error_report.ts, ajax.ts (lock-page and the leave confirmation), functions.ts (shift-click
 * ranges, the index dialog helpers, sort link icons, adjustTotals), navigation (New view), the 404
 * page, the HTTPS mismatch notice and the browser storage warning.
 */
const DB = 'm1shell_beh'
const ROOT = { ...MYSQL, multipleStatements: true }

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    ${[1, 2, 3, 4, 5].map((i) => `CREATE TABLE ${DB}.a${i} (id INT PRIMARY KEY, b VARCHAR(20));`).join('\n')}
    INSERT INTO ${DB}.a1 VALUES (1, 'x'), (2, 'y');
    CREATE VIEW ${DB}.v0 AS SELECT id FROM ${DB}.a1;`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}`)
  await c.end()
})

test('error report: the notice, "Show report details", Cancel, Send and Ignore', async ({ page }) => {
  const posts: Array<Record<string, unknown>> = []
  await page.route('**/api/telemetry/error', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    posts.push(body)
    if (body.get_settings === true) return route.fulfill({ json: { report_setting: 'ask' } })
    if (body.send_error_report === true)
      return route.fulfill({
        json: { message: { type: 'notice', text: 'Thank you for submitting this report.' } },
      })
    return route.fulfill({ json: { report: { exception_type: 'js', exception: body.exception } } })
  })
  await login(page)
  const boom = (msg: string) =>
    page.evaluate((m) => {
      setTimeout(() => {
        throw new Error(m)
      })
    }, msg)
  await boom('bma e2e error one')
  const notice = page.locator('[id^=error_notification_]')
  await expect(notice).toContainText(
    'A fatal JavaScript error has occurred. Would you like to send an error report?',
  )
  await notice.locator('[id^=show_error_report_]').click()
  const modal = page.locator('#errorReportModal')
  await expect(modal).toBeVisible()
  await expect(modal).toContainText('bma e2e error one')
  await modal.getByRole('button', { name: 'Cancel' }).last().click()
  await expect(modal).toBeHidden()
  expect(posts.some((p) => p.send_error_report === true)).toBe(false)

  await boom('bma e2e error two')
  await notice.locator('[id^=show_error_report_]').click()
  await modal.locator('#errorReportDescription').fill('steps')
  await modal.locator('#errorReportModalConfirm').click()
  await expect(page.locator('.ajax_notification')).toContainText('Thank you for submitting this report.')
  const sent = posts.find((p) => p.send_error_report === true)
  expect(sent).toMatchObject({ description: 'steps', always_send: false })

  await boom('bma e2e error three')
  await expect(notice.getByRole('link', { name: 'Change report settings' })).toHaveAttribute(
    'href',
    '/s/1/preferences/features',
  )
  await notice.locator('[id^=ignore_error_]').click()
  await expect(notice).toHaveCount(0)
})

test('lock-page: a changed field or query shows the lock and leaving asks first', async ({ page }) => {
  const dialogs: string[] = []
  let accept = false
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void (accept ? d.accept() : d.dismiss())
  })
  await login(page)
  // a field of a lock-page form, committed (change)
  await page.goto(`/s/1/db/${DB}/search`)
  const words = page.locator('#db_search_form').getByRole('textbox').first()
  await words.fill('needle')
  await words.press('Tab')
  const lock = page.locator('#lock_page_icon svg')
  await expect(lock).toBeVisible()
  await page.locator('#topmenu [data-tab="structure"]').click()
  await expect
    .poll(() => dialogs.at(-1))
    .toBe('You have unsaved changes; are you sure you want to leave this page?')
  await expect(page).toHaveURL(/\/search$/)
  // the original value again: no lock
  await words.fill('')
  await words.press('Tab')
  await expect(lock).toHaveCount(0)

  // the query editor (CodeMirror lock)
  await page.goto(`/s/1/db/${DB}/sql`)
  await page.locator('#sqlquery .cm-content').click()
  await page.keyboard.type('SELECT 1')
  await expect(lock).toBeVisible()
  accept = true
  await page.locator('#topmenu [data-tab="structure"]').click()
  await expect(page).toHaveURL(new RegExp(`/db/${DB}/structure$`))
  expect(dialogs).toHaveLength(2)
})

test('shift-click checks a range of rows; Drop recounts the summary ("%d table(s)")', async ({ page }) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/structure`)
  const box = (n: string) => page.getByRole('checkbox', { name: n, exact: true })
  await box('a1').click()
  await box('a4').click({ modifiers: ['Shift'] })
  for (const n of ['a1', 'a2', 'a3', 'a4']) await expect(box(n)).toHaveAttribute('aria-checked', 'true')
  await expect(box('a5')).toHaveAttribute('aria-checked', 'false')
  // a second shift-click replaces the range
  await box('a2').click({ modifiers: ['Shift'] })
  for (const n of ['a1', 'a2']) await expect(box(n)).toHaveAttribute('aria-checked', 'true')
  for (const n of ['a3', 'a4']) await expect(box(n)).toHaveAttribute('aria-checked', 'false')

  const summary = page.locator('#tbl_summary_row .tbl_num')
  await expect(summary).toHaveText('6 tables')
  await page.getByTestId('db-structure-row-a5').locator('.drop_table_anchor').click()
  await page.locator('#functionConfirmOkButton').click()
  await expect(page.getByTestId('db-structure-row-a5')).toHaveCount(0)
  await expect(summary).toHaveText('5 table(s)')
})

test('index dialog: the column count check, the focused name and Size inputs', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.accept()
  })
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/a1/structure`)
  const count = page.locator('#index_div input[name=added_fields]')
  const go = page.locator('#index_div').getByRole('button', { name: 'Go' })
  await count.fill('')
  await go.click()
  await expect.poll(() => dialogs.at(-1)).toBe('Please enter a valid number!')
  await count.fill('-1')
  await go.click()
  await expect.poll(() => dialogs.at(-1)).toBe('Column count has to be larger than zero.')
  await count.fill('2')
  await go.click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.locator('#input_index_name')).toBeFocused()
  await dlg.getByTestId('index-column-0').getByLabel('Column').selectOption('b')
  await expect(dlg.getByTestId('index-column-0').getByLabel('Size')).toBeFocused()
})

test('sort links show the other direction while hovered', async ({ page }) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/sql`)
  await page.locator('#sqlquery .cm-content').click()
  await page.keyboard.type('SELECT * FROM a1 ORDER BY id ASC')
  await page.locator('#sqlqueryform').getByRole('button', { name: 'Go' }).first().click()
  const link = page.locator('.sortlink').filter({ hasText: 'id' }).first()
  await expect(link.locator('.soimg').first()).toBeVisible()
  await expect(link.locator('.ic_s_asc')).toBeVisible()
  await expect(link.locator('.ic_s_desc')).toBeHidden()
  await link.hover()
  await expect(link.locator('.ic_s_desc')).toBeVisible()
  await expect(link.locator('.ic_s_asc')).toBeHidden()
})

test('navigation: "New" under Views opens the create view dialog', async ({ page }) => {
  await login(page)
  // the panel follows the main panel (synced): the database opens in the tree
  await page.goto(`/s/1/db/${DB}/structure`)
  const nav = page.locator('#pma_navigation')
  await expect(nav.locator(`[role=treeitem][data-name=${DB}]`)).toHaveAttribute('aria-expanded', 'true')
  const views = nav.locator('[role=treeitem][data-kind=container][data-name=views]')
  await views.getByRole('button', { name: 'Expand/Collapse' }).click()
  const url = page.url()
  await nav.locator('[role=treeitem].new_view').getByRole('link', { name: 'New' }).last().click()
  const dlg = page.locator('#createViewModal')
  await expect(dlg).toBeVisible()
  expect(page.url()).toBe(url)
  await dlg.getByRole('button', { name: 'Close' }).last().click()
  await expect(dlg).toBeHidden()
})

test('an unknown page says "Error 404! The page … was not found."', async ({ page }) => {
  await login(page)
  await page.goto('/no-such-page')
  await expect(page.getByText('Error 404! The page /no-such-page was not found.')).toBeVisible()
})

test('login form: the HTTPS mismatch notice', async ({ page }) => {
  await page.route('**/api/auth/state', async (route) => {
    const r = await route.fetch()
    await route.fulfill({ response: r, json: { ...(await r.json()), isHttps: true } })
  })
  await page.goto('/')
  await expect(page.locator('#js-https-mismatch')).toContainText(
    'There is a mismatch between HTTPS indicated on the server and client.',
  )
})

test('Manage your settings warns when the browser storage cannot be used', async ({ page }) => {
  await login(page)
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError')
    }
  })
  await page.goto('/s/1/preferences/manage')
  await expect(page.locator('.ajax_notification')).toContainText(
    'There was a problem accessing your browser storage, some features may not work properly for you.',
  )
})

test('table options: changing every column collation asks with both paragraphs', async ({ page }) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/a1/operations`)
  await page.locator('#collationSelect').selectOption('utf8mb4_bin')
  await page.locator('#checkbox_change_all_collations').check()
  await page.locator('#tableOptionsForm').getByRole('button', { name: 'Go' }).click()
  const q = page.locator('#functionConfirmModal')
  await expect(q).toContainText(
    'Through this operation, MySQL attempts to map the data values between collations.',
  )
  await expect(q.locator('strong').first()).toHaveText('NOT')
  await expect(q).toContainText(
    'Are you sure you wish to change all the column collations and convert the data?',
  )
  await q.getByRole('button', { name: 'Close' }).click()
  await expect(q).toBeHidden()
})
