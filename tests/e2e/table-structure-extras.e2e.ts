import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Table Structure page details end to end (docs/features/04-table-level.md › Structure list): the
 * bulk buttons' Browse and "No", printing, and the view / system schema variants of the list.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f04_e2e_struct'
const DB = 'f04_e2e_struct'

async function sql(q: string): Promise<void> {
  const c = await mysql.createConnection(ROOT)
  await c.query(q)
  await c.end()
}

async function login(page: Page) {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
}

/** the "With selected:" bar under the column list */
const withSelected = (page: Page) =>
  page.locator('div', { has: page.locator('> label > #fieldsForm_checkall') })

/** the Action header of the column list (not the one of the index list) */
const actionHeader = (page: Page) =>
  page.getByRole('row', { name: /^# Name Type/ }).getByText('Action', { exact: true })

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, a VARCHAR(10), b INT);
    INSERT INTO ${DB}.t VALUES (1, 'x', 5), (2, 'y', 6);
    CREATE VIEW ${DB}.v AS SELECT id, a FROM ${DB}.t;
    CREATE TABLE ${DB}.geo (id INT PRIMARY KEY, g POINT NOT NULL SRID 0, n VARCHAR(5));
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f04\\_e2e\\_struct\`.* TO '${USER}'@'%';`)
})

test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
})

test('bulk Drop: the confirmation shows the multi-DROP statement, "No" answers "No change" [p04-2324e1]', async ({
  page,
}) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/t/structure`)
  await page.getByTestId('structure-row-a').getByRole('checkbox').check()
  await page.getByTestId('structure-row-b').getByRole('checkbox').check()
  await withSelected(page).getByRole('button', { name: 'Drop', exact: true }).click()
  await expect(page.getByTestId('confirm-sql')).toHaveText('ALTER TABLE `t`\n  DROP `a`,\n  DROP `b`;')
  await page.locator('#buttonNo').click()
  await expect(page.getByTestId('message-text').first()).toHaveText('No change')
  await expect(page.getByTestId('structure-row-a')).toBeVisible()
})

test('bulk Browse runs SELECT of the selected columns into the grid [p04-e3d505]', async ({ page }) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/t/structure`)
  await page.getByTestId('structure-row-b').getByRole('checkbox').check()
  await page.getByTestId('structure-row-id').getByRole('checkbox').check()
  await withSelected(page).getByRole('button', { name: 'Browse', exact: true }).click()
  // the columns in table order, like the form's selected_fld[]
  await expect(page.getByText(`SELECT \`id\`, \`b\` FROM \`${DB}\`.\`t\``).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: '6', exact: true })).toBeVisible()
})

test('Distinct values: COUNT(*) per value in the Browse view, each value links back to its rows [p04-a12911 p02-0d4e9a]', async ({
  page,
}) => {
  await sql(`INSERT INTO ${DB}.t VALUES (3, 'x', 7)`)
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/t/structure`)
  const row = page.getByTestId('structure-row-a')
  await row.getByText('More').click()
  await row.getByRole('link', { name: 'Distinct values' }).click()
  await expect(page).toHaveURL(/\/t\/t\/browse\?.*distinct=1/)
  await expect(
    page.getByText('SELECT COUNT(*) AS `Rows`, `a` FROM `t` GROUP BY `a` ORDER BY `a`').first(),
  ).toBeVisible()
  await expect(page.getByRole('cell', { name: '2', exact: true })).toBeVisible()
  // is_browse_distinct: the value is a relation link to the table's rows with that value
  await page.getByRole('link', { name: 'x', exact: true }).click()
  await expect(page.getByText("WHERE `a` = 'x'").first()).toBeVisible()
  await sql(`DELETE FROM ${DB}.t WHERE id = 3`)
})

test('Print shows the table name and hides the controls [p04-e9ef21]', async ({ page }) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/t/structure`)
  const heading = page.getByRole('heading', { level: 1, name: 't', exact: true })
  await expect(heading).toBeHidden()
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(heading).toBeVisible()
  await expect(page.locator('#structure-action-links')).toBeHidden()
  await expect(page.locator('#fieldsForm_checkall')).toBeHidden()
})

test('views and system schemas list their columns without the Action column [p04-46e274]', async ({
  page,
}) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/t/structure`)
  await expect(actionHeader(page)).toBeVisible()
  await page.goto(`/s/1/db/${DB}/t/v/structure`)
  await expect(page.getByTestId('structure-row-a')).toBeVisible()
  await expect(actionHeader(page)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Edit view' })).toBeVisible()
  await page.goto('/s/1/db/information_schema/t/ENGINES/structure')
  await expect(page.getByTestId('structure-row-ENGINE')).toBeVisible()
  await expect(actionHeader(page)).toHaveCount(0)
})

test('index editor: SPATIAL hides the size column and the add-more slider, one column only, no index type [p04-4973ea]', async ({
  page,
}) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/geo/structure`)
  await page.locator('#index_div').getByRole('spinbutton').fill('2')
  await page.locator('#index_div').getByRole('button', { name: 'Go' }).click()
  const dlg = page.getByRole('dialog')
  await expect(
    dlg.getByRole('columnheader', { name: 'Size' }).or(dlg.locator('th', { hasText: 'Size' })),
  ).toHaveCount(1)
  await expect(dlg.getByRole('slider')).toHaveCount(1)
  await dlg.getByRole('button', { name: 'Advanced options' }).click()
  await expect(dlg.locator('#select_index_type')).toBeEnabled()
  await dlg.locator('#select_index_choice').selectOption('SPATIAL')
  await expect(dlg.locator('th', { hasText: 'Size' })).toHaveCount(0)
  await expect(dlg.getByRole('slider')).toHaveCount(0)
  await expect(dlg.locator('#select_index_type')).toBeDisabled()
  await expect(dlg.getByTestId('index-column-1').getByLabel('Column')).toBeDisabled()
  // SPATIAL lists the spatial columns only
  await expect(dlg.getByTestId('index-column-0').getByLabel('Column').locator('option')).toHaveText([
    '-- Ignore --',
    'g [point]',
  ])
  await dlg.locator('#select_index_choice').selectOption('FULLTEXT')
  await expect(dlg.locator('#select_index_type')).toBeDisabled()
})

test('column form: type tooltips, Adjust privileges disabled without the privileges, collation-change warning [p04-488fbc p04-9f1072 p04-928ba0]', async ({
  page,
}) => {
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.dismiss()
  })
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/t/structure`)
  await page.getByTestId('structure-row-a').getByRole('link', { name: 'Change' }).click()
  const row = page.getByTestId('column-row-0')
  const type = row.getByLabel('Type')
  await expect(type.locator('option[value="VARCHAR"]').first()).toHaveAttribute('title', /.+/)
  await expect(type.locator('option[value="VARCHAR"]').first()).toHaveAttribute('data-length-restricted', /^[01]$/)
  // no column privileges / RELOAD for this account (ColumnsDefinition: privs_available)
  const adjust = row.getByLabel('Adjust privileges')
  await expect(adjust).toBeDisabled()
  await expect(adjust).toHaveAttribute('title', /You don't have sufficient privileges/)
  await row.getByLabel('Collation').selectOption('utf8mb4_bin')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => dialogs.at(-1) ?? '').toContain('Garbled Data')
  expect(dialogs.at(-1)).toContain('Are you sure you wish to change the collation and convert the data?')
  // dismissed: nothing ran
  await expect(page).toHaveURL(/\/structure\/change\?/)
})
