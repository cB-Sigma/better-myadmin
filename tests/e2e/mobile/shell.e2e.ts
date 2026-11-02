import { type Page, devices, expect, test } from '@playwright/test'
import { login } from '../fixtures.ts'

/**
 * The shell on a phone (≤ 767px, apps/web/src/lib/mobile.ts; styles/mobile-shell.css): a one-line top
 * bar, the navigation panel as an off-canvas drawer, the folded tab menu, the console strip opening full
 * screen, dialogs and the command palette as full-screen sheets, menus inside the screen, no sideways
 * page scroll, touch targets of 40px. Uses the acme_store demo database.
 */
test.use({ ...devices['iPhone 13'], defaultBrowserType: 'chromium' })

const BROWSE = '/s/1/db/acme_store/t/products/browse'
const drawer = (page: Page) => page.locator('#pma_navigation')
const toggle = (page: Page) => page.locator('#pma_navigation_collapser')

async function noSidewaysScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    width: window.innerWidth,
  }))
  expect(scroll).toBeLessThanOrEqual(width)
}

async function minSize(page: Page, selector: string, min = 40) {
  for (const box of await page.locator(selector).evaluateAll((els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null)
      .map((e) => {
        const r = e.getBoundingClientRect()
        return { w: r.width, h: r.height, id: e.id || e.className }
      }),
  )) {
    expect(box.w, `${box.id} width`).toBeGreaterThanOrEqual(min)
    expect(box.h, `${box.id} height`).toBeGreaterThanOrEqual(min)
  }
}

