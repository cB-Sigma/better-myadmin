import { readFile } from 'node:fs/promises'
import type {
  AdvisorResponse,
  KillProcessResponse,
  ProcessList,
  ProcessRow,
  QueryStatistics,
  StatusOverview,
  StatusVariable,
  StatusVariables,
} from '@bettermyadmin/contracts'
import {
  type Translator,
  formatByteDown,
  formatNumber,
  localisedDate,
  sprintf,
  timespanFormat,
} from '@bettermyadmin/i18n'
import { Advisor, statusVariables } from '@bettermyadmin/kbs'
import { backquote } from '@bettermyadmin/sql-gen'
import { type AdminCtx, isSuperUser, keyPairs, mysqlDocuUrl, varDocUrl } from './context.ts'
import { replicationStatusTable } from './replication-info.ts'
import { StatusData, num } from './status-data.ts'

const bytes = (ctx: AdminCtx, v: number, limes = 6, comma = 0) =>
  formatByteDown(ctx.tr, v, limes, comma)!.join(' ')

/**
 * Server overview: traffic, connections, uptime and the replication summary.
 * pma: src/Controllers/Server/Status/StatusController.php, templates/server/status/status/index.twig
 */
export async function statusOverview(ctx: AdminCtx): Promise<StatusOverview> {
  const data = await StatusData.load(ctx)
  const { tr } = ctx
  const s = (k: string) => num(data.status.get(k))
  const out: StatusOverview = {
    isDataLoaded: data.dataLoaded,
    networkTraffic: null,
    uptime: null,
    startTime: null,
    traffic: [],
    connections: [],
    isPrimary: data.replicationInfo.primaryInfo.status,
    isReplica: data.replicationInfo.replicaInfo.status,
    replication: [],
  }
  if (!data.dataLoaded) return out
  if (data.status.has('Bytes_received') && data.status.has('Bytes_sent')) {
    out.networkTraffic = bytes(ctx, s('Bytes_received') + s('Bytes_sent'), 3, 1)
  }
  if (data.status.has('Uptime')) out.uptime = timespanFormat(tr, Math.trunc(s('Uptime')))
  // getStartTime: SELECT UNIX_TIMESTAMP() - {Uptime}
  const start = Number.parseInt(
    String((await ctx.dbi.fetchValue(`SELECT UNIX_TIMESTAMP() - ${data.status.get('Uptime') ?? ''}`)) || '0'),
    10,
  )
  out.startTime = localisedDate(tr, start, '', ctx.timeZone)

  const hourFactor = 3600 / s('Uptime')
  const received = s('Bytes_received')
  const sent = s('Bytes_sent')
  out.traffic = [
    {
      name: tr.gettext('Received'),
      number: bytes(ctx, received, 3, 1),
      perHour: bytes(ctx, received * hourFactor, 3, 1),
    },
    {
      name: tr.gettext('Sent'),
      number: bytes(ctx, sent, 3, 1),
      perHour: bytes(ctx, sent * hourFactor, 3, 1),
    },
    {
      name: tr.gettext('Total'),
      number: bytes(ctx, received + sent, 3, 1),
      perHour: bytes(ctx, (received + sent) * hourFactor, 3, 1),
    },
  ]
  const connections = s('Connections')
  const pct = (k: string) =>
    connections > 0 ? `${formatNumber(tr, (s(k) * 100) / connections, 0, 2, true)}%` : '---'
  out.connections = [
    {
      name: tr.gettext('Max. concurrent connections'),
      number: formatNumber(tr, s('Max_used_connections'), 0),
      perHour: '---',
      percentage: '---',
    },
    {
      name: tr.gettext('Failed attempts'),
      number: formatNumber(tr, s('Aborted_connects'), 4, 1, true),
      perHour: formatNumber(tr, s('Aborted_connects') * hourFactor, 4, 2, true),
      percentage: pct('Aborted_connects'),
    },
    {
      name: tr.gettext('Aborted'),
      number: formatNumber(tr, s('Aborted_clients'), 4, 1, true),
      perHour: formatNumber(tr, s('Aborted_clients') * hourFactor, 4, 2, true),
      percentage: pct('Aborted_clients'),
    },
    {
      name: tr.gettext('Total'),
      number: formatNumber(tr, connections, 4, 0),
      perHour: formatNumber(tr, connections * hourFactor, 4, 2),
      percentage: `${formatNumber(tr, 100, 0, 2)}%`,
    },
  ]
  if (out.isPrimary)
    out.replication.push(await replicationStatusTable(ctx.dbi, ctx.versionInt, ctx.isMariaDb, 'primary'))
  if (out.isReplica)
    out.replication.push(await replicationStatusTable(ctx.dbi, ctx.versionInt, ctx.isMariaDb, 'replica'))
  return out
}

