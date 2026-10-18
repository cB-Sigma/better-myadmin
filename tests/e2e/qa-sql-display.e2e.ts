import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL } from './fixtures.ts'

/**
 * Queries phpMyAdmin posts to /sql (SqlController) or runs from MultiTableQueryController, compared
 * with the reference: the SQL is shown as posted (no import buffer ";"), and a query over several
 * tables has no table context (no unique-column notice). Objects prefixed m1qas_.
 */
const USER = 'm1qas_user'
const DB = 'm1qas_db'

async function sql(q: string): Promise<unknown[]> {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  try {
    return (await c.query(q))[0] as unknown[]
  } finally {
    await c.end()
  }
}

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE parent (id INT PRIMARY KEY, name VARCHAR(20));
    CREATE TABLE child (id INT PRIMARY KEY, parent_id INT, note VARCHAR(20));
    INSERT INTO parent VALUES (1, 'alpha'), (2, 'zeta');
    INSERT INTO child VALUES (1, 1, 'zeta note'), (2, 2, 'other');
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`m1qas\\_db\`.* TO '${USER}'@'%';`)
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

const UNIQUE = 'Current selection does not contain a unique column.'

test('search results → Browse and Refresh: the select is shown without a ";"', async ({ page }) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/search`)
  await page.locator('#criteriaSearchString').fill('zeta')
  await page.locator('#select_all').click()
  await page.locator('#buttonGo').click()
  await page.locator('#searchresults .browse_results').first().click()
  const shown = page.locator('#browse-results .sqlOuter').first()
  await expect(shown).toContainText("LIKE '%zeta%')")
  expect((await shown.innerText()).trim()).toMatch(/'%zeta%'\)$/)
  // the card's Refresh is a signed /sql link as well
  await page.locator('#browse-results').getByRole('button', { name: 'Refresh' }).first().click()
  await expect(page.locator('#browse-results .sqlOuter').first()).toContainText("LIKE '%zeta%')")
  expect((await page.locator('#browse-results .sqlOuter').first().innerText()).trim()).toMatch(/'%zeta%'\)$/)
})

test('multi-table query: a join has no table context, one table keeps the notice', async ({ page }) => {
  await login(page)
  await page.goto(`/s/1/db/${DB}/multi-table-query`)
  const results = page.locator('#sql_results')
  const fill = async (q: string) => {
    await page.locator('.cm-content').first().click()
    await page.keyboard.press('Control+a')
    await page.keyboard.insertText(q)
  }
  await fill(
    'SELECT `parent`.`name`, `child`.`note` FROM `parent` LEFT JOIN `child` ON `parent`.`id` = `child`.`parent_id`',
  )
  await page.locator('#submit_query').click()
  await expect(results).toContainText('zeta note')
  await expect(results).not.toContainText(UNIQUE)
  expect((await results.locator('.sqlOuter').first().innerText()).trim()).toMatch(/`parent_id`$/)
  // ParseAnalyze takes the one table from the SQL: Sql.php then checks it
  // each submit replaces the results ($('#sql_results').html(data))
  await fill('SELECT `name` FROM `parent`')
  await page.locator('#submit_query').click()
  await expect(results.locator('.sqlOuter').first()).toHaveText('SELECT `name` FROM `parent`')
  await expect(results).toContainText(UNIQUE)
})
