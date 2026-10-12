import type { ChartPageResponse, RowsFieldset, SqlMessage } from '@bettermyadmin/contracts'
import {
  Button,
  Input,
  Label,
  MessageBox,
  NativeCheckbox,
  NativeSelect,
  Panel,
  PmaIcon,
} from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type VisScope, api, errorMessage } from '../../../lib/api'
import { pgettext, t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import type { ChartSettings, ChartType } from './queryChart'

/**
 * Display chart of a query result (the "Query results operations" link).
 * pma: resources/templates/table/chart/tbl_chart.twig, table/start_and_number_of_rows_fieldset.twig,
 *      resources/js/table/chart.ts
 */

export interface VisualizationSearch {
  sql: string
  unlimNumRows: number
  pos?: number | undefined
  sessionMaxRows?: number | undefined
}

export function ChartPage({ scope, search }: { scope: VisScope; search: VisualizationSearch }) {
  const req = {
    sql: search.sql,
    unlimNumRows: search.unlimNumRows,
    ...(search.pos === undefined ? {} : { pos: search.pos }),
    ...(search.sessionMaxRows === undefined ? {} : { sessionMaxRows: search.sessionMaxRows }),
  }
  const q = useQuery({
    queryKey: qk.visualization(scope, 'chart', req),
    queryFn: () => api.chartPage(scope, req),
  })
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined) return null
  if (q.data.error !== null || q.data.fieldset === null) {
    return <MessageBox type="error">{q.data.error ?? ''}</MessageBox>
  }
  return <ChartForm scope={scope} page={q.data} fieldset={q.data.fieldset} />
}

/** the chart types of the radio group (Pie / Timeline / Scatter shown when they apply) */
const TYPES: Array<[ChartType, string]> = [
  ['bar', 'Bar'],
  ['column', 'Column'],
  ['line', 'Line'],
  ['spline', 'Spline'],
  ['area', 'Area'],
  ['pie', 'Pie'],
  ['timeline', 'Timeline'],
  ['scatter', 'Scatter'],
]

function typeLabel(type: ChartType): string {
  switch (type) {
    case 'bar':
      return pgettext('Chart type', 'Bar')
    case 'column':
      return pgettext('Chart type', 'Column')
    case 'line':
      return pgettext('Chart type', 'Line')
    case 'spline':
      return pgettext('Chart type', 'Spline')
    case 'area':
      return pgettext('Chart type', 'Area')
    case 'pie':
      return pgettext('Chart type', 'Pie')
    case 'timeline':
      return pgettext('Chart type', 'Timeline')
    default:
      return pgettext('Chart type', 'Scatter')
  }
}

