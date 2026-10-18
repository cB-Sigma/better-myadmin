import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * MySQL connections held between requests (parity exception X24, `ConnectionPool`): idle ones are
 * closed, logout drops a session's, the process never holds more than `maxTotal`, and a request
 * starts from a fresh session state like phpMyAdmin's connection per request. Only the user
 * `x24pool_u` is created; its connections are counted in the process list.
 */
const USER = 'x24pool_u'
const DB = 'x24pool_db'
let root: mysql.Connection

/** this user's connections on the server */
async function connections(): Promise<number> {
  const [rows] = (await root.query(
    'SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE USER = ?',
    [USER],
  )) as unknown as [Array<{ n: number }>]
  return Number(rows[0]?.n ?? 0)
}

async function until(cond: () => Promise<boolean>, ms = 10_000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await cond()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return cond()
}

// biome-ignore lint/suspicious/noExplicitAny: loosely typed API payloads in tests
type Json = Record<string, any>
const firstRows = (j: Json) => (j.statements as Json[])[0]?.result?.rows as Array<Array<string | null>>

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY) ENGINE=InnoDB;
    GRANT ALL ON ${DB}.* TO '${USER}'@'%';`)
})
afterAll(async () => {
  await root.query(`DROP USER IF EXISTS '${USER}'@'%'; DROP DATABASE IF EXISTS ${DB}`)
  await root.end()
})

describe('pooled connections (X24)', () => {
  it('many sessions: the idle connections are closed again; logout closes at once', async () => {
    const t = testApp(testConfig({ ConnectionPool: { idleTimeout: 1, maxTotal: 50, waitTimeout: 30 } }))
    try {
      // twelve sessions that never log out (a new cookie jar each)
      for (let i = 0; i < 12; i++) {
        t.jar.clear()
        expect((await t.login(USER, USER)).status).toBe(200)
        const r = await t.req('POST', '/api/servers/1/query', { sql: 'SELECT 1' })
        expect(r.status, JSON.stringify(r.json)).toBe(200)
      }
      expect(await connections()).toBeGreaterThan(0)
      // the idle connections close after idleTimeout
      expect(await until(async () => (await connections()) === 0)).toBe(true)

      // logout drops the session's connections without waiting for the idle timeout
      t.jar.clear()
      await t.login(USER, USER)
      await t.req('POST', '/api/servers/1/query', { sql: 'SELECT 1' })
      expect(await connections()).toBeGreaterThan(0)
      expect((await t.req('POST', '/api/auth/logout', {})).status).toBe(200)
      expect(await until(async () => (await connections()) === 0, 900)).toBe(true)
    } finally {
      await t.close()
    }
  })

  it('the process never holds more than maxTotal connections; requests wait for one', async () => {
    const t = testApp(testConfig({ ConnectionPool: { idleTimeout: 30, maxTotal: 3, waitTimeout: 30 } }))
    const jars: Array<Map<string, string>> = []
    for (let i = 0; i < 6; i++) {
      t.jar.clear()
      expect((await t.login(USER, USER)).status).toBe(200)
      jars.push(new Map(t.jar))
    }
    let peak = 0
    let sampling = true
    const sampler = (async () => {
      while (sampling) {
        peak = Math.max(peak, await connections())
        await new Promise((r) => setTimeout(r, 20))
      }
    })()
    // six sessions at once, each holding its connection for a moment
    const results = await Promise.all(
      jars.map(async (jar) => {
        const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
        const token = jar.get('bma_token') ?? ''
        const res = await t.app.request('/api/servers/1/query', {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json', 'X-BMA-Token': token },
          body: JSON.stringify({ sql: 'SELECT SLEEP(0.3)' }),
        })
        return res.status
      }),
    )
    sampling = false
    await sampler
    expect(results).toEqual([200, 200, 200, 200, 200, 200])
    expect(t.deps.pools.budget.open).toBeLessThanOrEqual(3)
    expect(peak).toBeLessThanOrEqual(3)
    await t.close()
    expect(await until(async () => (await connections()) === 0, 3000)).toBe(true)
  })

  it('a request starts from a fresh session state: user variables and session settings do not carry over', async () => {
    const t = testApp(testConfig({ ConnectionPool: { idleTimeout: 30, maxTotal: 50, waitTimeout: 30 } }))
    await t.login(USER, USER)
    const q = async (sql: string) => {
      const r = await t.req('POST', '/api/servers/1/query', { sql })
      expect(r.status, JSON.stringify(r.json)).toBe(200)
      return firstRows(r.json)
    }
    await q('SET @x24 = 42')
    expect(await q('SELECT @x24 AS v')).toEqual([[null]])
    await q("SET SESSION sql_mode = 'ANSI_QUOTES'")
    expect((await q('SELECT @@SESSION.sql_mode AS m'))?.[0]?.[0]).not.toBe('ANSI_QUOTES')
    // a plain read leaves the connection reusable
    const id1 = (await q('SELECT CONNECTION_ID() AS i'))?.[0]?.[0]
    const id2 = (await q('SELECT CONNECTION_ID() AS i'))?.[0]?.[0]
    expect(id2).toBe(id1)
    await t.close()
  })

  it('a transaction left open by a request is rolled back when it ends, as with a connection per request', async () => {
    const t = testApp(testConfig({ ConnectionPool: { idleTimeout: 30, maxTotal: 50, waitTimeout: 30 } }))
    await t.login()
    const r = await t.req('POST', '/api/servers/1/query', {
      sql: `START TRANSACTION; INSERT INTO ${DB}.t VALUES (1);`,
      db: DB,
    })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    expect((r.json.statements as Json[])[1]?.message?.text).toMatch(/^1 row inserted/)
    // the request is over: its row lock is gone (an open transaction would make this insert wait)
    await writeFromAnotherSession(1)
    // and the next request does not run inside it
    const next = await t.req('POST', '/api/servers/1/query', { sql: `SELECT COUNT(*) FROM ${DB}.t` })
    expect(firstRows(next.json)).toEqual([['0']])
    await t.close()
  })

  it('LOCK TABLES of a request does not outlive it: another session can write the table', async () => {
    const t = testApp(testConfig({ ConnectionPool: { idleTimeout: 30, maxTotal: 50, waitTimeout: 30 } }))
    await t.login()
    const r = await t.req('POST', '/api/servers/1/query', { sql: `LOCK TABLES ${DB}.t WRITE`, db: DB })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    expect((r.json.statements as Json[])[0]?.error ?? null).toBeNull()
    await writeFromAnotherSession(2)
    await t.close()
  })
})

/** INSERT and DELETE a row of the table from a root connection that waits at most 2 s for a lock. */
async function writeFromAnotherSession(id: number): Promise<void> {
  const other = await mysql.createConnection(MYSQL)
  try {
    await other.query('SET SESSION lock_wait_timeout = 2, SESSION innodb_lock_wait_timeout = 2')
    await other.query(`INSERT INTO ${DB}.t VALUES (${id})`)
    await other.query(`DELETE FROM ${DB}.t`)
  } finally {
    await other.end()
  }
}
