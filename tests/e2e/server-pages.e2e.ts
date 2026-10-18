import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Smoke test of the server-level pages (docs/features/06-server-level.md): every page renders its
 * phpMyAdmin texts and controls; create/drop a database, kill a process, inline-edit a variable.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'm3srv_e2e'

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS m3srv_e2e_new; DROP USER IF EXISTS '${USER}'@'%';
    CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}'; GRANT ALL ON *.* TO '${USER}'@'%'`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS m3srv_e2e_new; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

async function login(page: Page) {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.getByRole('link', { name: 'Databases' }).first()).toBeVisible()
}

test('databases: list, statistics, create and drop', async ({ page }) => {
  await login(page)
  await page.goto('/s/1/databases')
  await expect(page.getByRole('heading', { name: 'Databases', exact: true })).toBeVisible()
  await expect(page.locator('#dbStatsTable')).toContainText('information_schema')
  await page.getByRole('button', { name: 'Enable statistics' }).click()
  await expect(page.getByRole('heading', { name: 'Databases statistics' })).toBeVisible()
  await expect(page.locator('#dbStatsTable thead')).toContainText('Overhead')

  await page.locator('#text_create_db').fill('m3srv_e2e_new')
  await page.locator('#buttonGo').click()
  await expect(page).toHaveURL(/\/s\/1\/db\/m3srv_e2e_new/)

  await page.goto('/s/1/databases')
  await page.locator('#filterText').fill('m3srv_e2e')
  await page.locator('input[name="selected_dbs[]"][value="m3srv_e2e_new"]').check()
  await page.locator('#bulkActionDropButton').click()
  await expect(page.locator('#dropDatabaseModal')).toContainText('DROP DATABASE `m3srv_e2e_new`;')
  await page.locator('#dropDatabaseModalDropButton').click()
  await expect(page.getByText('1 database has been dropped successfully.')).toBeVisible()
})

test('status pages: overview, processes with kill, queries, variables, advisor [p06-bc85e3] [p06-9768f8] [p06-cac377] [p06-44265d]', async ({
  page,
}) => {
  await login(page)
  await page.goto('/s/1/status')
  await expect(page.getByText(/^Network traffic since startup: /)).toBeVisible()
  await expect(page.locator('#connectionsTable')).toContainText('Max. concurrent connections')
  await expect(page.locator('#statusPills a[aria-current="page"]')).toHaveText('Server')

  const sleeper = await mysql.createConnection(ROOT)
  void sleeper.query('SELECT SLEEP(60) AS m3srv_e2e_sleep').catch(() => {})
  try {
    await page.getByRole('link', { name: 'Processes' }).click()
    const row = page.locator(`tr[data-process-id="${sleeper.threadId}"]`)
    await expect(row).toContainText('m3srv_e2e_sleep')
    await row.getByRole('button', { name: 'Kill' }).click()
    await expect(page.getByText(`Thread ${sleeper.threadId} was successfully killed.`)).toBeVisible()
    await expect(row).toHaveCount(0)
  } finally {
    sleeper.destroy()
  }
  await page.locator('#toggleRefresh').click()
  await expect(page.locator('#toggleRefresh')).toHaveText('Stop auto refresh')
  await page.locator('#toggleRefresh').click()

  await page.getByRole('link', { name: 'Query statistics' }).click()
  await expect(page.getByText(/^Questions since startup:/)).toBeVisible()
  await expect(page.locator('#serverStatusQueriesDetails')).toContainText('Select')
  // the Chart.js pie of queries.ts: a slice per statement type, "Number of statements" in its tooltip
  await expect(page.locator('#query-statistics-chart path').first()).toBeAttached()
  await expect(page.locator('#query-statistics-chart path title').first()).toContainText(
    'Number of statements',
  )

  await page.getByRole('link', { name: 'All status variables' }).click()
  await page.locator('#filterText').fill('uptime')
  await expect(page.locator('#serverStatusVariables tbody tr').first()).toContainText('Uptime')
  await page.locator('#filterCategory').selectOption('innodb')
  await expect(page.locator('#linkSuggestions')).toContainText('InnoDB Status')

  await page.getByRole('link', { name: 'Advisor' }).click()
  await expect(page.getByRole('heading', { name: 'Advisor system' })).toBeVisible()
  await page.getByRole('button', { name: 'Instructions' }).click()
  await expect(page.locator('#advisorInstructionsModal')).toContainText('rule of thumb')
})

test('variables: filter and inline edit [p06-162a8d] [p06-d139b2]', async ({ page }) => {
  const c = await mysql.createConnection(ROOT)
  const [rows] = await c.query('SELECT @@GLOBAL.max_connect_errors AS v')
  const original = Number((rows as Array<{ v: number }>)[0]!.v)
  try {
    await login(page)
    await page.goto('/s/1/variables?filter=max_connect')
    await expect(page.getByRole('heading', { name: 'Server variables and settings' })).toBeVisible()
    const row = page.locator('tr[data-filter-row="MAX_CONNECT_ERRORS"]').first()
    await row.getByRole('button', { name: 'Edit' }).click()
    const input = row.locator('input')
    await input.fill('4242')
    await input.press('Enter')
    await expect(row.locator('td.var-value')).toHaveText('4,242')
  } finally {
    await c.query(`SET GLOBAL max_connect_errors = ${original}`)
    await c.end()
  }
})

test('charsets, engines, plugins, binary log [p06-b19775] [p06-e1da5c] [p06-e5aa2e] [p06-debfa6]', async ({
  page,
}) => {
  await login(page)
  await page.goto('/s/1/collations')
  await expect(page.getByRole('heading', { name: 'Character sets and collations' })).toBeVisible()
  await expect(page.locator('[data-charset="utf8mb4"]')).toContainText(
    'Unicode (UCA 4.0.0), case-insensitive',
  )

  await page.goto('/s/1/engines')
  await page.getByRole('link', { name: 'InnoDB', exact: true }).click()
  await expect(page.getByText('InnoDB is the default storage engine on this MySQL server.')).toBeVisible()
  await page.getByRole('link', { name: 'Buffer Pool' }).click()
  await expect(page.locator('#bufferPool')).toContainText('Buffer pool usage')
  await page.getByRole('link', { name: 'InnoDB Status' }).click()
  await expect(page.locator('#pre_innodb_status')).toContainText('INNODB MONITOR OUTPUT')

  await page.goto('/s/1/plugins')
  await expect(page.locator('#plugins-storageengine')).toContainText('InnoDB')

  await page.goto('/s/1/binlog')
  await expect(page.getByRole('heading', { name: 'Binary log' })).toBeVisible()
  await expect(page.getByText('SHOW BINLOG EVENTS LIMIT 0, 25')).toBeVisible()
  await page.getByTitle('Next').click()
  await expect(page.getByText('SHOW BINLOG EVENTS LIMIT 25, 25')).toBeVisible()
})
