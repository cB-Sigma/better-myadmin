import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL } from './fixtures.ts'

/**
 * The last phpMyAdmin controls the client was missing: the legacy database select of the
 * navigation panel (ShowDatabasesNavigationAsTree off), the inline column actions
 * (HideStructureActions off), the FEDERATED Connection field, drag-sorted index columns, the bulk
 * trigger export / drop and the Insert page settings. The user and its preferences (the e2e
 * server's local metadata store) are this file's own; everything is prefixed m1gap_.
 */
const USER = 'm1gap_e2e'
const DB = 'm1gap_e2e'
const DB2 = 'm1gap_e2e_two'

async function sql(q: string): Promise<unknown[]> {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  try {
    return (await c.query(q))[0] as unknown[]
  } finally {
    await c.end()
  }
}

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB2};
    CREATE DATABASE ${DB}; CREATE DATABASE ${DB2}; USE ${DB};
    CREATE TABLE a (id INT PRIMARY KEY, v VARCHAR(20), w INT, tx TEXT);
    CREATE TABLE b (x INT);
    CREATE TRIGGER tr_one BEFORE INSERT ON a FOR EACH ROW SET NEW.w = 1;
    CREATE TRIGGER tr_two BEFORE UPDATE ON a FOR EACH ROW SET NEW.w = 2;
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`m1gap\\_e2e%\`.* TO '${USER}'@'%';`)
})

test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB2}; DROP USER IF EXISTS '${USER}'@'%'`)
})

async function login(page: Page) {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
}

/** Saves one checkbox of a Settings tab (the user's own preferences). */
async function setPref(page: Page, tab: string, group: string, name: string, on: boolean) {
  await page.goto(`/s/1/preferences/${tab}`)
  await page.locator(`#${group}-tab`).click()
  const box = page.locator(`#${name}`)
  await box.setChecked(on)
  await page.locator(`#${group} input[name=submit_save]`).click()
  await expect(page.getByText('Configuration has been saved.')).toBeVisible()
}

