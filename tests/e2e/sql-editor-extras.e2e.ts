import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * More of the SQL tab (docs/features/09-sql-editor-query-pipeline.md): the URL prefill, the editor
 * options, SHOW results, the bookmark options and the bookmarked query card, "Show this query here
 * again", the leave-page lock, a bookmark as a table's default browse query and the Kanji options.
 * Bookmarks live in the e2e server's local metadata store.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const DB = 'f09_e2e'

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY, name VARCHAR(20)); INSERT INTO t VALUES (1, 'a'), (2, 'b'), (3, 'c');
    CREATE TABLE marked (id INT PRIMARY KEY); INSERT INTO marked VALUES (1), (2);`)
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

const editor = (page: Page) => page.locator('#sqlquery .cm-content')

async function setQuery(page: Page, sql: string) {
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(sql)
}

/** runs the box's query and waits for its answer */
async function go(page: Page) {
  const answer = page.waitForResponse((r) => r.request().method() === 'POST' && /\/query$/.test(r.url()))
  await page.locator('#button_submit_query').click()
  expect((await answer).ok()).toBe(true)
}

test.describe('SQL tab extras', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.evaluate(() => window.localStorage.clear())
    await resetPrefs(page)
  })

  test('the query in the URL fills the editor without running it [p09-097a18]', async ({ page }) => {
    let ran = 0
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/query$/.test(r.url())) ran++
    })
    await page.goto(`/s/1/db/${DB}/t/t/sql?sql=${encodeURIComponent('SELECT name FROM t WHERE id = 2')}`)
    await expect(editor(page)).toHaveText('SELECT name FROM t WHERE id = 2')
    await page.waitForTimeout(500)
    expect(ran).toBe(0)
    await expect(page.locator('#sqlqueryresultsouter table')).toHaveCount(0)
  })

  test('CodeMirror: line numbers, line wrapping, bracket matching, the lint gutter [p09-32b8dd]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    const cm = page.locator('#sqlquery .cm-editor')
    await expect(cm.locator('.cm-lineNumbers')).toBeVisible()
    await expect(cm.locator('.cm-content.cm-lineWrapping')).toHaveCount(1)
    await expect(cm.locator('.cm-gutter-lint')).toHaveCount(1)
    await setQuery(page, 'SELECT (1)')
    await page.keyboard.press('ArrowLeft')
    await expect(cm.locator('.cm-matchingBracket')).toHaveCount(2)
  })

  test('SHOW results: Kill links for PROCESSLIST, no sorting; system SQL columns highlighted [p09-3ce77a] [p09-6e6b10]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    await setQuery(page, 'SHOW FULL PROCESSLIST')
    await go(page)
    const grid = page.locator('#sqlqueryresultsouter table.table_results').first()
    await expect(grid.getByRole('button', { name: 'Kill' }).first()).toBeVisible()
    await expect(grid.locator('thead .sortlink')).toHaveCount(0)
    // without "Retain query box" the box hides after a run
    await page.goto(`/s/1/db/${DB}/sql`)
    await setQuery(page, 'SHOW CREATE TABLE t')
    await go(page)
    const create = page.locator('#sqlqueryresultsouter table.table_results').first()
    await expect(create).toContainText('CREATE TABLE `t`')
    await expect(create.getByRole('button', { name: 'Kill' })).toHaveCount(0)

    // Results::$transformationInfo: information_schema.PROCESSLIST.INFO is shown as highlighted SQL
    await page.goto('/s/1/db/information_schema/sql')
    await setQuery(page, 'SELECT ID, INFO FROM PROCESSLIST WHERE ID = CONNECTION_ID()')
    await go(page)
    await expect(
      page.locator('#sqlqueryresultsouter table.table_results tbody code.sql').first(),
    ).toContainText('SELECT ID, INFO FROM PROCESSLIST')
  })

  test('bookmarks: options with a label, the whole text stored, variables, Enter runs the bookmark, main Go empties the choice [p09-bd3b52] [p09-523b05] [p09-3ceb0e] [p09-44e585] [p09-6efe0c] [p09-714ea3]', async ({
    page,
  }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    await expect(page.locator('#id_bkm_all_users')).toHaveCount(0)
    await expect(page.locator('#id_bkm_replace')).toHaveCount(0)
    await page.locator('#bkm_label').fill('f09 by id')
    await expect(page.locator('#id_bkm_all_users')).toBeVisible()
    await expect(page.locator('#id_bkm_replace')).toBeVisible()
    await page.locator('#id_bkm_all_users').check()
    // two statements: the bookmark keeps the whole text with its variable
    // the variable sits in a comment, so the stored text runs as is (a failing query stores nothing)
    await setQuery(page, 'SELECT 1;\nSELECT name FROM t WHERE 1 /* AND id = [VARIABLE1] */')
    await go(page)

    await page.goto(`/s/1/db/${DB}/sql`)
    const select = page.locator('#id_bookmark')
    const option = select.locator('option', { hasText: 'f09 by id' })
    await expect(option).toHaveText('f09 by id (shared)')
    await select.selectOption({ label: 'f09 by id (shared)' })
    const variable = page.locator('#bookmarkVariable1')
    await expect(page.locator('label[for="bookmarkVariable1"]')).toHaveText('Variable 1:')
    await variable.fill('2')
    // Enter in a variable runs the bookmark (the bookmark card's Go), not the query box
    const ran = page.waitForRequest((r) => r.method() === 'POST' && /\/(query|bookmarks)/.test(r.url()))
    await variable.press('Enter')
    await ran
    // the un-commented variable: only the row with id 2
    const out = page.locator('#sqlqueryresultsouter')
    await expect(out.getByRole('gridcell', { name: 'b', exact: true })).toHaveCount(1)
    await expect(out.getByRole('gridcell', { name: 'a', exact: true })).toHaveCount(0)
    await expect(out.getByRole('gridcell', { name: 'c', exact: true })).toHaveCount(0)

    // the main Go empties the bookmark choice first
    await page.goto(`/s/1/db/${DB}/sql`)
    await page.locator('#id_bookmark').selectOption({ label: 'f09 by id (shared)' })
    await page.getByLabel('Retain query box').check()
    await setQuery(page, 'SELECT 42')
    await go(page)
    await expect(page.locator('#id_bookmark')).toHaveValue('')
    await expect(page.locator('#sqlqueryresultsouter')).toContainText('42')
  })

  test('"Show this query here again" fills the editor on the next visit [p09-5e5479]', async ({ page }) => {
    await page.goto(`/s/1/db/${DB}/t/t/sql`)
    await page.locator('#checkbox_show_query').check()
    await setQuery(page, 'SELECT id FROM t ORDER BY id DESC')
    await go(page)
    await page.goto(`/s/1/db/${DB}/t/marked/sql`)
    await expect(editor(page)).not.toHaveText('SELECT id FROM t ORDER BY id DESC')
    await page.goto(`/s/1/db/${DB}/t/t/sql`)
    await expect(editor(page)).toHaveText('SELECT id FROM t ORDER BY id DESC')
  })

  test('a changed editor asks before leaving the page [p09-67640f]', async ({ page }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    await setQuery(page, 'SELECT 1 -- not run')
    const asked = new Promise<string>((resolve) => {
      page.once('dialog', (d) => {
        resolve(d.type())
        void d.dismiss()
      })
    })
    await page.locator('#pma_navigation').getByRole('link', { name: DB, exact: true }).first().click()
    expect(await asked).toBe('confirm')
    // dismissed: still on the SQL tab with the text
    await expect(page).toHaveURL(new RegExp(`/db/${DB}/sql`))
    await expect(editor(page)).toContainText('SELECT 1 -- not run')
  })

  test('a bookmark labelled like a table becomes its default browse query [p09-6b0a5a]', async ({ page }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    await page.locator('#bkm_label').fill('marked')
    await setQuery(page, 'SELECT * FROM marked WHERE id = 2')
    await go(page)
    await page.goto(`/s/1/db/${DB}/t/marked/browse`)
    await expect(page.getByText('Using bookmark "marked" as default browse query.')).toBeVisible()
    await expect(page.locator('table.table_results tbody tr')).toHaveCount(1)
  })

  test('Kanji conversion options only in the Japanese locale [p09-b31fd8]', async ({ page }) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    await expect(page.locator('#kanji_encoding')).toHaveCount(0)
    // every response writes the language cookie: leave the app first, so that no request still in
    // flight writes "en" back after the switch
    await page.goto('about:blank')
    await page.goto('/api/i18n?lang=ja')
    try {
      await page.goto(`/s/1/db/${DB}/sql`)
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja', { timeout: 15000 })
      const kanji = page.locator('#kanji_encoding')
      await expect(kanji.locator('input[name="knjenc"]')).toHaveCount(3)
      await expect(kanji.locator('#kj-none')).toBeChecked()
      await expect(kanji.locator('input[name="xkana"]')).toHaveCount(1)
    } finally {
      await page.goto('/api/i18n?lang=en')
    }
  })
})
