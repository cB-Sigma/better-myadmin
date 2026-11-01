import type {
  DashboardSample,
  SlowQueriesResetResponse,
  SlowQueriesResponse,
  SlowQueryDetail,
  SlowQueryExplainResponse,
} from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'
import { isMariaDb } from '../support/vendor.ts'

/**
 * Status › Dashboard and Slow queries (BetterMyAdmin only, parity exceptions X64 / X65) against a
 * real server: MySQL 8.4 (:3306, performance_schema on) and MariaDB 11 (BMA_TEST_PORT=3307,
 * performance_schema off by default), plus the dev replica (:3308) when it is up.
 */
const DB = 'm65sq_it'
const USER = 'm65sq_it_user'
let t: ReturnType<typeof testApp>
let limited: ReturnType<typeof testApp>
let root: mysql.Connection
let slowLogBefore = 'OFF'

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, a VARCHAR(10), KEY (a));
    INSERT INTO ${DB}.t VALUES (1,'x'),(2,'y'),(3,'z');
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}'`)
  const [rows] = (await root.query('SELECT @@GLOBAL.slow_query_log AS v')) as unknown as [
    Array<{ v: number }>,
  ]
  slowLogBefore = String(rows[0]?.v) === '1' ? 'ON' : 'OFF'
  t = testApp()
  await t.login()
  limited = testApp(testConfig())
  await limited.login(USER, USER)
})

afterAll(async () => {
  await t?.close()
  await limited?.close()
  await root.query(
    `SET GLOBAL slow_query_log = ${slowLogBefore}; DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`,
  )
  await root.end()
})

const get = async <T>(path: string, app = t) => {
  const r = await app.req('GET', `/api/servers/1${path}`)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json as unknown as T
}

describe('dashboard', () => {
  it('returns the raw counters, the variables and the server clock', async () => {
    const a = await get<DashboardSample>('/status/dashboard')
    expect(a.status).not.toBeNull()
    for (const k of [
      'Questions',
      'Threads_connected',
      'Threads_running',
      'Bytes_sent',
      'Slow_queries',
      'Uptime',
    ])
      expect(Number(a.status![k]), k).toBeGreaterThanOrEqual(0)
    expect(Number(a.status!.Innodb_buffer_pool_pages_total)).toBeGreaterThan(0)
    expect(Number(a.variables.max_connections)).toBeGreaterThan(0)
    expect(a.variables.version).toMatch(/^\d+\.\d+/)
    expect(a.isMariaDb).toBe(isMariaDb)
    expect(Math.abs(a.serverTime - Date.now())).toBeLessThan(60_000)
    // the test server is a primary, not a replica
    expect(a.replica).toBeNull()
    const b = await get<DashboardSample>('/status/dashboard')
    expect(b.serverTime).toBeGreaterThanOrEqual(a.serverTime)
    expect(Number(b.status!.Questions)).toBeGreaterThan(Number(a.status!.Questions))
  })

  it('an account without REPLICATION CLIENT still gets the counters; the replica status is denied', async () => {
    const a = await get<DashboardSample>('/status/dashboard', limited)
    expect(a.status).not.toBeNull()
    expect(Number(a.status!.Threads_connected)).toBeGreaterThan(0)
    expect(a.replica).toBe('denied')
  })

  it.skipIf(isMariaDb)('on the replica: the lag and the thread states', async () => {
    const port = Number(process.env.BMA_PARITY_REPLICA_PORT ?? 3308)
    const probe = await mysql.createConnection({ ...MYSQL, port }).catch(() => null)
    if (probe === null) return
    await probe.end()
    const replica = testApp(testConfig({}, { port }))
    try {
      await replica.login()
      const s = await get<DashboardSample>('/status/dashboard', replica)
      expect(s.replica).not.toBeNull()
      expect(s.replica).not.toBe('denied')
      const r = s.replica as Exclude<DashboardSample['replica'], 'denied' | null>
      expect(r.sqlRunning).toMatch(/^(Yes|No)$/)
      expect(r.lag === null || typeof r.lag === 'number').toBe(true)
    } finally {
      await replica.close()
    }
  })
})

