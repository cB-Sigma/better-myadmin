import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * BetterMyAdmin's command palette (parity exception X61; phpMyAdmin has none): Ctrl+Shift+P or the
 * top bar's button, fuzzy filtering of the server's tables / databases and the current level's tabs,
 * keyboard navigation, Esc and focus return. Objects prefixed x61e_ (per e2e port).
 */
const RUN = process.env.BMA_E2E_PORT ?? '8099'
const DB = `x61e_palette${RUN}`

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.x61e_customer (id INT PRIMARY KEY);
    CREATE TABLE ${DB}.x61e_customer_list (id INT PRIMARY KEY);
    CREATE TABLE ${DB}.x61e_rental (id INT PRIMARY KEY);
    CREATE VIEW ${DB}.x61e_rental_view AS SELECT id FROM ${DB}.x61e_rental;`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection(MYSQL)
  await c.query(`DROP DATABASE IF EXISTS ${DB}`)
  await c.end()
})

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
const input = (page: Page) => palette(page).getByRole('combobox')
const selected = (page: Page) => palette(page).locator('[role="option"][aria-selected="true"]')

test.describe('command palette (X61)', () => {
  test('Ctrl+Shift+P opens it with the focus in the search box; Esc closes it', async ({ page }) => {
    await login(page)
    await page.locator('#page_content').click({ position: { x: 2, y: 2 } })
    await page.keyboard.press('Control+Shift+P')
    await expect(palette(page)).toBeVisible()
    await expect(input(page)).toBeFocused()
    // combobox / listbox wiring
    await expect(input(page)).toHaveAttribute('aria-expanded', 'true')
    const list = await input(page).getAttribute('aria-controls')
    expect(list).toBeTruthy()
    await expect(page.locator(`[id="${list}"]`)).toHaveAttribute('role', 'listbox')
    await expect(selected(page)).toHaveCount(1)
    const first = await selected(page).getAttribute('id')
    await expect(input(page)).toHaveAttribute('aria-activedescendant', first ?? 'missing')
    // the current level's tabs (the tab bar's labels) and the actions are listed
    await expect(palette(page).getByRole('option', { name: 'Databases' })).toBeVisible()
    await expect(palette(page).getByRole('option', { name: /^Log out/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette(page)).toHaveCount(0)
    // the shortcut toggles it closed as well
    await page.keyboard.press('Control+Shift+P')
    await expect(palette(page)).toBeVisible()
    await page.keyboard.press('Control+Shift+P')
    await expect(palette(page)).toHaveCount(0)
  })

  test('the top bar button opens it and gets the focus back on Esc', async ({ page }) => {
    await login(page)
    const button = page.getByRole('button', { name: 'Command palette' })
    await expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+P Meta+Shift+P')
    // next to #page_nav_icons, not inside it (phpMyAdmin's icons stay as they are)
    await expect(page.locator('#page_nav_icons #bma_command_palette')).toHaveCount(0)
    await button.click()
    await expect(palette(page)).toBeVisible()
    await expect(input(page)).toBeFocused()
    // Tab stays inside the dialog (focus trap)
    await page.keyboard.press('Tab')
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null))
      .toBe(true)
    await page.keyboard.press('Escape')
    await expect(palette(page)).toHaveCount(0)
    await expect(button).toBeFocused()
  })

  test('typing filters the tables of the server; Enter opens the table Browse page', async ({ page }) => {
    await login(page)
    await page.keyboard.press('Control+Shift+P')
    await input(page).fill('x61ecustlist')
    const option = palette(page).getByRole('option', { name: /x61e_customer_list/ })
    await expect(option).toBeVisible()
    await expect(option).toContainText(DB)
    await expect(selected(page)).toContainText('x61e_customer_list')
    // the matched letters are highlighted
    await expect(option.locator('mark').first()).toHaveText('x61e')
    // a table that does not match is gone
    await expect(palette(page).getByRole('option', { name: /x61e_rental/ })).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(palette(page)).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/s/1/db/${DB}/t/x61e_customer_list/browse`))
    await expect(page.locator('#page_content')).toContainText('x61e_customer_list')
  })

  test('arrow keys move through the matches (looping), Enter opens the highlighted one', async ({ page }) => {
    await login(page)
    await page.keyboard.press('Control+Shift+P')
    await input(page).fill(`${DB}.x61erental`)
    const rows = palette(page).getByRole('option', { name: /x61e_rental/ })
    await expect(rows).toHaveCount(2)
    await expect(selected(page)).toContainText('x61e_rental')
    await expect(selected(page)).not.toContainText('x61e_rental_view')
    await page.keyboard.press('ArrowDown')
    await expect(selected(page)).toContainText('x61e_rental_view')
    // the active option is announced through aria-activedescendant
    const active = await input(page).getAttribute('aria-activedescendant')
    await expect(page.locator(`[id="${active}"]`)).toContainText('x61e_rental_view')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    await expect(selected(page)).toContainText('x61e_rental_view')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/s/1/db/${DB}/t/x61e_rental_view/browse`))
  })

  test('a database opens on its Structure page; its tabs are listed inside it', async ({ page }) => {
    await login(page)
    await page.keyboard.press('Control+Shift+P')
    await input(page).fill(DB)
    await expect(palette(page).getByRole('group', { name: 'Databases' })).toContainText(DB)
    await palette(page).getByRole('option', { name: DB, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/s/1/db/${DB}/structure`))
    // database level: the database tabs, e.g. Operations
    await page.keyboard.press('Control+Shift+P')
    await input(page).fill('operat')
    await expect(selected(page)).toHaveText(/Operations/)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/s/1/db/${DB}/operations`))
  })

  test('an empty query starts with the recent tables; no match says so', async ({ page }) => {
    await login(page)
    await page.goto(`/s/1/db/${DB}/t/x61e_rental/browse`)
    await expect(page.locator('#page_content')).toContainText('x61e_rental')
    await page.locator('#page_content').click({ position: { x: 2, y: 2 } })
    await page.keyboard.press('Control+Shift+P')
    const recent = palette(page).getByRole('group', { name: 'Recently visited tables' })
    await expect(recent.getByRole('option').first()).toContainText('x61e_rental')
    await expect(palette(page).locator('[cmdk-group-heading]').first()).toHaveText('Recently visited tables')
    await input(page).fill('qqqqzzzzxxxx')
    await expect(palette(page).getByText('No matches')).toBeVisible()
  })

  test('the console toggle runs from the palette and Ctrl+K still toggles the console', async ({ page }) => {
    await login(page)
    await page.goto('/s/1/sql')
    await expect(page.locator('.console_switch')).toBeVisible()
    await expect(page.getByTestId('console-messages')).toHaveCount(0)
    await page.keyboard.press('Control+Shift+P')
    await input(page).fill('toggle cons')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('console-messages')).toBeVisible()
    // phpMyAdmin's Ctrl+K is untouched (inside the console input: a single toggle)
    await expect(page.locator('.console_query_input .cm-content')).toBeFocused()
    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('console-messages')).toHaveCount(0)
  })
})