/**
 * Process list. Sorting or "Show only active" read INFORMATION_SCHEMA.PROCESSLIST.
 * pma: src/Server/Status/Processes.php::getList, getSortableColumnsForProcessList
 */
export async function processList(
  ctx: AdminCtx,
  q: { showExecuting: boolean; full: boolean; orderByField: string; sortOrder: string },
): Promise<ProcessList> {
  const { tr } = ctx
  // ProcessesController / RefreshController get Server\Status\Data from the DI container
  await StatusData.load(ctx)
  let sql = q.full ? 'SHOW FULL PROCESSLIST' : 'SHOW PROCESSLIST'
  const sorted = q.orderByField !== '' && q.sortOrder !== ''
  const useIS = q.showExecuting || sorted
  if (useIS) sql = 'SELECT * FROM `INFORMATION_SCHEMA`.`PROCESSLIST`'
  if (q.showExecuting) sql += " WHERE `COMMAND` <> 'Sleep' AND `STATE` <> 'Waiting for next activation'"
  // sort_order is inserted verbatim like phpMyAdmin; only ASC/DESC reach MySQL from our client
  if (sorted) sql += ` ORDER BY ${backquote(q.orderByField)} ${q.sortOrder}`

  const r = await ctx.conn.query(sql, 'status.processes')
  const set = r.resultSets[0]
  const rows: ProcessRow[] = []
  const empty = (v: string | null | undefined) => v === null || v === undefined || v === '' || v === '0'
  for (const raw of set?.rows ?? []) {
    const p: Record<string, string | null> = {}
    set!.fields.forEach((f, i) => {
      const v = raw[i]
      p[f.name.toLowerCase()] = v === null || v === undefined ? null : v.toString('utf8')
    })
    let progress = empty(p.progress) ? '---' : (p.progress as string)
    if (useIS && !empty(p.progress)) {
      const stage = 'stage' in p ? Math.trunc(num(p.stage ?? '')) : null
      const maxStage = 'max_stage' in p ? Math.trunc(num(p.max_stage ?? '')) : null
      if (stage !== null && maxStage !== null && maxStage > 1) {
        progress = formatNumberEn(((stage - 1) / maxStage) * 100 + num(progress) / maxStage, 3)
      }
    }
    let info: string | null = null
    if (!empty(p.info)) {
      info = p.info as string
      const max = ctx.cfg.MaxCharactersInDisplayedSQL
      if (!q.full && [...info].length > max) info = `${[...info].slice(0, max).join('')}[...]`
    }
    rows.push({
      id: p.id ?? '',
      user: p.user ?? '',
      host: p.host ?? '',
      userHost: (p.host ?? '').replace(/:\d+$/, ''),
      db: p.db ?? '',
      command: p.command ?? '',
      time: p.time ?? '',
      state: empty(p.state) ? '---' : (p.state as string),
      progress,
      info,
    })
  }

  const sortable: Array<[string, string]> = [
    [tr.gettext('ID'), 'Id'],
    [tr.gettext('User'), 'User'],
    [tr.gettext('Host'), 'Host'],
    [tr.gettext('Database'), 'Db'],
    [tr.gettext('Command'), 'Command'],
    [tr.gettext('Time'), 'Time'],
    [tr.gettext('Status'), 'State'],
  ]
  if (ctx.isMariaDb) sortable.push([tr.gettext('Progress'), 'Progress'])
  sortable.push([tr.gettext('SQL query'), 'Info'])
  const columns = sortable.map(([name, field], i) => {
    const isSorted = sorted && q.orderByField === field
    const last = i === sortable.length - 1
    return {
      name,
      orderByField: field,
      sortOrder: (isSorted && q.sortOrder === 'ASC' ? 'DESC' : 'ASC') as 'ASC' | 'DESC',
      isSorted,
      hasFullQuery: last,
      isFull: last && q.full,
    }
  })
  return {
    columns,
    rows,
    isMariaDb: ctx.isMariaDb,
    showExecuting: q.showExecuting,
    full: q.full,
    orderByField: q.orderByField,
    sortOrder: q.sortOrder,
  }
}

