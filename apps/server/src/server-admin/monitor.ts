import { readFile } from 'node:fs/promises'
import type {
  MonitorChartResponse,
  MonitorLogResponse,
  MonitorLogVarsResponse,
  MonitorPage,
  MonitorQueryResponse,
} from '@bettermyadmin/contracts'
import { formatByteDown, htmlspecialchars } from '@bettermyadmin/i18n'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import { MysqlError, ValidationError } from '../http/errors.ts'
import { formatError } from '../query/message.ts'
import { isProfilingSupported } from '../query/profiling.ts'
import { type AdminCtx, isSuperUser, keyPairs } from './context.ts'
import { StatusData } from './status-data.ts'

/**
 * Server › Status › Monitor: the page facts, the chart readings, the slow/general log statistics,
 * the logging variables and the query analyzer. Every endpoint first builds Server\Status\Data like
 * phpMyAdmin's DI container does for each Status controller (quirk Q55).
 * pma: src/Controllers/Server/Status/MonitorController.php, Monitor/*Controller.php,
 *      src/Server/Status/Monitor.php, src/Server/SysInfo/{SysInfo,Linux,Base}.php
 */

/** Status controllers: Data from the container (their `selectDb('mysql')` is not sent, X36) */
function prepare(ctx: AdminCtx): Promise<StatusData> {
  return StatusData.load(ctx)
}

/** SysInfo::getOs (PHP_OS of the web server; FreeBSD and DragonFly count as Linux) */
export function serverOs(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'linux' || platform === 'freebsd') return 'Linux'
  if (platform === 'win32') return 'WINNT'
  if (platform === 'sunos') return 'SunOS'
  return platform.charAt(0).toUpperCase() + platform.slice(1)
}

const isNumeric = (v: unknown) =>
  typeof v === 'number' ||
  (typeof v === 'string' && /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(v))

/** MonitorController: `#js_data` and `window.variableNames` */
export async function monitorPage(ctx: AdminCtx): Promise<MonitorPage> {
  const data = await prepare(ctx)
  const host = ctx.server.host.toLowerCase()
  const names = [...data.status].filter(([, v]) => isNumeric(v)).map(([k]) => k)
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return {
    serverTime: Date.now(),
    serverOs: serverOs(),
    isSuperUser: await isSuperUser(ctx.dbi),
    serverDbIsLocal: host === 'localhost' || host === '127.0.0.1' || host === '::1',
    variableNames: names,
  }
}

/** SysInfo Linux::loadavg — busy/idle jiffies of the first line of /proc/stat (Base: zeros) */
async function loadavg(): Promise<{ busy: number; idle: number } | { loadavg: number }> {
  if (serverOs() !== 'Linux') return { loadavg: 0 }
  const buf = await readFile('/proc/stat', 'utf8').catch(() => null)
  if (buf === null) return { loadavg: 0 }
  const nums = buf.slice(0, Math.max(0, buf.indexOf('\n'))).split(/\s+/)
  const n = (i: number) => Number.parseInt(nums[i] ?? '0', 10) || 0
  return { busy: n(1) + n(2) + n(3), idle: n(4) }
}

/** SysInfo Linux::memory — /proc/meminfo in KiB with MemUsed and SwapUsed (Base: none) */
async function memory(): Promise<Record<string, number>> {
  if (serverOs() !== 'Linux') return {}
  const content = await readFile('/proc/meminfo', 'utf8').catch(() => null)
  if (content === null) return {}
  const mem: Record<string, number> = {
    MemTotal: 0,
    MemFree: 0,
    Cached: 0,
    Buffers: 0,
    SwapTotal: 0,
    SwapFree: 0,
    SwapCached: 0,
  }
  for (const m of content.matchAll(
    /^(MemTotal|MemFree|Cached|Buffers|SwapCached|SwapTotal|SwapFree):\s+(.*)\s*kB/gim,
  ))
    mem[m[1]!] = Number.parseInt(m[2]!, 10) || 0
  mem.MemUsed = mem.MemTotal! - mem.MemFree! - mem.Cached! - mem.Buffers!
  mem.SwapUsed = mem.SwapTotal! - mem.SwapFree! - mem.SwapCached!
  return mem
}

