import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * Feature 01 checklist: the navigation panel (docs/features/01-shell-navigation-auth.md#navigation-panel).
 * Objects prefixed f01n_.
 */
const DB = 'f01ndb'
/** an account that sees only this suite's databases (no paging of the database list) */
const USER = 'f01n_u'
const LONG = `f01nlong${'x'.repeat(52)}`
/** enough databases for the database fast filter (NavigationTreeDisplayDbFilterMinimum = 30) */
const MORE = Array.from({ length: 30 }, (_, i) => `f01nf${String(i).padStart(2, '0')}`)

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${LONG}; CREATE DATABASE ${DB}; CREATE DATABASE ${LONG};
    ${MORE.map((d) => `DROP DATABASE IF EXISTS ${d}; CREATE DATABASE ${d};`).join(' ')}
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, name VARCHAR(20));
    CREATE TABLE ${DB}.t2 (id INT);
    CREATE VIEW ${DB}.v AS SELECT id FROM ${DB}.t;
    CREATE PROCEDURE ${DB}.p() SELECT 1;
    CREATE FUNCTION ${DB}.f() RETURNS INT DETERMINISTIC RETURN 1;
    CREATE TRIGGER ${DB}.trg BEFORE INSERT ON ${DB}.t FOR EACH ROW SET NEW.name = NEW.name;
    CREATE EVENT ${DB}.ev ON SCHEDULE EVERY 1 DAY DISABLE DO SELECT 1;
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f01n%\`.* TO '${USER}'@'%';`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(
    `DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${LONG}; ${MORE.map((d) => `DROP DATABASE IF EXISTS ${d};`).join(' ')} DROP USER IF EXISTS '${USER}'@'%'`,
  )
  await c.end()
})

const nav = (page: Page) => page.locator('#pma_navigation')
const item = (page: Page, kind: string, name: string) =>
  nav(page).locator(`[role=treeitem][data-kind=${kind}][data-name="${name}"]`)
async function expand(page: Page, kind: string, name: string) {
  await item(page, kind, name).getByRole('button', { name: 'Expand/Collapse' }).click()
}

test('[p01-d3c83f] "New" comes first in every container; the database list starts with New', async ({
  page,
}) => {
  await login(page, USER, USER)
  const first = await nav(page)
    .locator('[role=treeitem]')
    .first()
    .evaluate((e) => e.textContent?.trim() ?? '')
  expect(first).toMatch(/New$/)
  await expand(page, 'database', DB)
  for (const container of ['tables', 'views', 'procedures', 'functions', 'events']) {
    await expand(page, 'container', container)
    // its children are loaded
    await expect(item(page, 'container', container)).toHaveAttribute('aria-expanded', 'true')
  }
  await expect(item(page, 'event', 'ev')).toBeVisible()
  // the first child of each container is its "New" node
  const rows = await nav(page)
    .locator('[role=treeitem]')
    .evaluateAll((els) => els.map((e) => `${e.getAttribute('data-kind')}:${e.textContent?.trim()}`))
  for (const container of ['tables', 'views', 'procedures', 'functions', 'events']) {
    const at = rows.findIndex((r) => r.startsWith('container:') && r.toLowerCase().includes(container))
    expect(rows[at + 1], container).toMatch(/^new:(New)+$/)
  }
})

test('[p01-ae1670] routine icon opens Execute, the name opens Edit; trigger icon exports; event name edits', async ({
  page,
}) => {
  await login(page, USER, USER)
  await expand(page, 'database', DB)
  await expand(page, 'container', 'procedures')
  const p = item(page, 'procedure', 'p')
  // the icon: the Execute dialog; the name: the Edit dialog
  await expect(p.getByRole('link', { name: 'Procedure' })).toHaveAttribute(
    'href',
    /routines\?.*execute_dialog=1/,
  )
  await expect(p.getByRole('link', { name: 'p', exact: true })).toHaveAttribute(
    'href',
    /routines\?.*edit_item=1/,
  )
  await expand(page, 'container', 'events')
  await expect(item(page, 'event', 'ev').getByRole('link', { name: 'ev', exact: true })).toHaveAttribute(
    'href',
    /events\?.*edit_item=1/,
  )
  await expect(item(page, 'container', 'triggers')).toHaveCount(0)
  // a table's triggers: the icon exports, the name edits
  await expand(page, 'container', 'tables')
  await expand(page, 'table', 't')
  await expand(page, 'container', 'triggers')
  const trg = item(page, 'trigger', 'trg')
  await expect(trg.getByRole('link', { name: 'trg', exact: true })).toHaveAttribute(
    'href',
    /triggers\?.*edit_item=1/,
  )
  await expect(trg.locator('a').first()).toHaveAttribute('href', /triggers\?.*export_item=1/)
})

test('[p01-e12d1f] hovering a truncated name shows it whole in a floating layer', async ({ page }) => {
  await login(page, USER, USER)
  const row = item(page, 'database', LONG)
  await row.scrollIntoViewIfNeeded()
  await row.getByRole('link', { name: LONG }).hover()
  await expect(page.locator('#full_name_layer')).toHaveText(LONG)
  await page.mouse.move(800, 600)
  await expect(page.locator('#full_name_layer')).toHaveCount(0)
})

