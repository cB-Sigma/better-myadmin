import { expect, test } from '@playwright/test'
import { E2E, allTabs, login } from '../fixtures.ts'

/** docs/features/01 "Menu tabs matrix" — visibility as a limited user vs root (src/Menu.php). */
test.describe('tab visibility', () => {
  test('root sees User accounts, Binary log and Replication; the limited user does not [p01-4991aa]', async ({
    page,
  }) => {
    await login(page)
    expect(await allTabs(page)).toEqual([
      'databases',
      'sql',
      'status',
      'rights',
      'export',
      'import',
      'settings',
      'binlog',
      'replication',
      'vars',
      'charset',
      'engine',
      'plugins',
    ])
    await page.getByRole('button', { name: 'Open user account menu' }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await expect(page.locator('#login_form')).toBeVisible()

    await login(page, E2E.limited, E2E.limited)
    expect(await allTabs(page)).toEqual([
      'databases',
      'sql',
      'status',
      'export',
      'import',
      'settings',
      'vars',
      'charset',
      'engine',
      'plugins',
    ])
  })

  test('database and table tab bars follow privileges and view status [p01-4991aa]', async ({ page }) => {
    await login(page, E2E.limited, E2E.limited)
    await page.goto(`/s/1/db/${E2E.db}`)
    // DefaultTabDatabase: database structure
    await expect(page).toHaveURL(new RegExp(`/s/1/db/${E2E.db}/structure$`))
    const dbTabs = await allTabs(page)
    expect(dbTabs).not.toContain('privileges')
    expect(dbTabs).not.toContain('events')
    expect(dbTabs).not.toContain('triggers')
    expect(dbTabs).toContain('operation')

    await page.goto(`/s/1/db/${E2E.db}/t/v`)
    await expect(page).toHaveURL(new RegExp(`/s/1/db/${E2E.db}/t/v/browse`))
    const viewTabs = await allTabs(page)
    expect(viewTabs).not.toContain('import')
    expect(viewTabs).not.toContain('insert')
    await expect(page.locator('#server-breadcrumb')).toContainText('View: v')
  })

  test('root on a table: every tab, the comment in the breadcrumb, the active tab marked (current) [p01-4991aa] [p01-9a3eea]', async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/s/1/db/${E2E.db}/t/t/structure`)
    const tabs = await allTabs(page)
    expect(tabs.slice(0, 5)).toEqual(['browse', 'structure', 'sql', 'search', 'insert'])
    expect(tabs).toContain('triggers')
    await expect(page.locator('#server-breadcrumb .breadcrumb-comment')).toHaveText('“E2E table”')
    await expect(page.locator('[data-tab="structure"][aria-current="page"]')).toContainText('(current)')
    await expect(page).toHaveTitle(new RegExp(` / ${E2E.db} / t \\| BetterMyAdmin`))
  })

  test('tabs that do not fit collapse into More from the right [p01-4991aa]', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await login(page)
    const inline = await page
      .locator('#topmenu > li [data-tab]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-tab')))
    expect(inline.length).toBeLessThan(13)
    expect(inline[0]).toBe('databases')
    await page.locator('#navbarDropdown').click()
    await expect(page.getByRole('menu').locator('[data-tab="plugins"]')).toBeVisible()
  })
})
