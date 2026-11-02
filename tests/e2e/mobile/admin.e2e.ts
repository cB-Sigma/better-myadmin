import { existsSync } from 'node:fs'
import { type Locator, type Page, devices, expect, test } from '@playwright/test'
import { login } from '../fixtures.ts'

/**
 * The admin pages on a phone (iPhone 13, 390×844, touch; styles/mobile-admin.css, lib/mobileAdmin.tsx):
 * no sideways page scroll (wide tables scroll in their own box), user accounts as cards, privilege
 * matrices and settings forms usable by thumb (40px rows, 16px fields, label above the field),
 * single-column status/monitor cards, the Designer (pan, pinch and button zoom) and the ER diagram
 * fitted to the screen. Desktop is covered by the other suites and tests/visual.
 */
const chromium =
  process.env.PW_CHROMIUM ?? process.env.BMA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
test.use({
  ...devices['iPhone 13'],
  defaultBrowserType: 'chromium',
  ...(existsSync(chromium) ? { launchOptions: { executablePath: chromium } } : {}),
})

const DB = 'acme_store'

test.beforeEach(async ({ page }) => {
  await login(page)
})

async function open(page: Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#page_content')).toBeVisible()
}

/** the page itself never scrolls sideways */
async function expectNoSidewaysScroll(page: Page) {
  const [sw, cw] = await page
    .locator('#page_scroll')
    .evaluate((e) => [e.scrollWidth, e.clientWidth] as [number, number])
  expect(sw, 'page scroll width').toBeLessThanOrEqual(cw + 1)
}

async function box(l: Locator) {
  const b = await l.boundingBox()
  if (b === null) throw new Error('not rendered')
  return b
}

const PAGES = [
  '/s/1/databases',
  '/s/1/privileges',
  '/s/1/privileges/add-user',
  '/s/1/privileges/user?username=root&hostname=localhost',
  '/s/1/variables',
  '/s/1/status',
  '/s/1/status/processes',
  '/s/1/status/queries',
  '/s/1/status/variables',
  '/s/1/status/advisor',
  '/s/1/status/slow-queries',
  '/s/1/replication',
  '/s/1/binlog',
  '/s/1/engines',
  '/s/1/engines/InnoDB',
  '/s/1/collations',
  '/s/1/plugins',
  '/s/1/export',
  '/s/1/import',
  '/s/1/preferences/features',
  `/s/1/db/${DB}/operations`,
  `/s/1/db/${DB}/routines`,
  `/s/1/db/${DB}/events`,
  `/s/1/db/${DB}/triggers`,
  `/s/1/db/${DB}/export`,
  `/s/1/db/${DB}/designer`,
  `/s/1/db/${DB}/diagram`,
  `/s/1/db/${DB}/t/products/operations`,
  `/s/1/db/${DB}/t/products/triggers`,
]

test('admin pages: no sideways page scroll on a phone', async ({ page }) => {
  for (const path of PAGES) {
    await open(page, path)
    await test.step(path, () => expectNoSidewaysScroll(page))
  }
})

test('wide tables scroll inside their own box', async ({ page }) => {
  await open(page, '/s/1/variables')
  const table = page.locator('#serverVariables')
  await expect(table.locator('tbody tr').first()).toBeVisible()
  const [sw, cw] = await table.evaluate((e) => [e.scrollWidth, e.clientWidth] as [number, number])
  expect(sw).toBeGreaterThan(cw)
  expect(cw).toBeLessThanOrEqual(390)
  await table.evaluate((e) => e.scrollBy({ left: 200 }))
  expect(await table.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0)
})

test('user accounts: one card per account, actions reachable', async ({ page }) => {
  await open(page, '/s/1/privileges')
  const table = page.locator('#userRightsTable')
  await expect(table).toHaveClass(/bma-mobile-cards/)
  const card = table.locator('tbody tr').filter({ hasText: 'root' }).first()
  await expect(card.locator('td[data-label]').first()).toBeVisible()
  const edit = card.getByRole('link', { name: 'Edit privileges' })
  const b = await box(edit)
  expect(b.x + b.width).toBeLessThanOrEqual(390)
  expect(b.height).toBeGreaterThanOrEqual(40)
  // the header row is for screen readers only
  expect((await box(table.locator('thead'))).height).toBeLessThanOrEqual(1)
  // the checkbox cell is a 40px target
  const check = card.locator('td').first()
  expect((await box(check)).height).toBeGreaterThanOrEqual(40)
  await card.locator('input.checkall').check()
  await expect(card.locator('input.checkall')).toBeChecked()
  await edit.click()
  await expect(page).toHaveURL(/privileges\/user/)
})

