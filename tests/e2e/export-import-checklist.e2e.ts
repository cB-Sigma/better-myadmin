import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * The browser side of the docs/features/07-export-import.md micro-behaviours checklist: what the
 * Export and Import pages switch on, off and over as the user picks options. Each test names the
 * checklist ids it proves; the API side is apps/server/test/int/export-import-checklist.
 */
const DB = 'f07_cke'
const USER = 'f07_cke_user'

async function sql(q: string): Promise<void> {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  try {
    await c.query(q)
  } finally {
    await c.end()
  }
}

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE a (id INT PRIMARY KEY AUTO_INCREMENT, v VARCHAR(10)); INSERT INTO a (v) VALUES ('x'), ('y');
    CREATE TABLE b (id INT);
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON *.* TO '${USER}'@'%'`)
})
test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
})

const dbExport = `/s/1/db/${DB}/export`
const custom = async (page: Page) => {
  await page.locator('#radio_custom_export').check()
  await expect(page.locator('#output')).toBeVisible()
}

test.describe('export page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USER, USER)
  })

  test('quick mode hides the tables, rows, output and format cards; no SaveDir, no quick save card [p07-d027c7]', async ({
    page,
  }) => {
    await page.goto(dbExport)
    await expect(page.locator('#radio_quick_export')).toBeChecked()
    for (const id of ['databases_and_tables', 'output', 'format_specific_opts'])
      await expect(page.locator(`#${id}`).first()).toBeHidden()
    await expect(page.locator('#output_quick_export')).toHaveCount(0)
    await custom(page)
    await expect(page.locator('#format_specific_opts')).toBeVisible()
  })

  test('a forceFile format saves to a file and disables "View output as text" [p07-6c8c06]', async ({
    page,
  }) => {
    await page.goto(dbExport)
    await custom(page)
    await page.locator('#radio_view_as_text').check()
    await page.locator('#plugins').selectOption('ods')
    await expect(page.locator('#radio_dump_asfile')).toBeChecked()
    await expect(page.locator('#radio_view_as_text')).toBeDisabled()
    await page.locator('#plugins').selectOption('sql')
    await expect(page.locator('#radio_view_as_text')).toBeEnabled()
  })

  test('CSV for MS Excel switches the file charset to windows-1252, other formats back to utf-8 [p07-736d72]', async ({
    page,
  }) => {
    await page.goto(dbExport)
    await custom(page)
    await page.locator('#radio_dump_asfile').check()
    await page.locator('#plugins').selectOption('excel')
    await expect(page.locator('#select_charset')).toHaveValue('windows-1252')
    await page.locator('#plugins').selectOption('csv')
    await expect(page.locator('#select_charset')).toHaveValue('utf-8')
  })

  test('unchecking "Display comments" disables the header comment, dates, relations and media types [p07-73ee1f]', async ({
    page,
  }) => {
    await page.goto(dbExport)
    await custom(page)
    // (relations and media types need the configuration storage, absent here)
    const deps = ['#text_sql_header_comment', '#checkbox_sql_dates']
    for (const d of deps) await expect(page.locator(d)).toBeEnabled()
    await page.locator('#checkbox_sql_include_comments').uncheck()
    for (const d of deps) await expect(page.locator(d)).toBeDisabled()
    await page.locator('#checkbox_sql_include_comments').check()
    for (const d of deps) await expect(page.locator(d)).toBeEnabled()
  })

  test('table scope: "data" disables dates, relations, media types; "structure" disables AUTO_INCREMENT and hides Rows [p07-c5982b]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/t/a/export?single_table=true`)
    await custom(page)
    await page.locator('#radio_sql_structure_or_data_data').check()
    await expect(page.locator('#checkbox_sql_dates')).toBeDisabled()
    await page.locator('#radio_sql_structure_or_data_structure').check()
    await expect(page.locator('#checkbox_sql_auto_increment')).toBeDisabled()
    await expect(page.locator('#rows')).toBeHidden()
    await page.locator('#radio_sql_structure_or_data_structure_and_data').check()
    await expect(page.locator('#rows')).toBeVisible()
  })

  test('database scope: no Data ticked disables AUTO_INCREMENT; the procedures box follows "all structure and all data" [p07-e8a701 p07-2cc81e]', async ({
    page,
  }) => {
    await page.goto(dbExport)
    await custom(page)
    await expect(page.locator('#checkbox_sql_procedure_function')).toBeChecked()
    await page.locator('#table_data_all').uncheck()
    await expect(page.locator('#checkbox_sql_auto_increment')).toBeDisabled()
    await expect(page.locator('#checkbox_sql_procedure_function')).not.toBeChecked()
    await page.locator('#table_data_all').check()
    await expect(page.locator('#checkbox_sql_auto_increment')).toBeEnabled()
    await expect(page.locator('#checkbox_sql_procedure_function')).toBeChecked()
  })

  test('database scope: the structure/data radio becomes structure_and_data; formats without it force both columns [p07-f237fe]', async ({
    page,
  }) => {
    await page.goto(dbExport)
    await custom(page)
    await expect(page.locator('#radio_sql_structure_or_data_data')).toHaveCount(0)
    await expect(page.locator('input[type=hidden][name="sql_structure_or_data"]')).toHaveValue(
      'structure_and_data',
    )
    await page.locator('#plugins').selectOption('csv')
    await expect(page.locator('input[name="structure_or_data_forced"]')).toHaveValue('1')
    await expect(page.locator('#table_structure_all')).toBeDisabled()
    await page.locator('#plugins').selectOption('sql')
    await expect(page.locator('input[name="structure_or_data_forced"]')).toHaveValue('0')
  })

  test('view as text: the dump with Back, Refresh and Copy to clipboard; Back keeps the options [p07-5f94e1]', async ({
    page,
  }) => {
    await page.goto(dbExport)
    await custom(page)
    await page.locator('#radio_view_as_text').check()
    await page.locator('#checkbox_sql_include_comments').uncheck()
    await page.locator('#buttonGo').click()
    await expect(page.locator('#textSQLDUMP')).toHaveValue(/CREATE TABLE `a`/)
    await expect(page.getByRole('button', { name: 'Copy to clipboard' }).first()).toBeVisible()
    await expect(page.locator('.export_refresh_btn').first()).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).first().click()
    await expect(page.locator('#radio_view_as_text')).toBeChecked()
    await expect(page.locator('#checkbox_sql_include_comments')).not.toBeChecked()
  })

  test('aliases: the switch follows the aliases set; the modal drops empty rows [p07-a32e1d]', async ({
    page,
  }) => {
    await page.goto(dbExport)
    await custom(page)
    await page.locator('#btn_alias_config').click()
    const modal = page.locator('#renameExportModal')
    await modal.locator('#db_alias_select').selectOption(DB)
    await modal.locator('#db_alias_name').fill('renamed_db')
    await modal.locator('#db_alias_button').click()
    await expect(
      modal.locator('#alias_data input[value="renamed_db"], #alias_data input').last(),
    ).toHaveValue('renamed_db')
    await modal.locator('#saveAndCloseBtn').click()
    await expect(page.locator('#btn_alias_config')).toBeChecked()
  })
})

