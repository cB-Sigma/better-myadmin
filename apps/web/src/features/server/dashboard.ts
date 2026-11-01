import type { DashboardSample } from '@bettermyadmin/contracts'

/**
 * Status › Dashboard (BetterMyAdmin only, parity exception X64): the card values computed from two
 * consecutive readings of /status/dashboard (raw SHOW GLOBAL STATUS counters + the server clock),
 * their history and the threshold that colours a card. Pure: unit-tested in dashboard.test.ts.
 */

/** Poll intervals offered by the page (seconds). */
export const DASHBOARD_RATES = [2, 5, 10, 30] as const
/** Points kept per series (the sparkline's width). */
export const HISTORY = 60

export type Level = 'ok' | 'warning' | 'critical'

export interface Metrics {
  /** server time of the reading (ms) */
  t: number
  /** Questions per second */
  qps: number | null
  threadsConnected: number | null
  maxConnections: number | null
  /** Threads_connected / max_connections, % */
  connectionUsage: number | null
  maxUsedConnections: number | null
  /** Aborted_connects + Aborted_clients per second */
  abortedPerSec: number | null
  abortedTotal: number | null
  threadsRunning: number | null
  /** 1 − reads / read requests of the interval (since startup on the first reading), % */
  bufferPoolHitRate: number | null
  /** (pages_total − pages_free) / pages_total, % */
  bufferPoolUsage: number | null
  bytesInPerSec: number | null
  bytesOutPerSec: number | null
  slowPerMinute: number | null
  slowTotal: number | null
  tableLocksWaitedPerSec: number | null
  tableLocksWaitedTotal: number | null
  /** Created_tmp_disk_tables / Created_tmp_tables of the interval (since startup first), % */
  tmpDiskRatio: number | null
  uptime: number | null
  /** Seconds_Behind_Source of a replica */
  replicaLag: number | null
}

