import {
  CategoryScale,
  Chart,
  Colors,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js'
import { translator } from '../../lib/i18n'
import { type Translate, axisKind, formatTick } from './monitor'

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Legend,
  Title,
  Tooltip,
  Colors,
)

/** The time of a server timestamp (ms) in the request language (the chart's `locale`) */
export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(translator().locale.replace('_', '-'))
}

/**
 * One line chart of the grid: series per node, stacked and filled for memory and swap, y ticks per
 * title (addChart), x as time with 5 ticks; clicking it (outside edit mode) asks for the log analysis
 * of the shown time span (the first and fifth x tick).
 * pma: resources/js/server/status/monitor.ts::addChart
 */
export function createMonitorChart(
  canvas: HTMLCanvasElement,
  o: {
    title: string
    labels: string[]
    /** the shown time span (runtime.xmin / xmax) */
    range: { min: number; max: number }
    t: Translate
    onClick: (from: number, to: number) => void
  },
): Chart<'line', Array<{ x: number; y: number }>> {
  const kind = axisKind(o.title, o.t)
  const stacked = kind === 'mib'
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: o.labels.map((label) => ({ label, data: [], fill: stacked ? 'start' : false, tension: 0.3 })),
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        title: { display: true, text: o.title },
        legend: { display: true, position: 'bottom' },
      },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'linear',
          min: o.range.min,
          max: o.range.max,
          ticks: { maxTicksLimit: 5, callback: (v) => clock(Number(v)) },
          // refreshChartGrid's labels: five ticks spread over the shown span, the last at its end
          afterBuildTicks: (axis) => {
            const step = (axis.max - axis.min) / 5
            axis.ticks = [4, 3, 2, 1, 0].map((i) => ({ value: axis.max - step * i }))
          },
        },
        y: {
          stacked,
          suggestedMin: 0,
          suggestedMax: 100,
          ticks: { stepSize: 20, callback: (v) => formatTick(kind, Number(v), o.t) },
        },
      },
      onClick: (_event, _elements, chart) => {
        const ticks = chart.scales.x?.ticks ?? []
        const first = ticks[0]?.value
        const last = ticks[4]?.value ?? ticks.at(-1)?.value
        if (first !== undefined && last !== undefined) o.onClick(first, last)
      },
    },
  })
}
