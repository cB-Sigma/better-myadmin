import mysql from 'mysql2/promise'
import { E2E, MYSQL } from './fixtures.ts'

export default async function teardown() {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${E2E.db}`)
  for (const u of [E2E.limited, E2E.pw]) await c.query(`DROP USER IF EXISTS '${u}'@'%'`)
  await c.end()
}
