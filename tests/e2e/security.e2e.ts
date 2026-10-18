import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * docs/reference/security-review.md: a link to a page that carries SQL in its URL (Browse, Display
 * chart, GIS visualization, Edit, Export) never runs that SQL without the server's signature, as
 * phpMyAdmin ignores an unsigned GET sql_query. Objects prefixed m1sec_, per e2e server port.
 */
const RUN = process.env.BMA_E2E_PORT ?? '8099'
const DB = `m1sec_e2e_${RUN}`
const PROBE = `m1sec_probe_${RUN}`

const exists = async (db: string) => {
  const c = await mysql.createConnection(MYSQL)
  const [rows] = await c.query(
    'SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
    [db],
  )
  await c.end()
  return Number((rows as Array<{ n: number }>)[0]!.n) > 0
}

test.beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${PROBE}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, n INT); INSERT INTO ${DB}.t VALUES (1, 10)`)
  await c.end()
})
test.afterAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${PROBE}`)
  await c.end()
})

test.beforeEach(async () => {
  const c = await mysql.createConnection(MYSQL)
  await c.query(`DROP DATABASE IF EXISTS ${PROBE}`)
  await c.end()
})

const evil = encodeURIComponent(`CREATE DATABASE ${PROBE}`)

for (const [name, path] of [
  ['Browse', `/s/1/db/${DB}/t/t/browse?sql=${evil}`],
  ['Display chart (table)', `/s/1/db/${DB}/t/t/chart?sql=${evil}`],
  ['Display chart (server)', `/s/1/chart?sql=${evil}`],
] as const) {
  test(`${name}: an unsigned query of the URL is not run`, async ({ page }) => {
    await login(page)
    const answered = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/api/'))
    await page.goto(path)
    await answered
    await page.waitForLoadState('networkidle')
    expect(await exists(PROBE)).toBe(false)
  })
}

test('GIS visualization: an unsigned SELECT of the URL is not run (it only runs SELECTs)', async ({
  page,
}) => {
  await login(page)
  const point = encodeURIComponent("SELECT ST_GeomFromText('POINT(1 2)') AS g")
  await page.goto(`/s/1/db/${DB}/t/t/gis-visualization?sql=${point}`)
  await expect(page.getByText('No SQL query was set to fetch data.')).toBeVisible()
})

test('Edit: "Go back" after saving does not run an unsigned query of the URL', async ({ page }) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/t/browse`)
  const edit = page.locator('td.edit_row_anchor a').first()
  const href = await edit.getAttribute('href')
  // the attacker's variant of the row's Edit link: the Browse query swapped for its own
  const url = new URL(href ?? '', 'http://x')
  url.searchParams.set('sql', `CREATE DATABASE ${PROBE}`)
  url.searchParams.delete('sql_sig')
  await page.goto(`${url.pathname}${url.search}`)
  await page.locator('#buttonYes').click()
  await page.waitForLoadState('networkidle')
  expect(await exists(PROBE)).toBe(false)
})

test('Export: an unsigned sql_query of the URL is not exported (raw query export)', async ({ page }) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/t/t/export?single_table=true&raw_query=true&sql_query=${evil}`)
  await expect(page.locator('#buttonGo')).toBeVisible()
  await expect(page.locator('#showsqlquery')).toHaveCount(0)
  await expect(page.locator('input[name="sql_query"]')).toHaveCount(0)
})
