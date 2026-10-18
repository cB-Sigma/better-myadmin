import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../support/app.ts'

/**
 * Concurrent requests of one session must all complete (apps/server/test/int/). The per-session pool
 * (connectionLimit 4) deadlocked when withDb held a connection while MetaRequest.userConn() and the
 * control connection acquired more from the same pool: with 3+ requests in flight none returned.
 * phpMyAdmin connects per request. Only f04_dl objects are touched.
 */
const ROOT = {
  host: '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: 'root',
}
const PATHS = [
  '/api/servers/1/databases/f04_dl',
  '/api/servers/1/databases/f04_dl/tables/t/capabilities',
  '/api/servers/1/databases/f04_dl/tables/t/operations',
  '/api/servers/1',
  '/api/servers/1/databases/f04_dl/tables/t/structure',
  '/api/servers/1/databases/f04_dl/tables/t/relation',
]
let app: ReturnType<typeof testApp>

beforeAll(async () => {
  const c = await mysql.createConnection({ ...ROOT, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS f04_dl; CREATE DATABASE f04_dl; CREATE TABLE f04_dl.t (id INT PRIMARY KEY);
    DROP USER IF EXISTS 'f04_dl'@'%'; CREATE USER 'f04_dl'@'%' IDENTIFIED BY 'f04_dl'; GRANT ALL ON *.* TO 'f04_dl'@'%'`)
  await c.end()
  app = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }))
  expect((await app.login('f04_dl', 'f04_dl')).status).toBe(200)
})

afterAll(async () => {
  await app?.close()
  const c = await mysql.createConnection({ ...ROOT, multipleStatements: true })
  await c.query("DROP DATABASE IF EXISTS f04_dl; DROP USER IF EXISTS 'f04_dl'@'%'")
  await c.end()
})

const within = <T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> =>
  Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))])

describe('one session, concurrent requests (per-session pool)', () => {
  for (const n of [2, 3, 6]) {
    it(`${n} concurrent db/table requests all return`, async () => {
      const all = Promise.all(PATHS.slice(0, n).map((p) => app.req('GET', p).then((r) => r.status)))
      expect(await within(all, 10_000)).toEqual(Array(n).fill(200))
    }, 30_000)
  }
})
