import type { MonitorPage as MonitorFacts } from '@bettermyadmin/contracts'
import {
  Button,
  Input,
  Label,
  Loading,
  MessageBox,
  Modal,
  NativeCheckbox,
  NativeSelect,
  Panel,
  PanelBody,
  Radio,
} from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import type { Chart } from 'chart.js'
import { BarChart3, CircleHelp, Cog, Grip, Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { ngettext, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { LogAnalysis, LogVarsInstructions } from './MonitorLogs'
import {
  COMMON_SERIES,
  type ChartNode,
  DEFAULT_SETTINGS,
  type MonitorChart,
  type MonitorSettings,
  REFRESH_RATES,
  type ReadPoint,
  type StorageLike,
  axisKind,
  clearStored,
  defaultChartGrid,
  exportConfig,
  loadStored,
  maxPoints,
  newSeriesNode,
  nodeValue,
  orderedCharts,
  parseImportedConfig,
  presetCharts,
  requiredDataList,
  saveStored,
  seriesPreview,
  yMax,
} from './monitor'
import { createMonitorChart } from './monitorChart'

type Grid = Array<[string, MonitorChart]>

/** localStorage, or null where it is unavailable (isStorageSupported) */
function storage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** The readings of one chart: points per series, the y maximum, the stacked total of the last refresh */
interface Series {
  data: Array<Array<{ x: number; y: number }>>
  maxYLabel: number
  total: number
}

/**
 * Server › Status › Monitor: the chart grid (polled every refresh like phpMyAdmin), settings,
 * add-chart dialog, rearranging, the configuration in localStorage (phpMyAdmin's keys and format)
 * with import / export / reset, and the log analysis of a chart's time span.
 * pma: templates/server/status/monitor/index.twig, resources/js/server/status/monitor.ts
 */
export function MonitorPage({ server }: { server: number }) {
  const q = useQuery({
    queryKey: qk.monitor(server),
    queryFn: () => api.monitor(server),
    staleTime: Number.POSITIVE_INFINITY,
  })
  if (q.error !== null) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined) return <Loading />
  return <Monitor server={server} facts={q.data} />
}

function Monitor({ server, facts }: { server: number; facts: MonitorFacts }) {
  const presets = useMemo(() => presetCharts(facts.serverOs, t), [facts.serverOs])
  const serverTimeDiff = useMemo(() => Date.now() - facts.serverTime, [facts.serverTime])
  const [grid, setGrid] = useState<Grid>([])
  const [settings, setSettings] = useState<MonitorSettings>(DEFAULT_SETTINGS)
  const [hasStored, setHasStored] = useState(false)
  const [initialised, setInitialised] = useState(false)
  // the button starts the monitor once the page is loaded (monitor.ts triggers its click)
  const [redraw, setRedraw] = useState(true)
  const [everStarted, setEverStarted] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [modal, setModal] = useState<
    'instructions' | 'addChart' | 'import' | 'serverError' | 'incompatible' | null
  >(null)
  const [analyse, setAnalyse] = useState<{ from: number; to: number } | null>(null)
  const readings = useRef(new Map<string, Series>())
  /** runtime.xmin / xmax: the shown time span (server time) */
  const range = useRef({ min: 0, max: 0 })
  const [tick, setTick] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)

  /** initGrid / rebuildGrid */
  const init = useCallback(() => {
    const stored = loadStored(storage())
    setHasStored(stored.charts !== null)
    if (stored.incompatible) setModal('incompatible')
    setGrid(orderedCharts(stored.charts ?? defaultChartGrid(facts.serverOs, facts.serverDbIsLocal, t)))
    setSettings(stored.settings ?? DEFAULT_SETTINGS)
    readings.current = new Map()
    const s = stored.settings ?? DEFAULT_SETTINGS
    const now = Date.now() - serverTimeDiff
    range.current = {
      min: now - maxPoints(s, s.chartSize.width) * s.gridRefresh,
      max: now + s.gridRefresh,
    }
    setInitialised(true)
  }, [facts.serverOs, facts.serverDbIsLocal, serverTimeDiff])
  useEffect(() => {
    init()
  }, [init])

  const save = (g: Grid, s: MonitorSettings) => {
    saveStored(storage(), g, s)
    setHasStored(true)
  }

  // chart width → points kept per series (gridMaxPoints 'auto')
  const [chartWidth, setChartWidth] = useState(DEFAULT_SETTINGS.chartSize.width)
  const points = maxPoints(settings, chartWidth)

  // refreshChartGrid: one request per refresh with the data list of the grid
  const latest = useRef({ grid, points, redraw, settings })
  latest.current = { grid, points, redraw, settings }
  const requiredData = useMemo(() => JSON.stringify(requiredDataList(grid)), [grid])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new refresh rate restarts the loop (monitorChartRefreshRateSelect)
  useEffect(() => {
    if (!initialised) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = new AbortController()
    let previous: Record<string, unknown> | null = null
    let stopped = false
    const refresh = async () => {
      let message: Record<string, unknown>
      try {
        message = (await api.monitorChart(server, requiredData, abort.signal)).message
      } catch {
        if (!abort.signal.aborted) setModal('serverError')
        return
      }
      if (stopped) return
      const { grid: g, points: maxPts } = latest.current
      const x = Number(message.x)
      // the time axis moves with the server clock
      const diff = x - (previous === null ? range.current.max : Number(previous.x))
      range.current = { min: range.current.min + diff, max: range.current.max + diff }
      const xmin = range.current.min
      g.forEach(([key, chart], id) => {
        const cur = message[String(id)] as ReadPoint[][] | undefined
        if (cur === undefined) return
        const prev = (previous?.[String(id)] as ReadPoint[][] | undefined) ?? null
        let s = readings.current.get(key)
        if (s === undefined) {
          s = { data: chart.nodes.map(() => []), maxYLabel: chart.maxYLabel, total: 0 }
          readings.current.set(key, s)
        }
        s.total = 0
        chart.nodes.forEach((node: ChartNode, j) => {
          const value = nodeValue(node, cur[j] ?? [], prev === null ? null : (prev[j] ?? null))
          if (value === undefined || Number.isNaN(value)) return
          const data = s.data[j] ?? []
          s.data[j] = data
          data.push({ x, y: value })
          if (value > s.maxYLabel) s.maxYLabel = value
          else if (s.maxYLabel === 0) s.maxYLabel = 0.5
          // free old data point values and update maxYLabel
          if (data.length > maxPts && (data[0]?.x ?? x) < xmin) {
            const highest = s.maxYLabel <= (data[0]?.y ?? 0)
            data.splice(0, data.length - maxPts)
            if (highest) s.maxYLabel = Math.max(...data.map((d) => d.y))
          }
          if (axisKind(chart.title, t) === 'mib') s.total += value
        })
      })
      previous = message
      if (latest.current.redraw) setTick((n) => n + 1)
      timer = setTimeout(refresh, latest.current.settings.gridRefresh)
    }
    void refresh()
    return () => {
      stopped = true
      abort.abort()
      if (timer !== undefined) clearTimeout(timer)
    }
    // a new data list or refresh rate restarts the loop (the readings so far are kept)
  }, [initialised, server, requiredData, settings.gridRefresh])

  const changeColumns = (columns: number) => {
    const s = { ...settings, columns }
    const width = gridRef.current?.clientWidth
    if (width !== undefined && width > 0)
      setChartWidth(Math.floor(window.innerWidth > 768 ? width / columns - 10 : width))
    setSettings(s)
    save(grid, s)
  }

  const exportJson = () => {
    const blob = new Blob([exportConfig(grid, settings)], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'monitor-config.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  const dragFrom = useRef<number | null>(null)

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">{t('System monitor')}</h2>
      <div className="mb-3 flex flex-wrap gap-2 print:hidden">
        <Button
          variant="primary"
          id="monitorPauseResumeButton"
          onClick={() => {
            setRedraw(!redraw)
            setEverStarted(true)
          }}
        >
          {redraw ? <Pause aria-hidden /> : <Play aria-hidden />}
          {!everStarted ? t('Start monitor') : redraw ? t('Pause monitor') : t('Resume monitor')}
        </Button>
        <Button aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>
          <Cog aria-hidden />
          {t('Settings')}
        </Button>
        <Button onClick={() => setModal('instructions')}>
          <CircleHelp aria-hidden />
          {t('Instructions/Setup')}
        </Button>
      </div>

      {settingsOpen && (
        <Panel id="monitorSettingsContent" className="print:hidden">
          <PanelBody className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button id="monitorAddNewChartButton" onClick={() => setModal('addChart')}>
                <BarChart3 aria-hidden />
                {t('Add chart')}
              </Button>
              {!editMode ? (
                <Button id="monitorRearrangeChartButton" onClick={() => setEditMode(true)}>
                  <Grip aria-hidden />
                  {t('Enable charts dragging')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  id="monitorDoneRearrangeChartButton"
                  onClick={() => {
                    setEditMode(false)
                    save(grid, settings)
                  }}
                >
                  {t('Done dragging (rearranging) charts')}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-4">
              <div>
                <Label htmlFor="monitorChartRefreshRateSelect" className="mb-1 block">
                  {t('Refresh rate')}
                </Label>
                <NativeSelect
                  id="monitorChartRefreshRateSelect"
                  name="monitorChartRefreshRate"
                  className="w-auto"
                  value={settings.gridRefresh / 1000}
                  onChange={(e) => {
                    const s = { ...settings, gridRefresh: Number(e.target.value) * 1000 }
                    setSettings(s)
                    save(grid, s)
                  }}
                >
                  {REFRESH_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r < 60
                        ? ngettext('%d second', '%d seconds', r).replace('%d', String(r))
                        : ngettext('%d minute', '%d minutes', r / 60).replace('%d', String(r / 60))}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="monitorChartColumnsSelect" className="mb-1 block">
                  {t('Chart columns')}
                </Label>
                <NativeSelect
                  id="monitorChartColumnsSelect"
                  name="monitorChartColumns"
                  className="w-auto"
                  value={settings.columns}
                  onChange={(e) => changeColumns(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div>
              <p>
                <strong>{t('Chart arrangement')}</strong>
                <br />
                <span className="text-fg-muted">
                  {t(
                    'The arrangement of the charts is stored to the browsers local storage. You may want to export it if you have a complicated set up.',
                  )}
                </span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button onClick={() => setModal('import')}>{t('Import')}</Button>
                <Button id="monitorExportConfigButton" onClick={exportJson}>
                  {t('Export')}
                </Button>
                {hasStored && (
                  <Button
                    id="monitorResetConfigButton"
                    onClick={() => {
                      clearStored(storage())
                      init()
                    }}
                  >
                    {t('Reset to default')}
                  </Button>
                )}
              </div>
            </div>
          </PanelBody>
        </Panel>
      )}

      <div
        ref={gridRef}
        id="chartGrid"
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${settings.columns}, minmax(0, 1fr))` }}
      >
        {grid.map(([key, chart], i) => (
          <div
            key={key}
            className={`monitorChart rounded-(--radius) border border-border p-2 ${editMode ? 'cursor-move' : ''}`}
            draggable={editMode}
            onDragStart={() => {
              dragFrom.current = i
            }}
            onDragOver={(e) => editMode && e.preventDefault()}
            onDrop={() => {
              const from = dragFrom.current
              if (from === null || from === i) return
              const g = [...grid]
              const [moved] = g.splice(from, 1)
              g.splice(i, 0, moved!)
              // keys follow the new order so the stored grid keeps it
              const old = readings.current
              const moved2 = new Map<string, Series>()
              g.forEach(([k], n) => {
                const v = old.get(k)
                if (v !== undefined) moved2.set(`c${n}`, v)
              })
              readings.current = moved2
              setGrid(g.map(([, c], n) => [`c${n}`, c]))
            }}
          >
            <ChartCell
              chart={chart}
              range={range.current}
              series={readings.current.get(key)}
              tick={tick}
              editMode={editMode}
              onAnalyse={(from, to) => setAnalyse({ from, to })}
              onRemove={() => {
                const g = grid.filter(([k]) => k !== key)
                readings.current.delete(key)
                setGrid(g)
                save(g, settings)
              }}
            />
          </div>
        ))}
      </div>

      <LogAnalysis
        server={server}
        range={analyse}
        onClose={() => setAnalyse(null)}
        serverTimeDiff={serverTimeDiff}
        onServerError={() => setModal('serverError')}
      />

      <Modal
        title={t('System monitor instructions')}
        open={modal === 'instructions'}
        onClose={() => setModal(null)}
        size="xl"
        id="monitorInstructionsModal"
      >
        <LogVarsInstructions
          server={server}
          isSuperUser={facts.isSuperUser}
          onError={() => setModal('serverError')}
        />
      </Modal>

      <AddChartDialog
        open={modal === 'addChart'}
        presets={presets}
        variableNames={facts.variableNames}
        onClose={() => setModal(null)}
        onAdd={(chart) => {
          const used = new Set(grid.map(([k]) => k))
          let n = grid.length
          while (used.has(`c${n}`)) n++
          const g: Grid = [...grid, [`c${n}`, chart]]
          setGrid(g)
          save(g, settings)
        }}
      />

      <ImportDialog
        open={modal === 'import'}
        onClose={() => setModal(null)}
        onImport={(text) => {
          const json = parseImportedConfig(text)
          if (json === null) {
            window.alert(t("Failed parsing config file. It doesn't seem to be valid JSON code."))
            setModal(null)
            return
          }
          const st = storage()
          try {
            st?.setItem('monitorCharts', JSON.stringify(json.monitorCharts))
            st?.setItem('monitorSettings', JSON.stringify(json.monitorSettings))
            init()
          } catch {
            window.alert(t('Failed building chart grid with imported config. Resetting to default config…'))
            st?.removeItem('monitorCharts')
            st?.removeItem('monitorSettings')
            init()
          }
          setModal(null)
        }}
      />

      <Modal
        title={t('Monitor refresh failed')}
        open={modal === 'serverError'}
        onClose={() => setModal(null)}
        id="serverResponseErrorModal"
        footer={
          <>
            <Button onClick={() => setModal(null)}>{t('Close')}</Button>
            <Button
              variant="primary"
              id="serverResponseErrorModalReloadButton"
              onClick={() => window.location.reload()}
            >
              {t('Reload page')}
            </Button>
          </>
        }
      >
        {t(
          'While requesting new chart data the server returned an invalid response. This is most likely because your session expired. Reloading the page and reentering your credentials should help.',
        )}
      </Modal>

      <Modal
        title={t('Local monitor configuration incompatible!')}
        open={modal === 'incompatible'}
        onClose={() => setModal(null)}
        id="incompatibleMonitorConfigModal"
        footer={<Button onClick={() => setModal(null)}>{t('Close')}</Button>}
      >
        {t(
          'The chart arrangement configuration in your browsers local storage is not compatible anymore to the newer version of the monitor dialog. It is very likely that your current configuration will not work anymore. Please reset your configuration to default in the [em]Settings[/em] menu.',
        ).replace(/\[\/?em\]/g, '')}
      </Modal>
    </div>
  )
}

/** One chart of the grid; redrawn on every `tick` (the monitor is not paused). */
function ChartCell({
  chart,
  range,
  series,
  tick,
  editMode,
  onAnalyse,
  onRemove,
}: {
  chart: MonitorChart
  range: { min: number; max: number }
  series: Series | undefined
  tick: number
  editMode: boolean
  onAnalyse: (from: number, to: number) => void
  onRemove: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const instance = useRef<Chart<'line', Array<{ x: number; y: number }>> | null>(null)
  const edit = useRef(editMode)
  edit.current = editMode
  const analyse = useRef(onAnalyse)
  analyse.current = onAnalyse
  // biome-ignore lint/correctness/useExhaustiveDependencies: built once per chart; the refreshes move the time span
  useEffect(() => {
    if (canvas.current === null) return
    instance.current = createMonitorChart(canvas.current, {
      title: chart.title,
      labels: chart.series.map((s) => s.label),
      range,
      t,
      onClick: (from, to) => {
        if (!edit.current) analyse.current(from, to)
      },
    })
    return () => {
      instance.current?.destroy()
      instance.current = null
    }
  }, [chart])
  useEffect(() => {
    void tick
    const c = instance.current
    if (c === null || series === undefined) return
    series.data.forEach((d, j) => {
      const ds = c.data.datasets[j]
      if (ds !== undefined) ds.data = [...d]
    })
    const x = c.options.scales?.x
    if (x !== undefined) {
      x.min = range.min
      x.max = range.max
    }
    const max = yMax(axisKind(chart.title, t), series.maxYLabel, series.total)
    const y = c.options.scales?.y
    if (max !== undefined && y !== undefined) {
      y.max = max
      if (y.ticks !== undefined) (y.ticks as { stepSize?: number }).stepSize = Math.ceil(max / 5)
    }
    c.update('none')
  }, [tick, series, chart.title, range])
  return (
    <div>
      {editMode && (
        <div className="mb-1 text-end">
          <Button variant="link" size="sm" onClick={onRemove}>
            {t('Remove')}
          </Button>
        </div>
      )}
      <div className="relative aspect-[1/0.55] w-full">
        <canvas ref={canvas} />
      </div>
    </div>
  )
}

/** #addChartModal */
function AddChartDialog({
  open,
  presets,
  variableNames,
  onClose,
  onAdd,
}: {
  open: boolean
  presets: Record<string, MonitorChart>
  variableNames: string[]
  onClose: () => void
  onAdd: (chart: MonitorChart) => void
}) {
  const [title, setTitle] = useState(t('Chart Title'))
  const [lastRadio, setLastRadio] = useState<string | null>(null)
  const [type, setType] = useState<'preset' | 'variable'>('variable')
  const [preset, setPreset] = useState(Object.keys(presets)[0] ?? '')
  const [listIndex, setListIndex] = useState(0)
  const [variable, setVariable] = useState('')
  const [differential, setDifferential] = useState(true)
  const [useDivisor, setUseDivisor] = useState(false)
  const [divisor, setDivisor] = useState('1')
  const [useUnit, setUseUnit] = useState(false)
  const [unit, setUnit] = useState('')
  const [newChart, setNewChart] = useState<MonitorChart | null>(null)
  const [preview, setPreview] = useState<string[]>([])
  useEffect(() => {
    if (open) setPreview([])
  }, [open])
  const radioLabel = (id: string) => (id === 'chartPreset' ? t('Preset chart') : t('Status variable(s)'))
  const changeType = (id: 'chartPreset' | 'chartStatusVar') => {
    setType(id === 'chartPreset' ? 'preset' : 'variable')
    // the title follows the radio while it is the default or the previous radio's label
    if (title === t('Chart title') || (lastRadio !== null && title === radioLabel(lastRadio))) {
      setLastRadio(id)
      setTitle(radioLabel(id))
    }
  }
  const selectedSeries = listIndex === 0 ? t('Commonly monitored') : (COMMON_SERIES[listIndex - 1] ?? '')
  const close = () => {
    setNewChart(null)
    onClose()
  }
  return (
    <Modal
      title={t('Chart Title')}
      open={open}
      onClose={close}
      id="addChartModal"
      footer={
        <>
          <Button
            id="addChartButton"
            onClick={() => {
              let chart = newChart
              if (type === 'preset') chart = presets[preset] ?? null
              else if (chart === null || chart.nodes.length === 0) {
                window.alert(t('Please add at least one variable to the series!'))
                close()
                return
              }
              if (chart !== null) onAdd(structuredClone({ ...chart, title }))
              close()
            }}
          >
            {t('Add chart to grid')}
          </Button>
          <Button id="closeModalButton" onClick={close}>
            {t('Close')}
          </Button>
        </>
      }
    >
      <div id="tabGridVariables" className="space-y-2 text-[13px]">
        <p>
          <Input
            type="text"
            name="chartTitle"
            aria-label={t('Chart Title')}
            className="w-64"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </p>
        <div className="flex items-center gap-2">
          <Radio
            name="chartType"
            value="preset"
            id="chartPreset"
            checked={type === 'preset'}
            onChange={() => changeType('chartPreset')}
            onClick={() => setTitle(presets[preset]?.title ?? title)}
          />
          <Label htmlFor="chartPreset">{t('Preset chart')}</Label>
          <NativeSelect
            name="presetCharts"
            aria-label={t('Preset chart')}
            className="w-auto"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value)
              setTitle(presets[e.target.value]?.title ?? '')
              setType('preset')
            }}
          >
            {Object.entries(presets).map(([k, p]) => (
              <option key={k} value={k}>
                {p.title}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-center gap-2">
          <Radio
            name="chartType"
            value="variable"
            id="chartStatusVar"
            checked={type === 'variable'}
            onChange={() => changeType('chartStatusVar')}
            onClick={() => setTitle(selectedSeries.replaceAll('_', ' '))}
          />
          <Label htmlFor="chartStatusVar">{t('Status variable(s)')}</Label>
        </div>
        {type === 'variable' && (
          <div id="chartVariableSettings" className="space-y-2">
            <div>
              <Label htmlFor="chartSeries">{t('Select series:')}</Label>
              <br />
              <NativeSelect
                id="chartSeries"
                name="varChartList"
                className="w-auto"
                value={listIndex === 0 ? t('Commonly monitored') : (COMMON_SERIES[listIndex - 1] ?? '')}
                onChange={(e) => {
                  // options without a value: the value is the text
                  const i = e.target.selectedIndex
                  setListIndex(i)
                  setTitle(e.target.value.replaceAll('_', ' '))
                  if (i !== 0) setVariable(e.target.value)
                }}
              >
                <option>{t('Commonly monitored')}</option>
                {COMMON_SERIES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="variableInput">{t('or type variable name:')}</Label>{' '}
              <Input
                type="text"
                name="variableInput"
                id="variableInput"
                className="w-56"
                list="monitorVariableNames"
                value={variable}
                onChange={(e) => setVariable(e.target.value)}
              />
              <datalist id="monitorVariableNames">
                {variableNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <div className="flex items-center gap-1.5">
              <NativeCheckbox
                name="differentialValue"
                id="differentialValue"
                value="differential"
                checked={differential}
                onChange={(e) => setDifferential(e.target.checked)}
              />
              <Label htmlFor="differentialValue">{t('Display as differential value')}</Label>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <NativeCheckbox
                id="useDivisor"
                name="useDivisor"
                value="1"
                checked={useDivisor}
                onChange={(e) => setUseDivisor(e.target.checked)}
              />
              <Label htmlFor="useDivisor">{t('Apply a divisor')}</Label>
              {useDivisor && (
                <span className="divisorInput flex items-center gap-1">
                  <Input
                    type="text"
                    name="valueDivisor"
                    aria-label={t('Apply a divisor')}
                    className="w-16"
                    value={divisor}
                    onChange={(e) => setDivisor(e.target.value)}
                  />
                  (
                  <Button
                    variant="link"
                    onClick={() => {
                      setDivisor('1024')
                      setUnit(t('KiB'))
                      setUseUnit(true)
                    }}
                  >
                    {t('KiB')}
                  </Button>
                  ,
                  <Button
                    variant="link"
                    onClick={() => {
                      setDivisor(String(1024 * 1024))
                      setUnit(t('MiB'))
                      setUseUnit(true)
                    }}
                  >
                    {t('MiB')}
                  </Button>
                  )
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <NativeCheckbox
                id="useUnit"
                name="useUnit"
                value="1"
                checked={useUnit}
                onChange={(e) => setUseUnit(e.target.checked)}
              />
              <Label htmlFor="useUnit">{t('Append unit to data values')}</Label>
              {useUnit && (
                <span className="unitInput">
                  <Input
                    type="text"
                    name="valueUnit"
                    aria-label={t('Append unit to data values')}
                    className="w-16"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                  />
                </span>
              )}
            </div>
            <p className="flex items-center gap-1">
              <Button
                variant="link"
                className="font-bold"
                onClick={() => {
                  if (variable === '') return
                  const chart = newChart ?? { title, nodes: [], series: [], maxYLabel: 0 }
                  const node = newSeriesNode(variable, {
                    differential,
                    divisor: useDivisor ? divisor : null,
                    unit: useUnit ? unit : null,
                  })
                  const label = variable.replaceAll('_', ' ')
                  setNewChart({
                    ...chart,
                    nodes: [...chart.nodes, node],
                    series: [...chart.series, { label }],
                  })
                  setPreview([...(newChart === null ? [] : preview), seriesPreview(label, node, t)])
                  setVariable('')
                  setDifferential(true)
                  setUseDivisor(false)
                  setUseUnit(false)
                  setListIndex(0)
                }}
              >
                {t('Add this series')}
              </Button>
              {newChart !== null && (
                <span id="clearSeriesLink">
                  |{' '}
                  <Button
                    variant="link"
                    onClick={() => {
                      setPreview([])
                      setNewChart(null)
                    }}
                  >
                    {t('Clear series')}
                  </Button>
                </span>
              )}
            </p>
            <div>
              {t('Series in chart:')}
              <br />
              <span id="seriesPreview">
                {preview.length === 0 ? (
                  <em>{t('None')}</em>
                ) : (
                  preview.map((line, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the preview lines are append-only
                    <span key={i}>
                      {line}
                      <br />
                    </span>
                  ))
                )}
              </span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** #monitorImportConfigModal */
function ImportDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean
  onClose: () => void
  onImport: (text: string) => void
}) {
  const file = useRef<HTMLInputElement>(null)
  return (
    <Modal
      title={t('Importing system monitor configuration')}
      open={open}
      onClose={onClose}
      id="monitorImportConfigModal"
      footer={
        <>
          <Button onClick={onClose}>{t('Close')}</Button>
          <Button
            variant="primary"
            id="monitorImportConfigImportButton"
            onClick={() => {
              const f = file.current?.files?.[0]
              if (f === undefined) return
              f.text().then(onImport, (e: unknown) =>
                window.alert(
                  `${t("Failed parsing config file. It doesn't seem to be valid JSON code.")}\n${String(e)}`,
                ),
              )
            }}
          >
            {t('Import')}
          </Button>
        </>
      }
    >
      <form>
        <Label htmlFor="import_file" className="mb-1 block">
          {t('Please select the file you want to import:')}
        </Label>
        <Input ref={file} type="file" name="file" id="import_file" />
      </form>
    </Modal>
  )
}