const n = (s: DashboardSample, name: string): number | null => {
  const v = s.status?.[name]
  if (v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

const v = (s: DashboardSample, name: string): number | null => {
  const x = Number(s.variables[name] ?? Number.NaN)
  return Number.isFinite(x) ? x : null
}

/**
 * The change of a counter per second between two readings; null when either is missing, the
 * interval is empty or the counter went down (FLUSH STATUS, a restart).
 */
export function rate(prev: number | null, cur: number | null, seconds: number): number | null {
  if (prev === null || cur === null || seconds <= 0) return null
  const d = cur - prev
  return d < 0 ? null : d / seconds
}

/** `part / whole` as a %, null on an empty whole */
const pct = (part: number | null, whole: number | null): number | null =>
  part === null || whole === null || whole <= 0 ? null : (part / whole) * 100

/** The delta of a counter, null when missing or reset */
const delta = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b < a ? null : b - a

export function computeMetrics(prev: DashboardSample | null, cur: DashboardSample): Metrics {
  const seconds = prev === null ? 0 : (cur.serverTime - prev.serverTime) / 1000
  // counters going down mean the server restarted (or FLUSH STATUS): no rates from that pair
  const restarted = prev !== null && (n(cur, 'Uptime') ?? 0) < (n(prev, 'Uptime') ?? 0)
  const p = prev === null || restarted ? null : prev
  const r = (name: string) => (p === null ? null : rate(n(p, name), n(cur, name), seconds))
  const sum = (s: DashboardSample, a: string, b: string) => {
    const x = n(s, a)
    const y = n(s, b)
    return x === null && y === null ? null : (x ?? 0) + (y ?? 0)
  }
  const abortedNow = sum(cur, 'Aborted_connects', 'Aborted_clients')
  const reqs =
    p === null
      ? n(cur, 'Innodb_buffer_pool_read_requests')
      : delta(n(p, 'Innodb_buffer_pool_read_requests'), n(cur, 'Innodb_buffer_pool_read_requests'))
  const reads =
    p === null
      ? n(cur, 'Innodb_buffer_pool_reads')
      : delta(n(p, 'Innodb_buffer_pool_reads'), n(cur, 'Innodb_buffer_pool_reads'))
  const tmp =
    p === null
      ? n(cur, 'Created_tmp_tables')
      : delta(n(p, 'Created_tmp_tables'), n(cur, 'Created_tmp_tables'))
  const tmpDisk =
    p === null
      ? n(cur, 'Created_tmp_disk_tables')
      : delta(n(p, 'Created_tmp_disk_tables'), n(cur, 'Created_tmp_disk_tables'))
  const pagesTotal = n(cur, 'Innodb_buffer_pool_pages_total')
  const pagesFree = n(cur, 'Innodb_buffer_pool_pages_free')
  const slow = r('Slow_queries')
  const threadsConnected = n(cur, 'Threads_connected')
  const maxConnections = v(cur, 'max_connections')
  return {
    t: cur.serverTime,
    qps: r('Questions'),
    threadsConnected,
    maxConnections,
    connectionUsage: pct(threadsConnected, maxConnections),
    maxUsedConnections: n(cur, 'Max_used_connections'),
    abortedPerSec:
      p === null ? null : rate(sum(p, 'Aborted_connects', 'Aborted_clients'), abortedNow, seconds),
    abortedTotal: abortedNow,
    threadsRunning: n(cur, 'Threads_running'),
    bufferPoolHitRate:
      reqs === null || reads === null || reqs <= 0 ? null : Math.max(0, (1 - reads / reqs) * 100),
    bufferPoolUsage:
      pagesTotal === null || pagesFree === null ? null : pct(pagesTotal - pagesFree, pagesTotal),
    bytesInPerSec: r('Bytes_received'),
    bytesOutPerSec: r('Bytes_sent'),
    slowPerMinute: slow === null ? null : slow * 60,
    slowTotal: n(cur, 'Slow_queries'),
    tableLocksWaitedPerSec: r('Table_locks_waited'),
    tableLocksWaitedTotal: n(cur, 'Table_locks_waited'),
    tmpDiskRatio: tmp === null || tmpDisk === null || tmp <= 0 ? null : pct(tmpDisk, tmp),
    uptime: n(cur, 'Uptime'),
    replicaLag: cur.replica === null || cur.replica === 'denied' ? null : cur.replica.lag,
  }
}

/** Appends a reading, keeping the last `max` */
export function pushHistory<T>(list: readonly T[], item: T, max = HISTORY): T[] {
  const out = [...list, item]
  return out.length > max ? out.slice(out.length - max) : out
}

/**
 * The thresholds that colour a card (docs/features/06-server-level.md, user docs
 * docs-site/…/status-dashboard): `warning` from the first bound, `critical` from the second.
 * `higher` means a higher value is worse.
 */
export const THRESHOLDS = {
  /** Threads_connected / max_connections, % */
  connectionUsage: { warning: 80, critical: 95, higher: true },
  /** InnoDB buffer pool hit rate, % (lower is worse) */
  bufferPoolHitRate: { warning: 99, critical: 95, higher: false },
  /** temporary tables created on disk, % of all temporary tables */
  tmpDiskRatio: { warning: 25, critical: 50, higher: true },
  /** slow queries per minute */
  slowPerMinute: { warning: 1, critical: 10, higher: true },
  /** table locks waited per second */
  tableLocksWaitedPerSec: { warning: 0.1, critical: 1, higher: true },
  /** replication lag, seconds */
  replicaLag: { warning: 30, critical: 300, higher: true },
} as const

export type ThresholdKey = keyof typeof THRESHOLDS

export function level(key: ThresholdKey, value: number | null): Level {
  if (value === null) return 'ok'
  const th = THRESHOLDS[key]
  if (th.higher) return value >= th.critical ? 'critical' : value >= th.warning ? 'warning' : 'ok'
  return value < th.critical ? 'critical' : value < th.warning ? 'warning' : 'ok'
}

/** The replica card's level: a stopped thread or unknown lag is critical */
export function replicaLevel(replica: DashboardSample['replica']): Level {
  if (replica === null || replica === 'denied') return 'ok'
  if (replica.ioRunning !== 'Yes' || replica.sqlRunning !== 'Yes' || replica.lag === null) return 'critical'
  return level('replicaLag', replica.lag)
}

/** The points of a sparkline path in a `width` × `height` box (y grows downwards); min 0. */
export function sparkPoints(
  values: ReadonlyArray<number | null>,
  width: number,
  height: number,
  max = HISTORY,
): Array<[number, number] | null> {
  const top = Math.max(0, ...values.filter((x): x is number => x !== null))
  const scale = top === 0 ? 1 : top
  const step = width / Math.max(1, max - 1)
  const offset = max - values.length
  return values.map((x, i) =>
    x === null ? null : [(offset + i) * step, height - (x / scale) * (height - 2) - 1],
  )
}

/** An SVG path of the points, broken at the gaps (null) */
export function sparkPath(points: ReadonlyArray<[number, number] | null>): string {
  let d = ''
  let pen = false
  for (const p of points) {
    if (p === null) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`
    pen = true
  }
  return d
}
