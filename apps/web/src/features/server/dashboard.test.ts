import type { DashboardSample } from '@bettermyadmin/contracts'
import { describe, expect, it } from 'vitest'
import { computeMetrics, level, pushHistory, rate, replicaLevel, sparkPath, sparkPoints } from './dashboard'

const sample = (
  t: number,
  status: Record<string, number>,
  vars: Record<string, string> = {},
): DashboardSample => ({
  serverTime: t,
  status: Object.fromEntries(Object.entries(status).map(([k, x]) => [k, String(x)])),
  variables: { max_connections: '100', ...vars },
  isMariaDb: false,
  replica: null,
})

describe('rate', () => {
  it('is the delta per second', () => {
    expect(rate(100, 160, 2)).toBe(30)
  })
  it('is null for a reset counter, a missing value or an empty interval', () => {
    expect(rate(100, 50, 2)).toBeNull()
    expect(rate(null, 50, 2)).toBeNull()
    expect(rate(1, 2, 0)).toBeNull()
  })
})

describe('computeMetrics', () => {
  const a = sample(10_000, {
    Uptime: 100,
    Questions: 1000,
    Threads_connected: 85,
    Threads_running: 3,
    Aborted_connects: 1,
    Aborted_clients: 1,
    Bytes_received: 1000,
    Bytes_sent: 5000,
    Slow_queries: 4,
    Table_locks_waited: 0,
    Created_tmp_tables: 10,
    Created_tmp_disk_tables: 5,
    Innodb_buffer_pool_read_requests: 1000,
    Innodb_buffer_pool_reads: 10,
    Innodb_buffer_pool_pages_total: 200,
    Innodb_buffer_pool_pages_free: 50,
  })
  const b = sample(15_000, {
    Uptime: 105,
    Questions: 1500,
    Threads_connected: 90,
    Threads_running: 5,
    Aborted_connects: 3,
    Aborted_clients: 4,
    Bytes_received: 6000,
    Bytes_sent: 55000,
    Slow_queries: 5,
    Table_locks_waited: 5,
    Created_tmp_tables: 20,
    Created_tmp_disk_tables: 6,
    Innodb_buffer_pool_read_requests: 2000,
    Innodb_buffer_pool_reads: 30,
    Innodb_buffer_pool_pages_total: 200,
    Innodb_buffer_pool_pages_free: 40,
  })

  it('computes the rates of an interval from two readings', () => {
    const m = computeMetrics(a, b)
    expect(m.qps).toBe(100)
    expect(m.connectionUsage).toBe(90)
    expect(m.abortedPerSec).toBe(1)
    expect(m.abortedTotal).toBe(7)
    expect(m.threadsRunning).toBe(5)
    expect(m.bufferPoolHitRate).toBeCloseTo(98)
    expect(m.bufferPoolUsage).toBe(80)
    expect(m.bytesInPerSec).toBe(1000)
    expect(m.bytesOutPerSec).toBe(10000)
    expect(m.slowPerMinute).toBeCloseTo(12)
    expect(m.tableLocksWaitedPerSec).toBe(1)
    expect(m.tmpDiskRatio).toBe(10)
  })

  it('the first reading has no rates; ratios are since startup', () => {
    const m = computeMetrics(null, a)
    expect(m.qps).toBeNull()
    expect(m.slowPerMinute).toBeNull()
    expect(m.bufferPoolHitRate).toBeCloseTo(99)
    expect(m.tmpDiskRatio).toBe(50)
    expect(m.connectionUsage).toBe(85)
  })

  it('a restart (Uptime going down) gives no rates instead of negative ones', () => {
    const restarted = sample(20_000, { Uptime: 2, Questions: 3, Slow_queries: 0 })
    const m = computeMetrics(b, restarted)
    expect(m.qps).toBeNull()
    expect(m.slowPerMinute).toBeNull()
  })

  it('an idle interval leaves the hit rate and the disk ratio unknown', () => {
    const m = computeMetrics(a, { ...a, serverTime: 12_000 })
    expect(m.qps).toBe(0)
    expect(m.bufferPoolHitRate).toBeNull()
    expect(m.tmpDiskRatio).toBeNull()
  })

  it('unreadable status (no privilege) gives nulls, not NaN', () => {
    const m = computeMetrics(null, { ...a, status: null })
    expect(m.threadsConnected).toBeNull()
    expect(m.connectionUsage).toBeNull()
    expect(m.maxConnections).toBe(100)
  })
})

describe('thresholds', () => {
  it('colours connections from 80 % and 95 % of max_connections', () => {
    expect(level('connectionUsage', 79.9)).toBe('ok')
    expect(level('connectionUsage', 80)).toBe('warning')
    expect(level('connectionUsage', 95)).toBe('critical')
  })
  it('a lower hit rate is worse', () => {
    expect(level('bufferPoolHitRate', 99.5)).toBe('ok')
    expect(level('bufferPoolHitRate', 98)).toBe('warning')
    expect(level('bufferPoolHitRate', 90)).toBe('critical')
    expect(level('bufferPoolHitRate', null)).toBe('ok')
  })
  it('replication: lag bounds, a stopped thread is critical', () => {
    expect(replicaLevel(null)).toBe('ok')
    expect(replicaLevel('denied')).toBe('ok')
    expect(replicaLevel({ lag: 0, ioRunning: 'Yes', sqlRunning: 'Yes' })).toBe('ok')
    expect(replicaLevel({ lag: 31, ioRunning: 'Yes', sqlRunning: 'Yes' })).toBe('warning')
    expect(replicaLevel({ lag: null, ioRunning: 'Yes', sqlRunning: 'No' })).toBe('critical')
    expect(replicaLevel({ lag: 0, ioRunning: 'Connecting', sqlRunning: 'Yes' })).toBe('critical')
  })
})

describe('history and sparkline', () => {
  it('keeps the last N readings', () => {
    let h: number[] = []
    for (let i = 0; i < 5; i++) h = pushHistory(h, i, 3)
    expect(h).toEqual([2, 3, 4])
  })
  it('right-aligns the points and breaks the path at gaps', () => {
    const pts = sparkPoints([0, 10, null, 5], 30, 12, 4)
    expect(pts[0]).toEqual([0, 11])
    expect(pts[1]).toEqual([10, 1])
    expect(pts[2]).toBeNull()
    expect(sparkPath(pts)).toBe('M0.0,11.0L10.0,1.0M30.0,6.0')
  })
})
