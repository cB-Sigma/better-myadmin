import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * The browser side of the docs/features/05-database-level.md micro-behaviours checklist: what the
 * database pages show and do in the page (confirmations, toggles, client filters and forms). Each
 * test names the checklist ids it proves; the API side is apps/server/test/int/database-checklist.
 */
const DB = 'f05_cke'
const USER = 'f05_cke_user'

async function sql(q: string): Promise<unknown[]> {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  try {
    return (await c.query(q))[0] as unknown[]
  } finally {
    await c.end()
  }
}

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE a (id INT PRIMARY KEY, v VARCHAR(20)) COMMENT 'a comment for the a table that is longer than fifty chars';
    INSERT INTO a VALUES (1, 'x'), (2, 'y');
    CREATE TABLE ovh (id INT, pad CHAR(200)) ENGINE=MyISAM;
    INSERT INTO ovh VALUES (1, 'a'), (2, 'b'), (3, 'c'); DELETE FROM ovh WHERE id = 2;
    CREATE VIEW v AS SELECT id FROM a;
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON *.* TO '${USER}'@'%'`)
})
test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
})

const base = `/s/1/db/${DB}`
const row = (page: import('@playwright/test').Page, t: string) => page.getByTestId(`db-structure-row-${t}`)

test.describe('database structure', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USER, USER)
    await page.goto(`${base}/structure`)
    await expect(row(page, 'a')).toBeVisible()
  })

  test('the table-name link carries the full comment in its title [p05-7fa25a]', async ({ page }) => {
    const full = 'a comment for the a table that is longer than fifty chars'
    await expect(row(page, 'a').getByRole('link', { name: 'a', exact: true })).toHaveAttribute('title', full)
  })

  test('a view has Edit instead of Empty; its drop confirmation has no strong warning [p05-3eaa5f]', async ({
    page,
  }) => {
    await expect(row(page, 'v').getByRole('link', { name: 'Edit' })).toHaveAttribute('href', /view\/create/)
    await expect(row(page, 'v').locator('.truncate_table_anchor')).toHaveCount(0)
    await row(page, 'v').locator('.drop_table_anchor').click()
    const dlg = page.getByRole('alertdialog')
    await expect(dlg).toContainText('Do you really want to execute "DROP VIEW `v`"?')
    await expect(dlg).not.toContainText('You are about to DESTROY a complete table!')
    await dlg.getByRole('button', { name: 'Close' }).last().click()
  })

  test('Empty asks with the foreign key checks box, then shows 0 rows and the new sum [p05-22cce4 p05-731ff5]', async ({
    page,
  }) => {
    await row(page, 'a').locator('.truncate_table_anchor').click()
    const dlg = page.getByRole('alertdialog')
    await expect(dlg).toContainText('You are about to TRUNCATE a complete table!')
    await expect(dlg.getByLabel('Enable foreign key checks')).toBeVisible()
    await dlg.getByRole('button', { name: 'OK' }).click()
    await expect(page.getByText('Table a has been emptied.')).toBeVisible()
    await expect(row(page, 'a').locator('td.tbl_rows')).toHaveText('0')
    // ovh's 2 rows and the view's -1 (MaxExactCountViews = 0)
    await expect(page.getByTestId('rows-sum')).toHaveText('1')
  })

  test('"Check tables having overhead" checks only the tables with overhead [p05-7f697c]', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Check tables having overhead' }).click()
    await expect(row(page, 'ovh').getByRole('checkbox')).toBeChecked()
    await expect(row(page, 'v').getByRole('checkbox')).not.toBeChecked()
  })

  test('the print view hides the checkboxes, actions and the create-table form [p05-898d30]', async ({
    page,
  }) => {
    await page.emulateMedia({ media: 'print' })
    await expect(row(page, 'v').getByRole('checkbox')).toBeHidden()
    await expect(row(page, 'v').locator('.drop_table_anchor')).toBeHidden()
    await expect(page.locator('#createTableMinimalForm')).toBeHidden()
    await page.emulateMedia({ media: 'screen' })
  })

  test('no configuration storage: no Central columns group in "With selected:" [p05-2acc14]', async ({
    page,
  }) => {
    await expect(page.getByRole('combobox', { name: 'With selected:' }).locator('optgroup')).toHaveCount(3)
    await expect(page.locator('optgroup[label="Central columns"]')).toHaveCount(0)
  })

  test('the create-table form: name max 64, 4 columns by default, at least 1; it locks the page [p05-6362c2]', async ({
    page,
  }) => {
    await expect(page.locator('#createTableNameInput')).toHaveAttribute('maxlength', '64')
    await expect(page.locator('#createTableNumFieldsInput')).toHaveValue('4')
    await expect(page.locator('#createTableNumFieldsInput')).toHaveAttribute('min', '1')
    await page.locator('#createTableNameInput').fill('newone')
    await expect(page.locator('#lock_page_icon [data-icon="ic_s_lock"]')).toHaveCount(1)
    page.once('dialog', (d) => {
      expect(d.message()).toBe('You have unsaved changes; are you sure you want to leave this page?')
      void d.dismiss()
    })
    await page.getByRole('link', { name: 'Operations' }).first().click()
    await expect(page).toHaveURL(/\/structure/)
  })
})

test.describe('databases list and operations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USER, USER)
  })
  test.afterAll(async () => {
    await sql(`DROP DATABASE IF EXISTS ${DB}_new`)
  })

  test('the filter box matches the upper-cased names; creating opens the new database [p05-838cf0 p05-3d20d2]', async ({
    page,
  }) => {
    await page.goto('/s/1/databases')
    await page.locator('#filterText').fill('f05_CKE')
    await expect(page.locator('tr[data-filter-row]')).toHaveCount(1)
    await expect(page.locator(`tr[data-filter-row="${DB.toUpperCase()}"]`)).toBeVisible()
    await page.locator('#text_create_db').fill(`${DB}_new`)
    await page.locator('#buttonGo').click()
    await expect(page).toHaveURL(new RegExp(`/db/${DB}_new`))
    // the navigation reloaded (the new database is the current one: its group is open)
    const nav = page.locator('#pma_navigation')
    await expect(nav.locator(`[role=treeitem][data-name="${DB}_new"]`)).toBeVisible()
  })

  test('rename: the same name is refused, the confirmation shows CREATE / DROP, privileges adjusted by default [p05-d8139a]', async ({
    page,
  }) => {
    await page.goto(`${base}/operations`)
    await expect(page.locator('#checkbox_adjust_privileges')).toBeChecked()
    await page.locator('#new_db_name').fill(DB)
    await page.locator('#rename_db_form').getByRole('button', { name: 'Go' }).click()
    await expect(
      page.getByText('Cannot rename database to the same name. Change the name and try again.'),
    ).toBeVisible()
    await page.locator('#new_db_name').fill(`${DB}_other`)
    await page.locator('#rename_db_form').getByRole('button', { name: 'Go' }).click()
    const dlg = page.getByRole('alertdialog')
    await expect(dlg).toContainText(`CREATE DATABASE ${DB}_other / DROP DATABASE ${DB}`)
    await dlg.getByRole('button', { name: 'Close' }).last().click()
  })

  test('copy defaults: structure and data, CREATE DATABASE, AUTO_INCREMENT, constraints, privileges [p05-b5ba2f]', async ({
    page,
  }) => {
    await page.goto(`${base}/operations`)
    await expect(page.locator('#whatRadio2')).toBeChecked()
    for (const id of ['create_database_before_copying', 'auto_increment', 'constraints', 'privileges'])
      await expect(page.locator(`#checkbox_${id}`)).toBeChecked()
    await expect(page.locator('#checkbox_drop')).not.toBeChecked()
  })
})