test.describe('phone shell', () => {
  test('login page: no sideways scroll, 16px fields', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#input_username')).toBeVisible()
    await noSidewaysScroll(page)
    for (const id of ['#input_username', '#input_password']) {
      const size = await page.locator(id).evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize))
      expect(size).toBeGreaterThanOrEqual(16)
    }
    const go = await page.locator('#input_go').boundingBox()
    expect(go?.height ?? 0).toBeGreaterThanOrEqual(40)
  })

  for (const width of [360, 390, 430]) {
    test(`top bar is one line and nothing scrolls sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await login(page)
      await page.goto(BROWSE)
      await expect(page.locator('#server-breadcrumb')).toContainText('products')
      const bar = await page.locator('.bma-topbar').boundingBox()
      expect(bar?.height ?? 0).toBeLessThanOrEqual(56)
      await noSidewaysScroll(page)
      await minSize(
        page,
        '#pma_navigation_collapser, #bma_command_palette, #userAccountDropdown > button, #goto_pagetop, #page_settings_icon > button',
      )
      // the current table is in view at the end of the breadcrumb
      const crumb = await page.locator('#server-breadcrumb li').last().boundingBox()
      expect((crumb?.x ?? 0) + (crumb?.width ?? 0)).toBeLessThanOrEqual(width)
    })
  }

  test('the navigation panel is a drawer: toggle, backdrop, Escape, swipe, closes on navigation', async ({
    page,
  }) => {
    await login(page)
    await page.goto(BROWSE)
    await expect(drawer(page)).toBeHidden()
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')

    await toggle(page).click()
    await expect(drawer(page)).toBeVisible()
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
    // over the page, not pushing it
    const main = await page.locator('#page_content').boundingBox()
    expect(main?.x ?? 99).toBeLessThan(20)
    // (once it has slid in)
    await expect.poll(async () => (await drawer(page).boundingBox())?.x).toBe(0)
    expect((await drawer(page).boundingBox())?.width ?? 0).toBeLessThan(390)
    // the backdrop closes it
    await page.locator('.bma-nav-backdrop').click({ position: { x: 380, y: 500 } })
    await expect(drawer(page)).toBeHidden()

    // Escape
    await toggle(page).click()
    await expect(drawer(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer(page)).toBeHidden()
    await expect(toggle(page)).toBeFocused()

    // a swipe to the left
    await toggle(page).click()
    await expect(drawer(page)).toBeVisible()
    await drawer(page).evaluate((el) => {
      const touch = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 })
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(250)] }))
      el.dispatchEvent(
        new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch(100)] }),
      )
    })
    await expect(drawer(page)).toBeHidden()

    // a table link: the page changes and the drawer goes
    await toggle(page).click()
    const row = drawer(page).locator('[role=treeitem][data-kind=table][data-name=orders]')
    await expect(row).toBeVisible()
    const h = await row.boundingBox()
    expect(h?.height ?? 0).toBeGreaterThanOrEqual(40)
    await row.getByRole('link', { name: 'orders', exact: true }).click()
    await expect(page).toHaveURL(/\/t\/orders\//)
    await expect(drawer(page)).toBeHidden()
  })

  test('the folded tab menu names the current tab, opens a grid and closes on a choice', async ({ page }) => {
    await login(page)
    await page.goto(BROWSE)
    const button = page.getByRole('button', { name: 'Toggle navigation' })
    await expect(button).toContainText('Browse')
    const b = await button.boundingBox()
    expect(b?.height ?? 0).toBeGreaterThanOrEqual(40)
    await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    const structure = page.locator('#topmenu [data-tab=structure]')
    await expect(structure).toBeVisible()
    await minSize(page, '#topmenu .nav-link')
    // Escape closes it
    await page.keyboard.press('Escape')
    await expect(structure).toBeHidden()
    // a tap elsewhere closes it
    await button.click()
    await expect(structure).toBeVisible()
    await page.locator('#page_content').click({ position: { x: 5, y: 300 } })
    await expect(structure).toBeHidden()
    // a choice navigates and closes it
    await button.click()
    await structure.click()
    await expect(page).toHaveURL(/\/t\/products\/structure/)
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(button).toContainText('Structure')
  })

  test('the console is a strip that opens full screen with a close button', async ({ page }) => {
    await login(page)
    const strip = page.locator('#pma_console')
    const s = await strip.boundingBox()
    expect(s?.height ?? 0).toBeLessThanOrEqual(56)
    // the hover-only buttons wait for the open console
    await expect(page.locator('#pma_console .toolbar button.clear')).toBeHidden()
    await page.locator('.console_switch').click()
    const full = await strip.boundingBox()
    expect(full?.y).toBe(0)
    expect(full?.height ?? 0).toBeGreaterThanOrEqual(page.viewportSize()!.height - 1)
    await expect(page.locator('#pma_console .toolbar button.clear')).toBeVisible()
    const close = page.locator('.bma-console-close')
    await expect(close).toBeVisible()
    await minSize(page, '.bma-console-close')
    await close.click()
    await expect(page.locator('.bma-console-close')).toHaveCount(0)
    const back = await strip.boundingBox()
    expect(back?.height ?? 0).toBeLessThanOrEqual(56)
  })

  test('dialogs are full-screen sheets with the footer in view', async ({ page }) => {
    await login(page)
    await page.locator('#li_change_password a, #li_change_password button').first().click()
    const dialog = page.locator('#changePasswordModal')
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    const vp = page.viewportSize()!
    expect(box).toMatchObject({ x: 0, y: 0, width: vp.width })
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(vp.height - 1)
    await expect(page.locator('#changePasswordGoButton')).toBeInViewport()
    await minSize(page, '#changePasswordModal [data-bma-dialog-close], #changePasswordGoButton')
    const field = await page
      .locator('#text_pma_change_pw')
      .evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize))
    expect(field).toBeGreaterThanOrEqual(16)
    // nothing wider than the sheet
    const over = await dialog.evaluate((e) => e.scrollWidth - e.clientWidth)
    expect(over).toBeLessThanOrEqual(0)
    await page.locator('#changePasswordModal [data-bma-dialog-close]').click()
    await expect(dialog).toBeHidden()
  })

  test('the command palette is full screen with a close button', async ({ page }) => {
    await login(page)
    await page.locator('#bma_command_palette').click()
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    const box = await palette.boundingBox()
    expect(box).toMatchObject({ x: 0, y: 0, width: page.viewportSize()!.width })
    const close = palette.getByRole('button', { name: 'Close' })
    await expect(close).toBeVisible()
    await close.click()
    await expect(palette).toBeHidden()
  })

  test('the user menu fits the screen with rows a finger can hit', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await login(page)
    await page.locator('#userAccountDropdown > button').click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const box = await menu.boundingBox()
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 999)).toBeLessThanOrEqual(360)
    await minSize(page, '[role=menu] [role=menuitem]')
  })

  // every theme restyles the tabs for desktop (native.css: a 22px segmented strip); on a phone the
  // grid's own sizes win
  for (const theme of ['pmahomme', 'native', 'modern', 'classic', 'metro']) {
    test(`${theme} theme: the open tab menu is a grid of separate 40px cells; structure pills 40px`, async ({
      page,
    }) => {
      await page.addInitScript((t) => localStorage.setItem('bma_theme', t), theme)
      await login(page)
      await page.goto(BROWSE)
      await page.getByRole('button', { name: 'Toggle navigation' }).click()
      await expect(page.locator('#topmenu [data-tab=structure]')).toBeVisible()
      const cells = await page.locator('#topmenu .nav-link').evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect()
          const li = (e.closest('li') as HTMLElement).getBoundingClientRect()
          return { x: r.x, y: r.y, w: r.width, h: r.height, liH: li.height }
        }),
      )
      for (const c of cells) {
        expect(c.h).toBeGreaterThanOrEqual(40)
        // the item is as tall as its link (no 22px row with the link spilling over the next one)
        expect(Math.abs(c.liH - c.h)).toBeLessThanOrEqual(1)
      }
      for (let i = 0; i < cells.length; i++)
        for (let j = i + 1; j < cells.length; j++) {
          const a = cells[i] as (typeof cells)[number]
          const b = cells[j] as (typeof cells)[number]
          const overlap =
            a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1
          expect(overlap, `tab cells ${i} and ${j} overlap`).toBe(false)
        }
      await page.goto('/s/1/db/acme_store/t/products/structure')
      await minSize(page, '[data-testid="structure-pills"] a')
      // the database structure's pinned name column is opaque: what scrolls under it stays hidden
      await page.goto('/s/1/db/acme_store/structure')
      const names = page.locator('#structureTable > tbody > tr > th')
      await expect(names.first()).toBeVisible()
      for (const bg of await names.evaluateAll((ths) =>
        ths.map((th) => getComputedStyle(th, '::before').backgroundColor),
      ))
        expect(bg).not.toMatch(/^(transparent|rgba\(\d+, \d+, \d+, 0\))$/)
    })
  }
})
