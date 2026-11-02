import { readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { E2E, MYSQL } from './fixtures.ts'
import { holdSuiteLock } from './suite-lock.ts'

export default async function setup() {
  // one e2e run per MySQL at a time (fixed m3srv_* objects; m1shell_*, f06j_*, f08_e2e_* are per port)
  const release = await holdSuiteLock('bma_browser:e2e', MYSQL)
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${E2E.db}; CREATE DATABASE ${E2E.db};
    CREATE TABLE ${E2E.db}.t (id INT PRIMARY KEY, name VARCHAR(20)) COMMENT='E2E table';
    CREATE VIEW ${E2E.db}.v AS SELECT COUNT(*) AS n FROM ${E2E.db}.t;`)
  for (const u of [E2E.limited, E2E.pw]) {
    await c.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}';
      GRANT SELECT ON ${E2E.db}.* TO '${u}'@'%';`)
  }
  // the acme_store demo database (docker/demo/acme_store.sql) for the phone suites (tests/e2e/mobile),
  // when the server does not have it yet; MariaDB has no utf8mb4_0900_ai_ci
  const [have] = await c.query("SHOW DATABASES LIKE 'acme_store'")
  if ((have as unknown[]).length === 0) {
    const [[{ v }]] = (await c.query('SELECT VERSION() AS v')) as unknown as [[{ v: string }]]
    let demo = readFileSync(new URL('../../docker/demo/acme_store.sql', import.meta.url), 'utf8')
    if (/mariadb/i.test(v)) demo = demo.replaceAll('utf8mb4_0900_ai_ci', 'utf8mb4_general_ci')
    await c.query(demo)
  }
  await c.end()
  return release
}