function ChartForm({
  scope,
  page,
  fieldset,
}: { scope: VisScope; page: ChartPageResponse; fieldset: RowsFieldset }) {
  const cols = page.columns
  const names = useMemo(() => cols.map((c) => c.name), [cols])
  const numeric = cols.flatMap((c, i) => (c.numeric ? [i] : []))
  const dateTime = cols.flatMap((c, i) => (c.dateTime ? [i] : []))
  // tbl_chart.twig: the X-Axis is the first column; the numeric columns but it are the series.
  // `series_column` is set inside its loop (Twig loop scope), so the value column select has no
  // selected option: the browser shows the first numeric column
  const xaxis = 0
  const initialSeries = numeric.filter((i) => i !== xaxis)
  const [settings, setSettings] = useState<ChartSettings>(() => ({
    type: 'line',
    title: '',
    xaxisLabel: names[xaxis] ?? '',
    yaxisLabel: initialSeries.length === 1 ? (names[initialSeries[0] ?? 0] ?? '') : t('Y Values'),
    stackSeries: false,
    mainAxis: xaxis,
    selectedSeries: initialSeries,
    seriesColumn: null,
    valueColumn: null,
  }))
  const [seriesColumn, setSeriesColumn] = useState(cols.length > 1 ? 1 : 0)
  const [valueColumn, setValueColumn] = useState(numeric[0] ?? 0)
  const [pos, setPos] = useState(fieldset.pos)
  const [rows, setRows] = useState(fieldset.rows)
  const [data, setData] = useState<Array<Record<string, string | null>> | null>(null)
  const [message, setMessage] = useState<SqlMessage | null>(null)
  const [image, setImage] = useState('#')
  const canvas = useRef<HTMLCanvasElement>(null)

  const set = (patch: Partial<ChartSettings>) => setSettings((s) => ({ ...s, ...patch }))

  // the form's ajax submit: the rows of the page
  const submit = async () => {
    try {
      const r = await api.chartData(scope, { sql: fieldset.sql, pos, sessionMaxRows: rows })
      if (r.error !== null) {
        setMessage({ type: 'error', text: r.error })
        return
      }
      setMessage(null)
      setData(r.data)
    } catch (e) {
      setMessage(errorMessage(e))
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: the initial $('#tblchartform').trigger('submit')
  useEffect(() => {
    void submit()
  }, [])

  // drawChart() on every change of the settings or the data
  useEffect(() => {
    const el = canvas.current
    if (el === null || data === null) return
    let cancelled = false
    void import('./queryChart').then(({ drawQueryChart }) => {
      if (cancelled) return
      try {
        const chart = drawQueryChart(el, data, names, settings)
        setImage(chart.toBase64Image())
      } catch (e) {
        setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
      }
    })
    return () => {
      cancelled = true
    }
  }, [data, settings, names])

  const onType = (type: ChartType) => {
    const stackable = type === 'bar' || type === 'column' || type === 'area'
    set({ type, ...(stackable ? {} : { stackSeries: false }) })
  }
  // onXAxisChange: Timeline / Scatter only for date-time / numeric X columns
  const onXAxis = (idx: number) => {
    let type = settings.type
    if (type === 'timeline' && !dateTime.includes(idx)) type = 'line'
    if (type === 'scatter' && !numeric.includes(idx)) type = 'line'
    set({ mainAxis: idx, type, xaxisLabel: names[idx] ?? '' })
  }
  // onDataSeriesChange: Pie only for one series; the Y-Axis label follows
  const onSeries = (selected: number[]) => {
    const one = selected.length === 1
    set({
      selectedSeries: selected,
      ...(one ? {} : settings.type === 'pie' ? { type: 'line' as const } : {}),
      yaxisLabel: one ? (names[selected[0] ?? 0] ?? '') : t('Y Values'),
    })
  }
  const shown = (type: ChartType) =>
    type === 'pie'
      ? settings.selectedSeries.length === 1
      : type === 'timeline'
        ? dateTime.includes(settings.mainAxis)
        : type === 'scatter'
          ? numeric.includes(settings.mainAxis)
          : true
  const stackable = settings.type === 'bar' || settings.type === 'column' || settings.type === 'area'
  const byColumn = settings.seriesColumn !== null

  return (
    <div id="div_view_options" className="my-3">
      <h2 className="mb-3 text-lg font-semibold">{t('Display chart')}</h2>
      {message !== null && <MessageBox {...message} />}
      <Panel>
        <form
          id="tblchartform"
          className="space-y-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <fieldset className="flex flex-wrap gap-3">
            <legend className="sr-only">{t('Chart type')}</legend>
            {TYPES.filter(([type]) => shown(type)).map(([type]) => (
              <Label key={type} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="chartType"
                  value={type}
                  id={`${type}ChartTypeRadio`}
                  checked={settings.type === type}
                  onChange={() => onType(type)}
                />
                {typeLabel(type)}
              </Label>
            ))}
          </fieldset>
          {stackable && (
            <Label className="flex items-center gap-1" id="barStacked">
              <NativeCheckbox
                name="barStackedCheckbox"
                id="barStackedCheckbox"
                checked={settings.stackSeries}
                onChange={(e) => set({ stackSeries: e.target.checked })}
              />
              {t('Stacked')}
            </Label>
          )}
          <Field label={t('Chart title:')} id="chartTitleInput">
            <Input
              id="chartTitleInput"
              name="chartTitleInput"
              value={settings.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </Field>
          <Field label={t('X-Axis:')} id="chartXAxisSelect">
            <NativeSelect
              id="chartXAxisSelect"
              name="chartXAxisSelect"
              value={settings.mainAxis}
              onChange={(e) => onXAxis(Number(e.target.value))}
            >
              {names.map((n, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: options by column position
                <option key={i} value={i}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('Series:')} id="chartSeriesSelect">
            <select
              id="chartSeriesSelect"
              name="chartSeriesSelect"
              multiple
              className="input min-h-20 resize-y"
              disabled={byColumn}
              value={settings.selectedSeries.map(String)}
              onChange={(e) => onSeries([...e.target.selectedOptions].map((o) => Number(o.value)))}
            >
              {numeric.map((i) => (
                <option key={i} value={i}>
                  {names[i]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('X-Axis label:')} id="xAxisLabelInput">
            <Input
              id="xAxisLabelInput"
              name="xAxisLabelInput"
              value={settings.xaxisLabel}
              onChange={(e) => set({ xaxisLabel: e.target.value })}
            />
          </Field>
          <Field label={t('Y-Axis label:')} id="yAxisLabelInput">
            <Input
              id="yAxisLabelInput"
              name="yAxisLabelInput"
              value={settings.yaxisLabel}
              onChange={(e) => set({ yaxisLabel: e.target.value })}
            />
          </Field>
          <Label className="flex items-center gap-1">
            <NativeCheckbox
              id="seriesColumnCheckbox"
              name="seriesColumnCheckbox"
              checked={byColumn}
              onChange={(e) =>
                set(
                  e.target.checked
                    ? { seriesColumn, valueColumn }
                    : { seriesColumn: null, valueColumn: null },
                )
              }
            />
            {t('Series names are in a column')}
          </Label>
          <Field label={t('Series column:')} id="chartSeriesColumnSelect">
            <NativeSelect
              id="chartSeriesColumnSelect"
              name="chartSeriesColumnSelect"
              disabled={!byColumn}
              value={seriesColumn}
              onChange={(e) => {
                setSeriesColumn(Number(e.target.value))
                set({ seriesColumn: Number(e.target.value) })
              }}
            >
              {names.map((n, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: options by column position
                <option key={i} value={i}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('Value Column:')} id="chartValueColumnSelect">
            <NativeSelect
              id="chartValueColumnSelect"
              name="chartValueColumnSelect"
              disabled={!byColumn}
              value={valueColumn}
              onChange={(e) => {
                setValueColumn(Number(e.target.value))
                set({ valueColumn: Number(e.target.value) })
              }}
            >
              {numeric.map((i) => (
                <option key={i} value={i}>
                  {names[i]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <RowsFieldsetInputs fieldset={fieldset} pos={pos} rows={rows} setPos={setPos} setRows={setRows} />
          <div id="resizer" className="relative mt-3 min-h-60 min-w-75 resize overflow-auto">
            <canvas ref={canvas} id="queryChartCanvas" aria-label={t('The generated chart')} role="img" />
            <div className="absolute top-0 right-0 mt-1 me-1">
              <a className="disableAjax" id="saveChart" href={image} download="chart.png">
                <PmaIcon name="b_saveimage" alt={t('Save chart as image')} />
              </a>
            </div>
          </div>
        </form>
      </Panel>
    </div>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  )
}

/** table/start_and_number_of_rows_fieldset.twig (also the GIS visualization's) */
export function RowsFieldsetInputs({
  fieldset,
  pos,
  rows,
  setPos,
  setRows,
}: {
  fieldset: RowsFieldset
  pos: number
  rows: number
  setPos: (n: number) => void
  setRows: (n: number) => void
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-3">
      <label htmlFor="startRowInput">{t('Start row:')}</label>
      <Input
        id="startRowInput"
        type="number"
        name="pos"
        min={0}
        {...(fieldset.unlimNumRows > 0 ? { max: fieldset.unlimNumRows - 1 } : {})}
        required
        className="w-24"
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
      />
      <label htmlFor="maxRowsInput">{t('Number of rows:')}</label>
      <Input
        id="maxRowsInput"
        type="number"
        name="session_max_rows"
        min={1}
        required
        className="w-24"
        value={rows}
        onChange={(e) => setRows(Number(e.target.value))}
      />
      <Button type="submit" variant="primary" name="submit">
        {t('Go')}
      </Button>
    </fieldset>
  )
}
