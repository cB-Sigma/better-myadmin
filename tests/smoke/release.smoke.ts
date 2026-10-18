import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * The release, end to end: the production server serves the built SPA (hashed assets cached
 * forever), the setup script is closed because a configuration file exists, a MySQL account logs
 * in with cookie auth and browses a table.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f07_smoke'
const DB = 'f07_smoke'

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE fruit (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(40)) ENGINE=InnoDB;
    INSERT INTO fruit (name) VALUES ('apple'), ('banana'), ('cherry');
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f07\\_smoke\`.* TO '${USER}'@'%';`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

test('serves the built app, setup closed', async ({ request }) => {
  const index = await request.get('/')
  expect(index.status()).toBe(200)
  const html = await index.text()
  const asset = /\/assets\/[^"]+\.js/.exec(html)?.[0]
  expect(asset).toBeDefined()
  const js = await request.get(asset as string)
  expect(js.status()).toBe(200)
  expect(js.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
  // a client route falls back to the SPA
  expect((await request.get('/s/1/db/x/t/y/browse')).status()).toBe(200)
  const setup = await request.get('/api/setup')
  expect(await setup.json()).toMatchObject({
    error: { message: 'Configuration already exists, setup is disabled!' },
  })
})

test('logs in and browses a table', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
  // the navigation tree: the database, then the table
  await page.locator('#pma_navigation').getByRole('link', { name: DB, exact: true }).click()
  await page.locator('#pma_navigation').getByRole('link', { name: 'fruit', exact: true }).click()
  // the table's default action is Browse
  await expect(page).toHaveURL(new RegExp(`/db/${DB}/t/fruit/browse`))
  await expect(page.getByRole('status').filter({ hasText: /Showing rows 0 -\s+2 \(3 total/ })).toBeVisible()
  await expect(page.locator('table.table_results tbody tr')).toHaveCount(3)
  await expect(page.locator('table.table_results tbody')).toContainText('banana')
})
