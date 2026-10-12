import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Table Operations end to end: table options, maintenance, copy, truncate (confirmation with the
 * foreign key checks box) and drop.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
const USER = 'f04ops_e2e'
const DB = 'f04ops_e2e'

async function sql<T = unknown>(q: string): Promise<T> {
  const c = await mysql.createConnection(ROOT)
  try {
    const [rows] = await c.query(q)
    return rows as T
  } finally {
    await c.end()
  }
}

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, name VARCHAR(10)) COMMENT 'old';
    INSERT INTO ${DB}.t VALUES (1, 'a'), (2, 'b');
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`f04ops\\_e2e\`.* TO '${USER}'@'%';`)
})

test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
})

test('table options, maintenance, copy, truncate and drop', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()

  await page.goto(`/s/1/db/${DB}/t/t/operations`)
  await expect(page.getByRole('heading', { name: 'Table operations' })).toBeVisible()
  // InnoDB with a primary key: no "Alter table order by"
  await expect(page.locator('#alterTableOrderby')).toHaveCount(0)

  // table options: the comment
  await page.locator('#tableCommentsInput').fill('new comment')
  await page.locator('#tableOptionsForm').getByRole('button', { name: 'Go' }).click()
  await expect(page.locator('.result_query').first()).toContainText('ALTER TABLE `t`')
  await expect
    .poll(
      async () =>
        (
          await sql<Array<{ c: string }>>(
            `SELECT TABLE_COMMENT c FROM information_schema.TABLES WHERE TABLE_SCHEMA='${DB}' AND TABLE_NAME='t'`,
          )
        )[0]?.c,
    )
    .toBe('new comment')

  // maintenance: check table
  await page.getByRole('button', { name: 'Check table' }).click()
  await expect(page.getByTestId('maintenance-result')).toContainText('OK')

  // copy (structure and data)
  await page.locator('#copyTable input[name=new_name]').fill('t_copy')
  await page.locator('#copyTable').getByRole('button', { name: 'Go' }).click()
  // the copy runs after the click returns: wait for its message before reading the new table
  // (expect.poll does not retry a query that throws "doesn't exist")
  await expect(
    page.getByText('Table `f04ops_e2e`.`t` has been copied to `f04ops_e2e`.`t_copy`.'),
  ).toBeVisible()
  await expect.poll(async () => (await sql<unknown[]>(`SELECT * FROM ${DB}.t_copy`)).length).toBe(2)

  // truncate: confirmation with the foreign key checks box
  await page.locator('#truncate_tbl_anchor').click()
  await expect(page.locator('#functionConfirmModal')).toContainText(
    'You are about to TRUNCATE a complete table!',
  )
  await expect(page.locator('#fk_checks')).toBeChecked()
  await page.locator('#functionConfirmOkButton').click()
  await expect.poll(async () => (await sql<unknown[]>(`SELECT * FROM ${DB}.t`)).length).toBe(0)

  // drop: back to the database
  await page.locator('#drop_tbl_anchor').click()
  await page.locator('#functionConfirmOkButton').click()
  await expect(page).toHaveURL(new RegExp(`/s/1/db/${DB}(/structure)?$`))
  expect(await sql<unknown[]>(`SHOW TABLES FROM ${DB} LIKE 't'`)).toHaveLength(0)
})
