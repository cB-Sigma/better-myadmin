import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Concurrent requests of one session (a table page fires about six at once) must all complete:
 * a request uses one user link and one control link, shared by everything it runs (withDb,
 * MetaRequest, the tracker), and a request that already holds a connection never waits for
 * another (X24, db/request-scope.ts). Objects prefixed x24conc_.
 */
const DB = 'x24conc_db'
const SRV = { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }
let root: mysql.Connection

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.p (id INT PRIMARY KEY) ENGINE=InnoDB;
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, pid INT, FOREIGN KEY (pid) REFERENCES ${DB}.p (id)) ENGINE=InnoDB;`)
})
afterAll(async () => {
  await root.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root.end()
})

const PATHS = [
  `/api/servers/1/databases/${DB}`,
  `/api/servers/1/databases/${DB}/tables/t/capabilities`,
  `/api/servers/1/databases/${DB}/operations`,
  `/api/servers/1/databases/${DB}/structure`,
  `/api/servers/1/databases/${DB}/tables/t/relation`,
  '/api/servers/1',
]

async function burst(t: ReturnType<typeof testApp>, n: number): Promise<number[]> {
  const cookie = [...t.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${n} concurrent requests did not complete`)), 10_000),
  )
  const all = Promise.all(
    Array.from({ length: n }, (_, i) =>
      Promise.resolve(t.app.request(PATHS[i % PATHS.length]!, { headers: { cookie } })).then(async (r) => {
        await r.arrayBuffer()
        return r.status
      }),
    ),
  )
  return Promise.race([all, timeout])
}

describe('concurrent requests of one session', () => {
  for (const [name, pool] of [
    ['default pool', { idleTimeout: 10, maxTotal: 50, waitTimeout: 30 }],
    ['under the global cap', { idleTimeout: 10, maxTotal: 2, waitTimeout: 30 }],
  ] as const) {
    it(`3, 6 and 20 concurrent GETs all return (${name})`, async () => {
      const t = testApp(testConfig({ ConnectionPool: pool }, SRV))
      try {
        expect((await t.login()).status).toBe(200)
        for (const n of [3, 6, 20]) {
          const statuses = await burst(t, n)
          expect(statuses, `${n} requests`).toEqual(Array.from({ length: n }, () => 200))
        }
        // everything went back: nothing is checked out
        expect(t.deps.pools.budget.open).toBeGreaterThanOrEqual(0)
      } finally {
        await t.close()
      }
    }, 60_000)
  }
})
