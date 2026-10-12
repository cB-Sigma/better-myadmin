import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  MONITOR_PROTOCOL_VERSION,
  type StorageLike,
  axisKind,
  checkImportedGrid,
  clearStored,
  defaultChartGrid,
  exportConfig,
  filterLogRows,
  formatChartBytes,
  formatTick,
  groupedQuery,
  loadStored,
  maxPoints,
  newSeriesNode,
  nodeValue,
  orderedCharts,
  parseImportedConfig,
  presetCharts,
  prettyProfilingNum,
  profilingSlices,
  requiredDataList,
  saveStored,
  secToTime,
  seriesPreview,
  sumLabel,
  timeToSec,
  transformValue,
  userHost,
  yMax,
} from './monitor.ts'

const t = (s: string) => s

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

describe('monitor grid', () => {
  it('default grid: three charts, plus CPU / memory / swap for a local server on Linux', () => {
    expect(Object.keys(defaultChartGrid('Linux', false, t))).toEqual(['c0', 'c1', 'c2'])
    expect(Object.keys(defaultChartGrid('Linux', true, t))).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5'])
    expect(Object.keys(defaultChartGrid('Darwin', true, t))).toEqual(['c0', 'c1', 'c2'])
    const c1 = defaultChartGrid('Linux', true, t).c1!
    expect(c1.title).toBe('Connections / Processes')
    expect(c1.nodes[1]!.dataPoints).toEqual([{ type: 'proc', name: 'processes' }])
  })

  it('presets per OS', () => {
    expect(Object.keys(presetCharts('Linux', t))).toEqual(['qce', 'qcu', 'cpu', 'memory', 'swap'])
    expect(presetCharts('WINNT', t).cpu!.maxYLabel).toBe(100)
    expect(presetCharts('SunOS', t).cpu!.maxYLabel).toBe(0)
    expect(Object.keys(presetCharts('Darwin', t))).toEqual(['qce', 'qcu'])
    expect(presetCharts('Linux', t).memory!.nodes.map((n) => n.dataPoints[0]!.name)).toEqual([
      'Buffers',
      'MemUsed',
      'Cached',
      'MemFree',
    ])
  })

  it('grid order is a string sort of the keys; requiredData numbers the charts', () => {
    const grid = { c10: defaultChartGrid('x', false, t).c0!, c2: defaultChartGrid('x', false, t).c1! }
    const ordered = orderedCharts(grid)
    expect(ordered.map(([k]) => k)).toEqual(['c10', 'c2'])
    expect(requiredDataList(ordered)).toEqual({
      0: [[{ type: 'statusvar', name: 'Questions' }]],
      1: [[{ type: 'statusvar', name: 'Connections' }], [{ type: 'proc', name: 'processes' }]],
    })
  })

  it('auto max points from the chart width', () => {
    expect(maxPoints(DEFAULT_SETTINGS, 295)).toBe(21)
    expect(maxPoints({ ...DEFAULT_SETTINGS, gridMaxPoints: 50 }, 295)).toBe(50)
  })
})

