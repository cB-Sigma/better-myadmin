/**
 * Pure model of the status monitor (unit-tested): presets, the default grid and settings, the
 * localStorage format, the requested data list, the value math of each refresh, axis formatters and
 * the log table filters.
 * pma: resources/js/server/status/monitor.ts, resources/js/modules/functions/chartByteFormatter.ts,
 *      resources/js/modules/functions.ts::prettyProfilingNum
 */

export type Translate = (msgid: string) => string

export interface DataPoint {
  type: 'statusvar' | 'servervar' | 'proc' | 'cpu' | 'memory' | string
  name: string
}

export interface ChartNode {
  dataPoints: DataPoint[]
  display?: 'differential' | ''
  valueDivisor?: number
  unit?: string
  transformFn?: 'qce' | 'qcu' | 'cpu-linux' | string
}

/** A chart of the grid as monitor.ts keeps it in runtime.charts / localStorage.monitorCharts */
export interface MonitorChart {
  title: string
  series: Array<{ label: string; fill?: boolean; dataType?: string }>
  nodes: ChartNode[]
  maxYLabel: number
  settings?: unknown
}

export interface MonitorSettings {
  columns: number
  chartSize: { width: number; height: number }
  gridMaxPoints: number | 'auto'
  /** ms */
  gridRefresh: number
}

/** monitorProtocolVersion */
export const MONITOR_PROTOCOL_VERSION = '1.0'

export const DEFAULT_SETTINGS: MonitorSettings = {
  columns: 3,
  chartSize: { width: 295, height: 250 },
  gridMaxPoints: 'auto',
  gridRefresh: 5000,
}

/** The refresh rates of the settings (seconds), 5 s selected by default */
export const REFRESH_RATES = [2, 3, 4, 5, 10, 20, 40, 60, 120, 300, 600, 1200]

/** "Commonly monitored" series of the add-chart dialog */
export const COMMON_SERIES = [
  'Processes',
  'Questions',
  'Connections',
  'Bytes_sent',
  'Bytes_received',
  'Threads_connected',
  'Created_tmp_disk_tables',
  'Handler_read_first',
  'Innodb_buffer_pool_wait_free',
  'Key_reads',
  'Open_tables',
  'Select_full_join',
  'Slow_queries',
]

/** presetCharts: the query cache charts, plus the OS charts phpMyAdmin knows for `serverOs` */
export function presetCharts(os: string, t: Translate): Record<string, MonitorChart> {
  const presets: Record<string, MonitorChart> = {
    qce: {
      title: t('Query cache efficiency'),
      series: [{ label: t('Query cache efficiency') }],
      nodes: [
        {
          dataPoints: [
            { type: 'statusvar', name: 'Qcache_hits' },
            { type: 'statusvar', name: 'Com_select' },
          ],
          transformFn: 'qce',
        },
      ],
      maxYLabel: 0,
    },
    qcu: {
      title: t('Query cache usage'),
      series: [{ label: t('Query cache used') }],
      nodes: [
        {
          dataPoints: [
            { type: 'statusvar', name: 'Qcache_free_memory' },
            { type: 'servervar', name: 'query_cache_size' },
          ],
          transformFn: 'qcu',
        },
      ],
      maxYLabel: 0,
    },
  }
  const mem = (name: string): ChartNode => ({ dataPoints: [{ type: 'memory', name }], valueDivisor: 1024 })
  if (os === 'WINNT' || os === 'SunOS') {
    presets.cpu = {
      title: t('System CPU usage'),
      series: [{ label: t('Average load') }],
      nodes: [{ dataPoints: [{ type: 'cpu', name: 'loadavg' }] }],
      maxYLabel: os === 'WINNT' ? 100 : 0,
    }
    presets.memory = {
      title: t('System memory'),
      series: [
        { ...(os === 'WINNT' ? { dataType: 'memory' } : {}), label: t('Used memory'), fill: true },
        { label: t('Free memory'), fill: true },
      ],
      nodes: [mem('MemUsed'), mem('MemFree')],
      maxYLabel: 0,
    }
    presets.swap = {
      title: t('System swap'),
      series: [
        { label: t('Used swap'), fill: true },
        { label: t('Free swap'), fill: true },
      ],
      nodes: [mem('SwapUsed'), mem('SwapFree')],
      maxYLabel: 0,
    }
  } else if (os === 'Linux') {
    presets.cpu = {
      title: t('System CPU usage'),
      series: [{ label: t('Average load') }],
      nodes: [{ dataPoints: [{ type: 'cpu', name: 'irrelevant' }], transformFn: 'cpu-linux' }],
      maxYLabel: 0,
    }
    presets.memory = {
      title: t('System memory'),
      series: [
        { label: t('Buffered memory'), fill: true },
        { label: t('Used memory'), fill: true },
        { label: t('Cached memory'), fill: true },
        { label: t('Free memory'), fill: true },
      ],
      nodes: [mem('Buffers'), mem('MemUsed'), mem('Cached'), mem('MemFree')],
      maxYLabel: 0,
    }
    presets.swap = {
      title: t('System swap'),
      series: [
        { label: t('Cached swap'), fill: true },
        { label: t('Used swap'), fill: true },
        { label: t('Free swap'), fill: true },
      ],
      nodes: [mem('SwapCached'), mem('SwapUsed'), mem('SwapFree')],
      maxYLabel: 0,
    }
  }
  return presets
}

