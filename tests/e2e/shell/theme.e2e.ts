import { expect, test } from '@playwright/test'
import { login } from '../fixtures.ts'

/** Themes and colour modes (ThemeManager, ThemeSetController, theme-init.js before first paint). */
test.describe('themes', () => {
  test('switching theme and colour mode applies at once and survives a reload [p01-b253b9]', async ({
    page,
  }) => {
    await login(page)
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'pmahomme')
    await page.selectOption('#themeSelect', 'metro')
    await expect(html).toHaveAttribute('data-theme', 'metro')
    await expect(html).toHaveAttribute('data-color-mode', 'win')
    // metro keeps phpMyAdmin's colour modes
    await page.selectOption('select[name="themeColorMode"]', 'teal')
    await expect(html).toHaveAttribute('data-color-mode', 'teal')
    await page.reload()
    await expect(html).toHaveAttribute('data-theme', 'metro')
    await expect(html).toHaveAttribute('data-color-mode', 'teal')
    // the cookie mirror lets theme-init.js paint the right theme before any script runs
    const cookies = await page.context().cookies()
    expect(cookies.find((c) => c.name === 'bma_theme')?.value).toBe('metro')
  })

  test('every theme has a dark variant; the user menu offers the colour mode too [p01-b253b9]', async ({
    page,
  }) => {
    await login(page)
    await page.selectOption('#themeSelect', 'bootstrap')
    await page.getByRole('button', { name: 'Open user account menu' }).click()
    await page.selectOption('#themeColorModeToggle', 'dark')
    await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark')
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(bg).toBe('rgb(33, 37, 41)')
  })

  test('without a stored choice, the OS dark preference picks the dark variant (X23)', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' })
    const page = await ctx.newPage()
    await login(page)
    await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark')
    await ctx.close()
  })

  test('the gallery shows one card per theme with "Take it" [p01-b253b9] [p01-100ac1] [p06-c67ed8]', async ({
    page,
  }) => {
    await login(page)
    await page.getByRole('button', { name: 'View all' }).click()
    const dialog = page.getByRole('dialog', { name: 'BetterMyAdmin Themes' })
    await expect(dialog.locator('[data-theme-card]')).toHaveCount(7)
    await dialog.locator('[data-theme-card="original"]').getByRole('button', { name: 'Take it' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'original')
    await expect(dialog).toBeHidden()
  })
})