type Point = Record<string, unknown> & { type?: unknown; name?: unknown }

/**
 * Monitor::getJsonForChartingData — the status and server variables of all charts in one query
 * each (names allow-listed to `[a-zA-Z_]`), the process count per `proc` point, CPU and memory of
 * the web server host, and `x`.
 */
export async function chartData(ctx: AdminCtx, requiredData: string): Promise<MonitorChartResponse> {
  await prepare(ctx)
  let decoded: unknown
  try {
    decoded = JSON.parse(requiredData)
  } catch {
    decoded = null
  }
  if (decoded === null || typeof decoded !== 'object') throw new ValidationError('Invalid requiredData')
  const ret = decoded as Record<string, Point[][]>
  const statusVars: string[] = []
  const serverVars: string[] = []
  const valid = (n: unknown) => typeof n === 'string' && !/[^a-zA-Z_]+/.test(n)
  for (const nodes of Object.values(ret)) {
    if (!Array.isArray(nodes)) continue
    for (const points of nodes) {
      if (!Array.isArray(points)) continue
      for (const point of points) {
        if (point === null || typeof point !== 'object') continue
        switch (point.type) {
          case 'servervar':
            if (valid(point.name)) serverVars.push(point.name as string)
            break
          case 'statusvar':
            if (valid(point.name)) statusVars.push(point.name as string)
            break
          case 'proc': {
            const r = await ctx.conn.query('SHOW PROCESSLIST', 'monitor.proc')
            point.value = r.resultSets[0]?.rows.length ?? 0
            break
          }
          case 'cpu': {
            const load = await loadavg()
            if ('busy' in load) {
              point.idle = load.idle
              point.busy = load.busy
            } else point.value = load.loadavg
            break
          }
          case 'memory':
            point.value = (await memory())[String(point.name)] ?? 0
            break
        }
      }
    }
  }
  const statusValues =
    statusVars.length > 0
      ? ((await keyPairs(
          ctx.dbi,
          `SHOW GLOBAL STATUS WHERE Variable_name='${statusVars.join("' OR Variable_name='")}'`,
        )) ?? {})
      : {}
  const serverValues =
    serverVars.length > 0
      ? ((await keyPairs(
          ctx.dbi,
          `SHOW GLOBAL VARIABLES WHERE Variable_name='${serverVars.join("' OR Variable_name='")}'`,
        )) ?? {})
      : {}
  for (const nodes of Object.values(ret)) {
    if (!Array.isArray(nodes)) continue
    for (const points of nodes) {
      if (!Array.isArray(points)) continue
      for (const point of points) {
        if (point === null || typeof point !== 'object') continue
        // an unknown (or filtered) name reads as null
        if (point.type === 'statusvar') point.value = statusValues[String(point.name)] ?? null
        else if (point.type === 'servervar') point.value = serverValues[String(point.name)] ?? null
      }
    }
  }
  return { message: { ...ret, x: Date.now() } as MonitorChartResponse['message'] }
}

const cut = (ctx: AdminCtx, text: string): string => {
  // Cut off big inserts and updates, but append byte count instead
  const chars = [...text]
  if (chars.length <= 220) return text
  return `${chars.slice(0, 200).join('')}... [${formatByteDown(ctx.tr, chars.length, 2, 2)!.join(' ')}]`
}

