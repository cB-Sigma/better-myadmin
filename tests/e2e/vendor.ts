import mysql from 'mysql2/promise'
import { MYSQL } from './fixtures.ts'

/**
 * The e2e target's vendor, probed once and cached. The browser suites run against one server per job
 * (MySQL on :3306 or MariaDB on :3307), so where phpMyAdmin itself behaves differently on MariaDB —
 * a duplicate-key error names the key without the table, no "integer width is ignored" notice, JSON
 * is a longtext and is not pretty-printed — the test asserts the behaviour that server actually has.
 * A cached async probe (not a top-level await) keeps the Playwright loader happy.
 */
let cached: boolean | undefined
export async function isMariaDb(): Promise<boolean> {
  if (cached === undefined) {
    const c = await mysql.createConnection(MYSQL)
    const [rows] = (await c.query('SELECT VERSION() AS v')) as unknown as [Array<{ v: string }>]
    await c.end()
    cached = /mariadb/i.test(rows[0]?.v ?? '')
  }
  return cached
}