/** number_format($v, $decimals) with the default '.' and ',' (not the translated separators) */
function formatNumberEn(v: number, decimals: number): string {
  const fixed = v.toFixed(decimals)
  const [i = '', f] = fixed.split('.')
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return f === undefined ? grouped : `${grouped}.${f}`
}

/**
 * Kill a process: `KILL id;`, or `CALL mysql.rds_kill(id);` on Amazon RDS as superuser.
 * pma: src/Controllers/Server/Status/Processes/KillController.php, DatabaseInterface::getKillQuery
 */
export async function killProcess(ctx: AdminCtx, id: number): Promise<KillProcessResponse> {
  const { tr } = ctx
  // KillController gets Server\Status\Data from the DI container
  await StatusData.load(ctx)
  // DatabaseInterface::isAmazonRds (SessionCache is_amazon_rds)
  let rds = ctx.dbi.cache.is_amazon_rds
  if (typeof rds !== 'boolean') {
    rds = String((await ctx.dbi.fetchValue('SELECT @@basedir')) || '').startsWith('/rdsdbbin/')
    ctx.dbi.cache.is_amazon_rds = rds
  }
  const sql = rds && (await isSuperUser(ctx.dbi)) ? `CALL mysql.rds_kill(${id});` : `KILL ${id};`
  const ok = (await ctx.dbi.tryQuery(sql, 'status.kill')) !== null
  return ok
    ? {
        success: true,
        message: {
          type: 'success',
          text: sprintf(tr.gettext('Thread %s was successfully killed.'), String(id)),
        },
      }
    : {
        success: false,
        message: {
          type: 'error',
          text: sprintf(
            tr.gettext('phpMyAdmin was unable to kill thread %s. It probably has already been closed.'),
            String(id),
          ),
        },
      }
}

/** mb_convert_case(str_replace(['Com_', '_'], ['', ' '], $key), MB_CASE_TITLE) */
export function queryName(key: string): string {
  const s = key.replaceAll('Com_', '').replaceAll('_', ' ')
  // MB_CASE_TITLE upper-cases the first letter of every word and lower-cases the rest
  return s
    .toLowerCase()
    .replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase())
}

/**
 * Query statistics: Com_* counters with a pie chart.
 * pma: src/Controllers/Server/Status/QueriesController.php
 */
export async function queryStatistics(ctx: AdminCtx): Promise<QueryStatistics> {
  const data = await StatusData.load(ctx)
  const { tr } = ctx
  const out: QueryStatistics = {
    isDataLoaded: data.dataLoaded,
    total: '',
    perHour: '',
    perMinute: '',
    perSecond: null,
    questionsDocUrl: mysqlDocuUrl('server-status-variables', 'statvar_Questions', ctx.versionInt),
    queries: [],
    chart: { labels: [], data: [] },
  }
  if (!data.dataLoaded) return out
  const uptime = num(data.status.get('Uptime'))
  const hourFactor = 3600 / uptime
  const used = [...data.usedQueries].map(([k, v]) => [k, num(v)] as const)
  const total = used.reduce((a, [, v]) => a + v, 0)
  out.total = formatNumber(tr, total, 0)
  out.perHour = formatNumber(tr, total * hourFactor, 0)
  out.perMinute = formatNumber(tr, (total * 60) / uptime, 0)
  const perSecond = total / uptime
  out.perSecond = perSecond >= 1 ? formatNumber(tr, perSecond, 0) : null
  // arsort: by value descending (stable for equal values in PHP 8)
  const sorted = [...used].sort((a, b) => b[1] - a[1])
  const chart = new Map<string, number>()
  let otherSum = 0
  for (const [key, value] of sorted) {
    const name = queryName(key)
    // Group together values that make out less than 2% into "Other", but only if we have more than 6 fractions already
    if (value < total * 0.02 && chart.size > 6) otherSum += value
    else chart.set(name, Math.trunc(value))
    out.queries.push({
      key,
      name,
      value: formatNumber(tr, value, 5, 0, true),
      perHour: formatNumber(tr, value * hourFactor, 4, 1, true),
      percentage: formatNumber(tr, (value * 100) / total, 0, 2),
    })
  }
  if (otherSum > 0) chart.set(tr.gettext('Other statements'), otherSum)
  out.chart = { labels: [...chart.keys()], data: [...chart.values()] }
  return out
}