test.describe('database search', () => {
  test('all tables preselected; none selected is refused; results fold the form; Browse and Delete [p05-b20265 p05-802894 p05-286ac8]', async ({
    page,
  }) => {
    await sql(`INSERT IGNORE INTO ${DB}.a VALUES (11, 'needle'), (12, 'needle')`)
    await login(page, USER, USER)
    await page.goto(`${base}/search`)
    const tables = page.locator('#criteriaTables option:checked')
    await expect(tables).toHaveCount(3)
    await page.locator('#unselect_all').click()
    await expect(tables).toHaveCount(0)
    await page.locator('#buttonGo').click()
    await expect(page.getByText('No table selected.')).toBeVisible()
    await page.locator('#select_all').click()
    await page.locator('#criteriaSearchString').fill('needle')
    await page.locator('#buttonGo').click()
    await expect(page.locator('#togglesearchformlink')).toHaveText('Show search criteria')
    await expect(page.locator('#criteriaSearchString')).toBeHidden()
    await page.locator('#togglesearchresultlink').click()
    await expect(page.locator('#searchresults')).toBeHidden()
    await expect(page.locator('#togglesearchresultlink')).toHaveText('Show search results')
    await page.locator('#togglesearchresultlink').click()
    await page.locator('#searchresults .browse_results').first().click()
    await expect(page.locator('#browse-results #table-link')).toHaveText('a')
    await page.locator('#searchresults .delete_results').first().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'OK' }).click()
    await expect(page.locator('#searchresults')).toContainText('0 matches in a')
    await expect(page.locator('#searchresults .browse_results')).toHaveCount(0)
  })
})

