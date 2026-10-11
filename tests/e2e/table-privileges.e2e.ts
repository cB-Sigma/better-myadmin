import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Table Privileges end to end: the accounts with access to the table, the table-specific row of
 * an account with a table grant, and the edit link into the user editor with the table preset.
 * (The e2e server runs without configuration storage, so the central-columns actions are
 * covered by tests/parity/table-central-privileges.parity.test.ts and the UI parity cases.)
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const ADMIN = 'f04prv_e2e_admin'
const USER = 'f04prv_e2e_user'
const DB = 'f04prv_e2e'

async function sql<T = unknown>(q: string): Promise<T> {
  const c = await mysql.createConnection(ROOT)
  const [rows] = await c.query(q)
  await c.end()
  return rows as T
}

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY);
    DROP USER IF EXISTS '${ADMIN}'@'%'; CREATE USER '${ADMIN}'@'%' IDENTIFIED BY '${ADMIN}';
    GRANT ALL ON *.* TO '${ADMIN}'@'%' WITH GRANT OPTION;
    DROP USER IF EXISTS '${USER}'@'localhost'; CREATE USER '${USER}'@'localhost' IDENTIFIED BY 'x';
    GRANT DELETE, ALTER ON ${DB}.t TO '${USER}'@'localhost';`)
})

test.afterAll(async () => {
  await sql(
    `DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${ADMIN}'@'%'; DROP USER IF EXISTS '${USER}'@'localhost'`,
  )
})

test('the accounts with access to the table', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input_username').fill(ADMIN)
  await page.locator('#input_password').fill(ADMIN)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()

  await page.goto(`/s/1/db/${DB}/t/t/privileges`)
  await expect(page.getByRole('heading', { name: `Users having access to "${DB}.t"` })).toBeVisible()
  const row = page.locator('#usersForm tr', { hasText: USER })
  await expect(row).toContainText('table-specific')
  await expect(row).toContainText('DELETE, ALTER')
  const edit = row.locator('a.edit_user_anchor')
  await expect(edit).toHaveAttribute('href', new RegExp(`dbname=${DB}&tablename=t&`))
  await expect(page.locator('#add_user_anchor')).toHaveAttribute('href', /tablename=t/)
})