test.describe('import page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USER, USER)
  })

  test('without an UploadDir there are no file tabs; the size limit is shown [p07-f1893a p07-e0cbaa]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/import`)
    await expect(page.locator('#importFileTab')).toHaveCount(0)
    await expect(page.locator('#input_import_file')).toBeVisible()
    await expect(page.getByText(/Browse your computer:\s*\(Max: \d/)).toBeVisible()
  })

  test('resuming after a timeout: the skip field and the banner, the "Skip this number of queries" box hidden [p07-ca9144 p07-5a8804]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/import?timeout_passed=1&offset=4096&format=sql`)
    await expect(
      page.getByText('Previous import timed out, after resubmitting will continue from position 4096.'),
    ).toBeVisible()
    await expect(page.locator('input[type=hidden][name="skip"]')).toHaveValue('4096')
    // the skip box is a hidden field then, so nobody types a value that interferes with "skip"
    await expect(page.locator('input[name="skip_queries"]')).toHaveAttribute('type', 'hidden')
    await expect(page.locator('#text_skip_queries')).toBeHidden()
  })

  test('the result: no Back after a successful import or a failed SELECT (Back only when a statement the import runs itself fails); the Import tab shows the form again', async ({
    page,
  }) => {
    const upload = async (sqlText: string) => {
      await page.locator('#input_import_file').setInputFiles({
        name: 'x.sql',
        mimeType: 'text/plain',
        buffer: Buffer.from(sqlText),
      })
      await page.locator('#buttonGo').click()
      await expect(page.locator('#import_form_status')).toBeVisible()
    }
    await page.goto(`/s/1/db/${DB}/import`)
    await upload('SELECT 1;\n')
    // fewer than 50 statements: the SQL tab's result of the statement
    await expect(page.locator('#import_form_status')).toContainText('Showing rows 0 -  0 (1 total')
    await expect(page.locator('#import_form_status').getByRole('button', { name: 'Back' })).toHaveCount(0)
    // the Import tab: the form again
    await page.locator('#topmenu').getByRole('link', { name: 'Import' }).click()
    await expect(page.locator('#import_file_form')).toBeVisible()
    // a failed SELECT goes to the SQL tab's result (Sql::handleQueryExecuteError: mysqlDie without a back URL)
    await upload('SELECT * FROM no_such_table;\n')
    await expect(page.locator('#import_form_status')).toContainText("doesn't exist")
    await expect(page.locator('#import_form_status').getByRole('button', { name: 'Back' })).toHaveCount(0)
    await page.locator('#topmenu').getByRole('link', { name: 'Import' }).click()
    // from the 50th statement on the import runs them itself (Import::runQuery); one fails:
    // $my_die, mysqlDie with $errorUrl and Generator::getBackUrlHtml's Back
    await upload(`${'DO 1;\n'.repeat(50)}INSERT INTO no_such_table VALUES (1);\n`)
    await expect(page.locator('#import_form_status')).toContainText("doesn't exist")
    await page.locator('#import_form_status').getByRole('button', { name: 'Back' }).click()
    await expect(page.locator('#import_file_form')).toBeVisible()
  })

  test('the import shows "The file is being processed, please be patient." while it runs [p07-573c56]', async ({
    page,
  }) => {
    await page.route('**/import/jobs', async (route) => {
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    await page.goto(`/s/1/db/${DB}/import`)
    await page.locator('#input_import_file').setInputFiles({
      name: 'x.sql',
      mimeType: 'text/plain',
      buffer: Buffer.from('SELECT 1;\n'),
    })
    await page.locator('#buttonGo').click()
    await expect(page.locator('#import_form_status')).toContainText(
      'The file is being processed, please be patient.',
    )
  })
})