describe('slow queries: performance_schema digests', () => {
  it.skipIf(!isMariaDb)('MariaDB with performance_schema off explains it instead of failing', async () => {
    const r = await get<SlowQueriesResponse>('/status/slow-queries')
    expect(r.available).toBe(false)
    expect(r.reasons).toContain('pfs-off')
    expect(r.isMariaDb).toBe(true)
    expect(r.rows).toEqual([])
  })

  it.skipIf(isMariaDb)(
    'lists the top digests with times, rows and the sample; filters and sorts',
    async () => {
      // the database filter is the statements' default database (SCHEMA_NAME)
      await root.query(`USE ${DB}`)
      for (let i = 0; i < 3; i++) await root.query(`SELECT * FROM t WHERE a = 'x${i}'`)
      await root.query('SELECT COUNT(*) FROM t WHERE id > 1')
      const r = await get<SlowQueriesResponse>(`/status/slow-queries?db=${DB}`)
      expect(r.available).toBe(true)
      expect(r.canReset).toBe(true)
      expect(r.databases).toContain(DB)
      expect(r.rows.every((x) => x.schema === DB)).toBe(true)
      const row = r.rows.find((x) => /^SELECT \* FROM `t` WHERE `a` = \?/.test(x.text))
      expect(row, JSON.stringify(r.rows.map((x) => x.text))).toBeDefined()
      expect(row!.count).toBeGreaterThanOrEqual(3)
      expect(row!.totalMs).toBeGreaterThan(0)
      expect(row!.maxMs).toBeGreaterThanOrEqual(row!.avgMs)
      expect(row!.rowsExamined).toBeGreaterThanOrEqual(row!.rowsSent)
      expect(row!.sample).toMatch(/^SELECT \* FROM t WHERE a = 'x\d'$/)
      expect(row!.lastSeen).not.toBeNull()
      const byCount = await get<SlowQueriesResponse>('/status/slow-queries?sort=count&order=asc')
      const counts = byCount.rows.map((x) => x.count)
      expect(counts).toEqual([...counts].sort((a, b) => a - b))
      // an unknown sort falls back to the total time
      const bad = await get<SlowQueriesResponse>('/status/slow-queries?sort=x;DROP')
      expect(bad.available).toBe(true)
    },
  )

  it.skipIf(isMariaDb)('the detail formats the digest and EXPLAIN runs on its sample', async () => {
    await root.query(`USE ${DB}; SELECT * FROM t WHERE a = 'y'`)
    const list = await get<SlowQueriesResponse>(`/status/slow-queries?db=${DB}`)
    const row = list.rows.find((x) => x.schema === DB && /WHERE `a` = \?/.test(x.text))!
    expect(row).toBeDefined()
    const d = await get<SlowQueryDetail>(
      `/status/slow-queries/detail?digest=${row.digest}&db=${encodeURIComponent(DB)}`,
    )
    expect(d.formatted).toContain('\n')
    // QUERY_SAMPLE_TEXT keeps the slowest statement of the digest
    expect(d.sample).toMatch(/^SELECT \* FROM t WHERE a = '(x\d|y)'$/)
    expect(d.sampleSource).toBe('summary')
    expect(d.explainable).toBe(true)
    const e = await t.req('POST', '/api/servers/1/status/slow-queries/explain', { db: DB, query: d.sample })
    const x = e.json as unknown as SlowQueryExplainResponse
    expect(x.error).toBeNull()
    expect(x.sql).toBe(`EXPLAIN ${d.sample}`)
    expect(x.columns).toContain('key')
    expect(x.rows[0]![x.columns.indexOf('table')]).toBe('t')
    const missing = await t.req('GET', '/api/servers/1/status/slow-queries/detail?digest=nope')
    expect(missing.status).toBe(404)
  })

  it.skipIf(isMariaDb)('an account without SELECT on performance_schema sees why, and no reset', async () => {
    const r = await get<SlowQueriesResponse>('/status/slow-queries', limited)
    expect(r.available).toBe(false)
    expect(r.reasons).toEqual(['pfs-denied'])
    expect(r.canReset).toBe(false)
    const reset = await limited.req('POST', '/api/servers/1/status/slow-queries/reset', {})
    expect((reset.json as unknown as SlowQueriesResetResponse).message.type).toBe('error')
  })

  it.skipIf(isMariaDb)('reset truncates the digest summary', async () => {
    const reset = await t.req('POST', '/api/servers/1/status/slow-queries/reset', {})
    expect(reset.status).toBe(200)
    expect((reset.json as unknown as SlowQueriesResetResponse).message.type).toBe('success')
    const r = await get<SlowQueriesResponse>(`/status/slow-queries?db=${DB}`)
    expect(r.rows.filter((x) => x.text.includes('m65sq_it'))).toEqual([])
  })
})

