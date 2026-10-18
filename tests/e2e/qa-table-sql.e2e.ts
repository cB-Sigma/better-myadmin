import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL } from './fixtures.ts'

/**
 * Differences found by exploratory QA against phpMyAdmin (SQL editor, console, table level), each
 * pinned here: what phpMyAdmin does that the checklists did not cover. Objects prefixed m1qae_.
 */
const USER = 'm1qae_user'
const DB = 'm1qae_db'

async function sql(q: string): Promise<unknown[]> {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  try {
    return (await c.query(q))[0] as unknown[]
  } finally {
    await c.end()
  }
}

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB} CHARACTER SET utf8mb4; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY, \`名前\` VARCHAR(20));
    CREATE TABLE \`select\` (\`from\` INT PRIMARY KEY);
    CREATE TABLE parted (id INT PRIMARY KEY) PARTITION BY RANGE (id) (PARTITION p0 VALUES LESS THAN (10), PARTITION p1 VALUES LESS THAN (100));
    INSERT INTO parted VALUES (1), (50);
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`m1qae\\_db\`.* TO '${USER}'@'%';`)
})

test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
})

async function login(page: Page) {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
}

async function typeSql(page: Page, text: string) {
  await page.locator('#queryfieldscontainer .cm-content, .cm-content').first().click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(text)
}

const consoleInput = (page: Page) => page.locator('.console_query_input .cm-content')
async function openConsole(page: Page) {
  await expect(page.locator('.console_switch')).toBeVisible()
  await page.waitForTimeout(300)
  if (!(await consoleInput(page).isVisible())) await page.locator('.console_switch').click()
  await expect(consoleInput(page)).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('SQL tab: a failed batch shows the error and keeps the query box open (sql.ts success false)', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/sql`)
  await typeSql(page, 'SELECT 1;\nSELECT * FROM nope;\nSELECT 2;')
  await page.locator('#button_submit_query').click()
  await expect(page.getByRole('alert').filter({ hasText: "doesn't exist" })).toBeVisible()
  await expect(page.locator('#button_submit_query')).toBeVisible()
  await expect(page.locator('#togglequerybox')).toHaveCount(0)
  // a successful run still collapses the box behind "Show query box"
  await typeSql(page, 'SELECT 1')
  await page.locator('#button_submit_query').click()
  await expect(page.locator('#togglequerybox')).toHaveText('Show query box')
  await expect(page.locator('#button_submit_query')).toHaveCount(0)
})

test('console: a failed query shows its error over the page, which stays (ajax.ts responseHandler)', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/structure`)
  await expect(page.getByTestId('db-structure-row-t')).toBeVisible()
  await openConsole(page)
  await consoleInput(page).click()
  await page.keyboard.insertText('SELECT 1; SELECT * FROM nope')
  await page.keyboard.press('Control+Enter')
  await expect(page.getByText("#1146 - Table 'm1qae_db.nope' doesn't exist")).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/db/${DB}/structure`))
  await expect(page.getByTestId('db-structure-row-t')).toBeVisible()
  await expect(page.getByTestId('console-messages').locator('.message[data-state="failed"]')).toHaveCount(1, {
    timeout: 15_000,
  })
})

test('console: a query typed on a table page runs without that table (Console.execute)', async ({ page }) => {
  await page.goto(`/s/1/db/${DB}/t/t/structure`)
  await openConsole(page)
  await consoleInput(page).click()
  await page.keyboard.insertText('SELECT 1')
  await page.keyboard.press('Control+Enter')
  // the response has no table: the database's SQL tab shows the result
  await expect(page).toHaveURL(new RegExp(`/db/${DB}/sql`))
  await expect(page).not.toHaveURL(/\/t\/t\//)
  await expect(page.getByText('Showing rows 0 - 0 (1 total')).toBeVisible()
})

test('operations: a rename shows its message on the renamed table', async ({ page }) => {
  await sql(`CREATE TABLE ${DB}.ren (x INT)`)
  await page.goto(`/s/1/db/${DB}/t/ren/operations`)
  const name = page.locator('#tableOptionsForm input[name="new_name"]')
  await name.fill('ordér by')
  await name.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/t/${encodeURIComponent('ordér by')}/operations`))
  await expect(page.getByText('Table ren has been renamed to ordér by.')).toBeVisible()
  await sql(`DROP TABLE ${DB}.\`ordér by\``)
})

test('structure: the row actions and the partition actions confirm in the Confirm modal', async ({
  page,
}) => {
  let native = 0
  page.on('dialog', (d) => {
    native++
    void d.dismiss()
  })
  await page.goto(`/s/1/db/${DB}/t/t/structure`)
  await page.getByTestId('structure-row-名前').getByRole('button', { name: 'Drop' }).click()
  const ask = page.getByRole('alertdialog')
  await expect(ask).toContainText('Do you really want to execute "ALTER TABLE `t` DROP `名前`;"?')
  await ask.getByRole('button', { name: 'Close' }).last().click()
  await expect(page.getByTestId('structure-row-名前')).toBeVisible()

  await page.goto(`/s/1/db/${DB}/t/parted/structure`)
  const truncate = page.locator('#partition_action_TRUNCATE').first()
  if (!(await truncate.isVisible())) await page.getByText('Partitions', { exact: true }).first().click()
  await truncate.click()
  await expect(ask).toContainText('Do you really want to TRUNCATE the selected partition(s)?')
  await ask.getByRole('button', { name: 'OK' }).click()
  await expect(page.getByText('Your SQL query has been executed successfully.')).toBeVisible()
  expect(await sql(`SELECT id FROM ${DB}.parted`)).toEqual([{ id: 50 }])
  expect(native).toBe(0)
})

