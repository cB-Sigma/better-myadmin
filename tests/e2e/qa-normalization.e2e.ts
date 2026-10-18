import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL } from './fixtures.ts'

/**
 * The normalization wizard driven step by step like a user, as phpMyAdmin's normalization.js
 * runs it (compared side by side with the reference): 1NF (split a column, add a primary key,
 * move a repeating group, remove a redundant column), 2NF and 3NF. Objects prefixed m1qan_.
 */
const USER = 'm1qan_user'
const DB = 'm1qan_db'

async function sql(q: string): Promise<unknown[]> {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  try {
    return (await c.query(q))[0] as unknown[]
  } finally {
    await c.end()
  }
}

async function seed() {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE ep (emp_id INT NOT NULL, proj_id INT NOT NULL, emp_name VARCHAR(20), dept VARCHAR(20),
      dept_city VARCHAR(20), hours INT, phone1 VARCHAR(10), phone2 VARCHAR(10), PRIMARY KEY (emp_id, proj_id));
    INSERT INTO ep VALUES (1,1,'ann','eng','paris',5,'11','12'), (1,2,'ann','eng','paris',3,'11','12'),
      (2,1,'bob','ops','rome',7,'21',NULL), (3,2,'cy','eng','paris',2,'31','32');
    CREATE TABLE np (a VARCHAR(20), full_name VARCHAR(40), dup INT);
    INSERT INTO np VALUES ('x', 'ann lee', 1), ('y', 'bob ray', 2);`)
}

test.beforeAll(async () => {
  await seed()
  await sql(`DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`m1qan\\_db\`.* TO '${USER}'@'%';`)
})

test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
})

async function login(page: Page) {
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
}

const main = (page: Page) => page.locator('#mainContent')
const columns = async (table: string) =>
  (
    (await sql(
      `SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) c FROM information_schema.columns WHERE table_schema = '${DB}' AND table_name = '${table}'`,
    )) as Array<{ c: string | null }>
  )[0]?.c ?? null

test.beforeEach(async ({ page }) => {
  await seed()
  await login(page)
})

test('1NF → 3NF: repeating group, partial and transitive dependencies, step by step', async ({ page }) => {
  await page.goto(`/s/1/db/${DB}/t/ep/normalization`)
  await page.locator('#normalizeToRadio3').check()
  await page.locator('#normalizeTable').getByRole('button', { name: 'Go' }).click()
  await page.locator('#selectNonAtomicCol').selectOption('no_such_col')

  // 1.3: move phone1, phone2; the step comes back without them and without the confirmation
  await expect(main(page)).toContainText('Step 1.3 Move repeating groups')
  await main(page).locator('#extra input[value=phone1]').check()
  await main(page).locator('#extra input[value=phone2]').check()
  await page.locator('#moveRepeatingGroup').click()
  await expect(main(page)).toContainText('DROP columns phone1, phone2 from the table ep')
  await page.locator('input[name=repeatGroupTable]').fill('ep_phone')
  await page.locator('input[name=repeatGroupColumn]').fill('phone')
  await main(page).getByRole('button', { name: 'Go' }).click()
  // ajaxShowMessage(data.message, false): the message floats, the step starts afresh
  await expect(
    page.locator('.ajax_notification', { hasText: 'Selected repeating group has been moved' }),
  ).toBeVisible()
  await expect(main(page).locator('#extra input[value=phone1]')).toHaveCount(0)
  await expect(main(page)).not.toContainText('The following actions will be performed')
  await expect(page.locator('#pma_navigation_tree_content [data-name="ep_phone"]')).toBeVisible()
  await page.locator('.ajax_notification').click()
  await page.locator('#noRepeatingGroup').click()
  await page.locator('#noRedundantColumn').click()

  // 2.1: one form per column, as Normalization::getHtmlFor2NFstep1 (pk_N, data-colname)
  await expect(main(page)).toContainText('Step 2.1 Find partial dependencies')
  await expect(main(page).locator('#extra form#pk_1[data-colname="emp_name"]')).toHaveCount(1)
  for (const c of ['emp_name', 'dept', 'dept_city'])
    await main(page).locator(`#extra form[data-colname="${c}"] input[value=emp_id]`).check()
  await main(page).locator('#extra form[data-colname="hours"] input[value=emp_id]').check()
  await main(page).locator('#extra form[data-colname="hours"] input[value=proj_id]').check()
  await main(page).getByRole('button', { name: 'Done' }).click()
  await expect(main(page)).toContainText('emp_id -> emp_name,dept,dept_city')
  await page.locator('#goTo2NFFinish').click()

  // 3.1: td_N forms with their table; the note on its own line (<br>)
  await expect(main(page)).toContainText('Step 3.1 Find transitive dependencies')
  await expect(main(page).locator('#extra form#td_1[data-tablename="table2"]')).toHaveCount(1)
  expect(await main(page).locator('p').filter({ hasText: 'minimal set' }).innerHTML()).toContain('<br>')
  await main(page).locator('#extra form[data-colname="dept_city"] input[value=dept]').check()
  await main(page).getByRole('button', { name: 'Done' }).click()

  // 3.2: both rows of getHtmlForNewTables3NF, even with the repeated name "table2"
  await expect(main(page)).toContainText('Step 3.2 Confirm transitive dependencies')
  const rows = main(page).locator('#extra input[name="table2"]')
  await expect(rows).toHaveCount(2)
  await expect(main(page)).toContainText('emp_name, dept )')
  await page.locator('#goTo3NFFinish').click()
  await expect(main(page)).toContainText('The third step of normalization is complete.')
  // the reference ends with the same tables (the repeated name keeps the last proposal)
  expect(await columns('ep')).toBe('emp_id,proj_id,hours')
  expect(await columns('ep_phone')).toBe('emp_id,proj_id,phone')
  expect(await columns('table2')).toBe('dept,dept_city')
})

