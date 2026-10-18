import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * Feature 01 checklist (docs/features/01-shell-navigation-auth.md): the shell, top bar, home page
 * and authentication items, in the running SPA. Objects prefixed f01e_.
 */
const DB = 'f01e_db'

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, name VARCHAR(20)) COMMENT='the f01 table';
    CREATE TABLE ${DB}.u (id INT PRIMARY KEY);`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection(MYSQL)
  await c.query(`DROP DATABASE IF EXISTS ${DB}`)
  await c.end()
})

test.describe('top bar and shell', () => {
  test('[p01-39786c] the footer link opens the current page (route, db, table, server) in a new window', async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/s/1/db/${DB}/t/t/structure`)
    const link = page.locator('#selflink a')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('title', 'Open new BetterMyAdmin window')
    expect(await link.getAttribute('href')).toBe(`/s/1/db/${DB}/t/t/structure`)
  })

  test('[p01-49a7f3] the breadcrumb bar stays at the top; a click on it scrolls to the top unless Ctrl is held', async ({
    page,
  }) => {
    await login(page)
    await page.goto('/s/1/variables')
    const scroller = page.locator('#page_scroll')
    await expect(page.locator('#page_content table').first()).toBeVisible()
    await scroller.evaluate((e) => e.scrollTo({ top: 2000 }))
    await expect.poll(() => scroller.evaluate((e) => e.scrollTop)).toBeGreaterThan(0)
    // the bar is outside the scrolled area: still visible at the top
    await expect(page.locator('#server-breadcrumb')).toBeInViewport()
    await page.locator('#server-breadcrumb').click({ modifiers: ['Control'], position: { x: 400, y: 5 } })
    expect(await scroller.evaluate((e) => e.scrollTop)).toBeGreaterThan(0)
    await page.locator('#server-breadcrumb').click({ position: { x: 400, y: 5 } })
    await expect.poll(() => scroller.evaluate((e) => e.scrollTop)).toBe(0)
  })

  test('[p01-9a3eea] the table comment, or the database comment, follows the breadcrumb in quotes', async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/s/1/db/${DB}/t/t/structure`)
    await expect(page.locator('#server-breadcrumb')).toContainText('“the f01 table”')
  })

  test('[p01-a7125e] the title follows TitleTable / TitleDatabase / TitleServer and every navigation', async ({
    page,
  }) => {
    await login(page)
    await page.goto('/s/1')
    await expect(page).toHaveTitle(/^127\.0\.0\.1:\d+ \/ [^/]+ \| BetterMyAdmin /)
    await page.goto(`/s/1/db/${DB}/structure`)
    await expect(page).toHaveTitle(new RegExp(` / ${DB} \\| BetterMyAdmin `))
    await page.goto(`/s/1/db/${DB}/t/t/structure`)
    await expect(page).toHaveTitle(new RegExp(` / ${DB} / t \\| BetterMyAdmin `))
  })

  test('[p01-c1dc76] the page settings gear only on pages with a PageSettings group; the lock while a form is dirty; scroll to top', async ({
    page,
  }) => {
    await login(page)
    await page.goto('/s/1')
    await expect(page.locator('#page_settings_icon')).toHaveCount(0)
    await expect(page.locator('#goto_pagetop')).toBeVisible()
    await page.goto(`/s/1/db/${DB}/t/t/browse`)
    await expect(page.locator('#page_settings_icon')).toBeVisible()
    await page.goto(`/s/1/db/${DB}/t/t/insert`)
    await expect(page.locator('#lock_page_icon img, #lock_page_icon svg')).toHaveCount(0)
    await page.locator('input[name^="fields"]').first().fill('5')
    await expect(page.locator('#lock_page_icon').locator('*').first()).toBeVisible()
  })

  test('[p01-c6a012] leaving a dirty lock-page form asks for confirmation', async ({ page }) => {
    await login(page)
    await page.goto(`/s/1/db/${DB}/t/t/insert`)
    await page.locator('input[name^="fields"]').first().fill('6')
    let asked = ''
    page.once('dialog', async (d) => {
      asked = d.message()
      await d.dismiss()
    })
    await page.locator('#topmenu [data-tab="structure"]').click()
    await expect.poll(() => asked).toBe('You have unsaved changes; are you sure you want to leave this page?')
    await expect(page).toHaveURL(/\/insert/)
  })

  test('[p01-f7dfcf] the user menu: user@host to the privileges, docs, colour mode, Settings, Log out', async ({
    page,
  }) => {
    await login(page)
    await page.getByRole('button', { name: 'Open user account menu' }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: /^root@/ })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /documentation/ }).first()).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeVisible()
    await menu.getByRole('menuitem', { name: /^root@/ }).click()
    await expect(page).toHaveURL(/\/privileges\/user/)
  })

  test('[p01-4991aa] below 768px the tabs fold into the hamburger', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 })
    await login(page)
    await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeVisible()
  })
})

test.describe('home page', () => {
  test('[p01-100ac1] the cards: General settings, Appearance, Database server, Web server, the application block', async ({
    page,
  }) => {
    await login(page)
    for (const title of ['General settings', 'Appearance settings', 'Database server', 'Web server']) {
      await expect(page.getByText(title, { exact: true })).toBeVisible()
    }
    await expect(page.locator('#li_change_password')).toBeVisible()
    await expect(page.locator('#li_select_mysql_collation')).toBeVisible()
    await expect(page.locator('#li_user_preferences')).toBeVisible()
    await expect(page.locator('#li_select_theme')).toBeVisible()
    await page.getByRole('button', { name: 'View all' }).click()
    await expect(page.getByRole('button', { name: 'Take it' }).first()).toBeVisible()
    await page.keyboard.press('Escape')
    // the version block, the documentation links
    await expect(page.getByText(/Version information:/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Documentation' }).first()).toBeVisible()
  })
})

test.describe('authentication', () => {
  test('[p01-389871] logout posts with the token and returns to the login form', async ({ page }) => {
    await login(page)
    const req = page.waitForRequest((r) => r.url().endsWith('/api/auth/logout') && r.method() === 'POST')
    await page.getByRole('button', { name: 'Open user account menu' }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    const r = await req
    expect(r.headers()['x-bma-token']).toBeTruthy()
    await expect(page.locator('#login_form')).toBeVisible()
    // the username is recalled (LoginCookieRecall)
    await expect(page.locator('#input_username')).toHaveValue(MYSQL.user)
  })

  test('[p01-570894] the login is kept after a reload (the session cookie, not a form re-post)', async ({
    page,
  }) => {
    await login(page)
    await page.reload()
    await expect(page.locator('#maincontainer')).toBeVisible()
    await expect(page.locator('#login_form')).toHaveCount(0)
  })

  test('[p01-4faba9] the login form: server choice and the language card', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#login_form')).toBeVisible()
    await expect(page.locator('#languageSelect, select[name="lang"]').first()).toBeVisible()
  })
})

test.describe('JavaScript error reporting', () => {
  test('[p01-ae26ee] ask mode: the notification, the report dialog with "Automatically send report next time", Ignore', async ({
    page,
  }) => {
    await login(page)
    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error('f01 boom')
      }),
    )
    const note = page.locator('[id^="error_notification_"]').first()
    await expect(note).toContainText(
      'A fatal JavaScript error has occurred. Would you like to send an error report?',
    )
    await expect(note.getByTitle('Change report settings')).toBeVisible()
    await note.locator('[id^="show_error_report_"]').click()
    const dialog = page.locator('#errorReportModal')
    await expect(dialog).toContainText('Submit error report')
    await expect(dialog.locator('#errorReportAlwaysSendCheckbox')).toBeVisible()
    await expect(dialog).toContainText('Automatically send report next time')
    await dialog.getByRole('button', { name: 'Cancel' }).first().click()
    // a second error: Ignore removes its notification
    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error('f01 boom again')
      }),
    )
    const again = page.locator('[id^="error_notification_"]').last()
    await again.locator('[id^="ignore_error_"]').click()
    await expect(page.locator('[id^="error_notification_"]')).toHaveCount(0)
  })
})
