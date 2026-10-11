import type { StatusLink } from '@bettermyadmin/contracts'
import type { Translator } from '@bettermyadmin/i18n'
import { type AdminCtx, keyPairs } from './context.ts'
import { ReplicationInfo } from './replication-info.ts'

/**
 * variable name → section; a variable matches when its name contains the given string (first match).
 * pma: src/Server/Status/Data.php::ALLOCATIONS
 */
const ALLOCATIONS: Array<[string, string]> = [
  ['Com_', 'com'],
  ['Innodb_', 'innodb'],
  ['Ndb_', 'ndb'],
  ['Handler_', 'handler'],
  ['Qcache_', 'qcache'],
  ['Threads_', 'threads'],
  ['Slow_launch_threads', 'threads'],
  ['Binlog_cache_', 'binlog_cache'],
  ['Created_tmp_', 'created_tmp'],
  ['Key_', 'key'],
  ['Delayed_', 'delayed'],
  ['Not_flushed_delayed_rows', 'delayed'],
  ['Flush_commands', 'query'],
  ['Last_query_cost', 'query'],
  ['Slow_queries', 'query'],
  ['Queries', 'query'],
  ['Prepared_stmt_count', 'query'],
  ['Select_', 'select'],
  ['Sort_', 'sort'],
  ['Open_tables', 'table'],
  ['Opened_tables', 'table'],
  ['Open_table_definitions', 'table'],
  ['Opened_table_definitions', 'table'],
  ['Table_locks_', 'table'],
  ['Rpl_status', 'repl'],
  ['Slave_', 'repl'],
  ['Tc_', 'tc'],
  ['Ssl_', 'ssl'],
  ['Open_files', 'files'],
  ['Open_streams', 'files'],
  ['Opened_files', 'files'],
]

/** Data::getSections */
function sections(tr: Translator): Array<[string, string]> {
  return [
    ['com', 'Com'],
    ['query', tr.gettext('SQL query')],
    ['innodb', 'InnoDB'],
    ['ndb', 'NDB'],
    ['handler', tr.gettext('Handler')],
    ['qcache', tr.gettext('Query cache')],
    ['threads', tr.gettext('Threads')],
    ['binlog_cache', tr.gettext('Binary log')],
    ['created_tmp', tr.gettext('Temporary data')],
    ['delayed', tr.gettext('Delayed inserts')],
    ['key', tr.gettext('Key cache')],
    ['select', tr.gettext('Joins')],
    ['repl', tr.gettext('Replication')],
    ['sort', tr.gettext('Sorting')],
    ['table', tr.gettext('Tables')],
    ['tc', tr.gettext('Transaction coordinator')],
    ['files', tr.gettext('Files')],
    ['ssl', 'SSL'],
    ['other', tr.gettext('Other')],
  ]
}