test('privilege matrix: 40px rows, the label toggles the privilege', async ({ page }) => {
  await open(page, '/s/1/privileges/add-user')
  const row = page.locator('.item:has(#checkbox_Select_priv)')
  expect((await box(row)).height).toBeGreaterThanOrEqual(40)
  const label = row.locator('label')
  expect((await box(label)).width).toBeGreaterThan(150)
  const select = page.locator('#checkbox_Select_priv')
  const before = await select.isChecked()
  await label.tap()
  expect(await select.isChecked()).toBe(!before)
  // the login fields: label above a full-width field, 16px text (no iOS zoom)
  const name = page.locator('#pma_username')
  expect((await box(name)).width).toBeGreaterThan(250)
  expect(await name.evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(
    16,
  )
})

test('operations: label above a full-width 40px field', async ({ page }) => {
  await open(page, `/s/1/db/${DB}/t/products/operations`)
  const field = page.locator('#renameTableInput')
  const fb = await box(field)
  expect(fb.height).toBeGreaterThanOrEqual(40)
  expect(fb.width).toBeGreaterThan(280)
  const label = page.getByText('Rename table to', { exact: true })
  const lb = await box(label)
  expect(lb.y + lb.height).toBeLessThanOrEqual(fb.y + 1)
  for (const go of await page.getByRole('button', { name: 'Go' }).all())
    expect((await box(go)).height).toBeGreaterThanOrEqual(40)
})

test('preferences: option name and help above the field', async ({ page }) => {
  await open(page, '/s/1/preferences/features')
  const row = page
    .locator('.config-form tr')
    .filter({ has: page.locator('select, input[type="text"], input[type="number"]') })
  const first = row.first()
  const th = await box(first.locator('th'))
  const td = await box(first.locator('td').first())
  expect(th.y + th.height).toBeLessThanOrEqual(td.y + 1)
  expect(td.width).toBeGreaterThan(280)
})

test('status: monitor charts and dashboard cards in one full-width column', async ({ page }) => {
  await open(page, '/s/1/status/monitor')
  const charts = page.locator('#chartGrid .monitorChart')
  await expect(charts.nth(1)).toBeVisible()
  const a = await box(charts.nth(0))
  const b = await box(charts.nth(1))
  expect(a.x).toBe(b.x)
  expect(a.width).toBeGreaterThan(330)
  // sub-menu pills are 40px targets
  expect((await box(page.locator('#statusPills a').first())).height).toBeGreaterThanOrEqual(40)
  await open(page, '/s/1/status/dashboard')
  const cards = page.locator('#statusDashboard .grid > *')
  await expect(cards.nth(1)).toBeVisible()
  const c0 = await box(cards.nth(0))
  const c1 = await box(cards.nth(1))
  expect(c0.x).toBe(c1.x)
  expect(c0.width).toBeGreaterThan(330)
})

test('designer: a scrolling canvas with button and pinch zoom', async ({ page }) => {
  await open(page, `/s/1/db/${DB}/designer`)
  await expect(page.locator('.designer-mobile-bar')).toBeVisible()
  const zoom = page.getByTestId('designer-zoom')
  // fitted to the phone's width on load
  await expect(zoom).not.toHaveText('100%')
  const pct = async () => Number.parseInt((await zoom.textContent()) ?? '0', 10)
  const start = await pct()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  expect(await pct()).toBeGreaterThan(start)
  await page.getByRole('button', { name: 'Zoom out' }).click()
  expect(await pct()).toBe(start)
  // the canvas is its own scroller, within the screen
  const outer = page.locator('#canvas_outer')
  const ob = await box(outer)
  expect(ob.x + ob.width).toBeLessThanOrEqual(390)
  expect(await outer.evaluate((e) => getComputedStyle(e).overflow)).toBe('auto')
  // the side menu is a toolbar of 40px buttons, its controls reachable
  const menu = page.locator('#side_menu a').first()
  expect((await box(menu)).height).toBeGreaterThanOrEqual(40)
  // two-finger pinch out zooms in
  await outer.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const touches = (d: number) => [
      new Touch({ identifier: 1, target: el, clientX: cx - d, clientY: cy }),
      new Touch({ identifier: 2, target: el, clientX: cx + d, clientY: cy }),
    ]
    const fire = (type: string, d: number) => {
      const t = type === 'touchend' ? [] : touches(d)
      el.dispatchEvent(
        new TouchEvent(type, {
          touches: t,
          targetTouches: t,
          changedTouches: touches(d),
          bubbles: true,
          cancelable: true,
        }),
      )
    }
    fire('touchstart', 40)
    fire('touchmove', 60)
    fire('touchmove', 80)
    fire('touchend', 80)
  })
  expect(await pct()).toBeGreaterThan(start)
})

test('ER diagram: fitted to the phone screen, touch-ready canvas', async ({ page }) => {
  await open(page, `/s/1/db/${DB}/diagram`)
  const canvas = page.getByTestId('er-canvas')
  await expect(canvas.locator('[data-table]').first()).toBeVisible()
  const cb = await box(canvas)
  expect(cb.x + cb.width).toBeLessThanOrEqual(390)
  expect(Number.parseInt((await page.getByTestId('er-zoom').textContent()) ?? '0', 10)).toBeLessThan(60)
  // every table box is inside the canvas after the initial fit
  for (const t of await canvas.locator('[data-table]').all()) {
    const b = await box(t)
    expect(b.x).toBeGreaterThanOrEqual(cb.x - 1)
    expect(b.x + b.width).toBeLessThanOrEqual(cb.x + cb.width + 1)
  }
  expect(await canvas.evaluate((e) => getComputedStyle(e).touchAction)).toBe('none')
})
