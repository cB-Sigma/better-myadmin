import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Tracker::handleQuery end to end: a statement of the SQL box in a database whose table has an
 * active version is appended to that version's log; with tracking_version_auto_create a created
 * table starts version 1. (tests/parity/table-tracking-log.parity.test.ts compares the statements
 * with phpMyAdmin.)
 */
const DB = 'f01a_trk'
let root: mysql.Connection

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(
    `DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; CREATE TABLE ${DB}.t (id INT PRIMARY KEY);`,
  )
  await root.query('DELETE FROM phpmyadmin.pma__tracking WHERE db_name = ?', [DB])
  await root.query(
    "INSERT INTO phpmyadmin.pma__tracking (db_name, table_name, version, date_created, date_updated, schema_snapshot, schema_sql, data_sql, tracking, tracking_active) VALUES (?, 't', 1, NOW(), NOW(), '', '', '\n', 'INSERT,CREATE TABLE', 1)",
    [DB],
  )
})
afterAll(async () => {
  await root?.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root?.query('DELETE FROM phpmyadmin.pma__tracking WHERE db_name = ?', [DB])
  await root?.end()
})

describe('Tracker::handleQuery', () => {
  it('[p04-cc268e] logs a tracked statement and auto-creates the version of a new table', async () => {
    const t = testApp(testConfig({}, { pmadb: 'phpmyadmin', tracking_version_auto_create: true }))
    try {
      await t.login()
      const r = await t.req('POST', '/api/servers/1/query', {
        sql: `INSERT INTO \`${DB}\`.t VALUES (1); CREATE TABLE fresh (a INT)`,
        db: DB,
        fromQueryBox: true,
      })
      expect(r.status, JSON.stringify(r.json)).toBe(200)
      const [rows] = (await root.query(
        'SELECT table_name, version, data_sql, schema_sql FROM phpmyadmin.pma__tracking WHERE db_name = ? ORDER BY table_name',
        [DB],
      )) as unknown as [Array<{ table_name: string; version: number; data_sql: string; schema_sql: string }>]
      const tracked = rows.find((x) => x.table_name === 't')
      expect(tracked?.data_sql).toMatch(
        /^\n\n# log \d{4}-\d\d-\d\d \d\d:\d\d:\d\d \S+\nINSERT INTO t VALUES \(1\);$/,
      )
      const fresh = rows.find((x) => x.table_name === 'fresh')
      expect(fresh?.version).toBe(1)
      expect(fresh?.schema_sql).toContain('DROP TABLE IF EXISTS `fresh`;')
    } finally {
      await t.close()
    }
  })
})
