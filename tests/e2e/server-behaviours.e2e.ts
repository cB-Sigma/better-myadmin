import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { GeneralLog } from '../parity/lib/general-log.ts'

/**
 * The browser behaviours of the server-level pages (docs/features/06-server-level.md, the
 * `js:server/*`, `js:replication.ts` claims of apps/web/src/features/server/pma-controls.ts):
 * Databases, Processes, status variables, server variables, replication on the primary and the
 * Monitor (settings, add chart, import/export, instructions, log analysis, query analyzer).
 * The replica's behaviours are in server-replica.e2e.ts.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
// per e2e server port: runs of other checkouts on the same MySQL drop and recreate their own account
const RUN = process.env.BMA_E2E_PORT ?? '8099'
const USER = `f06j_e2e_${RUN}`
const DB = `f06j_e2e_db_${RUN}`

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB}_new;
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON *.* TO '${USER}'@'%'; CREATE DATABASE ${DB}`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB}_new;
    DROP USER IF EXISTS '${USER}'@'%'; DROP USER IF EXISTS 'f06j_repl'@'%'`)
  await c.end()
})

async function login(page: Page) {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.getByRole('link', { name: 'Databases' }).first()).toBeVisible()
}

/** The next window.alert / confirm text (accepted). */
function nextDialog(page: Page): Promise<string> {
  return new Promise((resolve) => {
    page.once('dialog', (d) => {
      resolve(d.message())
      void d.accept()
    })
  })
}

test('databases: empty name alert, create, sort links, check all, drop', async ({ page }) => {
  await login(page)
  await page.goto('/s/1/databases')
  // strFormEmpty: the HTML5 `required` is the first guard, the script's check the second
  await page.locator('#text_create_db').evaluate((el) => el.removeAttribute('required'))
  const alert = nextDialog(page)
  await page.locator('#buttonGo').click()
  expect(await alert).toBe('Missing value in the form!')

  // submit #create_database_form.ajax → POST, then the new database's structure page (dbStructUrl)
  await page.locator('#text_create_db').fill(`${DB}_new`)
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/databases$/.test(r.url()))
  await page.locator('#buttonGo').click()
  expect((await created).ok()).toBe(true)
  await expect(page).toHaveURL(new RegExp(`/s/1/db/${DB}_new`))

  await page.goto('/s/1/databases')
  await page.locator('#dbStatsTable thead').getByRole('button', { name: 'Collation' }).click()
  await expect(page).toHaveURL(/sort_by=DEFAULT_COLLATION_NAME/)
  await page
    .locator('#dbStatsTable thead')
    .getByRole('button', { name: /^Database/ })
    .click()
  await expect(page).toHaveURL(/sort_by=SCHEMA_NAME/)
  await expect(page.locator('#dbStatsTable thead [aria-label="Ascending"]')).toBeVisible()

  await page.locator('#filterText').fill(`${DB}_new`)
  await page.locator('#checkAllCheckbox').check()
  await expect(page.locator(`input[name="selected_dbs[]"][value="${DB}_new"]`)).toBeChecked()
  // submit #dbStatsForm → #dropDatabaseModal → #dropDatabaseModalDropButton → POST (parts[0])
  await page.locator('#bulkActionDropButton').click()
  await expect(page.locator('#dropDatabaseModal')).toContainText(`DROP DATABASE \`${DB}_new\`;`)
  const dropped = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/databases\/drop/.test(r.url()),
  )
  await page.locator('#dropDatabaseModalDropButton').click()
  expect((await dropped).ok()).toBe(true)
  await expect(page.getByText(/databases? (has|have) been dropped successfully/)).toBeVisible()
  await expect(page.locator(`tr[data-filter-row="${DB.toUpperCase()}_NEW"]`)).toHaveCount(0)
})

