import mysql from 'mysql2/promise'
import { E2E, MYSQL } from './fixtures.ts'

export default async function setup() {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${E2E.db}; CREATE DATABASE ${E2E.db};
    CREATE TABLE ${E2E.db}.t (id INT PRIMARY KEY, name VARCHAR(20)) COMMENT='E2E table';
    CREATE VIEW ${E2E.db}.v AS SELECT COUNT(*) AS n FROM ${E2E.db}.t;`)
  for (const u of [E2E.limited, E2E.pw]) {
    await c.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}';
      GRANT SELECT ON ${E2E.db}.* TO '${u}'@'%';`)
  }
  await c.end()
}