describe('monitor storage (phpMyAdmin keys and format)', () => {
  it('saves monitorCharts / monitorSettings / monitorVersion and loads them back', () => {
    const st = memoryStorage()
    const grid = orderedCharts(defaultChartGrid('Linux', false, t))
    saveStored(st, grid, DEFAULT_SETTINGS)
    expect([...st.data.keys()]).toEqual(['monitorCharts', 'monitorSettings', 'monitorVersion'])
    expect(st.data.get('monitorVersion')).toBe(MONITOR_PROTOCOL_VERSION)
    const loaded = loadStored(st)
    expect(loaded.incompatible).toBe(false)
    expect(Object.keys(loaded.charts!)).toEqual(['c0', 'c1', 'c2'])
    expect(loaded.settings).toEqual(DEFAULT_SETTINGS)
    st.setItem('monitorVersion', '0.9')
    expect(loadStored(st).incompatible).toBe(true)
    clearStored(st)
    expect(st.data.size).toBe(0)
    expect(loadStored(null)).toEqual({ charts: null, settings: null, incompatible: false })
  })

  it('export / import of {monitorCharts, monitorSettings}', () => {
    const grid = orderedCharts(defaultChartGrid('Linux', false, t))
    const json = exportConfig(grid, DEFAULT_SETTINGS)
    expect(Object.keys(JSON.parse(json))).toEqual(['monitorCharts', 'monitorSettings'])
    expect(parseImportedConfig(json)?.monitorSettings).toEqual(DEFAULT_SETTINGS)
    expect(parseImportedConfig('{not json')).toBeNull()
    expect(parseImportedConfig('{"monitorSettings":{}}')).toBeNull()
  })

  it('an imported grid rebuildGrid cannot build (strFailedBuildingGrid)', () => {
    const grid = orderedCharts(defaultChartGrid('Linux', false, t))
    const ok = parseImportedConfig(exportConfig(grid, DEFAULT_SETTINGS))!
    expect(() => checkImportedGrid(ok)).not.toThrow()
    expect(() => checkImportedGrid({ monitorCharts: ok.monitorCharts, monitorSettings: undefined })).toThrow()
    expect(() => checkImportedGrid({ monitorCharts: { c0: { title: 'x' } }, monitorSettings: {} })).toThrow()
  })
})

describe('monitor values', () => {
  it('differential, negative after a restart, divisor', () => {
    const node = { dataPoints: [], display: 'differential' as const, valueDivisor: 1024 }
    expect(nodeValue(node, [{ value: '4096' }], null)).toBeUndefined()
    expect(nodeValue(node, [{ value: '4096' }], [{ value: '2048' }])).toBe(2)
    expect(nodeValue(node, [{ value: '1024' }], [{ value: '8192' }])).toBe(1)
    expect(nodeValue({ dataPoints: [] }, [{ value: 7 }], null)).toBe(7)
  })

  it('transforms: cpu-linux, qce, qcu', () => {
    expect(transformValue('cpu-linux', [{ busy: 30, idle: 70 }], null)).toBeUndefined()
    expect(transformValue('cpu-linux', [{ busy: 130, idle: 170 }], [{ busy: 30, idle: 70 }])).toBe(50)
    expect(transformValue('qce', [{ value: 10 }, { value: 5 }], [{ value: 0 }, { value: 5 }])).toBe(0)
    expect(transformValue('qce', [{ value: 10 }, { value: 15 }], [{ value: 0 }, { value: 5 }])).toBe(50)
    expect(transformValue('qcu', [{ value: 25 }, { value: 100 }], null)).toBe(75)
    expect(transformValue('qcu', [{ value: 25 }, { value: 0 }], null)).toBe(0)
  })

  it('axis kinds and tick labels', () => {
    expect(axisKind('System CPU usage', t)).toBe('percent')
    expect(axisKind('System swap', t)).toBe('mib')
    expect(axisKind('Traffic', t)).toBe('kib')
    expect(axisKind('Questions', t)).toBe('count')
    expect(axisKind('Mine', t)).toBe('plain')
    expect(formatTick('percent', 42.7, t)).toBe('42 %')
    expect(formatTick('count', 1234, t)).toBe('1.23 k')
    expect(formatTick('count', 2500000, t)).toBe('2.5 M')
    expect(formatTick('count', 999, t)).toBe('999')
    expect(formatChartBytes(1536, 1, t)).toBe('1.5 MiB')
    expect(formatChartBytes(512, 2, t)).toBe('512 MiB')
    // 100 * 1.1 is 110.00000000000001 in JavaScript too
    expect(yMax('count', 100, 0)).toBe(111)
    expect(yMax('count', 50, 0)).toBe(56)
    expect(yMax('percent', 100, 0)).toBeUndefined()
    expect(yMax('mib', 0, 1234)).toBe(1400)
  })

  it('add-chart series', () => {
    const n = newSeriesNode('Processes', { differential: false, divisor: null, unit: null })
    expect(n).toEqual({ dataPoints: [{ type: 'proc', name: 'Processes' }], display: '' })
    const m = newSeriesNode('Bytes_sent', { differential: true, divisor: '1024', unit: 'KiB' })
    expect(seriesPreview('Bytes sent', m, t)).toBe('- Bytes sent, Differential, Divided by 1024, Unit: KiB')
  })
})

