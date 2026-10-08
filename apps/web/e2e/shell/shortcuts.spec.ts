import { expect, test } from '@playwright/test'
import { E2E, login } from '../fixtures.ts'

/** docs/features/01 "Keyboard shortcuts table" (shortcuts_handler.ts). */
test.describe('keyboard shortcuts', () => {
  test('D then S opens the database structure; Backspace goes back', async ({ page }) => {
    await login(page)
    await page.goto(`/s/1/db/${E2E.db}/sql`)
    await expect(page.locator('[data-tab="sql"][aria-current="page"]')).toBeVisible()
    await page.locator('body').click()
    await page.keyboard.press('d')
    await page.keyboard.press('s')
    await expect(page).toHaveURL(new RegExp(`/db/${E2E.db}/structure$`))
    await page.keyboard.press('Backspace')
    await expect(page).toHaveURL(new RegExp(`/db/${E2E.db}/sql$`))
  })

  test('T then F opens the table search; letters are ignored inside fields', async ({ page }) => {
    await login(page)
    await page.goto(`/s/1/db/${E2E.db}/t/t/structure`)
    await expect(page.locator('[data-tab="structure"][aria-current="page"]')).toBeVisible()
    await page.locator('body').click()
    await page.keyboard.press('t')
    await page.keyboard.press('f')
    await expect(page).toHaveURL(/\/t\/t\/search$/)
  })

  test('E opens Export, H goes home, ? lists the shortcuts', async ({ page }) => {
    await login(page)
    await page.locator('body').click()
    await page.keyboard.press('e')
    await expect(page).toHaveURL(/\/s\/1\/export$/)
    await page.keyboard.press('h')
    await expect(page).toHaveURL(/\/s\/1\/?$/)
    await expect(page.locator('#maincontainer')).toBeVisible()
    await page.keyboard.press('Shift+?')
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(help).toContainText('Toggle the console')
    // Esc closes dialogs; shortcuts are paused while a dialog is open
    await page.keyboard.press('e')
    await expect(page).toHaveURL(/\/s\/1\/?$/)
    await page.keyboard.press('Escape')
    await expect(help).toBeHidden()
  })

  test('K and Ctrl+Alt+C send the console toggle event', async ({ page }) => {
    await login(page)
    await page.evaluate(() => {
      ;(window as unknown as { toggles: number }).toggles = 0
      window.addEventListener('bma:console-toggle', () => {
        ;(window as unknown as { toggles: number }).toggles++
      })
    })
    await page.locator('body').click()
    await page.keyboard.press('k')
    await page.keyboard.press('Control+Alt+c')
    expect(await page.evaluate(() => (window as unknown as { toggles: number }).toggles)).toBe(2)
  })
})