/** defaultChartGrid: Questions, Connections / Processes, Traffic (+ CPU, memory, swap when local) */
export function defaultChartGrid(os: string, dbIsLocal: boolean, t: Translate): Record<string, MonitorChart> {
  const grid: Record<string, MonitorChart> = {
    c0: {
      title: t('Questions'),
      series: [{ label: t('Questions') }],
      nodes: [{ dataPoints: [{ type: 'statusvar', name: 'Questions' }], display: 'differential' }],
      maxYLabel: 0,
    },
    c1: {
      title: t('Connections / Processes'),
      series: [{ label: t('Connections') }, { label: t('Processes') }],
      nodes: [
        { dataPoints: [{ type: 'statusvar', name: 'Connections' }], display: 'differential' },
        { dataPoints: [{ type: 'proc', name: 'processes' }] },
      ],
      maxYLabel: 0,
    },
    c2: {
      title: t('Traffic'),
      series: [{ label: t('Bytes sent') }, { label: t('Bytes received') }],
      nodes: [
        {
          dataPoints: [{ type: 'statusvar', name: 'Bytes_sent' }],
          display: 'differential',
          valueDivisor: 1024,
        },
        {
          dataPoints: [{ type: 'statusvar', name: 'Bytes_received' }],
          display: 'differential',
          valueDivisor: 1024,
        },
      ],
      maxYLabel: 0,
    },
  }
  const presets = presetCharts(os, t)
  if (dbIsLocal && presets.cpu !== undefined) {
    grid.c3 = presets.cpu
    grid.c4 = presets.memory!
    grid.c5 = presets.swap!
  }
  return grid
}

/** The charts in grid order (initGrid: `keys.sort()`, a plain string sort) */
export function orderedCharts(charts: Record<string, MonitorChart>): Array<[string, MonitorChart]> {
  return Object.keys(charts)
    .sort()
    .map((k) => [k, charts[k]!])
}

/** gridMaxPoints 'auto' → `round((chartWidth - 40) / 12)` */
export function maxPoints(settings: MonitorSettings, chartWidth: number): number {
  return settings.gridMaxPoints === 'auto' ? Math.round((chartWidth - 40) / 12) : settings.gridMaxPoints
}

/** buildRequiredDataList: chart index → node → data points (the `requiredData` of a refresh) */
export function requiredDataList(charts: Array<[string, MonitorChart]>): Record<number, DataPoint[][]> {
  const list: Record<number, DataPoint[][]> = {}
  charts.forEach(([, chart], i) => {
    list[i] = chart.nodes.map((n) => n.dataPoints)
  })
  return list
}