test('processes: refresh rate, auto refresh, header sort, full queries [p06-9768f8] [p06-0b7c03] [p06-5727d3]', async ({
  page,
}) => {
  await login(page)
  await page.goto('/s/1/status/processes')
  await page.locator('#id_refreshRate').selectOption('2')
  await page.locator('#toggleRefresh').click()
  await expect(page.locator('#toggleRefresh')).toHaveText('Stop auto refresh')
  // the list is fetched again every 2 s while the refresh runs
  const refetch = await page.waitForResponse((r) => /\/status\/processes/.test(r.url()), { timeout: 10_000 })
  expect(refetch.ok()).toBe(true)
  await page.locator('#toggleRefresh').click()
  await expect(page.locator('#toggleRefresh')).toHaveText('Start auto refresh')

  await page.locator('#tableprocesslist thead .sortlink', { hasText: 'Time' }).click()
  await expect(page).toHaveURL(/order_by_field=Time/)
  await page.locator('#tableprocesslist thead').getByRole('button', { name: 'Show full queries' }).click()
  await expect(page).toHaveURL(/full=true/)
  await expect(
    page.locator('#tableprocesslist thead').getByRole('button', { name: 'Truncate shown queries' }),
  ).toBeVisible()

  // "Show only active" submits by itself (autosubmit); Refresh fetches the list again
  await page.locator('#showExecuting').check()
  await expect(page).toHaveURL(/showExecuting=true/)
  const refreshed = page.waitForResponse((r) => /\/status\/processes/.test(r.url()))
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  expect((await refreshed).ok()).toBe(true)
  // system users have no privileges link, the others link to their account; db cells to the database
  const rowsOf = page.locator('#tableprocesslist tbody tr')
  await expect(rowsOf.first()).toBeVisible()
  await page.locator('#showExecuting').uncheck()
  const own = page.locator('#tableprocesslist tbody tr', { hasText: USER }).first()
  await expect(own.locator('td').nth(2).getByRole('link', { name: USER })).toHaveAttribute(
    'href',
    new RegExp(`/privileges\\?username=${USER}`),
  )
})

test('status variables: word, alert, category and unformatted filters [p06-65e09f]', async ({ page }) => {
  await login(page)
  await page.goto('/s/1/status/variables')
  const rows = page.locator('#serverStatusVariables tbody tr:visible')
  // keyup #filterText: `(^| )bytes received`, also Mysqlx_bytes_received…
  await page.locator('#filterText').pressSequentially('bytes_received')
  await expect(rows.first()).toContainText(/^Bytes received/)
  for (const name of await rows.locator('th.name').allInnerTexts())
    expect(name).toMatch(/(^| )bytes received/i)
  const formatted = (await rows.first().locator('td').first().innerText()).trim()
  await page.locator('#dontFormat').check()
  await expect(rows.first().locator('td').first()).not.toHaveText(formatted)
  await expect(rows.first().locator('td').first()).toHaveText(/^\d+$/)
  await page.locator('#dontFormat').uncheck()

  await page.locator('#filterText').fill('')
  await page.locator('#filterCategory').selectOption('innodb')
  await expect(rows.first()).toContainText(/^Innodb/)
  await expect(page.locator('#linkSuggestions')).toContainText('InnoDB Status')
  await page.locator('#filterCategory').selectOption('')
  await page.locator('#filterAlert').check()
  const alerts = await rows.count()
  expect(alerts).toBe(await page.locator('#serverStatusVariables tbody tr:visible td .text-error').count())
  await page.locator('#filterAlert').uncheck()

  // an invalid regular expression marks the field (.error) and filters nothing
  await page.locator('#filterText').fill('uptime(')
  await expect(page.locator('#filterText')).toHaveClass(/\berror\b/)
  await page.locator('#filterText').fill('uptime')
  await expect(page.locator('#filterText')).not.toHaveClass(/\berror\b/)
  // Refresh reloads the values and keeps the filters
  const refreshed = page.waitForResponse((r) => /\/status\/variables/.test(r.url()))
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  expect((await refreshed).ok()).toBe(true)
  await expect(page.locator('#filterText')).toHaveValue('uptime')
  await expect(rows.first()).toContainText(/^Uptime/)
})

test('status pages without SHOW GLOBAL STATUS: each page shows its own error [p06-032e98]', async ({
  page,
}) => {
  await login(page)
  // the API answers of an account whose SHOW GLOBAL STATUS fails (Data::$dataLoaded false)
  await page.route(/\/api\/servers\/1\/status(\/(queries|variables|advisor))?(\?.*)?$/, async (route) => {
    const r = await route.fetch()
    const json = { ...(await r.json()), isDataLoaded: false }
    await route.fulfill({ response: r, json })
  })
  for (const [path, message] of [
    ['', 'Not enough privilege to view server status.'],
    ['/queries', 'Not enough privilege to view query statistics.'],
    ['/variables', 'Not enough privilege to view status variables.'],
    ['/advisor', 'Not enough privilege to view the advisor.'],
  ]) {
    await page.goto(`/s/1/status${path}`)
    await expect(page.getByText(message)).toBeVisible()
  }
})