test.describe('routines, events, triggers', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USER, USER)
  })

  test('the routine editor: FUNCTION hides Direction and shows Return; options follow the type; validation; drag reorders parameters [p05-505ad5 p05-1a3bef p05-2eb385]', async ({
    page,
  }) => {
    await page.goto(`${base}/routines`)
    await page.getByRole('button', { name: 'Create new routine' }).click()
    const dlg = page.locator('#routinesEditorModal')
    await expect(dlg.locator('th.routine_direction_cell')).toBeVisible()
    await dlg.locator('select[name="item_type"]').selectOption('FUNCTION')
    await expect(dlg.locator('th.routine_direction_cell')).toHaveCount(0)
    await expect(dlg.locator('select[name="item_returntype"]')).toBeVisible()
    const typeOf = (i: number) => dlg.locator(`select[name="item_param_type[${i}]"]`)
    await typeOf(0).selectOption('DATE')
    await expect(dlg.getByTestId('routine-param-0').locator('.no_len')).toBeVisible()
    await expect(dlg.getByTestId('routine-param-0').locator('.no_opts')).toBeVisible()
    await typeOf(0).selectOption('VARCHAR')
    await expect(dlg.locator('select[name="item_param_opts_text[0]"]')).toBeVisible()
    await typeOf(0).selectOption('VARBINARY')
    await expect(dlg.locator('select[name="item_param_opts_text[0]"]')).toHaveCount(0)
    await typeOf(0).selectOption('INT')
    await expect(dlg.locator('select[name="item_param_opts_num[0]"]')).toBeVisible()
    // validation: a missing name, then a function body without RETURN (routines.ts validate:
    // native alerts)
    const alerts: string[] = []
    page.on('dialog', (d) => {
      alerts.push(d.message())
      void d.dismiss()
    })
    await dlg.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(() => alerts.at(-1)).toBe('Missing value in the form!')
    await dlg.locator('input[name="item_name"]').fill('f_ck')
    await dlg.locator('input[name="item_param_name[0]"]').fill('first')
    await dlg.locator('#addRoutineParameterButton').click()
    await dlg.locator('input[name="item_param_name[1]"]').fill('second')
    await dlg.getByTestId('routine-param-1').dragTo(dlg.getByTestId('routine-param-0'))
    await expect(dlg.locator('input[name="item_param_name[0]"]')).toHaveValue('second')
    await dlg.locator('textarea, .cm-content').first().fill('SELECT 1')
    await dlg.getByRole('button', { name: 'Save changes' }).click()
    await expect
      .poll(() => alerts.at(-1))
      .toBe('The definition of a stored function must contain a RETURN statement!')
  })

  test('dropping the last routine shows the "no routines" notice [p05-9964cd]', async ({ page }) => {
    await sql(`CREATE PROCEDURE ${DB}.p_last() SELECT 1`)
    await page.goto(`${base}/routines`)
    await page.locator('.drop_anchor').first().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'OK' }).click()
    await expect(page.getByText('There are no routines to display.')).toBeVisible()
  })

  test('the event editor: the type switches the schedule rows; 15 interval units [p05-f63b73]', async ({
    page,
  }) => {
    await page.goto(`${base}/events`)
    await page.getByRole('button', { name: 'Create new event' }).click()
    const type = page.locator('select[name="item_type"]')
    await type.selectOption('ONE TIME')
    await expect(page.getByText('Execute at')).toBeVisible()
    await expect(page.locator('input[name="item_interval_value"]')).toBeHidden()
    await type.selectOption('RECURRING')
    await expect(page.locator('input[name="item_interval_value"]')).toBeVisible()
    await expect(page.locator('select[name="item_interval_field"] option')).toHaveCount(15)
  })

  test('the scheduler toggle sends SET GLOBAL event_scheduler [p05-396223]', async ({ page }) => {
    let sent = ''
    await page.route('**/api/servers/1/query', async (route) => {
      sent = String((route.request().postDataJSON() as { sql?: string }).sql)
      await route.abort()
    })
    await page.goto(`${base}/events`)
    const on = await page.locator('.toggleAjax [role=switch]').getAttribute('aria-checked')
    await page.locator('.toggleAjax .toggle-container').click()
    await expect.poll(() => sent).toBe(`SET GLOBAL event_scheduler="${on === 'true' ? 'OFF' : 'ON'}"`)
  })

  test('the database triggers list has a Table column linking to the table triggers [p05-6d51f6]', async ({
    page,
  }) => {
    await sql(`CREATE TRIGGER ${DB}.tr_ck BEFORE INSERT ON ${DB}.a FOR EACH ROW SET NEW.v = NEW.v`)
    await page.goto(`${base}/triggers`)
    await expect(page.locator('#triggersTable th', { hasText: 'Table' })).toBeVisible()
    await expect(
      page.locator('#triggersTable').getByRole('link', { name: 'a', exact: true }),
    ).toHaveAttribute('href', new RegExp(`/db/${DB}/t/a/triggers`))
  })
})

