import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { formatSql } from '../../packages/sql-lexer/src/index.ts'

const DB = 'm1sql_e2e'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...ROOT, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(20) COMMENT 'the name', qty INT) ENGINE=InnoDB;
    INSERT INTO t (name, qty) VALUES ('a', 1), ('b', 2), ('c', 3);`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}`)
  await c.end()
})

async function login(page: Page) {
  await page.goto('/')
  await page.locator('#input_username').fill(ROOT.user)
  await page.locator('#input_password').fill(ROOT.password)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
}

/** The CodeMirror content element of the SQL box. */
const editor = (page: Page) => page.locator('#sqlquery .cm-content')

async function setQuery(page: Page, sql: string) {
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(sql)
}

/**
 * The user preferences of the e2e server's store are shared by every test of the run: start from
 * the defaults (an open console, Console/Mode "show", takes the focus when a page loads).
 */
async function resetPrefs(page: Page) {
  await page.evaluate(async () => {
    const token = document.cookie
      .split('; ')
      .find((c) => c.startsWith('bma_token='))
      ?.slice('bma_token='.length)
    const r = await fetch('/api/servers/1/prefs/reset', {
      method: 'POST',
      headers: { 'X-BMA-Token': decodeURIComponent(token ?? '') },
    })
    if (!r.ok) throw new Error(`prefs reset: ${r.status}`)
  })
}

