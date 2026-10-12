import type { Page } from '@playwright/test'
import { FIX, RUN, USERS } from './lib/env.ts'
import { pageParity } from './lib/parity.ts'

/**
 * The SQL tab at server, database and table scope, its "Bookmark this SQL query" fieldset and the
 * "Bookmarked SQL query" card, and the console with its options, bookmarks and history
 * (docs/features/09-sql-editor-query-pipeline.md). Each tool's user gets the same private
 * bookmarks in its own configuration storage (phpMyAdmin's `phpmyadmin`, ours FIX.pmadb).
 */
/** the same ids in both storages (the option values), distinct per run (the reference's is shared) */
const ID = 700_000 + (Number.parseInt(RUN, 36) % 100_000) * 2
const bookmarks = (pmadb: string, user: string) => `
DELETE FROM ${pmadb}.pma__bookmark WHERE user = '${user}' OR id IN (${ID}, ${ID + 1});
INSERT INTO ${pmadb}.pma__bookmark (id, dbase, user, label, query) VALUES
  (${ID}, '${FIX.db}', '${user}', 'uip_all_rows', 'SELECT * FROM ${FIX.table}'),
  (${ID + 1}, '${FIX.db}', '${user}', 'uip_by_id', 'SELECT * FROM ${FIX.table} WHERE id = /*[VARIABLE1]*/ OR id = /*[VARIABLE2]*/');`
const BOOKMARKS = bookmarks('phpmyadmin', USERS.pma) + bookmarks(FIX.pmadb, USERS.ours)

pageParity('db-sql', {
  pma: { route: '/database/sql', params: { db: FIX.db } },
  ours: { path: `/s/1/db/${FIX.db}/sql` },
  sql: BOOKMARKS,
  ready: { pma: '#sqlqueryform', ours: '#sqlqueryform' },
  interactions: [
    // the bookmark options appear once a label is typed
    { name: 'bookmark label', do: { fill: ['Bookmark this SQL query:', 'uip'] } },
    // a bookmark with variables shows one field per variable
    { name: 'bookmark with variables', do: { select: ['Bookmark:', 'uip_by_id'] } },
    { name: 'view only', do: { check: 'View only' } },
    { name: 'bind parameters', do: { check: 'Bind parameters' } },
  ],
})

pageParity('table-sql', {
  pma: { route: '/table/sql', params: { db: FIX.db, table: FIX.table } },
  ours: { path: `/s/1/db/${FIX.db}/t/${FIX.table}/sql` },
  sql: BOOKMARKS,
  ready: { pma: '#sqlqueryform', ours: '#sqlqueryform' },
  interactions: [
    // the snippet buttons fill the box; a DML statement shows "Simulate query"
    { name: 'DELETE snippet', do: { click: 'DELETE' } },
    { name: 'SELECT * snippet', do: { click: 'SELECT *' } },
    { name: 'show this query here again', do: { check: 'Show this query here again' } },
  ],
})

/** phpMyAdmin's console toolbar entries are <div>s: located by class in both tools. */
const click = async (page: Page, sel: string) => {
  await page.locator(sel).first().click()
  await page.waitForTimeout(500)
}
/** opens the console: its toolbar entries show once it is expanded */
const openConsole = async (page: Page) => {
  await click(page, '#pma_console > .toolbar .console_switch')
  const options = page.locator('#pma_console > .toolbar .options').first()
  await options.waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {
    // phpMyAdmin may take the first click as the start of a resize drag
    await click(page, '#pma_console > .toolbar .console_switch')
    await options.waitFor({ state: 'visible', timeout: 5000 })
  })
}

const runInConsole = async (page: Page) => {
  await page.locator('#pma_console .query_input .console_query_input').first().click()
  await page.keyboard.type(`SELECT COUNT(*) FROM \`${FIX.db}\`.\`${FIX.table}\``)
  await page.keyboard.press('Control+Enter')
  await page.waitForTimeout(1500)
}

// the console: toolbar, query input, the Options card, the Bookmarks card and its Add card
const toolbar = (cls: string) => (page: Page) => click(page, `#pma_console > .toolbar .${cls}`)
const cardToolbar = (card: string, cls: string) => (page: Page) => click(page, `${card} .toolbar .${cls}`)
pageParity('console', {
  pma: { route: '/server/sql' },
  ours: { path: '/s/1/sql' },
  scope: 'console',
  sql: BOOKMARKS,
  interactions: [
    { name: 'open', pma: openConsole, ours: openConsole },
    // a query run from the console: its message with the actions (Expand, Requery, Edit, Explain …)
    { name: 'run a query', pma: runInConsole, ours: runInConsole },
    { name: 'options', pma: toolbar('options'), ours: toolbar('options') },
    {
      name: 'bookmarks',
      // phpMyAdmin: the card's own switch closes it; ours: the toolbar entry switches cards
      pma: async (p) => {
        await cardToolbar('#pma_console_options', 'switch_button')(p)
        await toolbar('bookmarks')(p)
      },
      ours: toolbar('bookmarks'),
    },
    {
      name: 'add bookmark',
      pma: cardToolbar('#pma_bookmarks', 'add'),
      ours: cardToolbar('#pma_bookmarks', 'add'),
    },
  ],
})

/** types a query into the SQL box (CodeMirror in both tools) and submits it with Go */
const runInBox =
  (sql: string) =>
  async (page: Page): Promise<void> => {
    const box = page.locator('#sqlqueryform .CodeMirror, #sqlqueryform .cm-editor').first()
    await box.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Delete')
    await page.keyboard.type(sql)
    await page.locator('#button_submit_query').click()
    await page
      .locator(
        '#sqlqueryresultsouter .alert, #sqlqueryresultsouter [role="alert"], #sqlqueryresultsouter .sqlqueryresults',
      )
      .first()
      .waitFor({ timeout: 15_000 })
    await page.waitForTimeout(800)
  }

// the results of the SQL box: the message card, the grid, "Query results operations" and the
// "Bookmark this SQL query" fieldset, for rows and for an empty result (no_results_returned.twig)
pageParity('table-sql-results', {
  pma: { route: '/table/sql', params: { db: FIX.db, table: FIX.table } },
  ours: { path: `/s/1/db/${FIX.db}/t/${FIX.table}/sql` },
  ready: { pma: '#sqlqueryform', ours: '#sqlqueryform' },
  scope: { pma: '#sqlqueryresultsouter', ours: '#sqlqueryresultsouter' },
  interactions: [
    {
      name: 'rows',
      pma: runInBox(`SELECT id FROM ${FIX.table}`),
      ours: runInBox(`SELECT id FROM ${FIX.table}`),
    },
    {
      name: 'empty result',
      pma: async (page) => {
        await page.locator('#togglequerybox').click()
        await runInBox(`SELECT id FROM ${FIX.table} WHERE 1 = 0`)(page)
      },
      ours: async (page) => {
        await page.locator('#togglequerybox').click()
        await runInBox(`SELECT id FROM ${FIX.table} WHERE 1 = 0`)(page)
      },
    },
  ],
})
