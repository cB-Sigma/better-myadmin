import { ArcElement, Chart, Colors, Legend, PieController, Tooltip } from 'chart.js'
import { translator } from '../../lib/i18n'

Chart.register(PieController, ArcElement, Legend, Tooltip, Colors)

/**
 * Pie chart of the time per state, legend at the bottom, tooltips in seconds.
 * pma: resources/js/modules/functions/createProfilingChart.ts
 */
export function createProfilingChart(
  canvas: HTMLCanvasElement,
  chartData: { labels: string[]; data: number[] },
  legendPosition: 'bottom' | 'top' | 'left' | 'right' = 'bottom',
): Chart {
  // CommonParams.get('lang'): the phpMyAdmin language code (pt_BR → pt-BR)
  const lang = translator().locale
  const numberFormat = new Intl.NumberFormat(lang.replace('_', '-'), {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'long',
    notation: 'engineering',
  })
  return new Chart(canvas, {
    type: 'pie',
    data: { labels: chartData.labels, datasets: [{ data: chartData.data }] },
    options: {
      plugins: {
        legend: { position: legendPosition },
        tooltip: {
          callbacks: { label: (context) => (context.parsed ? numberFormat.format(context.parsed) : '') },
        },
      },
    },
  })
}
