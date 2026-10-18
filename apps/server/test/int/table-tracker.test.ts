import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Tracker::handleQuery through the API (docs/features/04-table-level.md › Tracking): the statements
 * run on a tracked table are logged into its version.
 */
const DB = 'f04_it_tracker'
const PMADB = { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }
const clean = `DELETE FROM phpmyadmin.pma__tracking WHERE db_name = '${DB}';`
let root: mysql.Connection

async function logs(
  table: string,
): Promise<Array<{ version: number; schema_sql: string; data_sql: string }>> {
  const [r] = await root.query(
    `SELECT version, schema_sql, data_sql FROM phpmyadmin.pma__tracking WHERE db_name = '${DB}' AND table_name = '${table}' ORDER BY version`,
  )
  return r as Array<{ version: number; schema_sql: string; data_sql: string }>
}

async function run(a: ReturnType<typeof testApp>, sql: string) {
  const r = await a.req('POST', '/api/servers/1/query', { db: DB, sql })
  expect(r.status, JSON.stringify(r.json)).toBe(200)
}

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; ${clean}
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, v VARCHAR(10));
    CREATE TABLE ${DB}.u (id INT PRIMARY KEY);
    INSERT INTO phpmyadmin.pma__tracking (db_name, table_name, version, date_created, date_updated, schema_snapshot, schema_sql, data_sql, tracking, tracking_active)
      VALUES ('${DB}', 't', 1, NOW(), NOW(), '', '', '\n', 'ALTER TABLE,INSERT,UPDATE', 1);`)
})
afterAll(async () => {
  await root?.query(`${clean} DROP DATABASE IF EXISTS ${DB}`)
  await root?.end()
})

describe('Tracker::handleQuery', () => {
  it('logs tracked statements with "# log date user", skips untracked ones and other tables [p04-cc268e]', async () => {
    const a = testApp(testConfig({}, PMADB))
    await a.login()
    await run(a, `ALTER TABLE \`${DB}\`.\`t\` ADD c INT`)
    await run(a, "INSERT INTO t VALUES (1, 'a', 0)")
    // DELETE is not in the version's statement set; u is not tracked
    await run(a, 'DELETE FROM t WHERE id = 1')
    await run(a, 'INSERT INTO u VALUES (1)')
    // phpMyAdmin's own statements are marked /*NOTRACK*/
    await run(a, "/*NOTRACK*/ UPDATE t SET v = 'z'")
    await a.close()
    const [v1] = await logs('t')
    const user = MYSQL.user
    // the statement ends with ';', so no "\n" is added to it
    expect(v1?.schema_sql).toMatch(
      new RegExp(
        `^\\n# log \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d ${user}\\nALTER TABLE \`t\` ADD c INT;$`,
      ),
    )
    expect(v1?.data_sql).toMatch(
      new RegExp(`^\\n\\n# log [\\d: -]+ ${user}\\nINSERT INTO t VALUES \\(1, 'a', 0\\);$`),
    )
    expect(await logs('u')).toEqual([])
  })

  it('creates version 1 of a new table with tracking_version_auto_create [p04-cc268e]', async () => {
    const a = testApp(testConfig({}, { ...PMADB, tracking_version_auto_create: true }))
    await a.login()
    await run(a, 'CREATE TABLE n (id INT)')
    await a.close()
    const [v] = await logs('n')
    expect(v?.version).toBe(1)
    expect(v?.schema_sql).toContain('CREATE TABLE `n`')
  })
})
