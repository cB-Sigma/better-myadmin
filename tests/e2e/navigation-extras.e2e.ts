import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * The navigation's Recent and Favorites lists end to end: visited tables show up in Recent, a
 * Favorites star of the database Structure page in Favorites, and an entry opens the table.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f04navx_e2e'
const DB = 'f04navx_e2e'

async function sql(q: string): Promise<void> {
  const c = await mysql.createConnection(ROOT)
  await c.query(q)
  await c.end()
}

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.a (id INT); CREATE TABLE ${DB}.b (id INT);
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f04navx\\_e2e\`.* TO '${USER}'@'%';`)
})

test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
})

test('Recent and Favorites', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
  const nav = page.locator('#pma_navigation')

  await nav.getByRole('button', { name: 'Recent' }).click()
  await expect(page.getByText('There are no recent tables.')).toBeVisible()
  await page.keyboard.press('Escape')

  // every table page adds its table to Recent (RecentTableHandling)
  for (const t of ['a', 'b']) {
    const added = page.waitForResponse((r) => r.url().endsWith('/recent') && r.request().method() === 'POST')
    await page.goto(`/s/1/db/${DB}/t/${t}/structure`)
    await added
  }
  await expect(page.locator('#structure_content')).toBeVisible()
  await nav.getByRole('button', { name: 'Recent' }).click()
  const recent = page.locator('#recentTableList')
  await expect(recent.getByRole('menuitem')).toHaveText([`\`${DB}\`.\`b\``, `\`${DB}\`.\`a\``])
  await recent.getByRole('menuitem', { name: `\`${DB}\`.\`a\`` }).click()
  await expect(page).toHaveURL(new RegExp(`/db/${DB}/t/a/browse`))

  // the database Structure page's star adds a favorite
  await page.goto(`/s/1/db/${DB}/structure`)
  await page
    .locator('tr', { has: page.getByRole('link', { name: 'b', exact: true }) })
    .locator('.favorite_table_anchor')
    .first()
    .click()
  await nav.getByRole('button', { name: 'Favorites' }).click()
  await expect(page.locator('#favoriteTableList')).toContainText(`\`${DB}\`.\`b\``)
})
