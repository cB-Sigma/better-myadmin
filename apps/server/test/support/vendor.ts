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
await probe.end()
const version = rows[0]?.v ?? ''

export const isMariaDb = /mariadb/i.test(version)

/** an INT column's type as SHOW COLUMNS reports it: MariaDB keeps the display width */
export const intType = (width = 11, unsigned = false) =>
  `${isMariaDb ? `int(${width})` : 'int'}${unsigned ? ' unsigned' : ''}`

/** the server's default utf8mb4 collation */
export const utf8mb4Default = isMariaDb ? 'utf8mb4_uca1400_ai_ci' : 'utf8mb4_0900_ai_ci'

/** Collation::buildDescription of utf8mb4Default (phpMyAdmin knows no UCA 14.0.0: utf8mb4 is "UCA 4.0.0") */
export const utf8mb4DefaultDescription = isMariaDb
  ? 'Unicode (UCA 4.0.0), accent-insensitive, case-insensitive'
  : 'Unicode (UCA 9.0.0), accent-insensitive, case-insensitive'

/** MariaDB has performance_schema off by default: SHOW DATABASES does not list it */
export const hasPerformanceSchema = !isMariaDb

/** Util::getServerType */
export const serverType = isMariaDb ? 'MariaDB' : 'MySQL'
