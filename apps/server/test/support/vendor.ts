import mysql from 'mysql2/promise'
import { MYSQL } from './app.ts'

/**
 * The test server's vendor, read once (`SELECT VERSION()`), so the int suite runs against MySQL
 * (mysql84 :3306) and MariaDB (`BMA_TEST_PORT=3307`, mariadb11) alike: the helpers give what each
 * server reports, and where phpMyAdmin itself behaves differently on MariaDB the tests assert that.
 * docs/architecture/14-development-setup.md#mariadb
 */
const probe = await mysql.createConnection(MYSQL)
const [rows] = (await probe.query('SELECT VERSION() AS v')) as unknown as [Array<{ v: string }>]
const [csRows] = (await probe.query(
  "SELECT DEFAULT_COLLATE_NAME AS c FROM information_schema.CHARACTER_SETS WHERE CHARACTER_SET_NAME = 'utf8mb4'",
)) as unknown as [Array<{ c: string }>]
await probe.end()
const version = rows[0]?.v ?? ''

export const isMariaDb = /mariadb/i.test(version)

/** an INT column's type as SHOW COLUMNS reports it: MariaDB keeps the display width */
export const intType = (width = 11, unsigned = false) =>
  `${isMariaDb ? `int(${width})` : 'int'}${unsigned ? ' unsigned' : ''}`

/**
 * The server's default utf8mb4 collation, read from the server rather than hard-coded: it varies by
 * version (MySQL 8.x `utf8mb4_0900_ai_ci`, MariaDB 11.4+ `utf8mb4_uca1400_ai_ci`, MariaDB < 11.4
 * `utf8mb4_general_ci`), so the integration matrix's older MariaDB (10.11) needs the real value.
 */
export const utf8mb4Default = csRows[0]?.c ?? (isMariaDb ? 'utf8mb4_uca1400_ai_ci' : 'utf8mb4_0900_ai_ci')

/** Collation::buildDescription(utf8mb4Default) as phpMyAdmin renders it (uca1400 is "UCA 14.0.0" since upstream c348bc2e60). */
const UTF8MB4_DESCRIPTIONS: Record<string, string> = {
  utf8mb4_0900_ai_ci: 'Unicode (UCA 9.0.0), accent-insensitive, case-insensitive',
  utf8mb4_uca1400_ai_ci: 'Unicode (UCA 14.0.0), accent-insensitive, case-insensitive',
  utf8mb4_general_ci: 'Unicode (UCA 4.0.0), case-insensitive',
}
export const utf8mb4DefaultDescription =
  UTF8MB4_DESCRIPTIONS[utf8mb4Default] ?? 'Unicode (UCA 4.0.0), accent-insensitive, case-insensitive'

/** MariaDB has performance_schema off by default: SHOW DATABASES does not list it */
export const hasPerformanceSchema = !isMariaDb

/** Util::getServerType */
export const serverType = isMariaDb ? 'MariaDB' : 'MySQL'