test.describe('SQL tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear())
    await login(page)
    await resetPrefs(page)
  })

  test('table scope: legend, DefaultQueryTable, columns and snippets [p09-0cd66f] [p09-625a43] [p09-50c42a] [p09-74590b]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/t/t/sql`)
    await expect(page.getByText(`Run SQL query/queries on table ${DB}.t`)).toBeVisible()
    await expect(editor(page)).toHaveText('SELECT * FROM `t` WHERE 1')
    await expect(page.locator('#fieldsSelect option')).toHaveText(['id', 'name', 'qty'])
    await expect(page.locator('#fieldsSelect option').nth(1)).toHaveAttribute('title', 'the name')
    await page.locator('#insert').click()
    await expect(editor(page)).toHaveText(
      "INSERT INTO `t`(`id`, `name`, `qty`) VALUES ('[value-1]','[value-2]','[value-3]')",
    )
    await page.locator('#delete').click()
    await expect(editor(page)).toHaveText('DELETE FROM `t` WHERE 0')
    await page.locator('#clear').click()
    await expect(editor(page)).toHaveText('')
    // double-click inserts the selected columns at the cursor
    await page.locator('#fieldsSelect').selectOption(['`id`', '`qty`'])
    await editor(page).click()
    await page.locator('#insertBtn').click()
    await expect(editor(page)).toHaveText('`id`, `qty`')
  })

  test('Ctrl+Enter and Alt+Enter run the query; the box collapses unless retained [p02-390d7c] [p09-5a7b7c] [p09-ba7ff7] [p09-550737]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    await setQuery(page, 'SELECT * FROM t')
    await page.keyboard.press('Control+Enter')
    await expect(page.getByText(/Showing rows 0\s+-\s+2 \(3 total, Query took/)).toBeVisible()
    await expect(page.locator('#togglequerybox')).toHaveText('Show query box')
    await page.locator('#togglequerybox').click()
    await page.locator('#retain_query_box').check()
    await setQuery(page, 'SELECT COUNT(*) FROM t')
    await page.keyboard.press('Alt+Enter')
    await expect(page.locator('.result_query').first()).toContainText('SELECT COUNT(*) FROM t')
    await expect(page.locator('#togglequerybox')).toHaveText('Hide query box')
    // the card's links for a SELECT
    const tools = page.locator('.result_query .tools').first()
    for (const l of ['Profiling', 'Edit inline', 'Edit', 'Explain SQL', 'Create PHP code', 'Refresh']) {
      await expect(tools.getByText(l, { exact: true })).toBeVisible()
    }
    await tools.getByText('Create PHP code', { exact: true }).click()
    await expect(page.getByText('$sql = "SELECT COUNT(*) FROM t;";')).toBeVisible()
    await expect(page.getByText('Showing as PHP code')).toBeVisible()
  })

  test('empty query alert and confirmation of destructive statements [p09-331963] [p09-e295f8]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(`${d.type()}:${d.message()}`)
      void d.dismiss()
    })
    await page.locator('#button_submit_query').click()
    await expect.poll(() => dialogs[0]).toBe('alert:Missing value in the form!')
    await setQuery(page, 'DELETE FROM t WHERE id = 1')
    await page.locator('#button_submit_query').click()
    await expect
      .poll(() => dialogs[1])
      .toBe('confirm:Do you really want to execute "DELETE FROM t WHERE id = 1"?')
    await expect(page.locator('.result_query')).toHaveCount(0)
  })

  test('autocomplete with Ctrl+Space lists the current database columns [p09-ba7ff7] [p09-d9ff25]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/t/t/sql`)
    await setQuery(page, 'SELECT na')
    await page.keyboard.press('Control+Space')
    const option = page.locator('.cm-tooltip-autocomplete li', { hasText: 'name' }).first()
    await expect(option).toBeVisible()
    await expect(option).toContainText('varchar(20)')
  })

  test('lint gutter marks syntax errors (worker, no round trip) [p09-d82c3f]', async ({ page }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    const lintRequests: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/sql/lint')) lintRequests.push(r.url())
    })
    await setQuery(page, "SELECT * FROM t WHERE name = 'abc")
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()
    expect(lintRequests).toEqual([])
  })

  test('Simulate query appears for UPDATE and shows the matched rows [p02-930d5c] [p09-c33691]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    await setQuery(page, 'SELECT 1')
    await expect(page.locator('#simulate_dml')).toHaveCount(0)
    await setQuery(page, "UPDATE t SET name = 'z' WHERE id < 3")
    await expect(page.locator('#simulate_dml')).toBeVisible()
    await page.locator('#simulate_dml').click()
    const modal = page.locator('#simulateDmlModal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('Simulate query')
    await expect(modal).toContainText('SQL query:')
    await expect(modal).toContainText('Affected rows: 2')
    await modal.getByRole('button', { name: 'Close' }).last().click()
    await expect(modal).toBeHidden()
  })

  test('Format, bind parameters and the auto-saved query [p02-390d7c] [p09-58f383] [p09-d68993] [p09-ec9fe2]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    await expect(page.locator('#saved')).toBeDisabled()
    const q = 'select id,name from t where id = :id or name = :name'
    await setQuery(page, q)
    await page.locator('#format').click()
    // the same output as phpmyadmin/sql-parser's Formatter (ported, fixture-tested)
    await expect(page.locator('#sqlquery .cm-line')).toHaveText(formatSql(q).split('\n'))
    await page.locator('#parameterized').check()
    await expect(page.locator('#parametersDiv label')).toHaveText([':id', ':name'])
    await page.locator('#param_id').fill('2')
    await page.locator('#param_name').fill('c')
    await page.locator('#button_submit_query').click()
    await expect(page.getByText(/Showing rows 0\s+-\s+1 \(2 total/)).toBeVisible()
    await page.locator('#togglequerybox').click()
    await page.locator('#clear').click()
    await page.locator('#saved').click()
    await expect(editor(page)).toContainText(':name')
  })

  test('card links: Edit inline, Explain SQL, Edit [p02-88edc9 p02-9128e7 p02-aa2107] [p09-0c49c5] [p09-ba7ff7] [p09-1fc182]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    await setQuery(page, 'SELECT * FROM t WHERE id = 1')
    await page.keyboard.press('Control+Enter')
    const card = page.locator('.result_query').first()
    await expect(card).toContainText(/Showing rows 0\s+-\s+0 \(1 total/)
    // inline editor: Ctrl+Enter saves, the FK checkbox comes from /sql/default-fk-check
    await card.getByText('Edit inline', { exact: true }).click()
    await expect(page.getByText('Enable foreign key checks').last()).toBeVisible()
    const inline = page.locator('#sql_query_edit .cm-content')
    await inline.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.insertText('SELECT * FROM t WHERE id > 1')
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('.result_query').first()).toContainText(/Showing rows 0\s+-\s+1 \(2 total/)
    // Explain SQL runs EXPLAIN <query>
    await page.locator('.result_query .tools').first().getByText('Explain SQL', { exact: true }).click()
    await expect(page.locator('.result_query').first()).toContainText('EXPLAIN SELECT * FROM t WHERE id > 1')
    await expect(page.locator('.result_query .tools').first().getByText('Skip Explain SQL')).toBeVisible()
    // Edit: the SQL tab of the scope with the query in the box
    await page.locator('.result_query .tools').first().getByText('Edit', { exact: true }).click()
    await expect(editor(page)).toHaveText('EXPLAIN SELECT * FROM t WHERE id > 1;')
  })

  test('profiling switch re-runs the query with the profile [p02-2a54e4] [p09-280f8a] [p09-33158a]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    await setQuery(page, 'SELECT * FROM t WHERE qty > 1')
    await page.keyboard.press('Control+Enter')
    await page.getByRole('switch').first().click()
    await expect(page.getByTestId('profiling')).toContainText('Detailed profile')
    await expect(page.getByTestId('profiling')).toContainText('Summary by state')
    await expect(page.locator('#profilingChartCanvas')).toBeVisible()
  })
})

