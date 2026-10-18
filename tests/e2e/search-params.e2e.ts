import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * Every SPA route opened with phpMyAdmin-style query values that are odd for what the route reads:
 * `true`, numbers, empty strings, `k[]=` lists, nested maps, JSON-looking text and repeated keys.
 * phpMyAdmin reads them as `$_GET` strings and never fails on their shape; neither may we: no route
 * may end on the router's error screen or throw in the page (apps/web/src/lib/search.ts).
 */
const DB = 'f05_odd'
const web = join(import.meta.dirname, '../../apps/web/src')

async function sql(q: string): Promise<void> {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  try {
    await c.query(q)
  } finally {
    await c.end()
  }
}

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })

/** every route path (catch-alls left out), its parameters filled in */
const params: Record<string, string> = {
  server: '1',
  db: DB,
  table: 't',
  engine: 'InnoDB',
  page: 'Status',
  tab: 'features',
  formset: 'Features',
  id: '1',
}
const routes = [...readFileSync(join(web, 'routeTree.gen.ts'), 'utf8').matchAll(/fullPath: '([^']+)'/g)]
  .map((m) => m[1] as string)
  .filter((p, i, all) => !p.endsWith('/$') && all.indexOf(p) === i)
  .map((p) => p.replace(/\$(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? 'x')))

/** every search key a route validator reads */
const keys = [
  ...new Set(
    files(web)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'))
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/^\s+(\w+): qs\./gm)].map((m) => m[1] as string)),
  ),
]

const variants: Array<(k: string) => string> = [
  (k) => `${k}=true&${k}=1`,
  (k) => `${k}[]=a&${k}[]=1`,
  (k) => `${k}=`,
  (k) => `${k}[x][y]=null&${k}=%5B1%5D`,
  (k) => `${k}=-1&${k}=1.0e3abc`,
]

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, v VARCHAR(10)); INSERT INTO ${DB}.t VALUES (1, 'a')`)
})
test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}`)
})

test('every route reads odd query values like $_GET, without crashing', async ({ page }) => {
  test.setTimeout(30 * 60_000)
  expect(routes.length).toBeGreaterThan(70)
  expect(keys).toEqual(expect.arrayContaining(['single_table', 'pos', 'sql', 'full', 'where', 'dbname']))
  const errors: string[] = []
  let at = ''
  page.on('pageerror', (e) => errors.push(`${at}: ${e.message}`))
  await login(page)
  const failed: string[] = []
  for (const route of routes) {
    for (const v of variants) {
      at = `${route}?${keys.map(v).join('&')}`
      await page.goto(at)
      await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => undefined)
      if ((await page.getByText('Something went wrong!').count()) > 0) failed.push(at)
    }
  }
  expect(failed).toEqual([])
  expect(errors).toEqual([])
})
