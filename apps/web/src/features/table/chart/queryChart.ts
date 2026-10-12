import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  type ChartConfiguration,
  type ChartDataset,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PieController,
  PointElement,
  ScatterController,
  TimeScale,
  Title,
  Tooltip,
  _adapters,
} from 'chart.js'

/**
 * The query result chart (loaded on demand with Chart.js).
 * pma: resources/js/table/chart.ts (queryChart, extractDate), resources/js/modules/chart.ts (DataTable)
 */

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PieController,
  PointElement,
  ScatterController,
  TimeScale,
  Title,
  Tooltip,
)

// ------------------------------------------------------------------ the time scale's date adapter
// phpMyAdmin bundles chartjs-adapter-date-fns; the timeline only needs the adapter's calendar
// arithmetic and short labels, so a small local adapter stands in for it.

type Unit = 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year'
const MS: Record<string, number> = {
  millisecond: 1,
  second: 1e3,
  minute: 6e4,
  hour: 36e5,
  day: 864e5,
  week: 6048e5,
}
const LABEL: Record<string, Intl.DateTimeFormatOptions> = {
  datetime: { dateStyle: 'medium', timeStyle: 'medium' },
  millisecond: { hour: 'numeric', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 },
  second: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
  minute: { hour: 'numeric', minute: '2-digit' },
  hour: { hour: 'numeric' },
  day: { month: 'short', day: 'numeric' },
  week: { dateStyle: 'medium' },
  month: { month: 'short', year: 'numeric' },
  quarter: { month: 'short', year: 'numeric' },
  year: { year: 'numeric' },
}

function startOf(time: number, unit: Unit, weekday = 0): number {
  const d = new Date(time)
  switch (unit) {
    case 'second':
      d.setMilliseconds(0)
      break
    case 'minute':
      d.setSeconds(0, 0)
      break
    case 'hour':
      d.setMinutes(0, 0, 0)
      break
    case 'day':
      d.setHours(0, 0, 0, 0)
      break
    case 'week':
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7))
      break
    case 'month':
      d.setHours(0, 0, 0, 0)
      d.setDate(1)
      break
    case 'quarter':
      d.setHours(0, 0, 0, 0)
      d.setMonth(d.getMonth() - (d.getMonth() % 3), 1)
      break
    case 'year':
      d.setHours(0, 0, 0, 0)
      d.setMonth(0, 1)
      break
    default:
      break
  }
  return d.getTime()
}

function add(time: number, amount: number, unit: Unit): number {
  const d = new Date(time)
  if (unit === 'month' || unit === 'quarter' || unit === 'year') {
    d.setMonth(d.getMonth() + amount * (unit === 'year' ? 12 : unit === 'quarter' ? 3 : 1))
    return d.getTime()
  }
  return time + amount * (MS[unit] ?? 1)
}

function diff(a: number, b: number, unit: Unit): number {
  if (unit === 'month' || unit === 'quarter' || unit === 'year') {
    const da = new Date(a)
    const db = new Date(b)
    const months = (da.getFullYear() - db.getFullYear()) * 12 + da.getMonth() - db.getMonth()
    return unit === 'year' ? Math.trunc(months / 12) : unit === 'quarter' ? Math.trunc(months / 3) : months
  }
  return Math.trunc((a - b) / (MS[unit] ?? 1))
}

_adapters._date.override({
  formats: () =>
    Object.fromEntries(Object.keys(LABEL).map((k) => [k, k])) as Record<keyof typeof LABEL, string> as never,
  parse: (value: unknown) => {
    if (value === null || value === undefined) return null
    const t =
      value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(String(value))
    return Number.isNaN(t) ? null : t
  },
  format: (time: number, format: string) =>
    new Intl.DateTimeFormat(undefined, LABEL[format] ?? LABEL.datetime).format(new Date(time)),
  add: (time: number, amount: number, unit: Unit) => add(time, amount, unit),
  diff: (a: number, b: number, unit: Unit) => diff(a, b, unit),
  startOf: (time: number, unit: Unit | 'isoWeek', weekday?: number) =>
    unit === 'isoWeek' ? startOf(time, 'week', Number(weekday ?? 1)) : startOf(time, unit, 0),
  endOf: (time: number, unit: Unit | 'isoWeek') => {
    const u = unit === 'isoWeek' ? 'week' : unit
    return add(startOf(time, u), 1, u) - 1
  },
})

// ------------------------------------------------------------------ the chart

export type ChartType = 'bar' | 'column' | 'line' | 'spline' | 'area' | 'pie' | 'timeline' | 'scatter'

export interface ChartSettings {
  type: ChartType
  title: string
  xaxisLabel: string
  yaxisLabel: string
  stackSeries: boolean
  /** the X-Axis column's index */
  mainAxis: number
  selectedSeries: number[]
  /** "Series names are in a column": the series and value columns */
  seriesColumn: number | null
  valueColumn: number | null
}

type Cell = string | number | Date | null