test.describe.serial('legacy database select', () => {
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await login(page)
    await setPref(page, 'navigation', 'Navi_panel', 'ShowDatabasesNavigationAsTree', true)
    await page.close()
  })

  test('ShowDatabasesNavigationAsTree off: #navi_db_select picks the database whose tree shows', async ({
    page,
  }) => {
    await login(page)
    await setPref(page, 'navigation', 'Navi_panel', 'ShowDatabasesNavigationAsTree', false)
    await page.goto('/s/1')
    const nav = page.locator('#pma_navigation')
    const content = page.locator('#pma_navigation_tree_content')
    // no database: the list of databases without expanders, the select hidden, no tree controls
    await expect(content.locator(`[data-kind="database"][data-name="${DB}"]`)).toBeVisible()
    await expect(content.getByRole('button', { name: 'Expand/Collapse' })).toHaveCount(0)
    await expect(nav.locator('#navi_db_select')).toBeHidden()
    await expect(nav.locator('#navigation_controls')).toHaveCount(0)
    await expect(nav.locator('#pma_navigation_collapse')).toHaveCount(0)

    // a database: the select shows it, the tree holds its children only
    await content.locator(`[data-name="${DB}"]`).getByRole('link', { name: DB, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/db/${DB}/structure`))
    const select = nav.locator('#navi_db_select')
    await expect(select).toBeVisible()
    await expect(select).toHaveValue(DB)
    await expect(select.locator('option')).toContainText([DB, DB2])
    await expect(select.locator(`option[value="${DB}"]`)).toHaveAttribute('title', 'Structure')
    await expect(content.locator('[data-kind="table"][data-name="a"]')).toBeVisible()
    await expect(content.locator('[data-kind="table"][data-name="b"]')).toBeVisible()
    await expect(content.locator(`[data-kind="database"]`)).toHaveCount(0)

    // change: the chosen database's default tab, and its (empty) tree
    await select.selectOption(DB2)
    await expect(page).toHaveURL(new RegExp(`/db/${DB2}/structure`))
    await expect(select).toHaveValue(DB2)
    await expect(content.locator('[data-kind="table"]')).toHaveCount(0)

    // back to the server: the select hides and the databases list returns
    await page.goto('/s/1')
    await expect(select).toBeHidden()
    await expect(content.locator(`[data-kind="database"][data-name="${DB2}"]`)).toBeVisible()
  })
})

test.describe.serial('inline structure actions', () => {
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await login(page)
    await setPref(page, 'main-panel', 'TableStructure', 'HideStructureActions', true)
    await page.close()
  })

  test('HideStructureActions: "More" dropdown when on, inline nav when off [p04-4ff34f]', async ({ page }) => {
    await login(page)
    await page.goto(`/s/1/db/${DB}/t/a/structure`)
    const row = page.getByTestId('structure-row-v')
    await expect(row.locator('#moreActionsButton')).toBeVisible()
    await expect(row.getByRole('button', { name: 'Unique', exact: true })).toBeHidden()

    await setPref(page, 'main-panel', 'TableStructure', 'HideStructureActions', false)
    await page.goto(`/s/1/db/${DB}/t/a/structure`)
    await expect(row.locator('#moreActionsButton')).toHaveCount(0)
    await expect(row.locator('ul.nav > li.nav-item')).toHaveCount(5)
    await expect(row.getByRole('button', { name: 'Unique', exact: true })).toBeVisible()
    // a TEXT column cannot be PRIMARY / UNIQUE / INDEX: the bd_* (disabled) icons
    const text = page.getByTestId('structure-row-tx')
    await expect(text.locator('[aria-disabled="true"]', { hasText: 'Unique' })).toBeVisible()
    await expect(text.locator('[data-icon="ic_bd_unique"]')).toHaveCount(1)
  })
})

test('the Connection field shows for FEDERATED only [p04-c48bc1]', async ({ page }) => {
  // MySQL ships FEDERATED disabled: offer it in the engine list of the form
  await page.route('**/create-table/form', async (route) => {
    const r = await route.fetch()
    const body = (await r.json()) as { options: { engines: Array<Record<string, unknown>> } }
    body.options.engines.push({ name: 'FEDERATED', comment: 'Federated MySQL storage engine', isDefault: false })
    await route.fulfill({ response: r, json: body })
  })
  await login(page)
  await page.goto(`/s/1/db/${DB}/create-table`)
  const engine = page.getByLabel('Storage engine')
  await expect(page.locator('#storage-engine-connection')).toHaveCount(0)
  await expect(page.locator('input[name="connection"]')).toHaveCount(0)
  await engine.selectOption('FEDERATED')
  await expect(page.locator('#storage-engine-connection')).toContainText('Connection:')
  await expect(page.locator('input[name="connection"]')).toBeVisible()
  await engine.selectOption('InnoDB')
  await expect(page.locator('input[name="connection"]')).toHaveCount(0)
})

test('index columns sort by dragging; the slider adds 1..16 columns [p04-e4af55]', async ({ page }) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/a/structure`)
  await page.locator('#index_div').getByRole('spinbutton').fill('2')
  await page.locator('#index_div').getByRole('button', { name: 'Go' }).click()
  const dlg = page.getByRole('dialog')
  const col = (i: number) => dlg.getByTestId(`index-column-${i}`).getByLabel('Column')
  await col(0).selectOption('v')
  await col(1).selectOption('w')
  // phpMyAdmin has the drag handle only (jQuery sortable), no up / down buttons
  await expect(dlg.getByTestId('index-column-0').locator('button')).toHaveCount(0)
  await dlg.getByTestId('index-column-1').locator('.drag_icon').dragTo(dlg.getByTestId('index-column-0'))
  await expect(col(0)).toHaveValue('w')
  await expect(col(1)).toHaveValue('v')

  const slider = dlg.locator('.add_more input[type="range"]')
  await expect(slider).toHaveAttribute('min', '1')
  await expect(slider).toHaveAttribute('max', '16')
  await expect(dlg.locator('#add_fields')).toBeHidden()
  await slider.fill('3')
  await expect(dlg.locator('#add_fields')).toHaveText('Add 3 column(s) to index')
  await dlg.locator('#add_fields').click()
  await expect(dlg.locator('[data-testid^="index-column-"]')).toHaveCount(5)
})

test('bulk trigger export concatenates; bulk drop confirms once [p04-f581ea]', async ({ page }) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/a/triggers`)
  await expect(page.getByText('tr_one', { exact: true })).toBeVisible()
  await page.locator('#checkAllCheckbox').click()
  await page.locator('#bulkActionExportButton').click()
  const dlg = page.getByRole('dialog', { name: 'Export' })
  const text = await dlg.locator('textarea').inputValue()
  expect(text.startsWith('\nCREATE TRIGGER')).toBe(true)
  expect(text.match(/\nCREATE TRIGGER/g)?.length).toBe(2)
  expect(text).toContain('`tr_one`')
  expect(text).toContain('`tr_two`')
  await dlg.getByRole('button', { name: 'Close' }).last().click()

  await page.locator('#bulkActionDropButton').click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Do you really want to delete the selected items?')
  await confirm.getByRole('button', { name: 'OK' }).click()
  await expect(page.getByText('tr_one', { exact: true })).toHaveCount(0)
  await expect(page.getByText('tr_two', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(await sql(`SHOW TRIGGERS FROM ${DB}`)).toHaveLength(0)
})

test('the Insert page settings gear has the Edit and Text fields groups [p03-4b85ec]', async ({ page }) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/a/insert`)
  await page.locator('#page_settings_icon button').click()
  const modal = page.locator('#pageSettingsModal')
  await expect(modal.getByText('Page-related settings')).toBeVisible()
  await expect(modal.locator('#Edit-tab')).toBeVisible()
  await expect(modal.locator('#Text_fields-tab')).toBeVisible()
  await expect(modal.locator('#ProtectBinary')).toHaveCount(1)
  await modal.locator('#Text_fields-tab').click()
  await expect(modal.locator('#CharEditing')).toBeVisible()
})
