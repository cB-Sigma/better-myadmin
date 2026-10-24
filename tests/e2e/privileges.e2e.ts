import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Server → User accounts end to end (docs/features/06-server-level.md): the overview, Add user
 * account with a global privilege, the editor at database level (with the grant option, which
 * phpMyAdmin drops on MySQL ≥ 8.0.11 — exception X40), and Remove selected user accounts.
 * Statement parity is covered by tests/parity/privileges.parity.test.ts.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const ADMIN = 'f06u_e2e_admin'
const USER = 'f06u_e2e_u'
const DB = 'f06u_e2e_db'

async function sql<T = unknown>(q: string): Promise<T> {
  const c = await mysql.createConnection(ROOT)
  const [rows] = await c.query(q)
  await c.end()
  return rows as T
}
const grants = async (account: string) =>
  (await sql<Array<Record<string, string>>>(`SHOW GRANTS FOR ${account}`)).map((r) => Object.values(r)[0])
const exists = async (user: string) =>
  (await sql<unknown[]>(`SELECT 1 FROM mysql.user WHERE User = '${user}'`)).length > 0

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    DROP USER IF EXISTS '${USER}'@'%';
    DROP USER IF EXISTS '${ADMIN}'@'%'; CREATE USER '${ADMIN}'@'%' IDENTIFIED BY '${ADMIN}';
    GRANT ALL ON *.* TO '${ADMIN}'@'%' WITH GRANT OPTION;`)
})

test.afterAll(async () => {
  await sql(
    `DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'; DROP USER IF EXISTS '${ADMIN}'@'%'`,
  )
})

test('add a user account, grant a database with the grant option, remove it', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input_username').fill(ADMIN)
  await page.locator('#input_password').fill(ADMIN)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()

  // the overview lists the logged-in account
  await page.goto('/s/1/privileges')
  await expect(page.getByRole('heading', { name: 'User accounts overview' })).toBeVisible()
  await expect(page.locator('#userRightsTable')).toContainText(ADMIN)

  // Add user account: user name, any host, password, global SELECT
  await page.locator('#add_user_anchor').click()
  await expect(page.getByRole('heading', { name: 'Add user account' })).toBeVisible()
  await page.locator('#pma_username').fill(USER)
  await page.locator('#select_pred_hostname').selectOption('any')
  await page.locator('#text_pma_pw').fill('E2e_secret_1')
  await page.locator('#text_pma_pw2').fill('E2e_secret_1')
  await page.locator('#addUsersForm input[name="Select_priv"]').check()
  await page.locator('#adduser_submit').click()
  await expect(page.getByText('You have added a new user.')).toBeVisible()
  await expect(page.locator('#edit_user_dialog')).toContainText(`'${USER}'@'%'`)
  // Generator::getMessage: the message and its query card (Edit inline / Edit / Create PHP code)
  // come first, before the user page's pills (QA: they followed the pills, without the links)
  const card = page.locator('#edit_user_dialog > .result_query').first()
  await expect(card).toContainText('CREATE USER')
  for (const link of ['Edit inline', 'Edit', 'Create JS code']) {
    await expect(
      card
        .getByRole('button', { name: link, exact: true })
        .or(card.getByRole('link', { name: link, exact: true }))
        .first(),
    ).toBeVisible()
  }
  expect(
    await page
      .locator('#edit_user_dialog')
      .evaluate(
        (d) =>
          [...d.children].findIndex((c) => c.classList.contains('result_query')) <
          [...d.children].findIndex((c) => c.matches('ul.nav-pills')),
      ),
  ).toBe(true)
  expect((await grants(`'${USER}'@'%'`)).join('\n')).toMatch(/GRANT SELECT ON \*\.\* TO /)

  // the editor at database level: INSERT with GRANT
  const dbname = DB.replaceAll('_', '\\_')
  await page.goto(`/s/1/privileges/user?username=${USER}&hostname=%25&dbname=${encodeURIComponent(dbname)}`)
  await expect(page.locator('#edit_user_dialog')).toContainText(`Database ${dbname}`)
  await page.locator('#addUsersForm input[name="Insert_priv"]').check()
  await page.locator('#addUsersForm input[name="Grant_priv"]').check()
  await page.locator('#addUsersForm input[type="submit"][value="Update user privileges"]').click()
  await expect(page.getByText(`You have updated the privileges for '${USER}'@'%'.`)).toBeVisible()
  // X40: the grant option is kept (phpMyAdmin loses it on MySQL ≥ 8.0.11)
  expect(await grants(`'${USER}'@'%'`)).toContain(
    `GRANT INSERT ON \`${dbname}\`.* TO \`${USER}\`@\`%\` WITH GRANT OPTION`,
  )

  // Remove selected user accounts
  await page.goto('/s/1/privileges')
  await page.locator(`#userRightsTable input[name="selected_usr[]"][value^="${USER}&"]`).check()
  await page.locator('#buttonGo').click()
  await page.getByRole('button', { name: 'OK' }).click()
  await expect(page.getByText('The selected users have been deleted successfully.')).toBeVisible()
  expect(await exists(USER)).toBe(false)
})
