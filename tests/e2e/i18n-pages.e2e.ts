import { type Browser, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Translated pages beyond the login form (docs/architecture/10-i18n-and-accessibility.md), checked
 * against what the localized reference phpMyAdmin shows for the same catalogues: the plural form
 * of the table count under Structure (`%s table` / `%s tables` through ngettext, the count through
 * Util::formatNumber), the navigation panel's documentation link, and a tab label whose
 * translation carries HTML entities (get_icon prints it raw, so `&nbsp;` renders as a space).
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
  multipleStatements: true,
}
// per e2e server port: runs of other checkouts on the same MySQL drop and recreate their own account
const RUN = process.env.BMA_E2E_PORT ?? '8099'
const USER = `i18n_e2e_${RUN}`
const DB = `i18n_e2e${RUN}`

test.beforeAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE a (id INT); CREATE TABLE b (id INT); CREATE TABLE c (id INT);
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`${DB}\`.* TO '${USER}'@'%';`)
  await c.end()
})

test.afterAll(async () => {
  const c = await mysql.createConnection(ROOT)
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})

async function openIn(browser: Browser, baseURL: string | undefined, lang: string) {
  const context = await browser.newContext(baseURL !== undefined ? { baseURL } : {})
  const page = await context.newPage()
  await page.goto(`/?lang=${lang}`)
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
  await page.goto(`/s/1/db/${DB}/structure`)
  await expect(page.locator('#tbl_summary_row')).toBeVisible()
  return { page, context }
}

// what the localized UI shows for 3 tables, with the product name read as BetterMyAdmin (pl and ru: three forms; de: `n != 1` is a
// boolean, so motranslator always picks form 0; ja: one form)
const CASES = [
  { lang: 'pl', tables: '3 tabel', docs: 'Dokumentacja BetterMyAdmina', dir: 'ltr' },
  { lang: 'ru', tables: '3 таблицы', docs: 'Документация BetterMyAdmin', dir: 'ltr' },
  { lang: 'de', tables: '3 Tabelle', docs: 'BetterMyAdmin-Dokumentation', dir: 'ltr' },
  { lang: 'ja', tables: '3 テーブル', docs: 'BetterMyAdminのドキュメント', dir: 'ltr' },
  { lang: 'ar', tables: '3 جداول', docs: 'مستندات وثائقية لـ BetterMyAdmin (بالإنجليزية)', dir: 'rtl' },
]

for (const c of CASES) {
  test(`${c.lang}: table count plural, navigation strings [p01-728b8d]`, async ({ browser, baseURL }) => {
    const { page, context } = await openIn(browser, baseURL, c.lang)
    try {
      await expect(page.locator('html')).toHaveAttribute('dir', c.dir)
      await expect(page.locator('#tbl_summary_row th.tbl_num')).toHaveText(c.tables)
      await expect(page.locator(`#pma_navigation a[title="${c.docs}"]`)).toHaveCount(1)
    } finally {
      await context.close()
    }
  })
}

test('ru: a tab label with &nbsp; in its translation renders the spaces [p01-728b8d]', async ({
  browser,
  baseURL,
}) => {
  const { page, context } = await openIn(browser, baseURL, 'ru')
  try {
    // "Query" → "Запрос&nbsp;по&nbsp;шаблону"
    const tab = page.locator('[data-tab="query"]').first()
    await expect(tab).toHaveText('Запрос по шаблону')
    await expect(page.getByText('&nbsp;')).toHaveCount(0)
  } finally {
    await context.close()
  }
})