/** extractDate: the first `Y-m-d H:i:s` (or `Y-m-d`) of the value, in local time */
export function extractDate(s: string | null): Date | null {
  const v = s ?? ''
  const dt = /[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/.exec(v)
  if (dt !== null) {
    const m = dt[0]
    return new Date(
      Number(m.slice(0, 4)),
      Number.parseInt(m.slice(5, 7), 10) - 1,
      Number(m.slice(8, 10)),
      Number(m.slice(11, 13)),
      Number(m.slice(14, 16)),
      Number(m.slice(17, 19)),
    )
  }
  const d = /[0-9]{4}-[0-9]{2}-[0-9]{2}/.exec(v)
  if (d !== null) {
    const m = d[0]
    return new Date(Number(m.slice(0, 4)), Number.parseInt(m.slice(5, 7), 10) - 1, Number(m.slice(8, 10)))
  }
  return null
}

const float = (v: string | null | undefined) => Number.parseFloat(v ?? '')

/** queryChart's DataTable: the column names and the rows (short rows padded with null) */
export function chartTable(
  data: Array<Record<string, string | null>>,
  columnNames: string[],
  s: ChartSettings,
): { columns: string[]; rows: Cell[][] } {
  const columns = [columnNames[s.mainAxis] ?? '']
  let rows: Cell[][] = []
  if (s.seriesColumn === null) {
    for (const e of s.selectedSeries) columns.push(columnNames[e] ?? '')
    const extract = [s.mainAxis, ...s.selectedSeries]
    rows = data.map((row) =>
      extract.map((idx, j) => {
        const v = row[columnNames[idx] ?? ''] ?? null
        if (j > 0) return float(v)
        if (s.type === 'timeline') return extractDate(v)
        if (s.type === 'scatter') return float(v)
        return v
      }),
    )
  } else {
    // the series are the distinct values of the series column, in order of appearance
    const seriesNames = new Map<string, number>()
    const seriesCol = columnNames[s.seriesColumn] ?? ''
    for (const row of data) {
      const name = String(row[seriesCol] ?? '')
      if (!seriesNames.has(name)) seriesNames.set(name, seriesNames.size + 1)
    }
    columns.push(...seriesNames.keys())
    const valueMap = new Map<string, Cell[]>()
    const main = columnNames[s.mainAxis] ?? ''
    const valueCol = columnNames[s.valueColumn ?? -1] ?? ''
    for (const row of data) {
      const x = row[main] ?? null
      let value = valueMap.get(String(x))
      if (value === undefined) {
        value = [x]
        valueMap.set(String(x), value)
      }
      value[seriesNames.get(String(row[seriesCol] ?? '')) ?? 0] = float(row[valueCol])
    }
    rows = [...valueMap.values()]
  }
  // DataTable::fillMissingValues
  for (const row of rows) {
    if (row.length > columns.length) row.splice(columns.length - 1, row.length - columns.length)
    for (let j = row.length; j < columns.length; j++) row.push(null)
    for (let j = 0; j < row.length; j++) if (row[j] === undefined) row[j] = null
  }
  return { columns, rows }
}

/** queryChart: (re)draws the chart on the canvas */
export function drawQueryChart(
  canvas: HTMLCanvasElement,
  data: Array<Record<string, string | null>>,
  columnNames: string[],
  s: ChartSettings,
): Chart {
  const { columns, rows } = chartTable(data, columnNames, s)
  let type: 'bar' | 'line' | 'pie' | 'scatter' = 'line'
  if (s.type === 'column' || s.type === 'bar') type = 'bar'
  else if (s.type === 'pie' || s.type === 'scatter') type = s.type
  const labels = rows.map((r) => r[0] ?? null)
  const datasets: ChartDataset[] = []
  for (let i = 1; i < columns.length; i++) {
    const values = rows.map((r) => (s.type === 'scatter' ? { x: r[0] as number, y: r[i] as number } : r[i]))
    const dataset = { label: columns[i] ?? '', data: values } as ChartDataset
    if (s.type === 'area') (dataset as ChartDataset<'line'>).fill = 'start'
    datasets.push(dataset)
  }
  const config = {
    type,
    data: { labels, datasets },
    options: {
      animation: false,
      plugins: {
        legend: { position: 'right' },
        title: { display: s.title !== '', text: s.title },
      },
      indexAxis: s.type === 'bar' ? 'y' : 'x',
      scales: {
        x: {
          display: true,
          title: { display: s.xaxisLabel !== '', text: s.xaxisLabel },
          stacked: s.stackSeries,
          ...(s.type === 'timeline' ? { type: 'time' } : {}),
        },
        y: {
          display: true,
          title: { display: s.yaxisLabel !== '', text: s.yaxisLabel },
          stacked: s.stackSeries,
        },
      },
      ...(s.type === 'spline' ? { elements: { line: { tension: 0.4 } } } : {}),
    },
  } as unknown as ChartConfiguration
  Chart.getChart(canvas)?.destroy()
  return new Chart(canvas, config)
}