test('server variables: edit, Escape, Cancel and Save [p06-d139b2]', async ({ page }) => {
  const c = await mysql.createConnection(ROOT)
  const [rows] = await c.query('SELECT @@GLOBAL.max_connect_errors AS v')
  const original = Number((rows as Array<{ v: number }>)[0]!.v)
  try {
    await login(page)
    await page.goto('/s/1/variables?filter=max_connect_errors')
    const row = page.locator('tr[data-filter-row="MAX_CONNECT_ERRORS"]').first()
    // click a.editLink → GET /server/variables/get/<name>
    const get = page.waitForResponse((r) => /\/variables\/max_connect_errors$/.test(r.url()))
    await row.locator('.editLink').click()
    expect((await get).ok()).toBe(true)
    await row.locator('input').press('Escape')
    await expect(row.locator('input')).toHaveCount(0)
    await row.locator('.editLink').click()
    await row.locator('.cancelLink').click()
    await expect(row.locator('input')).toHaveCount(0)
    await row.locator('.editLink').click()
    await row.locator('input').fill('4343')
    // click $mySaveLink → POST /server/variables/set/<name>
    const set = page.waitForResponse(
      (r) => r.request().method() !== 'GET' && /\/variables\/max_connect_errors$/.test(r.url()),
    )
    await row.locator('.saveLink').click()
    expect((await set).ok()).toBe(true)
    await expect(row.locator('td.var-value')).toHaveText('4,343')
  } finally {
    await c.query(`SET GLOBAL max_connect_errors = ${original}`)
    await c.end()
  }
})

test('replication on the primary: status toggles, replica user password, configuration wizard [p06-3af6a2]', async ({
  page,
}) => {
  await login(page)
  await page.goto('/s/1/replication')
  await page.locator('#primary_status_href').click()
  await expect(page.locator('#serverprimaryreplicationsummary')).toBeVisible()
  await page.locator('#primary_status_href').click()
  await expect(page.locator('#serverprimaryreplicationsummary')).toHaveCount(0)
  await page.locator('#primary_replicas_href').click()
  await expect(page.locator('#replication_replicas_section')).toBeVisible()
  await page.locator('#primary_replicas_href').click()
  await expect(page.locator('#replication_replicas_section')).toHaveCount(0)

  await page.locator('#primary_addreplicauser_href').click()
  await page.locator('#button_generate_password').click()
  const generated = await page.locator('#generated_pw').inputValue()
  expect(generated.length).toBeGreaterThan(8)
  await expect(page.locator('#text_pma_pw')).toHaveValue(generated)
  await expect(page.locator('#text_pma_pw2')).toHaveValue(generated)

  await page.goto('/s/1/replication?view=primary_configure')
  const rep = page.locator('#rep')
  await expect(rep).toContainText('log_bin=mysql-bin')
  await page.locator('#db_select').selectOption([DB])
  await expect(rep).toContainText(`binlog_ignore_db=${DB}`)
  await page.locator('#db_type').selectOption('ign')
  await expect(rep).toContainText(`binlog_do_db=${DB}`)
  await page.locator('#db_select_href').click()
  expect((await rep.innerText()).match(/binlog_do_db=/g)?.length ?? 0).toBeGreaterThan(1)
  await page.locator('#db_reset_href').click()
  await expect(rep).not.toContainText('binlog_do_db=')
})

