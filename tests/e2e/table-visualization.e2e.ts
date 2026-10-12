import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * The query results' operations end to end: Display chart (the chart is drawn, the type and
 * series options react), Visualize GIS data (the SVG shapes, the label tooltip) and the Create
 * view dialog (the view exists afterwards, Edit view reopens it).
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f04vis_e2e'
const DB = 'f04vis_e2e'

async function sql<T = unknown>(q: string): Promise<T> {
  const c = await mysql.createConnection(ROOT)
  const [rows] = await c.query(q)
  await c.end()
  return rows as T
}

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, name VARCHAR(10), qty INT, g POINT);
    INSERT INTO ${DB}.t VALUES (1, 'a', 3, ST_GeomFromText('POINT(1 2)')), (2, 'b', 5, ST_GeomFromText('POINT(4 6)'));
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f04vis\\_e2e\`.* TO '${USER}'@'%';`)
})

test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
})

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
  await page.goto(`/s/1/db/${DB}/t/t/browse`)
  await expect(page.locator('table.table_results')).toBeVisible()
})

test('Display chart', async ({ page }) => {
  await page.getByRole('link', { name: 'Display chart' }).click()
  await expect(page.getByRole('heading', { name: 'Display chart' })).toBeVisible()
  // the chart is drawn: the save link carries the canvas image
  await expect(page.locator('#saveChart')).toHaveAttribute('href', /^data:image\/png/)
  await expect(page.locator('#xAxisLabelInput')).toHaveValue('id')
  // qty is the only series but id: one series → Pie is offered and the Y label follows
  await expect(page.locator('#yAxisLabelInput')).toHaveValue('qty')
  await expect(page.locator('#pieChartTypeRadio')).toBeVisible()
  await page.locator('#chartSeriesSelect').selectOption(['0', '2'])
  await expect(page.locator('#pieChartTypeRadio')).toHaveCount(0)
  await expect(page.locator('#yAxisLabelInput')).toHaveValue('Y Values')
  await page.locator('#barChartTypeRadio').check()
  await expect(page.locator('#barStackedCheckbox')).toBeVisible()
})

test('Visualize GIS data', async ({ page }) => {
  await page.getByRole('link', { name: 'Visualize GIS data' }).click()
  await expect(page.getByRole('heading', { name: 'Display GIS Visualization' })).toBeVisible()
  await expect(page.locator('#visualization-placeholder circle.point')).toHaveCount(2)
  await page.locator('#labelColumn').selectOption('name')
  await expect(page.locator('circle[data-label="a"]')).toHaveCount(1)
  await page.locator('circle[data-label="b"]').hover()
  await expect(page.locator('#tooltip')).toHaveText('b')
  // the OpenStreetMaps view (OpenLayers loaded on demand; the tiles may not load offline)
  await page.locator('#useOsmAsBaseLayerSwitch').check()
  await expect(page.locator('.visualization-target-ol .ol-viewport')).toBeVisible()
  await expect(page.locator('.visualization-target-ol .ol-mouse-position')).toHaveCount(1)
  await expect(page.locator('.visualization-target-svg')).toBeHidden()
  await page.locator('#useOsmAsBaseLayerSwitch').uncheck()
  await expect(page.locator('.visualization-target-svg')).toBeVisible()
})

test('Create view from the results, then Edit view', async ({ page }) => {
  await page.getByRole('button', { name: 'Create view' }).click()
  const dialog = page.locator('#createViewModal')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('VIEW name').fill('v_t')
  await dialog.locator('#createViewModalGoButton').click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.result_query').last()).toContainText('VIEW `v_t`')
  await expect
    .poll(async () => (await sql<unknown[]>(`SHOW FULL TABLES FROM ${DB} WHERE Table_type = 'VIEW'`)).length)
    .toBe(1)
  await page.goto(`/s/1/db/${DB}/t/v_t/structure`)
  await page.getByRole('link', { name: 'Edit view' }).click()
  await expect(page.getByText('Edit view').first()).toBeVisible()
  await page.locator('select[name="view[algorithm]"]').selectOption('MERGE')
  await page.getByRole('button', { name: 'Go' }).click()
  await expect(page).toHaveURL(/\/t\/v_t\/structure/)
  await expect(page.getByText('Your SQL query has been executed successfully.')).toBeVisible()
  await expect(page.locator('code', { hasText: 'ALTER ALGORITHM = MERGE' })).toBeVisible()
})

test('Display chart of a server-level result (no database)', async ({ page }) => {
  await page.goto('/s/1/sql')
  await page.locator('#sqlquery .cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText('SELECT 1 AS a, 2 AS b UNION SELECT 3, 5')
  await page.locator('#button_submit_query').click()
  await page.getByRole('link', { name: 'Display chart' }).click()
  await expect(page).toHaveURL(/\/s\/1\/chart\?/)
  await expect(page.locator('#saveChart')).toHaveAttribute('href', /^data:image\/png/)
  await expect(page.locator('#xAxisLabelInput')).toHaveValue('a')
})
