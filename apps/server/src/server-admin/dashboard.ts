import type { DashboardSample } from '@bettermyadmin/contracts'
import { showReplicaStatusSql } from '@bettermyadmin/sql-gen'
import { type AdminCtx, keyPairs } from './context.ts'

/**
 * Server › Status › Dashboard (BetterMyAdmin only, parity exception X64): one cheap reading of the
 * counters the dashboard cards chart. Three statements per poll: the status counters and the
 * variables (each one `SHOW GLOBAL … WHERE Variable_name IN (…)`) and the replica status. The
 * rates are computed by the browser from two consecutive readings (features/server/dashboard.ts).
 */

/** The status counters the cards read (MySQL and MariaDB names alike). */
export const DASHBOARD_STATUS = [
  'Uptime',
  'Questions',
  'Connections',
  'Threads_connected',
  'Threads_running',
  'Max_used_connections',
  'Aborted_connects',
  'Aborted_clients',
  'Bytes_received',
  'Bytes_sent',
  'Slow_queries',
  'Table_locks_waited',
  'Table_locks_immediate',
  'Created_tmp_tables',
  'Created_tmp_disk_tables',
  'Innodb_buffer_pool_read_requests',
  'Innodb_buffer_pool_reads',
  'Innodb_buffer_pool_pages_total',
  'Innodb_buffer_pool_pages_free',
  'Innodb_buffer_pool_pages_data',
] as const

export const DASHBOARD_VARIABLES = [
  'version',
  'version_comment',
  'max_connections',
  'innodb_buffer_pool_size',
  'long_query_time',
  'slow_query_log',
] as const

const inList = (names: readonly string[]) => names.map((n) => `'${n}'`).join(',')

/** MySQL 8 refuses SHOW REPLICA STATUS without REPLICATION CLIENT (1227 / 1045 / 1142) */
const DENIED = /^#(1227|1045|1142|1044) /

export async function dashboardSample(ctx: AdminCtx): Promise<DashboardSample> {
  const { dbi } = ctx
  const clock = (await dbi.tryQuery('SELECT UNIX_TIMESTAMP(NOW(3))', 'dashboard.clock'))?.rows[0]?.[0]
  const serverTime =
    clock === undefined || clock === null ? Date.now() : Math.round(Number.parseFloat(clock) * 1000)
  const status = await keyPairs(
    dbi,
    `SHOW GLOBAL STATUS WHERE Variable_name IN (${inList(DASHBOARD_STATUS)})`,
  )
  const variables =
    (await keyPairs(dbi, `SHOW GLOBAL VARIABLES WHERE Variable_name IN (${inList(DASHBOARD_VARIABLES)})`)) ??
    {}
  const flavour = { versionInt: ctx.versionInt, isMariaDb: ctx.isMariaDb }
  const r = await dbi.tryQuery(showReplicaStatusSql(flavour), 'dashboard.replica')
  let replica: DashboardSample['replica'] = null
  if (r === null) replica = DENIED.test(dbi.lastError) ? 'denied' : null
  else if (r.rows.length > 0) {
    const row = Object.fromEntries(r.fields.map((f, i) => [f, r.rows[0]![i] ?? null]))
    const lag = row.Seconds_Behind_Source ?? row.Seconds_Behind_Master ?? null
    replica = {
      lag: lag === null || lag === '' ? null : Number(lag),
      ioRunning: row.Replica_IO_Running ?? row.Slave_IO_Running ?? '',
      sqlRunning: row.Replica_SQL_Running ?? row.Slave_SQL_Running ?? '',
    }
  }
  return { serverTime, status, variables, isMariaDb: ctx.isMariaDb, replica }
}
