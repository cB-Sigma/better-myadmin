import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'
import { isMariaDb } from './vendor.ts'

/**
 * Status › Slow queries (BetterMyAdmin only, parity exception X65): the digest list with its
 * database filter and sorting, the detail with the formatted statement and EXPLAIN of the sample,
 * the reset confirmation, the slow-log source and MariaDB's "performance_schema is off" note.
 */
const RUN = process.env.BMA_E2E_PORT ?? '8099'
const DB = `m65sq_e2e${RUN}`

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, a VARCHAR(10), KEY (a));
    INSERT INTO ${DB}.t VALUES (1,'x'),(2,'y'),(3,'z')`)
  await c.query(`USE ${DB}`)
  for (let i = 0; i < 4; i++) await c.query(`SELECT * FROM t WHERE a = 'v${i}'`)
  await c.query('SELECT COUNT(*) FROM t WHERE id > 1')
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection(MYSQL)
  await c.query(`DROP DATABASE IF EXISTS ${DB}`)
  await c.end()
})

test('digests: list, filter, sort, detail with EXPLAIN, reset confirmation', async ({ page }) => {
  test.skip(await isMariaDb(), 'MariaDB has performance_schema off: covered by the next test')
  await login(page)
  await page.goto('/s/1/status')
  await page.locator('#statusPills').getByRole('link', { name: 'Slow queries' }).click()
  await expect(page).toHaveURL(/\/s\/1\/status\/slow-queries/)
  await expect(page.getByRole('heading', { name: 'Slow queries' })).toBeVisible()
  await page.locator('#slowQueriesDb').selectOption(DB)
  await expect(page).toHaveURL(new RegExp(`db=${DB}`))
  const table = page.locator('#slowQueriesTable')
  // (not the EXPLAIN of it a previous run left in the summary)
  const row = table.locator('tbody tr', {
    has: page.locator('.slow-query-open', { hasText: /^SELECT \* FROM `t` WHERE `a` = \?$/ }),
  })
  await expect(row).toBeVisible()
  // the summary outlives the database: earlier runs add to the count
  await expect(row.locator('[data-col="count"]')).toHaveText(/^\d+$/)
  expect(Number(await row.locator('[data-col="count"]').textContent())).toBeGreaterThanOrEqual(4)
  expect(await table.locator('tbody tr').count()).toBeGreaterThanOrEqual(2)

  // sort by count: descending first, then ascending
  await table.locator('th[data-sort="count"] button').click()
  await expect(page).toHaveURL(/sort=count/)
  await expect(table.locator('th[data-sort="count"]')).toHaveAttribute('aria-sort', 'descending')
  await expect(table.locator('tbody tr').first()).toContainText(/^SELECT \* FROM `t` WHERE `a` = \?/)
  await table.locator('th[data-sort="count"] button').click()
  await expect(table.locator('th[data-sort="count"]')).toHaveAttribute('aria-sort', 'ascending')
  await expect(page).toHaveURL(/order=asc/)
  const counts = await table.locator('tbody [data-col="count"]').allTextContents()
  expect(counts.map(Number)).toEqual([...counts.map(Number)].sort((a, b) => a - b))

  // detail: the formatted digest, the sample with its values, EXPLAIN on demand
  await row.locator('.slow-query-open').click()
  const dialog = page.locator('#slowQueryDetail')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('#slowQueryFormatted')).toContainText('SELECT')
  expect(await dialog.locator('#slowQueryFormatted').textContent()).toContain('\n')
  await expect(dialog.locator('#slowQuerySample')).toContainText(/SELECT \* FROM t WHERE a = 'v\d'/)
  await expect(dialog.locator('#slowQueryOpenSql')).toHaveAttribute(
    'href',
    new RegExp(`/db/${DB}/sql\\?sql=`),
  )
  await dialog.locator('#slowQueryExplain').click()
  const result = dialog.locator('#slowQueryExplainResult')
  await expect(result).toContainText("EXPLAIN SELECT * FROM t WHERE a = 'v")
  await expect(result.locator('th', { hasText: /^key$/ })).toBeVisible()
  await expect(result.locator('tbody tr').first()).toContainText('t')
  await dialog.getByRole('button', { name: 'Close' }).last().click()
  await expect(dialog).toBeHidden()

  // reset asks first; dismissing keeps the statistics
  await page.locator('#slowQueriesReset').click()
  const confirm = page.getByRole('alertdialog').filter({ hasText: 'Reset the statement statistics' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Close' }).last().click()
  await expect(confirm).toBeHidden()
  await expect(row).toBeVisible()
})

test('MariaDB without performance_schema: how to enable it instead of an error', async ({ page }) => {
  test.skip(!(await isMariaDb()), 'MySQL has performance_schema on')
  await login(page)
  await page.goto('/s/1/status/slow-queries')
  await expect(page.locator('[data-reason="pfs-off"]')).toContainText('performance_schema is off')
  await expect(page.locator('[data-reason="pfs-off"] a')).toHaveAttribute('href', /mariadb\.com/)
  await expect(page.locator('#slowQueriesTable')).toHaveCount(0)
})

test('slow log source: entries grouped by normalized query, EXPLAIN of the newest', async ({ page }) => {
  const c = await mysql.createConnection({ ...MYSQL, database: DB })
  const [rows] = (await c.query('SELECT @@GLOBAL.slow_query_log AS v')) as unknown as [Array<{ v: number }>]
  const before = String(rows[0]?.v) === '1' ? 'ON' : 'OFF'
  try {
    await c.query('SET GLOBAL slow_query_log = ON')
    // a new session: MariaDB copies slow_query_log into each session when it connects
    const logged = await mysql.createConnection({ ...MYSQL, database: DB })
    await logged.query('SET SESSION long_query_time = 0')
    await logged.query("SELECT id FROM t WHERE a = 'x'")
    await logged.query("SELECT id FROM t WHERE a = 'y'")
    await logged.end()
    await login(page)
    await page.goto(`/s/1/status/slow-queries?source=slowlog&db=${DB}`)
    await expect(page.locator('#slowQueriesSource')).toHaveValue('slowlog')
    await expect(page.locator('#slowQueriesSettings')).toContainText('long_query_time')
    const row = page.locator('#slowQueriesTable tbody tr', { hasText: 'SELECT id FROM t WHERE a = ?' })
    // earlier runs' entries of the same database stay in mysql.slow_log
    await expect(row.locator('[data-col="count"]')).toHaveText(/^\d+$/)
    expect(Number(await row.locator('[data-col="count"]').textContent())).toBeGreaterThanOrEqual(2)
    await row.locator('.slow-query-open').click()
    const dialog = page.locator('#slowQueryDetail')
    await expect(dialog.locator('#slowQuerySample')).toContainText("SELECT id FROM t WHERE a = 'y'")
    await dialog.locator('#slowQueryExplain').click()
    await expect(dialog.locator('#slowQueryExplainResult')).toContainText(
      "EXPLAIN SELECT id FROM t WHERE a = 'y'",
    )
  } finally {
    await c.query(`SET GLOBAL slow_query_log = ${before}`)
    await c.end()
  }
})