test.describe('multi-table query', () => {
  test('three column cards, Add column, removable; alias off for *; AND/OR from two criteria; Copy and empty Submit [p05-bd2290 p05-24d15b p05-41c645 p05-cd1b8a]', async ({
    page,
  }) => {
    await login(page, USER, USER)
    await page.goto(`${base}/multi-table-query`)
    const cards = page.locator('.table_alias')
    await expect(cards).toHaveCount(3)
    await page.locator('#add_column_button').click()
    await expect(cards).toHaveCount(4)
    await expect(page.locator('#copy_query')).toBeDisabled()
    page.once('dialog', (d) => {
      expect(d.message()).toBe('Missing value in the form!')
      void d.dismiss()
    })
    await page.locator('#submit_query').click()
    const tableSel = page.locator('select.tableNameSelect, select[name^="criteriaTables"]').first()
    await tableSel.selectOption('a')
    const colSel = page.locator('select.columnNameSelect, select[name^="criteriaColumns"]').first()
    await colSel.selectOption('*')
    await expect(page.locator('.col_alias').first()).toBeDisabled()
    // form.twig's logical_operator row is not hidden: "Add as" AND / OR from the first criteria column
    await page.locator('.criteria_col').nth(0).check()
    await expect(page.locator('input[type=radio][value=OR]').first()).toBeVisible()
    await page.locator('.criteria_col').nth(1).check()
    await expect(page.locator('input[type=radio][value=OR]')).toHaveCount(2)
  })
})

