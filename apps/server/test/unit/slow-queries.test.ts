import { describe, expect, it } from 'vitest'
import {
  explainableStatement,
  fingerprintQuery,
  grantsAllow,
  groupSlowLog,
  sortRows,
} from '../../src/server-admin/slow-queries.ts'

describe('fingerprintQuery', () => {
  it('replaces literals, collapses whitespace, upper-cases keywords and drops comments', () => {
    expect(fingerprintQuery("select  *\n from t /* x */ where a = 1 and b = 'x' -- c\n")).toBe(
      'SELECT * FROM t WHERE a = ? AND b = ?',
    )
  })
  it('collapses IN lists and multi-row VALUES', () => {
    expect(fingerprintQuery('SELECT * FROM t WHERE id IN (1, 2, 3)')).toBe(
      'SELECT * FROM t WHERE id IN (...)',
    )
    expect(fingerprintQuery("INSERT INTO t VALUES (1,'a'),(2,'b'), (3, 'c');")).toBe(
      'INSERT INTO t VALUES (...)',
    )
  })
  it('keeps identifiers, so different tables stay apart', () => {
    expect(fingerprintQuery('SELECT `a` FROM t1')).not.toBe(fingerprintQuery('SELECT `a` FROM t2'))
  })
})

describe('groupSlowLog', () => {
  const e = (start: string, time: number, sql: string, db = 'd', rows = 1) => ({
    start_time: start,
    query_time: time,
    rows_sent: rows,
    rows_examined: rows * 10,
    db,
    sql_text: sql,
  })
  const groups = groupSlowLog([
    e('2026-01-01 10:00:02', 0.5, 'SELECT * FROM t WHERE id = 2'),
    e('2026-01-01 10:00:01', 1.5, 'select * from t where id = 1'),
    e('2026-01-01 10:00:03', 0.1, 'SELECT * FROM t WHERE id = 3', 'other'),
    e('2026-01-01 10:00:00', 2, 'UPDATE t SET a = 1'),
  ])

  it('groups by database and normalized query', () => {
    expect(groups).toHaveLength(3)
    const g = groups.find((x) => x.schema === 'd' && x.text.startsWith('SELECT'))!
    expect(g.text).toBe('SELECT * FROM t WHERE id = ?')
    expect(g.count).toBe(2)
    expect(g.totalMs).toBe(2000)
    expect(g.avgMs).toBe(1000)
    expect(g.maxMs).toBe(1500)
    expect(g.rowsSent).toBe(2)
    expect(g.rowsExamined).toBe(20)
    expect(g.firstSeen).toBe('2026-01-01 10:00:01')
    expect(g.lastSeen).toBe('2026-01-01 10:00:02')
    // the newest statement is the sample EXPLAIN runs
    expect(g.sample).toBe('SELECT * FROM t WHERE id = 2')
    expect(g.digest).toMatch(/^[0-9a-f]{32}$/)
  })

  it('sorts by any column, ties by digest', () => {
    expect(sortRows(groups, 'total', 'desc').map((g) => g.totalMs)).toEqual([2000, 2000, 100])
    expect(sortRows(groups, 'count', 'desc')[0]!.count).toBe(2)
    expect(sortRows(groups, 'max', 'asc').map((g) => g.maxMs)).toEqual([100, 1500, 2000])
    expect(sortRows(groups, 'lastSeen', 'desc')[0]!.schema).toBe('other')
  })
})

describe('grantsAllow', () => {
  const T = ['performance_schema', 'events_statements_summary_by_digest'] as const
  it('global DROP or ALL PRIVILEGES', () => {
    expect(grantsAllow(['GRANT SELECT, DROP, PROCESS ON *.* TO `root`@`%`'], 'DROP', ...T)).toBe(true)
    expect(grantsAllow(["GRANT ALL PRIVILEGES ON *.* TO 'root'@'localhost'"], 'DROP', ...T)).toBe(true)
  })
  it('schema- and table-level grants, wildcards', () => {
    expect(grantsAllow(['GRANT DROP ON `performance_schema`.* TO `u`@`%`'], 'DROP', ...T)).toBe(true)
    expect(
      grantsAllow(
        ['GRANT SELECT, DROP ON `performance_schema`.`events_statements_summary_by_digest` TO `u`@`%`'],
        'DROP',
        ...T,
      ),
    ).toBe(true)
    expect(grantsAllow(['GRANT DROP ON `performance\\_%`.* TO `u`@`%`'], 'DROP', ...T)).toBe(true)
  })
  it('no DROP, another schema or table, dynamic privileges', () => {
    expect(grantsAllow(['GRANT USAGE ON *.* TO `u`@`%`'], 'DROP', ...T)).toBe(false)
    expect(grantsAllow(['GRANT SELECT ON `performance_schema`.* TO `u`@`%`'], 'DROP', ...T)).toBe(false)
    expect(grantsAllow(['GRANT DROP ON `mysql`.* TO `u`@`%`'], 'DROP', ...T)).toBe(false)
    expect(grantsAllow(['GRANT DROP ON `performance_schema`.`threads` TO `u`@`%`'], 'DROP', ...T)).toBe(false)
    expect(grantsAllow(['GRANT DROP_ROLE,FLUSH_STATUS ON *.* TO `u`@`%`'], 'DROP', ...T)).toBe(false)
  })
})

describe('explainableStatement', () => {
  it('accepts one statement EXPLAIN takes, without its delimiter', () => {
    expect(explainableStatement('SELECT * FROM t WHERE a = 1;')).toBe('SELECT * FROM t WHERE a = 1')
    expect(explainableStatement('  /* c */ update t set a = 1')).toBe('/* c */ update t set a = 1')
    expect(explainableStatement('WITH x AS (SELECT 1) SELECT * FROM x')).not.toBeNull()
    expect(explainableStatement("SELECT ';' FROM t;  ")).toBe("SELECT ';' FROM t")
  })
  it('refuses a second statement and anything else', () => {
    expect(explainableStatement('SELECT 1; DROP TABLE t')).toBeNull()
    expect(explainableStatement('DROP TABLE t')).toBeNull()
    expect(explainableStatement('EXPLAIN ANALYZE SELECT 1')).toBeNull()
    expect(explainableStatement('SET @a = 1')).toBeNull()
    expect(explainableStatement('')).toBeNull()
  })
})