/** Monitor::getJsonForLogDataTypeSlow */
export async function slowLog(ctx: AdminCtx, start: number, end: number): Promise<MonitorLogResponse> {
  await prepare(ctx)
  const sql =
    'SELECT start_time, user_host, ' +
    'Sec_to_Time(Sum(Time_to_Sec(query_time))) as query_time, ' +
    'Sec_to_Time(Sum(Time_to_Sec(lock_time))) as lock_time, ' +
    'SUM(rows_sent) AS rows_sent, ' +
    'SUM(rows_examined) AS rows_examined, db, sql_text, ' +
    "COUNT(sql_text) AS '#' " +
    'FROM `mysql`.`slow_log` ' +
    `WHERE start_time > FROM_UNIXTIME(${start}) ` +
    `AND start_time < FROM_UNIXTIME(${end}) GROUP BY start_time, user_host, db, sql_text`
  const r = await ctx.dbi.tryQuery(sql, 'monitor.slowLog')
  if (r === null) return { success: false, message: null }
  const rows: Array<Record<string, string | null>> = []
  const sum: Record<string, number> = {}
  for (const raw of r.rows) {
    const row = Object.fromEntries(r.fields.map((f, i) => [f, raw[i] ?? null]))
    const text = row.sql_text ?? ''
    const space = text.indexOf(' ')
    const type = text.slice(0, Math.max(0, space)).toLowerCase()
    if (type === 'insert' || type === 'update') row.sql_text = cut(ctx, text)
    sum[type] = (sum[type] ?? 0) + Number(row['#'] ?? 0)
    rows.push(row)
  }
  sum.TOTAL = Object.values(sum).reduce((a, b) => a + b, 0)
  return { success: true, message: { rows, sum, numRows: rows.length } }
}