test('binary log: the query card runs its links through /sql [p06-debfa6]', async ({ page }) => {
  await login(page)
  await page.goto('/s/1/binlog')
  const card = page.locator('.result_query').first()
  await expect(card).toContainText('SHOW BINLOG EVENTS LIMIT 0, 25')
  for (const link of ['Edit inline', 'Edit', 'Create PHP code', 'Refresh'])
    await expect(card.getByRole('button', { name: link, exact: true })).toBeVisible()
  // Refresh: phpMyAdmin's /sql result (the grid of SHOW BINLOG EVENTS) in place of the page
  const ran = page.waitForResponse((r) => r.request().method() === 'POST' && /\/query$/.test(r.url()))
  await card.getByRole('button', { name: 'Refresh', exact: true }).click()
  expect((await ran).ok()).toBe(true)
  await expect(page.locator('#sqlqueryresultsouter')).toContainText('Event_type')
  await page.goto('/s/1/binlog')
  await page.locator('.result_query').first().getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page).toHaveURL(/\/s\/1\/sql\?sql=SHOW/)
})

test('plugins: jump buttons, status badges, sortable tables but the Description column [p06-e5aa2e]', async ({
  page,
}) => {
  await login(page)
  await page.goto('/s/1/plugins')
  const engines = page.locator('#plugins-storageengine')
  await expect(page.getByRole('link', { name: 'STORAGE ENGINE' })).toHaveAttribute(
    'href',
    '#plugins-storageengine',
  )
  const names = () =>
    engines.locator('tbody th').evaluateAll((ths) => ths.map((th) => th.firstChild?.textContent ?? ''))
  const asc = await names()
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  expect(asc).toEqual([...asc].sort(cmp))
  await engines.locator('thead').getByRole('button', { name: 'Plugin' }).click()
  expect(await names()).toEqual([...asc].sort(cmp).reverse())
  await engines.locator('thead').getByRole('button', { name: 'License' }).click()
  await expect(engines.locator('thead th[aria-sort="ascending"]')).toHaveText('License')
  await expect(engines.locator('thead th', { hasText: 'Description' }).getByRole('button')).toHaveCount(0)
})