test('structure: partition maintenance shows the operation heading and title-cased badges', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/t/parted/structure`)
  const analyze = page.locator('#partition_action_ANALYZE').first()
  if (!(await analyze.isVisible())) await page.getByText('Partitions', { exact: true }).first().click()
  await analyze.click()
  const result = page.getByTestId('partition-maintenance')
  await expect(result.getByRole('heading', { name: 'Analyze partition' })).toBeVisible()
  await expect(result).toContainText(`${DB}.parted (p0)`)
  // templates/table/partition/analyze.twig: row.Msg_type|title
  await expect(result.getByText('Status', { exact: true })).toBeVisible()
})

test('tracking: "Tracking of … is activated." reflects the state before the action', async ({ page }) => {
  // the e2e server has no configuration storage: the tracking API is played by the page routes
  let versions = 0
  const page_ = () => ({
    db: DB,
    table: 'select',
    type: 'table',
    available: true,
    activeMessage: versions > 0,
    trackedTables: versions > 0 ? [{ name: 'select', active: true }] : [],
    lastVersion: versions,
    versions: Array.from({ length: versions }, (_, i) => ({
      version: String(versions - i),
      dateCreated: '2026-01-01 00:00:00',
      dateUpdated: '2026-01-01 00:00:00',
      active: true,
    })),
    defaultStatements: 'CREATE TABLE,ALTER TABLE,INSERT',
  })
  await page.route('**/tables/select/tracking', (r) => r.fulfill({ json: page_() }))
  await page.route('**/tables/select/tracking/versions', (r) => {
    versions++
    return r.fulfill({
      json: {
        messages: [
          { type: 'success', text: `Version ${versions} was created, tracking for ${DB}.select is active.` },
        ],
      },
    })
  })
  await page.goto(`/s/1/db/${DB}/t/select/tracking`)
  await page.getByRole('button', { name: 'Create version' }).click()
  await expect(page.getByText(`Version 1 was created, tracking for ${DB}.select is active.`)).toBeVisible()
  // TrackingController reads the tracked tables before it creates the version
  await expect(page.getByText(`Tracking of ${DB}.select is activated.`)).toHaveCount(0)
  await page.getByRole('button', { name: 'Create version' }).click()
  await expect(page.getByText(`Version 2 was created, tracking for ${DB}.select is active.`)).toBeVisible()
  await expect(page.getByText(`Tracking of ${DB}.select is activated.`)).toBeVisible()
})

test('the routine, event and trigger editors have one "Details" legend', async ({ page }) => {
  for (const [path, open, modal] of [
    ['routines', 'Create new routine', '#routinesEditorModal'],
    ['events', 'Create new event', '#eventsEditorModal'],
    ['triggers', 'Create new trigger', '#triggersEditorModal'],
  ] as const) {
    await page.goto(`/s/1/db/${DB}/${path}`)
    await page.getByRole('button', { name: open }).click()
    await expect(page.locator(`${modal} [name="item_name"]`)).toBeVisible()
    // one card headed "Details" (its doc link's icon is an SVG whose <title> is part of the text)
    await expect(page.locator(modal).locator('header').filter({ hasText: /^Details\b/ })).toHaveCount(1)
    await page.locator(modal).getByRole('button', { name: 'Close' }).last().click()
  }
})

test('a failed trigger save shows the error in the floating message; the editor stays (triggers.ts)', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/t/t/triggers`)
  await page.getByRole('button', { name: 'Create new trigger' }).click()
  const modal = page.locator('#triggersEditorModal')
  await modal.locator('[name="item_name"]').fill('trg bad')
  await modal.locator('.cm-content, textarea[name="item_definition"]').first().click()
  await page.keyboard.insertText('SET NEW.nope = 1')
  await modal.getByRole('button', { name: 'Save changes' }).click()
  const error = page.locator('.ajax_notification', { hasText: 'The following query has failed' })
  await expect(error).toBeVisible()
  await expect(modal.getByText('The following query has failed')).toHaveCount(0)
  await expect(modal.locator('[name="item_name"]')).toHaveValue('trg bad')
})

test('index dialogs: a refused rename shows its error in the floating message (indexRenameDialog)', async ({
  page,
}) => {
  await sql(`ALTER TABLE ${DB}.t ADD KEY k (\`名前\`)`)
  await page.goto(`/s/1/db/${DB}/t/t/structure`)
  await page.getByTestId('index-k').getByRole('button', { name: 'Rename' }).click()
  const modal = page.locator('#indexDialogModal')
  await modal.locator('#input_index_name').fill('PRIMARY')
  await modal.getByRole('button', { name: 'Go' }).click()
  await expect(
    page.locator('.ajax_notification', { hasText: "Can't rename index to PRIMARY!" }),
  ).toBeVisible()
  await expect(modal.getByText("Can't rename index to PRIMARY!")).toHaveCount(0)
  await expect(modal.locator('#input_index_name')).toBeVisible()
})
