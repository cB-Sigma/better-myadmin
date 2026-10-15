import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { compareLogs } from './lib/compare.ts'
import { GeneralLog } from './lib/general-log.ts'
import { PmaClient, isPmaUp, sqlBoxForm, visibleText } from './lib/pma.ts'

/**
 * Golden parity: the same SQL-tab action in the reference phpMyAdmin and in BetterMyAdmin must
 * produce the same message and send the same statements to MySQL (modulo allowed-diffs.yaml).
 */
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const PMA_USER = 'pma_ref'
const BMA_USER = 'bma_par'
const DB_PMA = 'par_pma'
const DB_BMA = 'par_bma'
const dbMap = { [DB_PMA]: 'par_db', [DB_BMA]: 'par_db', [PMA_USER]: 'parity_user', [BMA_USER]: 'parity_user' }

const reachable = await isPmaUp(PMA_URL)

const SEED = (db: string) => `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}; USE ${db};
  CREATE TABLE t (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(20), qty INT, price DECIMAL(10,2)) ENGINE=InnoDB;
  INSERT INTO t (name, qty, price) VALUES ${Array.from({ length: 40 }, (_, i) => `('item${i + 1}', ${i % 7}, ${i}.50)`).join(',')};
  CREATE TABLE nokey (a INT, b VARCHAR(5));
  INSERT INTO nokey VALUES (1, 'x'), (2, 'y');`

/** The typed queries; every case runs on a freshly seeded database in each tool. */
const CASES: Array<{ name: string; sql: string; delimiter?: string }> = [
  {
    name: 'browse-style SELECT * gets LIMIT and an exact count [p09-4df052] [p09-7438a7]',
    sql: 'SELECT * FROM t',
  },
  {
    name: 'SELECT with WHERE and ORDER BY gets the COUNT(*) wrapper [p09-4df052] [p09-7438a7]',
    sql: 'SELECT id, name FROM t WHERE qty > 2 ORDER BY id DESC',
  },
  {
    name: 'GROUP BY keeps its expressions in the count [p09-7438a7]',
    sql: 'SELECT qty, COUNT(*) AS n FROM t GROUP BY qty',
  },
  { name: 'DISTINCT', sql: 'SELECT DISTINCT qty FROM t' },
  { name: 'user LIMIT is respected [p09-662a39]', sql: 'SELECT * FROM t LIMIT 5' },
  { name: 'SELECT without FROM [p09-662a39]', sql: 'SELECT 1 + 1 AS two' },
  { name: 'SHOW', sql: 'SHOW TABLES' },
  { name: 'EXPLAIN', sql: 'EXPLAIN SELECT * FROM t' },
  { name: 'aggregate', sql: 'SELECT COUNT(*) FROM t' },
  { name: 'INSERT multi-row', sql: "INSERT INTO t (name, qty) VALUES ('new1', 1), ('new2', 2)" },
  { name: 'UPDATE', sql: 'UPDATE t SET qty = qty + 1 WHERE id < 5' },
  { name: 'DELETE', sql: 'DELETE FROM t WHERE id > 38' },
  { name: 'DDL', sql: 'CREATE TABLE t2 (x INT)' },
  {
    name: 'multi-statement [p09-9a56f6]',
    sql: 'SELECT 1; SELECT name FROM t WHERE id = 3; UPDATE t SET qty = 0 WHERE id = 1',
  },
  { name: 'DELIMITER handling [p09-eef6d7]', sql: 'DELIMITER //\nSELECT 1 //\nSELECT 2 //' },
  {
    name: 'error stops the run [p09-9a56f6] [p09-a25a57]',
    sql: 'SELECT 1; SELECT * FROM missing_table; SELECT 2',
  },
  { name: 'empty result with columns [p09-4d18f5]', sql: 'SELECT * FROM t WHERE id = -1' },
  { name: 'table without unique key', sql: 'SELECT * FROM nokey' },
]

/** The message part of phpMyAdmin's response for the statements, with timings masked. */
const maskTime = (s: string) => s.replace(/\d+\.\d{4} seconds/g, 'T seconds')

describe.skipIf(!reachable)('parity: SQL tab (/import) vs POST /query', () => {
  let log: GeneralLog
  let pma: PmaClient
  let bma: ReturnType<typeof testApp>
  let root: mysql.Connection

  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    for (const [u, p] of [
      [PMA_USER, PMA_USER],
      [BMA_USER, BMA_USER],
    ]) {
      await root.query(
        `CREATE USER IF NOT EXISTS '${u}'@'%' IDENTIFIED BY '${p}'; GRANT ALL ON *.* TO '${u}'@'%'`,
      )
    }
    log = await GeneralLog.open(ROOT)
    pma = new PmaClient(PMA_URL)
    await pma.login(PMA_USER, PMA_USER)
    bma = testApp(testConfig())
    await bma.login(BMA_USER, BMA_USER)
  })

  afterAll(async () => {
    await root?.query(`DROP DATABASE IF EXISTS ${DB_PMA}; DROP DATABASE IF EXISTS ${DB_BMA}`)
    await root?.end()
    await log?.close()
    await bma?.close()
  })

  for (const c of CASES) {
    it(c.name, async () => {
      await root.query(SEED(DB_PMA))
      await root.query(SEED(DB_BMA))

      const m1 = await log.marker()
      const pr = await pma.postJson(
        '/import',
        sqlBoxForm(c.sql, DB_PMA, '', { sql_delimiter: c.delimiter ?? ';' }),
      )
      const pmaLog = await log.since(PMA_USER, m1)

      const m2 = await log.marker()
      const br = await bma.req('POST', '/api/servers/1/query', {
        sql: c.sql,
        db: DB_BMA,
        delimiter: c.delimiter ?? ';',
        fromQueryBox: true,
      })
      const bmaLog = await log.since(BMA_USER, m2)

      // 1. messages: every BetterMyAdmin message text appears in phpMyAdmin's response
      const pmaText = maskTime(visibleText(pr.message ?? pr.error ?? '')).replaceAll(DB_PMA, 'par_db')
      const statements = br.json.statements as Array<{
        kind: string
        message: { text: string }
        sql: string
        executedSql: string
      }>
      expect(pr.success, `pma success for ${c.sql}`).toBe(statements.every((s) => s.kind !== 'error'))
      for (const st of statements) {
        // whitespace collapses in HTML on both sides (pma's '%2s' pads: "0 -  4")
        const text = maskTime(st.message.text.replace(/\s+/g, ' ')).replaceAll(DB_BMA, 'par_db')
        expect(pmaText, `message for ${st.sql}`).toContain(text)
        // the card shows the typed statement; the error card shows the SQL actually sent
        expect(pmaText).toContain(st.kind === 'error' ? st.executedSql : st.sql)
      }

      // 2. statements sent to MySQL
      const cmp = compareLogs(pmaLog, bmaLog, dbMap)
      expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    })
  }
})