describe('slow queries: EXPLAIN never runs anything else', () => {
  it('refuses a statement that is not explainable or a second statement', async () => {
    for (const query of [`DROP TABLE ${DB}.t`, `SELECT 1; DROP TABLE ${DB}.t`, 'EXPLAIN ANALYZE SELECT 1']) {
      const e = await t.req('POST', '/api/servers/1/status/slow-queries/explain', { db: DB, query })
      const x = e.json as unknown as SlowQueryExplainResponse
      expect(x.error, query).toMatch(/can be explained/)
      expect(x.sql).toBe('')
    }
    const [rows] = (await root.query(`SELECT COUNT(*) AS n FROM ${DB}.t`)) as unknown as [
      Array<{ n: number }>,
    ]
    expect(Number(rows[0]!.n)).toBe(3)
  })

  it('an EXPLAIN error comes back as text', async () => {
    const e = await t.req('POST', '/api/servers/1/status/slow-queries/explain', {
      db: DB,
      query: 'SELECT * FROM no_such_table',
    })
    expect((e.json as unknown as SlowQueryExplainResponse).error).toMatch(/^#1146 - /)
  })
})

describe('slow queries: mysql.slow_log', () => {
  it('groups the logged statements by normalized query; detail and EXPLAIN use the newest', async () => {
    await root.query('SET GLOBAL slow_query_log = ON')
    const logged = await mysql.createConnection({ ...MYSQL, database: DB })
    try {
      await logged.query('SET SESSION long_query_time = 0')
      await logged.query("SELECT id FROM t WHERE a = 'x'")
      await logged.query("SELECT id FROM t WHERE a = 'z'")
      await logged.query('SELECT id FROM t WHERE id IN (1, 2)')
    } finally {
      await logged.end()
    }
    const r = await get<SlowQueriesResponse>(`/status/slow-queries?source=slowlog&db=${DB}`)
    expect(r.source).toBe('slowlog')
    expect(r.available).toBe(true)
    expect(r.reasons).not.toContain('slow-log-off')
    expect(r.databases).toContain(DB)
    const g = r.rows.find((x) => x.text === 'SELECT id FROM t WHERE a = ?')
    expect(g, JSON.stringify(r.rows.map((x) => x.text))).toBeDefined()
    expect(g!.count).toBeGreaterThanOrEqual(2)
    expect(g!.schema).toBe(DB)
    expect(r.rows.some((x) => x.text === 'SELECT id FROM t WHERE id IN (...)')).toBe(true)
    const d = await get<SlowQueryDetail>(
      `/status/slow-queries/detail?source=slowlog&digest=${g!.digest}&db=${DB}`,
    )
    expect(d.sampleSource).toBe('slowlog')
    expect(d.sample).toMatch(/^SELECT id FROM t WHERE a = '[xz]'$/)
    expect(d.explainable).toBe(true)
    const e = await t.req('POST', '/api/servers/1/status/slow-queries/explain', { db: DB, query: d.sample })
    expect((e.json as unknown as SlowQueryExplainResponse).error).toBeNull()
  })

  it('an account without SELECT on mysql.slow_log is told so', async () => {
    const r = await get<SlowQueriesResponse>('/status/slow-queries?source=slowlog', limited)
    expect(r.available).toBe(false)
    expect(r.reasons).toContain('slow-log-denied')
  })
})
