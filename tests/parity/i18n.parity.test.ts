import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { GeneralLog } from './lib/general-log.ts'
import { PmaClient, isPmaUp, sqlBoxForm, visibleText } from './lib/pma.ts'

/**
 * Language parity: a German session gets the same SQL-tab messages (translated by phpMyAdmin's
 * catalogue, numbers with German separators, MySQL errors via lc_messages) in both tools.
 *
 * The reference checkout at BMA_PARITY_PMA_URL has no compiled .mo files and is English-only, so this
 * runs against a copy served WITH translations:
 *   sh packages/i18n/scripts/serve-localized-pma.sh /tmp/pma-i18n 8082 de
 */
const PMA_URL = process.env.PMA_I18N_URL ?? 'http://127.0.0.1:8082'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const PMA_USER = 'pma_ref_i18n'
const BMA_USER = 'bma_par_i18n'
const DB_PMA = 'par_i18n_pma'
const DB_BMA = 'par_i18n_bma'

// reachable AND translated (a checkout without .mo files would answer in English)
const reachable = await isPmaUp(PMA_URL, { path: '/index.php?route=/&lang=de', contains: 'Willkommen bei' })

const SEED = (db: string) => `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}; USE ${db};
  CREATE TABLE t (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(20), qty INT) ENGINE=InnoDB;
  INSERT INTO t (name, qty) VALUES ${Array.from({ length: 40 }, (_, i) => `('item${i + 1}', ${i % 7})`).join(',')};
  CREATE TABLE big (id INT PRIMARY KEY);
  SET SESSION cte_max_recursion_depth = 2000;
  INSERT INTO big WITH RECURSIVE s (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 1234) SELECT n FROM s;`

const CASES: Array<{ name: string; sql: string; expect: RegExp }> = [
  {
    name: 'browse: Showing rows / total',
    sql: 'SELECT * FROM t',
    expect: /^Zeige Datensätze 0 - 24 \(40 insgesamt/,
  },
  {
    name: 'thousands separator',
    sql: 'SELECT * FROM big',
    expect: /\(1\.234 insgesamt, Die Abfrage dauerte/,
  },
  {
    name: 'empty result',
    sql: 'SELECT * FROM t WHERE id = -1',
    expect: /^MySQL lieferte ein leeres Resultat/,
  },
  { name: 'SHOW: executed successfully', sql: 'SHOW TABLES', expect: /^Ihr SQL-Befehl wurde erfolgreich/ },
  // motranslator evaluates `n != 1` to a boolean → form 0 even for 3 rows
  {
    name: 'UPDATE: plural form as phpMyAdmin picks it [p09-a212a5]',
    sql: 'UPDATE t SET qty = 9 WHERE id < 4',
    expect: /^3 Datensatz betroffen\./,
  },
  { name: 'DELETE', sql: 'DELETE FROM t WHERE id > 38', expect: /^2 Datensatz gelöscht\./ },
  {
    name: 'INSERT with row id [p09-a212a5]',
    sql: "INSERT INTO t (name, qty) VALUES ('a', 1), ('b', 2)",
    expect: /ID der eingefügten Zeile: 42/,
  },
  {
    name: 'MySQL error text follows lc_messages',
    sql: 'SELECT * FROM missing_table',
    expect: /#1146 - Tabelle/,
  },
]

const maskTime = (s: string) =>
  s.replace(/\d+,\d{4} Sekunden/g, 'T Sekunden').replace(/\d+\.\d{4} Sekunden/g, 'T Sekunden')

describe.skipIf(!reachable)('parity: German session (lang=de) — messages and lc_messages', () => {
  let log: GeneralLog
  let pma: PmaClient
  let bma: ReturnType<typeof testApp>
  let root: mysql.Connection

  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    for (const u of [PMA_USER, BMA_USER]) {
      await root.query(
        `CREATE USER IF NOT EXISTS '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON *.* TO '${u}'@'%'`,
      )
    }
    log = await GeneralLog.open(ROOT)
    pma = new PmaClient(PMA_URL)
    await pma.login(PMA_USER, PMA_USER, 1, 'de')
    bma = testApp(testConfig())
    // the login page's language selector: GET /api/i18n?lang=de sets the language cookie
    const st = await bma.req('GET', '/api/i18n?lang=de')
    expect(st.json).toMatchObject({ key: 'de', code: 'de', dir: 'ltr' })
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
      const pr = await pma.postJson('/import', sqlBoxForm(c.sql, DB_PMA))
      const pmaLog = await log.since(PMA_USER, m1)
      const m2 = await log.marker()
      const br = await bma.req('POST', '/api/servers/1/query', { sql: c.sql, db: DB_BMA, fromQueryBox: true })
      const bmaLog = await log.since(BMA_USER, m2)

      const pmaText = maskTime(visibleText(pr.message ?? pr.error ?? '')).replaceAll(DB_PMA, 'par_db')
      const statements = (br.json.statements ?? []) as Array<{ message: { text: string } }>
      expect(statements.length, JSON.stringify(br.json)).toBe(1)
      const text = maskTime(statements[0]!.message.text.replace(/\s+/g, ' ')).replaceAll(DB_BMA, 'par_db')
      expect(text).toMatch(c.expect)
      expect(pmaText, 'phpMyAdmin shows the same German message').toContain(text)

      // both connections ask MySQL for German messages (DatabaseInterface::postConnect)
      const lc = (entries: Array<{ sql: string }>) =>
        entries.some((e) => /^SET lc_messages = 'de_DE';?$/.test(e.sql))
      expect(lc(pmaLog), 'phpMyAdmin sets lc_messages').toBe(true)
      // BetterMyAdmin pools connections: lc_messages is set when the connection is set up or the language changes
      if (c === CASES[0]) expect(lc(bmaLog), 'BetterMyAdmin sets lc_messages').toBe(true)
    })
  }
})