/** VariablesController::getAlerts — alert when the value is above */
function alerts(data: StatusData): Map<string, number> {
  const s = (k: string) => (data.status.has(k) ? num(data.status.get(k)) : null)
  const entries: Array<[string, number]> = [
    ['Aborted_clients', 0],
    ['Aborted_connects', 0],
    ['Binlog_cache_disk_use', 0],
    ['Created_tmp_disk_tables', 0],
    ['Handler_read_rnd', 0],
    ['Handler_read_rnd_next', 0],
    ['Innodb_buffer_pool_pages_dirty', 0],
    ['Innodb_buffer_pool_reads', 0],
    ['Innodb_buffer_pool_wait_free', 0],
    ['Innodb_log_waits', 0],
    ['Innodb_row_lock_time_avg', 10],
    ['Innodb_row_lock_time_max', 50],
    ['Innodb_row_lock_waits', 0],
    ['Slow_queries', 0],
    ['Delayed_errors', 0],
    ['Select_full_join', 0],
    ['Select_range_check', 0],
    ['Sort_merge_passes', 0],
    ['Opened_tables', 0],
    ['Table_locks_waited', 0],
    ['Qcache_lowmem_prunes', 0],
    ['Qcache_free_blocks', s('Qcache_total_blocks') !== null ? s('Qcache_total_blocks')! / 5 : 0],
    ['Slow_launch_threads', 0],
    ['Key_reads', s('Key_read_requests') !== null ? 0.01 * s('Key_read_requests')! : 0],
    ['Key_writes', s('Key_write_requests') !== null ? 0.9 * s('Key_write_requests')! : 0],
    // quirk Q17: phpMyAdmin keys this `Key_buffer_fraction`, which never matches `Key_buffer_fraction_%`
    ['Key_buffer_fraction_%', 0.5],
    [
      'Threads_cached',
      data.variables.thread_cache_size !== undefined ? 0.95 * num(data.variables.thread_cache_size) : 0,
    ],
  ]
  return new Map(entries)
}

const FLUSHABLE = ['STATUS', 'TABLES', 'QUERY CACHE']

/**
 * All status variables with categories, alerts, descriptions, related links; FLUSH actions.
 * pma: src/Controllers/Server/Status/VariablesController.php, templates/server/status/variables/index.twig
 */
export async function statusVariablesPage(
  ctx: AdminCtx,
  req: {
    flush?: string | undefined
    filterText?: string | undefined
    filterAlert: boolean
    filterCategory?: string | undefined
    dontFormat: boolean
  },
): Promise<StatusVariables> {
  const { tr } = ctx
  // phpMyAdmin builds the Data object (and runs its queries) before the controller flushes, so the
  // page shows the values read before the FLUSH
  const data = await StatusData.load(ctx)
  let flushed: string | null = null
  if (req.flush !== undefined && FLUSHABLE.includes(req.flush)) {
    flushed = `FLUSH ${req.flush};`
    await ctx.conn.query(flushed, 'status.flush')
  }
  const out: StatusVariables = {
    isDataLoaded: data.dataLoaded,
    filterText: req.filterText ?? '',
    isOnlyAlerts: req.filterAlert,
    isNotFormatted: req.dontFormat,
    filterCategory: req.filterCategory ?? '',
    categories: [],
    links: [],
    variables: [],
    flushed,
  }
  if (!data.dataLoaded) return out
  for (const [id, name] of data.sections) if (data.sectionUsed.has(id)) out.categories.push({ id, name })
  for (const [section, links] of data.links) {
    out.links.push({
      section,
      links: links.map((l) =>
        l.kind === 'doc' ? { kind: 'doc', url: mysqlDocuUrl(l.url, '', ctx.versionInt) } : l,
      ),
    })
  }
  const descriptions = statusVariables.descriptions as Record<string, string>
  const alertMap = alerts(data)
  for (const [name, value] of data.status) {
    const text = typeof value === 'number' ? phpString(value) : value
    const alert = alertMap.get(name)
    const v: StatusVariable = {
      name,
      value: text,
      section: data.allocationMap.get(name) ?? null,
      // Fields containing % are calculated, they can not be described in MySQL documentation
      docUrl: name.includes('%') ? null : varDocUrl(name, ctx),
      hasAlert: alert !== undefined,
      isAlert: alert !== undefined && compareGreater(value, alert),
      formatted: formatStatusValue(tr, name, value),
      description: Object.hasOwn(descriptions, name) ? tr.gettext(descriptions[name]!) : '',
      descriptionLinks: (data.links.get(name) ?? []).map((l) =>
        l.kind === 'doc' ? { kind: 'doc', url: mysqlDocuUrl(l.url, '', ctx.versionInt) } : l,
      ),
    }
    out.variables.push(v)
  }
  return out
}