/** Monitor: everything but the charts' pixels. */
test.describe('monitor', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/s/1/status/monitor')
    await page.evaluate(() => {
      for (const k of ['monitorCharts', 'monitorSettings', 'monitorVersion']) localStorage.removeItem(k)
    })
    await page.reload()
    await expect(page.locator('#chartGrid .monitorChart').first()).toBeVisible()
  })

  test('pause/resume, settings, rearranging, export, import and reset [p06-f985d3] [p06-94e73a]', async ({
    page,
  }) => {
    const chart = page.waitForResponse((r) => /\/status\/monitor\/chart$/.test(r.url()))
    await page.locator('#monitorPauseResumeButton').click()
    expect((await chart).ok()).toBe(true)
    await expect(page.locator('#monitorPauseResumeButton')).toHaveText('Resume monitor')
    await page.locator('#monitorPauseResumeButton').click()
    await expect(page.locator('#monitorPauseResumeButton')).toHaveText('Pause monitor')

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('#monitorChartRefreshRateSelect').selectOption('10')
    await page.locator('#monitorChartColumnsSelect').selectOption('2')
    await expect(page.locator('#chartGrid')).toHaveAttribute('style', /repeat\(2,/)
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('monitorSettings') ?? '{}'))
    expect(stored).toMatchObject({ columns: 2, gridRefresh: 10_000 })

    await page.locator('#monitorRearrangeChartButton').click()
    await expect(page.locator('#chartGrid .monitorChart').first()).toHaveAttribute('draggable', 'true')
    await page.locator('#monitorDoneRearrangeChartButton').click()
    await expect(page.locator('#chartGrid .monitorChart').first()).toHaveAttribute('draggable', 'false')

    const download = page.waitForEvent('download')
    await page.locator('#monitorExportConfigButton').click()
    const file = await download
    expect(file.suggestedFilename()).toBe('monitor-config.json')
    const exported = JSON.parse(
      await (await file.createReadStream()).toArray().then((b) => Buffer.concat(b).toString()),
    )
    expect(Object.keys(exported)).toEqual(['monitorCharts', 'monitorSettings'])

    const importFile = async (contents: string) => {
      await page.getByRole('button', { name: 'Import' }).click()
      await expect(page.locator('#monitorImportConfigModal')).toBeVisible()
      await page
        .locator('#import_file')
        .setInputFiles({ name: 'c.json', mimeType: 'application/json', buffer: Buffer.from(contents) })
      const alert = nextDialog(page)
      await page.locator('#monitorImportConfigImportButton').click()
      return alert
    }
    expect(await importFile('{not json')).toBe(
      "Failed parsing config file. It doesn't seem to be valid JSON code.",
    )
    expect(await importFile(JSON.stringify({ monitorCharts: exported.monitorCharts }))).toBe(
      'Failed building chart grid with imported config. Resetting to default config…',
    )
    // a valid file: one chart only
    const first = Object.keys(exported.monitorCharts)[0]!
    await page.getByRole('button', { name: 'Import' }).click()
    await page.locator('#import_file').setInputFiles({
      name: 'c.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          monitorCharts: { [first]: exported.monitorCharts[first] },
          monitorSettings: exported.monitorSettings,
        }),
      ),
    })
    await page.locator('#monitorImportConfigImportButton').click()
    await expect(page.locator('#monitorImportConfigModal')).toHaveCount(0)
    await expect(page.locator('#chartGrid .monitorChart')).toHaveCount(1)

    await page.locator('#monitorResetConfigButton').click()
    await expect(page.locator('#chartGrid .monitorChart')).toHaveCount(
      Object.keys(exported.monitorCharts).length,
    )
  })

  test('add chart: presets, series with divisor and unit, clear, the empty-series alert [p06-3de1f6]', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const charts = await page.locator('#chartGrid .monitorChart').count()
    const dialog = page.locator('#addChartModal')
    const title = dialog.locator('input[name="chartTitle"]')

    await page.locator('#monitorAddNewChartButton').click()
    await expect(dialog).toBeVisible()
    await dialog.locator('select[name="presetCharts"]').selectOption({ index: 1 })
    const presetTitle = await dialog.locator('select[name="presetCharts"] option:checked').innerText()
    await expect(title).toHaveValue(presetTitle)
    await expect(dialog.locator('#chartPreset')).toBeChecked()
    await dialog.locator('#chartStatusVar').click()
    await expect(dialog.locator('#chartVariableSettings')).toBeVisible()
    await dialog.locator('#chartPreset').click()
    await expect(title).toHaveValue(presetTitle)
    await dialog.locator('#addChartButton').click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('#chartGrid .monitorChart')).toHaveCount(charts + 1)

    await page.locator('#monitorAddNewChartButton').click()
    await dialog.locator('#chartStatusVar').click()
    await dialog.locator('#chartSeries').selectOption('Bytes_sent')
    await expect(dialog.locator('#variableInput')).toHaveValue('Bytes_sent')
    await expect(title).toHaveValue('Bytes sent')
    await dialog.locator('#useDivisor').check()
    await dialog.getByRole('button', { name: 'KiB' }).click()
    await expect(dialog.locator('input[name="valueDivisor"]')).toHaveValue('1024')
    await expect(dialog.locator('#useUnit')).toBeChecked()
    await expect(dialog.locator('input[name="valueUnit"]')).toHaveValue('KiB')
    await dialog.getByRole('button', { name: 'MiB' }).click()
    await expect(dialog.locator('input[name="valueDivisor"]')).toHaveValue('1048576')
    await dialog.locator('#useUnit').uncheck()
    await expect(dialog.locator('input[name="valueUnit"]')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Add this series' }).click()
    await expect(dialog.locator('#seriesPreview')).toContainText('Bytes sent')
    await dialog.getByRole('button', { name: 'Clear series' }).click()
    await expect(dialog.locator('#seriesPreview')).toHaveText('None')
    // strAddOneSeriesWarning: a status-variable chart without series
    const alert = nextDialog(page)
    await dialog.locator('#addChartButton').click()
    expect(await alert).toBe('Please add at least one variable to the series!')
    await expect(dialog).toHaveCount(0)

    await page.locator('#monitorAddNewChartButton').click()
    await dialog.locator('#chartStatusVar').click()
    await dialog.locator('#variableInput').fill('Questions')
    await dialog.getByRole('button', { name: 'Add this series' }).click()
    await dialog.locator('#addChartButton').click()
    await expect(page.locator('#chartGrid .monitorChart')).toHaveCount(charts + 2)
    await page.locator('#monitorAddNewChartButton').click()
    await dialog.locator('#closeModalButton').click()
    await expect(dialog).toHaveCount(0)
  })

  test('instructions: log variables and a set link [p06-f985d3]', async ({ page }) => {
    const c = await mysql.createConnection(ROOT)
    const [rows] = await c.query('SELECT @@GLOBAL.long_query_time AS v')
    const original = Number((rows as Array<{ v: number }>)[0]!.v)
    try {
      const vars = page.waitForResponse((r) => /\/status\/monitor\/log-vars$/.test(r.url()))
      await page.getByRole('button', { name: 'Instructions/Setup' }).click()
      expect((await vars).ok()).toBe(true)
      const modal = page.locator('#monitorInstructionsModal')
      await expect(modal).toContainText('Current settings')
      const set = modal.locator('a.set, button.set', { hasText: /^Set long_query_time to \d+ seconds\.$/ })
      const target = (await set.innerText()).match(/\d+/)![0]
      const posted = page.waitForResponse(
        (r) => r.request().method() === 'POST' && /\/log-vars$/.test(r.url()),
      )
      await set.click()
      expect((await posted).ok()).toBe(true)
      await expect
        .poll(async () => {
          const [r] = await c.query('SELECT @@GLOBAL.long_query_time AS v')
          return Number((r as Array<{ v: number }>)[0]!.v)
        })
        .toBe(Number(target))
    } finally {
      await c.query(`SET GLOBAL long_query_time = ${original}`)
      await c.end()
    }
  })

  test('refresh failure modal with Reload; a cancelled analysis; an empty slow log [p06-94e73a] [p06-599f02]', async ({
    page,
  }) => {
    // "Monitor refresh failed": a chart refresh that gets no answer
    await page.route(/\/status\/monitor\/chart$/, (route) => route.abort())
    const failed = page.locator('#serverResponseErrorModal')
    await expect(failed).toBeVisible({ timeout: 15_000 })
    await expect(failed).toContainText(
      'While requesting new chart data the server returned an invalid response.',
    )
    await page.unroute(/\/status\/monitor\/chart$/)
    const reloaded = page.waitForEvent('load')
    await page.locator('#serverResponseErrorModalReloadButton').click()
    await reloaded
    await expect(page.locator('#serverResponseErrorModal')).toHaveCount(0)
    await page.waitForResponse((r) => /\/status\/monitor\/chart$/.test(r.url()))

    // the loading dialog cancels the log request (logRequest.abort())
    let release = () => {}
    await page.route(/\/status\/monitor\/general-log$/, (route) => {
      release = () => void route.abort().catch(() => {})
    })
    await page.locator('#chartGrid .monitorChart canvas').first().click()
    await expect(page.locator('#logAnalyseModal')).toBeVisible()
    await page.locator('#logAnalyseModalGeneralLogButton').click()
    const loading = page.locator('#analysingLogsModal')
    await expect(loading).toContainText('Analysing and loading logs. This may take a while.')
    await loading.getByRole('button', { name: 'Cancel request' }).click()
    await expect(loading).toHaveCount(0)
    release()
    await expect(page.locator('#serverResponseErrorModal')).toHaveCount(0)
    await page.unroute(/\/status\/monitor\/general-log$/)

    // the slow log of the window is empty on the dev servers (slow_query_log off): "No data found"
    const c = await mysql.createConnection(ROOT)
    const [[slow]] = (await c.query('SELECT @@GLOBAL.slow_query_log AS s')) as unknown as [[{ s: number }]]
    await c.end()
    test.skip(Number(slow.s) === 1, 'the slow log is on: the window may have rows')
    await page.locator('#chartGrid .monitorChart canvas').first().click()
    const posted = page.waitForResponse((r) => /\/status\/monitor\/slow-log$/.test(r.url()))
    await page.locator('#logAnalyseModalSlowLogButton').click()
    expect((await posted).ok()).toBe(true)
    const none = page.locator('#analysingLogsNoDataFoundModal')
    await expect(none).toBeVisible()
    await none.getByRole('button', { name: 'Close' }).last().click()
    await expect(none).toHaveCount(0)
  })

  test('log analysis from the general log, then the query analyzer [p06-599f02] [p06-d6900b] [p06-95d2b5]', async ({
    page,
  }) => {
    const c = await mysql.createConnection(ROOT)
    const [[vars]] = (await c.query(
      'SELECT @@GLOBAL.general_log AS g, @@GLOBAL.log_output AS o',
    )) as unknown as [[{ g: number; o: string }]]
    test.skip(
      Number(vars.g) !== 1 || !vars.o.includes('TABLE'),
      'the general log is not written to mysql.general_log',
    )
    // a registered reader of mysql.general_log: no other checkout rotates (truncates) it until the
    // analysis has read the probes (tests/parity/lib/log-holders.ts)
    const holder = await GeneralLog.open(ROOT)
    try {
      // a SELECT of this session inside the analysed span
      const conn = await mysql.createConnection({ ...ROOT, user: USER, password: USER })
      for (let i = 0; i < 3; i++) await conn.query(`SELECT ${i} AS ${USER}_probe FROM DUAL`)
      await conn.end()

      // the monitor runs from the start. The span a click analyses ends at the last refresh, and the
      // log query compares whole seconds: wait for a refresh *sent* a second after the probes (one
      // already in flight would end the span before them)
      const probed = Date.now()
      const refresh = await page.waitForRequest(
        (r) => /\/status\/monitor\/chart$/.test(r.url()) && Date.now() > probed + 1000,
        { timeout: 30_000 },
      )
      await refresh.response()
      // two frames: the new point is committed and the chart's axis updated (read on click)
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      await page.locator('#chartGrid .monitorChart canvas').first().click()
      const modal = page.locator('#logAnalyseModal')
      await expect(modal).toBeVisible()
      // the selected span ends after the probes
      const end = await modal.locator('input[name="dateEnd"]').inputValue()
      expect(Date.parse(end.replace(' ', 'T'))).toBeGreaterThan(probed)
      await modal.locator('#removeVariables').check()
      const log = page.waitForResponse((r) => /\/status\/monitor\/general-log$/.test(r.url()))
      await page.locator('#logAnalyseModalGeneralLogButton').click()
      expect((await log).ok()).toBe(true)
      const loaded = page.locator('#analysingLogsLogDataLoadedModal')
      await expect(loaded).toBeVisible()
      await page.locator('#analysingLogsLogDataLoadedModalJumpButton').click()
      await expect(loaded).toHaveCount(0)

      const table = page.locator('#logTable')
      await expect(table).toBeVisible()
      if ((await table.locator('#filterQueryText').count()) > 0) {
        // keyup #filterQueryText filters at once; above 250 rows #startFilterQueryText applies it
        await table.locator('#filterQueryText').fill(`${USER}_probe`)
        if ((await table.locator('#startFilterQueryText').count()) > 0)
          await table.locator('#startFilterQueryText').click()
        await expect(table.locator('tbody tr').first()).toContainText(`${USER}_probe`)
        await table.locator('#noWHEREData').check()
        await expect(table.locator('tbody tr').first()).toContainText(`${USER}_probe`)
        await table.locator('#noWHEREData').uncheck()
      }
      // click <$tCell>: a SELECT opens the query analyzer
      await table
        .locator('td.queryCell', { hasText: `${USER}_probe` })
        .first()
        .click()
      const analyzer = page.locator('#queryAnalyzerModal')
      await expect(analyzer).toBeVisible()
      await expect(analyzer.locator('#sqlquery')).toHaveValue(new RegExp(`${USER}_probe`))
      const analysed = page.waitForResponse((r) => /\/status\/monitor\/query$/.test(r.url()))
      await page.locator('#queryAnalyzerModalAnalyseButton').click()
      expect((await analysed).ok()).toBe(true)
      const placeholder = analyzer.locator('.placeHolder')
      await expect(placeholder).toContainText('Explain output')
      if ((await placeholder.locator('[data-href="#showNums"]').count()) > 0) {
        await expect(placeholder.locator('table.queryNums')).toBeVisible()
        await expect(placeholder.locator('#queryProfilingCanvas')).toBeVisible()
        await placeholder.locator('[data-href="#showNums"]').click()
        await expect(placeholder.locator('#queryProfilingCanvas')).toBeHidden()
        await placeholder.locator('[data-href="#showChart"]').click()
        await expect(placeholder.locator('table.queryNums')).toHaveCount(0)
        await expect(placeholder.locator('#queryProfilingCanvas')).toBeVisible()
      }
      await analyzer.getByRole('button', { name: 'Close' }).last().click()
      await expect(analyzer).toHaveCount(0)
    } finally {
      await holder.close()
      await c.end()
    }
  })
})