test.describe('trigger created from the dialog', () => {
  test('the message and its query card come before the list, the new row is listed [p05-6d51f6]', async ({
    page,
  }) => {
    await sql(`DROP TRIGGER IF EXISTS ${DB}.f05_cke_trg`)
    await login(page, USER, USER)
    await page.goto(`/s/1/db/${DB}/triggers`)
    await page
      .getByRole('button', { name: /Create new trigger/ })
      .first()
      .click()
    const dlg = page.getByRole('dialog')
    await dlg.locator('[name="item_name"]').fill('f05_cke_trg')
    await dlg.locator('[name="item_table"]').selectOption('a')
    await dlg.locator('.cm-content').first().click()
    await page.keyboard.insertText('SET NEW.v = TRIM(NEW.v)')
    await dlg.getByRole('button', { name: 'Save changes' }).click()
    const card = page.locator('.result_query').first()
    await expect(card).toContainText('Trigger `f05_cke_trg` has been created.')
    await expect(card).toContainText('CREATE TRIGGER `f05_cke_trg` BEFORE INSERT ON `a`')
    for (const link of ['Edit inline', 'Edit', 'Create PHP code']) {
      await expect(card.getByText(link, { exact: true }).first()).toBeVisible()
    }
    // Generator::getMessage before the "Triggers" heading (QA: it followed the heading, no links)
    expect(
      await card.evaluate((c) => {
        const h = document.querySelector('h2')
        return h !== null && (c.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      }),
    ).toBe(true)
    await expect(page.locator('#triggersTable')).toContainText('f05_cke_trg')
    await sql(`DROP TRIGGER IF EXISTS ${DB}.f05_cke_trg`)
  })
})

test.describe('multi-table query results', () => {
  test('a chosen table fills the column lists (`*` first, the criteria list without it); Submit renders the /sql results with inert AJAX controls [p05-cd1b8a]', async ({
    page,
  }) => {
    await sql(`DELETE FROM ${DB}.a; INSERT INTO ${DB}.a VALUES (1, 'x'), (2, 'y')`)
    await login(page, USER, USER)
    await page.goto(`/s/1/db/${DB}/multi-table-query`)
    const card = page
      .locator('fieldset')
      .filter({ has: page.locator('select.tableNameSelect') })
      .first()
    await card.locator('select.tableNameSelect').selectOption('a')
    // the table's options replace "select column", the first one selected
    const cols = card.locator('select.columnNameSelect').first()
    await expect(cols.locator('option')).toHaveText(['*', 'id', 'v'])
    await expect(cols).toHaveValue('*')
    await card.locator('.criteria_col').check()
    await expect(card.locator('select.columnNameSelect.opColumn option')).toHaveText(['id', 'v'])
    await card.locator('.criteria_col').uncheck()
    await page.locator('#update_query_button').click()
    await page.locator('#submit_query').click()
    const results = page.locator('#sql_results')
    // the results page of /sql: message card, navigation bar and grid
    await expect(results.locator('.result_query').first()).toContainText('Showing rows 0 - 1')
    await expect(results.locator('table.navigation').first()).toBeVisible()
    await expect(results.locator('table.table_results tbody tr')).toHaveCount(2)
    // its AJAX controls do nothing here: Show all stays unchecked, Delete asks nothing
    await results.locator('.showAllRows').first().click()
    await expect(results.locator('.showAllRows').first()).not.toBeChecked()
    let asked = false
    page.once('dialog', (d) => {
      asked = true
      void d.dismiss()
    })
    await results.locator('.delete_row').first().click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    expect(asked).toBe(false)
    await expect(results.locator('table.table_results tbody tr')).toHaveCount(2)
  })
})

/** The e2e server has no configuration storage: these pages get their storage-backed data mocked. */
test.describe('storage-backed pages (mocked configuration storage)', () => {
  const col = (name: string) => ({
    name,
    type: 'int',
    length: '11',
    collation: '',
    isNull: false,
    extra: '',
    attribute: '',
    default: null,
    defaultType: 'NONE',
    defaultValue: '',
  })
  const mockCentral = async (page: import('@playwright/test').Page, names: string[], posts: unknown[]) => {
    await page.route(/\/databases\/f05_cke\/central-columns(\?.*)?$/, async (route) => {
      if (route.request().method() === 'POST') {
        posts.push(route.request().postDataJSON())
        await route.fulfill({ json: { ok: true, message: { type: 'success', text: 'done' } } })
        return
      }
      const res = await route.fetch()
      const json = await res.json()
      await route.fulfill({
        json: {
          ...json,
          enabled: true,
          totalRows: names.length,
          columns: names.map(col),
          message: { type: 'success', text: `Showing rows 1 - ${names.length}.` },
        },
      })
    })
  }

  test('central columns: inline Edit with Save/Cancel, Delete confirms, bulk actions need a selection, Add new column folded [p05-1c26ce p05-9d28f6]', async ({
    page,
  }) => {
    const posts: unknown[] = []
    await mockCentral(page, ['c1', 'c2'], posts)
    await login(page, USER, USER)
    await page.goto(`${base}/central-columns`)
    await expect(page.locator('#add_new')).toBeHidden()
    await page.locator('#edit_1').getByRole('button', { name: 'Edit' }).click()
    await expect(page.locator('.edit_save_form')).toBeVisible()
    await page.locator('.edit_cancel_form').click()
    await expect(page.locator('.edit_save_form')).toHaveCount(0)
    await page.locator('#tableslistcontainer').getByRole('button', { name: 'Delete' }).first().click()
    const dlg = page.getByRole('alertdialog')
    await expect(dlg).toContainText('Do you really want to delete this central column?')
    await dlg.getByRole('button', { name: 'OK' }).click()
    await expect.poll(() => posts.at(-1)).toEqual({ action: 'delete', columns: ['c1'] })
    await page.locator('.mult_submit[title="Delete"], button[title="Delete"]').last().click()
    await expect(page.getByText('Select at least one of the options!')).toBeVisible()
    await page.locator('#tableslistcontainer_checkall').check()
    await page.locator('button[title="Edit"]').last().click()
    await expect(page.locator('#multi_edit_central_columns')).toBeVisible()
  })

  test('central columns: the Add new column form opens by itself on an empty list [p05-9d28f6]', async ({
    page,
  }) => {
    await mockCentral(page, [], [])
    await login(page, USER, USER)
    await page.goto(`${base}/central-columns`)
    await expect(page.locator('#add_new')).toBeVisible()
  })

  test('tracking: tables sorted by name, the version column numerically [p05-6d5ef9]', async ({ page }) => {
    await page.route(/\/databases\/f05_cke\/tracking$/, async (route) => {
      const json = await (await route.fetch()).json()
      const v = (table: string, version: string) => ({
        table,
        version,
        created: '2024-01-01 00:00:00',
        updated: '2024-01-02 00:00:00',
        active: true,
      })
      await route.fulfill({
        json: {
          ...json,
          enabled: true,
          noTables: false,
          tracked: [v('b', '10'), v('a', '9'), v('c', '100')],
          untracked: ['z', 'y'],
        },
      })
    })
    await login(page, USER, USER)
    await page.goto(`${base}/tracking`)
    const names = (id: string) => page.locator(`#${id} tbody tr th`).allTextContents()
    await expect.poll(() => names('versions')).toEqual(['a', 'b', 'c'])
    await expect.poll(() => names('noversions')).toEqual(['y', 'z'])
    await page.locator('#versions th', { hasText: 'Last version' }).click()
    await expect.poll(() => names('versions')).toEqual(['a', 'b', 'c'])
    await page.locator('#versions th', { hasText: 'Last version' }).click()
    await expect.poll(() => names('versions')).toEqual(['c', 'b', 'a'])
  })
})

test.describe('designer', () => {
  test.beforeAll(async () => {
    await sql(`DROP DATABASE IF EXISTS ${DB}_b; CREATE DATABASE ${DB}_b; CREATE TABLE ${DB}_b.t2 (id INT)`)
  })
  test.afterAll(async () => {
    await sql(`DROP DATABASE IF EXISTS ${DB}_b`)
  })
  test.beforeEach(async ({ page }) => {
    await login(page, USER, USER)
    await page.goto(`${base}/designer`)
    await expect(page.locator(`[id="${DB}.a"]`)).toBeVisible()
  })

  test('a move marks the page unsaved (*); New page then asks to save it first [p05-1655f2]', async ({
    page,
  }) => {
    const head = page.locator(`[id="id_zag_${DB}.a"]`)
    const box = await head.boundingBox()
    if (box === null) throw new Error('no header')
    await page.mouse.move(box.x + 5, box.y + 5)
    await page.mouse.down()
    await page.mouse.move(box.x + 60, box.y + 40, { steps: 5 })
    await page.mouse.up()
    await expect(page.locator('#saved_state')).toHaveText('*')
    await page.locator('#newPage').click({ force: true })
    await expect(page.locator('#designerPromptModal')).toBeVisible()
    await page.locator('#designerModalNoButton').click()
  })

  test('tables from another database are added once; a duplicate is refused [p05-853bd8]', async ({
    page,
  }) => {
    await page.locator('#addOtherDbTables').click({ force: true })
    await page.locator('#add_table_from').selectOption(`${DB}_b`)
    await page.locator('#add_table').selectOption('t2')
    await page.locator('#designerModalGoButton').click()
    await expect(page.locator(`[id="${DB}_b.t2"]`)).toBeVisible()
    await page.locator('#addOtherDbTables').click({ force: true })
    await page.locator('#add_table_from').selectOption(DB)
    await page.locator('#add_table').selectOption('a')
    await page.locator('#designerModalGoButton').click()
    await expect(page.getByText(`Table ${DB}.a already exists!`)).toBeVisible()
  })

  test("the export dialog shows only the chosen format's options and posts the canvas coordinates [p05-f81540]", async ({
    page,
  }) => {
    let body: Record<string, unknown> = {}
    await page.route('**/schema-export', async (route) => {
      body = route.request().postDataJSON() as Record<string, unknown>
      await route.abort()
    })
    await page.locator('#exportPages').click({ force: true })
    await page.locator('#plugins').selectOption('svg')
    await expect(page.locator('#id_export_pages [name^="svg_"]').first()).toBeVisible()
    await expect(page.locator('#id_export_pages [name^="pdf_"]').first()).toBeHidden()
    await page.locator('#designerModalGoButton').click()
    await expect.poll(() => JSON.stringify(body)).toContain(`"db":"${DB}","table":"a"`)
    expect(JSON.stringify(body)).toMatch(/"x":"\d+","y":"\d+"/)
    expect(Object.keys((body.options ?? {}) as object).every((k) => k.startsWith('svg_'))).toBe(true)
  })
})

test('Structure page settings: the five ShowDbStructure* toggles, kept for the user; comments cut at LimitChars [p05-67e9c0 p05-7fa25a]', async ({
  page,
}) => {
  await login(page, USER, USER)
  await page.goto(`${base}/structure`)
  const modal = page.locator('#pageSettingsModal')
  const open = async () => {
    await page.locator('#page_settings_icon button').click()
    await expect(modal.getByText('Page-related settings')).toBeVisible()
  }
  await open()
  for (const k of ['Charset', 'Comment', 'Creation', 'LastUpdate', 'LastCheck'])
    await expect(modal.locator(`#ShowDbStructure${k}`)).toBeVisible()
  await modal.locator('#ShowDbStructureComment').check()
  await modal.locator('#pageSettingsModalApplyButton').click()
  await expect(modal).toBeHidden()
  await page.reload()
  const full = 'a comment for the a table that is longer than fifty chars'
  await expect(row(page, 'a').locator('abbr')).toHaveAttribute('title', full)
  await expect(row(page, 'a').locator('abbr')).toHaveText(`${full.slice(0, 50)}...`)
  await open()
  await expect(modal.locator('#ShowDbStructureComment')).toBeChecked()
  await modal.locator('#ShowDbStructureComment').uncheck()
  await modal.locator('#pageSettingsModalApplyButton').click()
})