describe('monitor log table', () => {
  it('time helpers, user_host, sums label', () => {
    expect(timeToSec('01:02:03')).toBe(3723)
    expect(secToTime(100)).toBe('00:01:40')
    expect(userHost('root[root] @ localhost [127.0.0.1]')).toBe('root @ localhost ')
    expect(sumLabel('TOTAL')).toBe('Total')
    expect(sumLabel('select')).toBe('Select')
  })

  it('WHERE-value grouping of SELECTs', () => {
    expect(groupedQuery('SELECT * FROM t WHERE id=5')).toBe('SELECT * FROM t WHERE id=...')
    expect(groupedQuery("SELECT a FROM t WHERE name='x' AND n=2")).toBe(
      'SELECT a FROM t WHERE name=... AND n=...',
    )
    expect(groupedQuery('SELECT COUNT(id) FROM t')).toBe('SELECT  COUNT(...) FROM t')
  })

  it('filter by regexp and group (counts summed into the first row)', () => {
    const cols = ['event_time', 'argument', '#']
    const rows = [
      { event_time: '1', argument: 'SELECT * FROM t WHERE id=1', '#': '2' },
      { event_time: '2', argument: 'SELECT * FROM t WHERE id=2', '#': '3' },
      { event_time: '3', argument: 'INSERT INTO t VALUES (1)', '#': '1' },
    ]
    const plain = filterLogRows(rows, cols, { text: '', group: false, slow: false })
    expect([plain.shown, plain.total]).toEqual([3, 6])
    const grouped = filterLogRows(rows, cols, { text: '', group: true, slow: false })
    expect(grouped.rows.map((r) => [r.query, r.count, r.hidden])).toEqual([
      ['SELECT * FROM t WHERE id=...', 5, false],
      ['SELECT * FROM t WHERE id=2', 3, true],
      ['INSERT INTO t VALUES (1)', 1, false],
    ])
    expect([grouped.shown, grouped.total]).toEqual([2, 6])
    const filtered = filterLogRows(rows, cols, { text: 'insert', group: false, slow: false })
    expect([filtered.shown, filtered.total]).toEqual([1, 1])
    expect(filterLogRows(rows, cols, { text: '(', group: false, slow: false }).invalid).toBe(true)
  })

  it('slow log grouping sums time and row columns', () => {
    const cols = [
      'start_time',
      'user_host',
      'query_time',
      'lock_time',
      'rows_sent',
      'rows_examined',
      'db',
      'sql_text',
      '#',
    ]
    const row = (q: string) => ({
      start_time: 'x',
      user_host: 'u',
      query_time: '00:00:02',
      lock_time: '00:00:01',
      rows_sent: '3',
      rows_examined: '4',
      db: 'd',
      sql_text: q,
      '#': '1',
    })
    const out = filterLogRows([row('SELECT 1 FROM t WHERE a=1'), row('SELECT 1 FROM t WHERE a=2')], cols, {
      text: '',
      group: true,
      slow: true,
    })
    expect(out.rows[0]!.slow).toEqual(['00:00:04', '00:00:02', '6', '8'])
    expect(out.rows[0]!.count).toBe(2)
  })

  it('profiling: pretty numbers and the 2 % slices', () => {
    expect(prettyProfilingNum(0.00005)).toBe('50µs')
    expect(prettyProfilingNum(0.05)).toBe('50ms')
    expect(prettyProfilingNum(1.234)).toBe('1.23s')
    const s = profilingSlices(
      [
        { state: 'a', duration: 0.9 },
        { state: 'b', duration: 0.09 },
        { state: 'c', duration: 0.01 },
      ],
      'Other',
    )
    expect(s.labels).toEqual(['0.9s', '90ms b', '10ms Other'].map((l, i) => (i === 0 ? '0.9s a' : l)))
  })
})