test.describe('console', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.localStorage.clear())
    await login(page)
    // the console options are user preferences (the e2e server's local store): start from defaults
    await resetPrefs(page)
  })
  // and leave them so: an open console (Console/Mode) would take the focus in later files
  test.afterEach(async ({ page }) => {
    await resetPrefs(page)
  })

  test('runs queries, keeps them as messages, keys and options [p09-c24913]', async ({ page }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    await page.locator('.console_switch').click()
    const messages = page.getByTestId('console-messages')
    await expect(messages.locator('.welcome')).toHaveText('Press Ctrl+Enter to execute query')
    const input = page.locator('.console_query_input .cm-content')
    await input.click()
    await page.keyboard.insertText('SELECT name FROM t WHERE id = 2')
    await page.keyboard.press('Control+Enter')
    const entry = messages.locator('.message[data-state="successed"]').last()
    await expect(entry).toContainText('SELECT name FROM t WHERE id = 2')
    // the results go to the main panel
    await expect(page.getByText(/Showing rows 0\s+-\s+0 \(1 total/)).toBeVisible()
    // history with the arrow keys
    await input.click()
    await page.keyboard.press('ArrowUp')
    await expect(input).toHaveText('SELECT name FROM t WHERE id = 2;')
    // Ctrl+L clears the line, Ctrl+U the messages
    await page.keyboard.press('Control+l')
    await expect(input).toHaveText('')
    await page.keyboard.press('Control+u')
    await expect(messages.locator('.message:not(.welcome)')).toHaveCount(0)
    // Enter executes with the option
    await page.locator('#pma_console .toolbar .options').click()
    await page.locator('#consoleOptionsEnterExecutesCheckbox').check()
    await page.locator('.mid_layer').click({ position: { x: 5, y: 5 } })
    await expect(messages.locator('.welcome')).toHaveText('Press Enter to execute query')
    await input.click()
    await page.keyboard.insertText('SELECT 42')
    await page.keyboard.press('Enter')
    await expect(messages.locator('.message[data-state="successed"]').last()).toContainText('SELECT 42')
    // the options (and the open mode, Console/Mode) are user preferences (/console/config)
    await page.reload()
    await expect(page.getByTestId('console-messages').locator('.welcome')).toHaveText(
      'Press Enter to execute query',
    )
  })

  test('history entries: Requery (confirm), Edit, Explain, Profiling, Bookmark, select styling, Queried time [p09-f102f9]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    await page.locator('.console_switch').click()
    const messages = page.getByTestId('console-messages')
    const input = page.locator('.console_query_input .cm-content')
    await input.click()
    await page.keyboard.insertText('SELECT id FROM t WHERE id = 3')
    await page.keyboard.press('Control+Enter')
    const last = messages.locator('.message[data-state="successed"]').last()
    await expect(last).toContainText('SELECT id FROM t WHERE id = 3')
    const entry = messages.locator(`.message[data-msgid="${await last.getAttribute('data-msgid')}"]`)
    await expect(entry).toHaveClass(/\bselect\b/)
    // the actions float above a collapsed entry on hover; Expand keeps them in the entry
    await entry.locator('.action_content button', { hasText: 'Expand' }).dispatchEvent('click')
    const actions = entry.locator('.action_content')
    for (const name of ['Collapse', 'Requery', 'Edit', 'Explain', 'Profiling', 'Bookmark']) {
      await expect(actions.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(actions.locator('.query_time')).toContainText('Queried time')
    await expect(actions.locator('.targetdb')).toContainText(DB)
    // Edit puts the query back into the console input
    await actions.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(input).toHaveText('SELECT id FROM t WHERE id = 3;')
    // Explain runs EXPLAIN <query>
    await actions.getByRole('button', { name: 'Explain', exact: true }).click()
    await expect(messages.locator('.message[data-state="successed"]').last()).toContainText(
      'EXPLAIN SELECT id FROM t WHERE id = 3',
    )
    // Requery asks first; dismissed, nothing runs
    const before = await messages.locator('.message:not(.welcome)').count()
    const asked = new Promise<string>((resolve) => {
      page.once('dialog', (d) => {
        resolve(d.message())
        void d.dismiss()
      })
    })
    await actions.getByRole('button', { name: 'Requery', exact: true }).click()
    expect(await asked).toContain('SELECT id FROM t WHERE id = 3')
    await expect(messages.locator('.message:not(.welcome)')).toHaveCount(before)
  })

  test('Ctrl+K toggles twice outside fields and once inside, like phpMyAdmin (Q45)', async ({ page }) => {
    await page.goto('/s/1/sql')
    await expect(page.locator('.console_switch')).toBeVisible()
    await page.locator('#page_content').click({ position: { x: 2, y: 2 } })
    await page.keyboard.press('Control+k')
    // Ctrl+K, then K: open and closed again
    await expect(page.getByTestId('console-messages')).toHaveCount(0)
    await page.keyboard.press('Control+Alt+c')
    await expect(page.getByTestId('console-messages')).toBeVisible()
    // the console input has the focus: a single toggle
    await expect(page.locator('.console_query_input .cm-content')).toBeFocused()
    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('console-messages')).toHaveCount(0)
  })

  test('Ctrl+Alt+C toggles the console', async ({ page }) => {
    await page.goto('/s/1/sql')
    await expect(page.locator('.console_switch')).toBeVisible()
    await expect(page.getByTestId('console-messages')).toHaveCount(0)
    await page.keyboard.press('Control+Alt+c')
    await expect(page.getByTestId('console-messages')).toBeVisible()
    await page.keyboard.press('Control+Alt+c')
    await expect(page.getByTestId('console-messages')).toHaveCount(0)
  })
})
