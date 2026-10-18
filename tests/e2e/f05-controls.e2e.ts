import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * Template controls that were missing (docs/reference/coverage/controls.md): the GIS editor's
 * OpenStreetMap switch, the routine parameter's ENUM/SET editor, the database search's query box
 * toggle after "Delete", the dropped-database message. Objects carry the e2e server port.
 */
const RUN = process.env.BMA_E2E_PORT ?? '8099'
const DB = `f05c_e2e${RUN}`
const DROP = `f05c_drop${RUN}`

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.g (id INT PRIMARY KEY, shape GEOMETRY);
    CREATE TABLE ${DB}.a (id INT PRIMARY KEY, txt VARCHAR(20));
    INSERT INTO ${DB}.a VALUES (1, 'needle'), (2, 'hay');`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DROP}`)
  await c.end()
})

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('GIS editor: "Use OpenStreetMaps as Base Layer" switches the preview to the map; off for SRID 0', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/t/g/insert`)
  await page.getByRole('button', { name: 'Edit/Insert' }).first().click()
  const gis = page.locator('#gisEditorModal')
  await expect(gis).toBeVisible()
  const sw = gis.locator('#useOsmAsBaseLayerSwitch')
  await expect(gis.locator('#useOsmAsBaseLayerSwitchLabel')).toContainText('Use OpenStreetMaps as Base Layer')
  await expect(sw).not.toBeChecked()
  await expect(gis.locator('#visualization-placeholder svg.visualization-target-svg')).toBeVisible()
  await sw.check()
  await expect(gis.locator('#visualization-placeholder .visualization-target-ol')).toBeVisible()
  await expect(gis.locator('#visualization-placeholder svg.visualization-target-svg')).toHaveCount(0)
  await sw.uncheck()
  await expect(gis.locator('#visualization-placeholder svg.visualization-target-svg')).toBeVisible()
  // the dialog's corner button closes it
  await gis.getByRole('button', { name: 'Close' }).click()
  await expect(gis).toBeHidden()
})

test('routine parameter: the ENUM/SET editor link shows for ENUM and SET and fills the values', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/routines`)
  await page.getByRole('button', { name: 'Create new routine' }).click()
  const dlg = page.locator('#routinesEditorModal')
  const row = dlg.getByTestId('routine-param-0')
  await dlg.locator('input[name="item_param_name[0]"]').fill('mode')
  await expect(row.locator('.enum_hint')).toHaveCount(0)
  await dlg.locator('select[name="item_param_type[0]"]').selectOption('ENUM')
  await row.locator('.enum_hint .open_enum_editor').click()
  const editor = page.locator('#enum_editor')
  await expect(editor).toContainText('Values for column "mode"')
  const inputs = editor.locator('input.input')
  await inputs.nth(0).fill('on')
  await inputs.nth(1).fill("it's")
  await page.locator('#enumEditorGoButton').click()
  await expect(dlg.locator('input[name="item_param_length[0]"]')).toHaveValue("'on','it''s'")
})

test('database search: after "Delete" the result shows in the query box with "Hide query box" / "Show query box"', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/search`)
  await expect(page.locator('#togglequerybox')).toHaveCount(0)
  await page.locator('#criteriaSearchString').fill('needle')
  await page.locator('#buttonGo').click()
  await page.locator('#searchresults .delete_results').first().click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'OK' }).click()
  const toggle = page.locator('#togglequerybox')
  await expect(toggle).toHaveText('Hide query box')
  await expect(page.locator('#sqlqueryform')).toContainText('DELETE')
  await toggle.click()
  await expect(toggle).toHaveText('Show query box')
  await expect(page.locator('#sqlqueryform')).not.toContainText('DELETE')
  await toggle.click()
  await expect(page.locator('#sqlqueryform')).toContainText('DELETE')
})

test('Operations: dropping the database shows "Database `x` has been dropped." on the databases list', async ({
  page,
}) => {
  const c = await mysql.createConnection(MYSQL)
  await c.query(`CREATE DATABASE IF NOT EXISTS ${DROP}`)
  await c.end()
  await page.goto(`/s/1/db/${DROP}/operations`)
  await page.locator('#drop_db_anchor').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'OK' }).click()
  await expect(page).toHaveURL(/\/s\/1\/databases/)
  await expect(page.getByText(`Database \`${DROP}\` has been dropped.`)).toBeVisible()
})

test('Import and Export: the Kanji conversion form only in the Japanese locale', async ({ page }) => {
  for (const path of [`/s/1/db/${DB}/import`, `/s/1/db/${DB}/export`]) {
    await page.goto(path)
    await expect(page.locator('#buttonGo')).toBeVisible()
    await expect(page.locator('#kanji_encoding')).toHaveCount(0)
  }
  // every response writes the language cookie: leave the app first
  await page.goto('about:blank')
  await page.goto('/api/i18n?lang=ja')
  try {
    for (const path of [`/s/1/db/${DB}/import`, `/s/1/db/${DB}/export`]) {
      await page.goto(path)
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja', { timeout: 15000 })
      const kanji = page.locator('#kanji_encoding')
      await expect(kanji.locator('input[name="knjenc"]')).toHaveCount(3)
      await expect(kanji.locator('#kj-none')).toBeChecked()
      await expect(kanji.locator('#kj-kana')).toHaveAttribute('name', 'xkana')
    }
  } finally {
    await page.goto('about:blank')
    await page.goto('/api/i18n?lang=en')
  }
})