test('[p01-34f437] the panel width is stored on drag end and on collapse; re-expanding restores it', async ({
  page,
}) => {
  await login(page, USER, USER)
  const saved: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('/navigation/width') && r.method() === 'POST') saved.push(r.postData() ?? '')
  })
  // drag the resizer: the width is stored when the drag ends
  const box = (await page.locator('#pma_navigation_resizer').boundingBox())!
  await page.mouse.move(box.x + 1, box.y + 100)
  await page.mouse.down()
  await page.mouse.move(box.x + 61, box.y + 100, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => saved.length).toBe(1)
  const dragged = JSON.parse(saved[0] ?? '{}').value as number
  expect(dragged).toBeGreaterThan(240)
  await page.getByTitle('Hide panel').click()
  await expect(nav(page)).toBeHidden()
  await expect.poll(() => saved.at(-1)).toContain('"value":0')
  await page.getByTitle('Show panel').click()
  await expect(nav(page)).toBeVisible()
  await expect.poll(() => saved.length).toBe(3)
  // back to the width before the collapse
  expect(JSON.parse(saved[2] ?? '{}').value).toBe(dragged)
})

test('[p01-81bcd1] below 768px the panel starts hidden', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 })
  await login(page, USER, USER)
  await expect(nav(page)).toBeHidden()
})

test('[p01-425d41] the database filter: live regex on typing, server search on Enter, the clear button restores the list', async ({
  page,
}) => {
  await login(page, USER, USER)
  const filter = nav(page).getByRole('textbox', { name: 'Type to filter these, Enter to search all' }).first()
  const dbs = nav(page).locator('[role=treeitem][data-kind=database]')
  // a regular expression on the loaded items
  await filter.fill('f01nf0[12]')
  await expect(dbs).toHaveCount(2)
  // Enter searches the server (LIKE %text%)
  await filter.fill('f01nf01')
  await filter.press('Enter')
  await expect(dbs).toHaveCount(1)
  await expect(item(page, 'database', 'f01nf01')).toBeVisible()
  await nav(page).getByRole('button', { name: 'Clear fast filter' }).first().click()
  await expect(item(page, 'database', DB)).toBeVisible()
  await expect(filter).toHaveValue('')
})

test('[p01-8e663c] expanded branches come back after a reload; logging out clears them', async ({ page }) => {
  await login(page, USER, USER)
  await expand(page, 'database', DB)
  await expect(item(page, 'container', 'tables')).toBeVisible()
  await page.reload()
  await expect(item(page, 'container', 'tables')).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('navTreePaths'))).not.toBeNull()
  await page.getByRole('button', { name: 'Open user account menu' }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await expect(page.locator('#login_form')).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
})

test('[p01-1123b4] dragging a file over the page shows the drop overlay (enable_drag_drop_import)', async ({
  page,
}) => {
  await login(page, USER, USER)
  await page.goto(`/s/1/db/${DB}/structure`)
  await expect(page.locator('#structure_content, #tablesForm').first()).toBeVisible()
  const file = () =>
    page.evaluateHandle(() => {
      const d = new DataTransfer()
      d.items.add(new File(['SELECT 1;'], 'f01.sql', { type: 'application/sql' }))
      return d
    })
  await page.dispatchEvent('#page_content', 'dragenter', { dataTransfer: await file() })
  await expect(page.locator('.pma_drop_handler')).toHaveText('Drop files here')
  // the server level has no database to import into
  await page.goto('/s/1')
  await expect(page.locator('#maincontainer')).toBeVisible()
  await page.dispatchEvent('#page_content', 'dragenter', { dataTransfer: await file() })
  await expect(page.locator('.pma_drop_handler')).toHaveText('Select database first')
})

test('[p01-173d41] a tree request after the session is gone brings back the login form', async ({
  page,
  context,
}) => {
  await login(page, USER, USER)
  await expect(item(page, 'database', DB)).toBeVisible()
  await context.clearCookies()
  await expand(page, 'database', DB)
  await expect(page.locator('#login_form')).toBeVisible()
})

test('[p01-17b88b] the tree fills the panel when the window is resized; the console takes its own height', async ({
  page,
}) => {
  await login(page, USER, USER)
  const tree = page.locator('#pma_navigation_tree_content')
  const h1 = (await tree.boundingBox())!.height
  await page.setViewportSize({ width: 1400, height: 600 })
  await expect.poll(async () => (await tree.boundingBox())!.height).toBeLessThan(h1)
  // the page keeps a bottom space of the console's height, also when the console opens
  const pad = () =>
    page.locator('#page_scroll').evaluate((e) => Number.parseFloat(getComputedStyle(e).paddingBottom))
  const consoleHeight = () => page.locator('#pma_console').evaluate((e) => (e as HTMLElement).offsetHeight)
  await expect.poll(pad).toBe(await consoleHeight())
  await page.locator('#pma_console .toolbar').getByText('Console', { exact: true }).click()
  await expect.poll(consoleHeight).toBeGreaterThan(60)
  await expect.poll(pad).toBe(await consoleHeight())
})
