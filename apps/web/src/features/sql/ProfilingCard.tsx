import type { Profiling } from '@bettermyadmin/contracts'
import { useEffect, useRef, useState } from 'react'
import { mysqlDocUrl } from '../../lib/docs'
import { t } from '../../lib/i18n'
import { DocIcon } from './SqlMessage'

type SortDir = 'asc' | 'desc'

/** Sortable table (jquery.tablesorter on the raw values). */
function useSort<T>(
  rows: readonly T[],
  initial: { col: number; dir: SortDir },
  value: (r: T, col: number) => number | string,
) {
  const [sort, setSort] = useState(initial)
  const sorted = [...rows].sort((a, b) => {
    const va = value(a, sort.col)
    const vb = value(b, sort.col)
    const c =
      typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return sort.dir === 'asc' ? c : -c
  })
  const header = (label: string, col: number) => (
    <th
      scope="col"
      className="px-2 py-1 text-left"
      aria-sort={sort.col === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="cursor-pointer select-none font-semibold"
        onClick={() => setSort((s) => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))}
      >
        {label}
      </button>
    </th>
  )
  return { sorted, header }
}

/**
 * The Profiling card: detailed profile, summary by state and the pie chart.
 * pma: resources/templates/sql/profiling_chart.twig, resources/js/sql.ts::initProfilingTables
 */
export function ProfilingCard({ profiling, versionInt }: { profiling: Profiling; versionInt: number }) {
  const detail = useSort(
    profiling.profile.map((p, i) => ({ ...p, order: i + 1 })),
    { col: 0, dir: 'asc' },
    (r, col) => (col === 0 ? r.order : col === 1 ? r.status : Number.parseFloat(r.durationRaw)),
  )
  const summary = useSort(profiling.states, { col: 1, dir: 'desc' }, (r, col) =>
    col === 0
      ? r.state
      : col === 1
        ? r.totalTimeRaw
        : col === 2
          ? r.totalTimeRaw / profiling.totalTime
          : col === 3
            ? r.calls
            : Number.parseFloat(r.averageRaw),
  )
  const td = 'px-2 py-0.5'
  return (
    <div className="mb-3 rounded border border-border" data-testid="profiling">
      <div className="border-b border-border bg-bg-subtle px-3 py-1.5 font-semibold">{t('Profiling')}</div>
      <div className="grid gap-4 p-3 lg:grid-cols-3">
        <div>
          <h3 className="mb-1 font-semibold">{t('Detailed profile')}</h3>
          <table id="profiletable" className="w-full text-xs">
            <thead>
              <tr>
                {detail.header(t('Order'), 0)}
                {detail.header(t('State'), 1)}
                {detail.header(t('Time'), 2)}
              </tr>
            </thead>
            <tbody>
              {detail.sorted.map((r) => (
                <tr key={r.order} className="odd:bg-grid-odd even:bg-grid-even">
                  <td className={td}>{r.order}</td>
                  <td className={td}>{r.status}</td>
                  <td className={`${td} text-right`}>{r.duration}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="mb-1 flex items-center gap-1 font-semibold">
            {t('Summary by state')}
            <DocIcon href={mysqlDocUrl('general-thread-states', '', versionInt)} />
          </h3>
          <table id="profilesummarytable" className="w-full text-xs">
            <thead>
              <tr>
                {summary.header(t('State'), 0)}
                {summary.header(t('Total Time'), 1)}
                {summary.header(t('% Time'), 2)}
                {summary.header(t('Calls'), 3)}
                {summary.header(t('ø Time'), 4)}
              </tr>
            </thead>
            <tbody>
              {summary.sorted.map((r) => (
                <tr key={r.state} className="odd:bg-grid-odd even:bg-grid-even">
                  <td className={td}>{r.state}</td>
                  <td className={`${td} text-right`}>{r.totalTime}s</td>
                  <td className={`${td} text-right`}>{r.percent}%</td>
                  <td className={`${td} text-right`}>{r.calls}</td>
                  <td className={`${td} text-right`}>{r.average}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ProfilingChart chart={profiling.chart} />
      </div>
    </div>
  )
}

/** createProfilingChart: Chart.js pie with the legend at the bottom (Chart.js is a lazy chunk). */
function ProfilingChart({ chart }: { chart: Profiling['chart'] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let destroyed = false
    let instance: { destroy(): void } | null = null
    void import('./profilingChart').then(({ createProfilingChart }) => {
      if (destroyed || canvas.current === null) return
      instance = createProfilingChart(canvas.current, chart)
    })
    return () => {
      destroyed = true
      instance?.destroy()
    }
  }, [chart])
  return (
    <div>
      <canvas
        id="profilingChartCanvas"
        ref={canvas}
        role="img"
        aria-label={t('Pie chart with profiling results.')}
      />
    </div>
  )
}