/** Monitor::getJsonForLogDataTypeGeneral (with removeVariables, INSERTs into one table are grouped) */
export async function generalLog(
  ctx: AdminCtx,
  start: number,
  end: number,
  limitTypes: boolean,
  removeVariables: boolean,
): Promise<MonitorLogResponse> {
  await prepare(ctx)
  const limit = limitTypes ? "AND argument REGEXP '^(INSERT|SELECT|UPDATE|DELETE)' " : ''
  const sql =
    'SELECT TIME(event_time) as event_time, user_host, thread_id, ' +
    "server_id, argument, count(argument) as '#' " +
    'FROM `mysql`.`general_log` ' +
    "WHERE command_type='Query' " +
    `AND event_time > FROM_UNIXTIME(${start}) ` +
    `AND event_time < FROM_UNIXTIME(${end}) ` +
    `${limit}GROUP by event_time, user_host, thread_id, server_id, argument`
  const r = await ctx.dbi.tryQuery(sql, 'monitor.generalLog')
  if (r === null) return { success: false, message: null }
  const rows: Array<Record<string, string | null>> = []
  const sum: Record<string, number> = {}
  const insertTables = new Map<string, number>()
  let insertTablesFirst = -1
  let i = 0
  for (const raw of r.rows) {
    const row = Object.fromEntries(r.fields.map((f, k) => [f, raw[k] ?? null]))
    const argument = row.argument ?? ''
    const type = (/^(\w+)\s/.exec(argument)?.[1] ?? '').toLowerCase()
    sum[type] = (sum[type] ?? 0) + Number(row['#'] ?? 0)
    if (type === 'insert' && removeVariables) {
      // '/^INSERT INTO (`|\'|"|)([^\s\\1]+)\\1/i': in the class, PHP's `\1` is the octal escape \x01
      // biome-ignore lint/suspicious/noControlCharactersInRegex: phpMyAdmin's pattern, byte for byte
      const m = /^INSERT INTO (`|'|"|)([^\s\x01]+)\1/i.exec(argument)
      if (m !== null) {
        const table = m[2]!
        const n = (insertTables.get(table) ?? 0) + 1
        insertTables.set(table, n)
        if (n > 1) {
          const first = rows[insertTablesFirst]
          if (first !== undefined) {
            first['#'] = String(n)
            // a ... at the end of this query says that other queries were grouped into it
            const temp = first.argument ?? ''
            if (temp.at(-1) !== '.') first.argument = `${temp}<br>...`
          }
          continue
        }
        insertTablesFirst = i
        insertTables.set(table, n + Number(row['#'] ?? 0) - 1)
      }
    }
    if (type === 'insert' || type === 'update') row.argument = cut(ctx, argument)
    rows.push(row)
    i++
  }
  sum.TOTAL = Object.values(sum).reduce((a, b) => a + b, 0)
  return { success: true, message: { rows, sum, numRows: rows.length } }
}

/**
 * Monitor::getJsonForLoggingVars — `SET GLOBAL name = value` (name `[a-zA-Z0-9_]`, value quoted
 * unless numeric; a MySQL error fails the request), then the four logging variables.
 */
export async function logVars(
  ctx: AdminCtx,
  name: string | undefined,
  value: string | undefined,
): Promise<MonitorLogVarsResponse> {
  await prepare(ctx)
  if (name !== undefined && value !== undefined && !/[^a-zA-Z0-9_]+/.test(name)) {
    const v = isNumeric(value) ? value : quoteString(value)
    await ctx.conn.query(`SET GLOBAL ${name} = ${v}`, 'monitor.logVars')
  }
  const vars = await keyPairs(
    ctx.dbi,
    'SHOW GLOBAL VARIABLES WHERE Variable_name IN ("general_log","slow_query_log","long_query_time","log_output")',
  )
  return { message: vars ?? {} }
}

/**
 * Monitor::getJsonForQueryAnalyzer — the query (SELECT gets SQL_NO_CACHE) in its database, its
 * affected rows, EXPLAIN, the last error and, when supported, the profile of query 1.
 */
export async function queryAnalyzer(
  ctx: AdminCtx,
  database: string,
  query: string,
): Promise<MonitorQueryResponse> {
  await prepare(ctx)
  const { dbi } = ctx
  if (database !== '') await dbi.conn.selectDb(database, 'monitor.selectDb')
  const profiling =
    ctx.session !== undefined ? await isProfilingSupported(ctx.conn, ctx.session, ctx.serverIndex) : false
  if (profiling) await ctx.conn.query('SET PROFILING=1;', 'monitor.profiling')
  // Do not cache query
  const sql = query.replace(/^(\s*SELECT)/i, '$1 SQL_NO_CACHE')
  // DatabaseInterface::getError after the last statement: Utilities::formatError, HTML-escaped
  let lastError = ''
  const run = async (q: string, label: string) => {
    try {
      const r = await ctx.conn.query(q, label)
      lastError = ''
      return r
    } catch (e) {
      if (!(e instanceof MysqlError)) throw e
      lastError = formatError(e.extra.errno ?? 0, htmlspecialchars(e.message), ctx.tr).text
      return null
    }
  }
  const result = await run(sql, 'monitor.analyze')
  // mysqli affected_rows: the rows of a SELECT, -1 after an error
  const affectedRows =
    result === null ? -1 : (result.header?.affectedRows ?? result.resultSets[0]?.rows.length ?? 0)
  const out: MonitorQueryResponse['message'] = { affectedRows, error: '' }
  const explain = await run(`EXPLAIN ${sql}`, 'monitor.explain')
  const set = explain?.resultSets[0]
  if (set !== undefined) {
    out.explain = set.rows.map((row) =>
      Object.fromEntries(
        set.fields.map((f, i) => [
          f.name,
          row[i] === null || row[i] === undefined ? null : row[i]!.toString('utf8'),
        ]),
      ),
    )
  }
  // In case an error happened
  out.error = lastError
  if (profiling) {
    out.profiling = []
    const p = await dbi.tryQuery(
      'SELECT seq,state,duration FROM INFORMATION_SCHEMA.PROFILING WHERE QUERY_ID=1 ORDER BY seq',
      'monitor.profile',
    )
    if (p !== null)
      out.profiling = p.rows.map((row) => Object.fromEntries(p.fields.map((f, i) => [f, row[i] ?? null])))
  }
  return { message: out }
}