/** saveMonitor / export: the stored fields of each chart */
export function storedCharts(charts: Array<[string, MonitorChart]>): Record<string, MonitorChart> {
  const out: Record<string, MonitorChart> = {}
  for (const [key, c] of charts) {
    out[key] = {
      nodes: c.nodes,
      settings: c.settings,
      title: c.title,
      series: c.series,
      maxYLabel: c.maxYLabel,
    }
  }
  return out
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** initGrid: the stored grid and settings, and whether the stored version differs (incompatible). */
export function loadStored(storage: StorageLike | null): {
  charts: Record<string, MonitorChart> | null
  settings: MonitorSettings | null
  incompatible: boolean
} {
  if (storage === null) return { charts: null, settings: null, incompatible: false }
  try {
    const c = storage.getItem('monitorCharts')
    const s = storage.getItem('monitorSettings')
    const v = storage.getItem('monitorVersion')
    const charts = c !== null ? (JSON.parse(c) as Record<string, MonitorChart>) : null
    const settings = s !== null ? (JSON.parse(s) as MonitorSettings) : null
    return { charts, settings, incompatible: charts !== null && v !== null && v !== MONITOR_PROTOCOL_VERSION }
  } catch {
    return { charts: null, settings: null, incompatible: false }
  }
}

/** saveMonitor */
export function saveStored(
  storage: StorageLike | null,
  charts: Array<[string, MonitorChart]>,
  settings: MonitorSettings,
): void {
  if (storage === null) return
  try {
    storage.setItem('monitorCharts', JSON.stringify(storedCharts(charts)))
    storage.setItem('monitorSettings', JSON.stringify(settings))
    storage.setItem('monitorVersion', MONITOR_PROTOCOL_VERSION)
  } catch {
    // storage full or blocked: the grid works without it
  }
}

/** Reset to default: the three keys are removed */
export function clearStored(storage: StorageLike | null): void {
  if (storage === null) return
  try {
    storage.removeItem('monitorCharts')
    storage.removeItem('monitorSettings')
    storage.removeItem('monitorVersion')
  } catch {
    // nothing stored
  }
}

/** Export: `monitor-config.json` = `{monitorCharts, monitorSettings}` */
export function exportConfig(charts: Array<[string, MonitorChart]>, settings: MonitorSettings): string {
  return JSON.stringify({ monitorCharts: storedCharts(charts), monitorSettings: settings })
}

/** Import: the parsed configuration, or null when it is not JSON with `monitorCharts` */
export function parseImportedConfig(
  text: string,
): { monitorCharts: Record<string, MonitorChart>; monitorSettings: MonitorSettings } | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (json === null || typeof json !== 'object' || !('monitorCharts' in json) || !json.monitorCharts)
    return null
  return json as { monitorCharts: Record<string, MonitorChart>; monitorSettings: MonitorSettings }
}

export interface ReadPoint {
  value?: string | number | null
  busy?: number
  idle?: number
}

/** chartValueTransform: cpu-linux (busy share of the jiffies), qce, qcu (%) */
export function transformValue(name: string, cur: ReadPoint[], prev: ReadPoint[] | null): number | undefined {
  const v = (p: ReadPoint | undefined) => Number(p?.value ?? 0)
  switch (name) {
    case 'cpu-linux': {
      if (prev === null) return undefined
      const c = cur[0] ?? {}
      const p = prev[0] ?? {}
      const diffTotal = (c.busy ?? 0) + (c.idle ?? 0) - ((p.busy ?? 0) + (p.idle ?? 0))
      const diffIdle = (c.idle ?? 0) - (p.idle ?? 0)
      return (100 * (diffTotal - diffIdle)) / diffTotal
    }
    case 'qce': {
      if (prev === null) return undefined
      const diffQHits = v(cur[0]) - v(prev[0])
      // No NaN please :-)
      if (v(cur[1]) - v(prev[1]) === 0) return 0
      return (diffQHits / (v(cur[1]) - v(prev[1]) + diffQHits)) * 100
    }
    case 'qcu':
      if (v(cur[1]) === 0) return 0
      return 100 - (v(cur[0]) / v(cur[1])) * 100
  }
  return undefined
}

/**
 * refreshChartGrid: the y value of one node — transform, else the first point's value as
 * differential (skipped without a previous reading; a negative difference after a server restart
 * shows the raw value) and divided.
 */
export function nodeValue(node: ChartNode, cur: ReadPoint[], prev: ReadPoint[] | null): number | undefined {
  if (node.transformFn !== undefined && node.transformFn !== '')
    return transformValue(node.transformFn, cur, prev)
  let value = Number.parseFloat(String(cur[0]?.value ?? ''))
  if (node.display === 'differential') {
    if (prev === null) return undefined
    value -= Number(prev[0]?.value ?? 0)
    if (value < 0) value = Number.parseFloat(String(cur[0]?.value ?? ''))
  }
  if (node.valueDivisor) value /= node.valueDivisor
  return value
}

/** Which kind of y axis a chart title gets (addChart compares the translated titles) */
export function axisKind(title: string, t: Translate): 'percent' | 'mib' | 'kib' | 'count' | 'plain' {
  if (title === t('System CPU usage') || title === t('Query cache efficiency')) return 'percent'
  if (title === t('System memory') || title === t('System swap')) return 'mib'
  if (title === t('Traffic')) return 'kib'
  if (title === t('Questions') || title === t('Connections')) return 'count'
  return 'plain'
}