/** `$value > $alerts[$name]` with a numeric threshold */
function compareGreater(value: string | number, max: number): boolean {
  if (typeof value === 'number') return value > max
  if (isNumeric(value)) return num(value) > max
  // non-numeric string vs number: compared as strings (PHP 8)
  return value > phpString(max)
}

const isNumeric = (s: string) =>
  /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(s)

/** (string) of a computed float: precision 14 */
function phpString(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v)
  const [mant, expStr] = v.toExponential(13).split('e') as [string, string]
  const exp = Number(expStr)
  if (exp < -4 || exp >= 14) {
    let m = mant.replace(/0+$/, '').replace(/\.$/, '')
    if (!m.includes('.')) m += '.0'
    return `${m}E${exp < 0 ? '-' : '+'}${Math.abs(exp)}`
  }
  return v
    .toFixed(Math.max(0, 13 - exp))
    .replace(/0+$/, '')
    .replace(/\.$/, '')
}

/** The `.formatted` span of status/variables/index.twig */
export function formatStatusValue(tr: Translator, name: string, value: string | number) {
  const numeric = typeof value === 'number' || isNumeric(value)
  if (name.endsWith('%')) return { text: `${formatNumber(tr, value, 0, 2)} %` }
  if (name.includes('Uptime')) return { text: timespanFormat(tr, Math.trunc(num(value))) }
  if (numeric && num(value) >= 1000) {
    return { text: formatNumber(tr, value, 3, 1), title: formatNumber(tr, value, 0) }
  }
  if (numeric) return { text: formatNumber(tr, value, 3, 1) }
  return { text: typeof value === 'number' ? phpString(value) : value }
}

/** SysInfo::get()->memory()['MemTotal'] — /proc/meminfo on Linux, 0 elsewhere */
async function systemMemory(): Promise<number> {
  if (process.platform !== 'linux') return 0
  const content = await readFile('/proc/meminfo', 'utf8').catch(() => null)
  if (content === null) return 0
  const m = /^MemTotal:\s+(.*)\s*kB/im.exec(content)
  return m === null ? 0 : Number.parseInt(m[1]!, 10) || 0
}

/**
 * Advisor: phpMyAdmin's rule set evaluated on SHOW GLOBAL STATUS / VARIABLES and the host memory.
 * pma: src/Controllers/Server/Status/AdvisorController.php, src/Advisory/Advisor.php
 */
export async function advisorPage(
  ctx: AdminCtx,
  variableUrl: (name: string) => string,
): Promise<AdvisorResponse> {
  const data = await StatusData.load(ctx)
  if (!data.dataLoaded) return { isDataLoaded: false, fired: [], notfired: [], unchecked: [], errors: [] }
  // Advisor::setVariables reads both lists again
  const status = (await keyPairs(ctx.dbi, 'SHOW GLOBAL STATUS')) ?? {}
  const variables = (await keyPairs(ctx.dbi, 'SHOW GLOBAL VARIABLES')) ?? {}
  const advisor = new Advisor({ tr: ctx.tr, variableUrl })
  const result = advisor.run({
    status,
    variables,
    systemMemory: await systemMemory(),
    versionInt: ctx.versionInt,
    isMariaDb: ctx.isMariaDb,
  })
  return { isDataLoaded: true, ...result }
}