/** PHP numeric value of a status value (`$serverStatus['x'] * …`); non-numeric strings count as 0. */
export const num = (v: string | number | undefined): number => {
  if (typeof v === 'number') return v
  if (v === undefined) return 0
  const m = /^[ \t\n\r\v\f]*([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?)/.exec(v)
  return m === null ? 0 : Number(m[1])
}

export type StatusValue = string | number

/**
 * The status snapshot shared by the Status pages: SHOW GLOBAL STATUS, SHOW GLOBAL VARIABLES, the
 * deprecated-counter clean-up, the synthetic `%` variables, the section map and related links.
 * phpMyAdmin builds it (with ReplicationInfo) for every Status controller through the DI container.
 * pma: src/Server/Status/Data.php
 */
export class StatusData {
  status: Map<string, StatusValue> = new Map()
  variables: Record<string, string> = {}
  usedQueries: Map<string, StatusValue> = new Map()
  allocationMap: Map<string, string> = new Map()
  sectionUsed: Set<string> = new Set()
  sections: Array<[string, string]> = []
  links: Map<string, StatusLink[]> = new Map()
  dataLoaded = false
  replicationInfo!: ReplicationInfo

  static async load(ctx: AdminCtx): Promise<StatusData> {
    const d = new StatusData()
    d.replicationInfo = await new ReplicationInfo(ctx.dbi, ctx.versionInt, ctx.isMariaDb).load()
    const status = await keyPairs(ctx.dbi, 'SHOW GLOBAL STATUS')
    d.dataLoaded = status !== null
    d.variables = (await keyPairs(ctx.dbi, 'SHOW GLOBAL VARIABLES')) ?? {}
    const map = new Map<string, StatusValue>(Object.entries(status ?? {}))
    cleanDeprecated(map)
    calculateValues(map, d.variables)
    d.status = map
    d.sortVariables()
    // admin commands are not queries (e.g. they include COM_PING, which is excluded from Questions)
    d.usedQueries.delete('Com_admin_commands')
    d.sections = sections(ctx.tr)
    d.links = d.getLinks(ctx.tr)
    return d
  }

  /** Data::sortVariables */
  sortVariables(): void {
    for (const [name, value] of this.status) {
      const hit = ALLOCATIONS.find(([filter]) => name.includes(filter))
      const section = hit?.[1] ?? 'other'
      this.allocationMap.set(name, section)
      this.sectionUsed.add(section)
      if (section === 'com' && num(value) > 0) this.usedQueries.set(name, value)
    }
  }

  /**
   * Data::getLinks. phpMyAdmin points the flush links at the application root (quirk Q15, the POST
   * lands on the home page and does nothing); ours run FLUSH through the status variables page.
   */
  getLinks(tr: Translator): Map<string, StatusLink[]> {
    const links = new Map<string, StatusLink[]>()
    const add = (key: string, link: StatusLink) => {
      const list = links.get(key) ?? []
      list.push(link)
      links.set(key, list)
    }
    add('table', { kind: 'flush', label: tr.gettext('Flush (close) all tables'), flush: 'TABLES' })
    add('table', { kind: 'sql', label: tr.gettext('Show open tables'), sql: 'SHOW OPEN TABLES' })
    if (this.replicationInfo.primaryInfo.status) {
      add('repl', { kind: 'sql', label: tr.gettext('Show replica hosts'), sql: 'SHOW SLAVE HOSTS' })
      add('repl', { kind: 'route', label: tr.gettext('Show primary status'), route: '#replication_primary' })
    }
    if (this.replicationInfo.replicaInfo.status) {
      add('repl', { kind: 'route', label: tr.gettext('Show replica status'), route: '#replication_replica' })
    }
    add('repl', { kind: 'doc', url: 'replication' })
    add('qcache', { kind: 'flush', label: tr.gettext('Flush query cache'), flush: 'QUERY CACHE' })
    add('qcache', { kind: 'doc', url: 'query_cache' })
    add('threads', { kind: 'doc', url: 'mysql_threads' })
    add('key', { kind: 'doc', url: 'myisam_key_cache' })
    add('binlog_cache', { kind: 'doc', url: 'binary_log' })
    add('Slow_queries', { kind: 'doc', url: 'slow_query_log' })
    add('innodb', { kind: 'route', label: tr.gettext('Variables'), route: '/server/engines/InnoDB' })
    add('innodb', {
      kind: 'route',
      label: tr.gettext('InnoDB Status'),
      route: '/server/engines/InnoDB/Status',
    })
    add('innodb', { kind: 'doc', url: 'innodb' })
    return links
  }
}

/** Data::cleanDeprecated */
export function cleanDeprecated(status: Map<string, StatusValue>): void {
  const deprecated: Array<[string, string]> = [
    ['Com_prepare_sql', 'Com_stmt_prepare'],
    ['Com_execute_sql', 'Com_stmt_execute'],
    ['Com_dealloc_sql', 'Com_stmt_close'],
  ]
  for (const [old, now] of deprecated) {
    if (status.has(old) && status.has(now)) status.delete(old)
  }
}

/** Data::calculateValues — the synthetic `%` variables (appended in this order). */
export function calculateValues(status: Map<string, StatusValue>, variables: Record<string, string>): void {
  const has = (k: string) => status.has(k)
  const s = (k: string) => num(status.get(k))
  const v = (k: string) => num(variables[k])
  // Key_buffer_fraction
  if (
    has('Key_blocks_unused') &&
    'key_cache_block_size' in variables &&
    'key_buffer_size' in variables &&
    v('key_buffer_size') !== 0
  ) {
    status.set(
      'Key_buffer_fraction_%',
      100 - ((s('Key_blocks_unused') * v('key_cache_block_size')) / v('key_buffer_size')) * 100,
    )
  } else if (has('Key_blocks_used') && 'key_buffer_size' in variables && v('key_buffer_size') !== 0) {
    status.set('Key_buffer_fraction_%', (s('Key_blocks_used') * 1024) / v('key_buffer_size'))
  }
  // Ratio for key read/write
  if (has('Key_writes') && has('Key_write_requests') && s('Key_write_requests') > 0) {
    status.set('Key_write_ratio_%', (100 * s('Key_writes')) / s('Key_write_requests'))
  }
  if (has('Key_reads') && has('Key_read_requests') && s('Key_read_requests') > 0) {
    status.set('Key_read_ratio_%', (100 * s('Key_reads')) / s('Key_read_requests'))
  }
  // Threads_cache_hitrate
  if (has('Threads_created') && has('Connections') && s('Connections') > 0) {
    status.set('Threads_cache_hitrate_%', 100 - (s('Threads_created') / s('Connections')) * 100)
  }
}