/** chartByteFormatter(index): the value in units of 1024^index bytes, `%.1f` unless whole */
export function formatChartBytes(value: number, index: number, t: Translate): string {
  const units = [t('B'), t('KiB'), t('MiB'), t('GiB'), t('TiB'), t('PiB'), t('EiB')]
  let val = value
  let i = index
  while (val >= 1024 && i <= 6) {
    val /= 1024
    i++
  }
  return `${Math.floor(val) === val ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`
}

/** sprintf('%.3g', v): 3 significant digits without trailing zeros (C's %g) */
function g3(v: number): string {
  if (v === 0) return '0'
  const exp = Math.floor(Math.log10(Math.abs(v)))
  if (exp < -4 || exp >= 3) {
    const [m, e] = v.toExponential(2).split('e') as [string, string]
    const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m
    const n = Number(e)
    return `${mant}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`
  }
  const s = v.toFixed(Math.max(0, 2 - exp))
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** The y tick label of a chart (addChart's tickOptions) */
export function formatTick(kind: ReturnType<typeof axisKind>, value: number, t: Translate): string {
  switch (kind) {
    case 'percent':
      return `${Math.trunc(value)} %`
    case 'mib':
      return formatChartBytes(value, 2, t)
    case 'kib':
      return formatChartBytes(value, 1, t)
    case 'count':
      if (Math.abs(value) >= 1000000) return `${g3(value / 1000000)} M`
      if (Math.abs(value) >= 1000) return `${g3(value / 1000)} k`
      return String(Math.trunc(value))
    default:
      return String(Math.round(value * 1000) / 1000)
  }
}

/** The y maximum after a refresh (Math.ceil(max * 1.1); memory and swap from the stacked total) */
export function yMax(
  kind: ReturnType<typeof axisKind>,
  maxYLabel: number,
  total: number,
): number | undefined {
  if (kind !== 'percent' && kind !== 'mib' && maxYLabel > 0) return Math.ceil(maxYLabel * 1.1)
  if (kind === 'mib' && total > 0) return Math.ceil((total * 1.1) / 100) * 100
  return undefined
}

/** The series line of the add-chart preview: `- label, Differential, Divided by N, Unit: u` */
export function seriesPreview(label: string, node: ChartNode, t: Translate): string {
  let s = node.display === 'differential' ? `, ${t('Differential')}` : ''
  s += node.valueDivisor ? `, ${t('Divided by %s').replace('%s', String(node.valueDivisor))}` : ''
  s += node.unit ? `, ${t('Unit')}: ${node.unit}` : ''
  return `- ${label}${s}`
}

/** "Add this series": `Processes` becomes a process count */
export function newSeriesNode(
  name: string,
  o: { differential: boolean; divisor: string | null; unit: string | null },
): ChartNode {
  const node: ChartNode = {
    dataPoints: [{ type: name === 'Processes' ? 'proc' : 'statusvar', name }],
    display: o.differential ? 'differential' : '',
  }
  if (o.divisor !== null) node.valueDivisor = Number.parseInt(o.divisor, 10)
  if (o.unit !== null) node.unit = o.unit
  return node
}

/** timeToSec: "12:12:12" → seconds */
export function timeToSec(s: string): number {
  const [h = '0', m = '0', sec = '0'] = s.split(':')
  return Number.parseInt(h, 10) * 3600 + Number.parseInt(m, 10) * 60 + Number.parseInt(sec, 10)
}

/** secToTime: 100 → "00:01:40" */
export function secToTime(n: number): string {
  const h = Math.floor(n / 3600)
  const m = Math.floor((n - h * 3600) / 60)
  const s = n - h * 3600 - m * 60
  const p = (x: number) => (x < 10 ? `0${x}` : String(x))
  return `${p(h)}:${p(m)}:${p(s)}`
}

/** buildLogTable's formatValue for user_host: `[...]` segments removed */
export function userHost(value: string): string {
  return value.replace(/(\[.*?\])+/g, '')
}

/**
 * filterQueries' grouping of SELECTs "ignoring variable data in WHERE clauses": `col=value` →
 * `col=...`, `fn(args)` → ` fn(...)`.
 */
export function groupedQuery(text: string): string {
  const equalsFilter = /([^=]+)=(\d+|(('|"|).*?[^\\])\4((\s+)|$))/gi
  const functionFilter = /([a-z0-9_]+)\(.+?\)/gi
  return text.replace(equalsFilter, '$1=...$6').trim().replace(functionFilter, ' $1(...)')
}

export type LogRow = Record<string, string | null>

export interface LogTableRow {
  row: LogRow
  /** the query text and count shown (changed by the grouping) */
  query: string
  count: number
  /** slow log: query_time, lock_time, rows_sent, rows_examined as shown */
  slow?: [string, string, string, string]
  hidden: boolean
}

/**
 * filterQueries: the rows after the text filter (regexp, case-insensitive; an invalid one filters
 * nothing) and the optional WHERE-value grouping of SELECTs (counts and, for the slow log, the time
 * and row columns summed into the first of each group). Returns the rows, the number shown and the
 * sum of their counts.
 */
export function filterLogRows(
  rows: LogRow[],
  cols: string[],
  o: { text: string; group: boolean; slow: boolean },
): { rows: LogTableRow[]; shown: number; total: number; invalid: boolean } {
  let filter: RegExp | null = null
  let invalid = false
  if (o.text !== '') {
    try {
      filter = new RegExp(o.text, 'i')
    } catch {
      invalid = true
    }
  }
  const queryCol = cols[cols.length - 2] ?? ''
  const countCol = cols[cols.length - 1] ?? ''
  const out: LogTableRow[] = rows.map((row) => {
    const r: LogTableRow = {
      row,
      query: row[queryCol] ?? '',
      count: Number(row[countCol] ?? 0),
      hidden: false,
    }
    if (o.slow)
      r.slow = [row.query_time ?? '', row.lock_time ?? '', row.rows_sent ?? '', row.rows_examined ?? '']
    return r
  })
  if (o.group) {
    const first = new Map<string, LogTableRow>()
    const sums = new Map<string, [number, number, number, number]>()
    for (const r of out) {
      if (!/^SELECT/i.test(r.query)) continue
      const q = groupedQuery(r.query)
      const add = (s: [number, number, number, number] | undefined): [number, number, number, number] => {
        const base = s ?? [0, 0, 0, 0]
        if (!r.slow) return base
        return [
          base[0] + timeToSec(r.slow[0]),
          base[1] + timeToSec(r.slow[1]),
          base[2] + Number.parseInt(r.slow[2], 10),
          base[3] + Number.parseInt(r.slow[3], 10),
        ]
      }
      const head = first.get(q)
      sums.set(q, add(sums.get(q)))
      if (head === undefined) {
        first.set(q, r)
        r.query = q
      } else {
        head.count += r.count
        r.hidden = true
      }
    }
    for (const [q, head] of first) {
      const s = sums.get(q)!
      // groups of more than one query get the summed columns
      if (head.slow && head.count > 1)
        head.slow = [secToTime(s[0]), secToTime(s[1]), String(s[2]), String(s[3])]
    }
  }
  let shown = 0
  let total = 0
  for (const r of out) {
    if (!r.hidden && filter !== null && !filter.test(r.query)) r.hidden = true
    if (!r.hidden) {
      shown++
      total += r.count
    }
  }
  return { rows: out, shown, total, invalid }
}

/** prettyProfilingNum: µs / ms / s with `accuracy` decimals */
export function prettyProfilingNum(n: number, accuracy = 2): string {
  const acc = 10 ** accuracy
  if (n * 1000 < 0.1) return `${Math.round(acc * (n * 1000 * 1000)) / acc}µs`
  if (n < 0.1) return `${Math.round(acc * (n * 1000)) / acc}ms`
  return `${Math.round(acc * n) / acc}s`
}

/** loadQueryAnalysis' pie: states above 2 % of the total, the rest as "Other" */
export function profilingSlices(
  rows: Array<{ state: string; duration: number }>,
  other: string,
): { labels: string[]; data: number[]; total: number } {
  const total = rows.reduce((a, r) => a + r.duration, 0)
  const labels: string[] = []
  const data: number[] = []
  let otherTime = 0
  for (const r of rows) {
    if (r.duration / total > 0.02) {
      labels.push(`${prettyProfilingNum(r.duration, 2)} ${r.state}`)
      data.push(r.duration)
    } else otherTime += r.duration
  }
  if (otherTime > 0) {
    labels.push(`${prettyProfilingNum(otherTime, 2)} ${other}`)
    data.push(otherTime)
  }
  return { labels, data, total }
}

/** The capitalised statement type of the "Log data loaded" summary (`TOTAL` → Total) */
export function sumLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()
}