test('1NF: the split form and a new primary key column (Q75), then a redundant column', async ({ page }) => {
  await page.goto(`/s/1/db/${DB}/t/np/normalization`)
  await page.locator('#normalizeTable').getByRole('button', { name: 'Go' }).click()
  await page.locator('#selectNonAtomicCol').selectOption('full_name')
  await page.locator('#splitGo').click()
  // getHtmlForCreateNewColumn: the column cells only, #saveSplit / #cancelSplit
  const grid = page.locator('#newCols')
  await expect(grid.locator('select[name="field_key[0]"]')).toHaveCount(0)
  await expect(grid.locator('[name="online_transaction"]')).toHaveCount(0)
  await expect(grid.getByRole('button', { name: 'Preview SQL' })).toHaveCount(0)
  // an empty first name only takes the focus
  await page.locator('#saveSplit').click()
  await expect(grid.locator('input[name="field_name[0]"]')).toBeFocused()
  await grid.locator('input[name="field_name[0]"]').fill('first')
  await grid.locator('input[name="field_name[1]"]').fill('last')
  await page.locator('#saveSplit').click()
  await expect(page.locator('#selectNonAtomicCol option[value="full_name"]')).toHaveCount(0)
  expect(await columns('np')).toBe('a,dup,first,last')

  await page.locator('#selectNonAtomicCol').selectOption('no_such_col')
  await expect(main(page)).toContainText('Step 1.2 Have a primary key')
  await page.locator('#addNewPrimary').click()
  await expect(grid.locator('input[name="field_name[0]"]')).toHaveValue('np_id')
  await page.locator('#saveNewPrimary').click()
  await expect(main(page)).toContainText('Primary key added.')
  await expect(main(page)).toContainText('Step 1.3 Move repeating groups', { timeout: 10_000 })
  expect(
    String(((await sql(`SHOW CREATE TABLE ${DB}.np`)) as Array<Record<string, string>>)[0]?.['Create Table']),
  ).toContain('PRIMARY KEY (`np_id`)')
  await page.locator('#noRepeatingGroup').click()
  await main(page).locator('#extra input[value=dup]').check()
  await page.locator('#removeRedundant').click()
  await expect(main(page)).toContainText("The first step of normalization is complete for table 'np'.")
  expect(await columns('np')).toBe('a,first,last,np_id')
})
