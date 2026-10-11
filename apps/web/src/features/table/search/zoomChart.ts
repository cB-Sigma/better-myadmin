import { Chart, LinearScale, PointElement, ScatterController, Tooltip } from 'chart.js'
import zoomPlugin from 'chartjs-plugin-zoom'

Chart.register(ScatterController, PointElement, LinearScale, Tooltip, zoomPlugin)

export interface ZoomPoint {
  x: number
  y: number
  index: number
  label: string
}

/**
 * The zoom-search scatter plot: wheel / pinch zoom and drag pan on both axes, a click opens the row.
 * pma: resources/js/table/zoom_search.ts (Chart.js scatter + chartjs-plugin-zoom)
 */
export function createZoomChart(
  canvas: HTMLCanvasElement,
  points: ZoomPoint[],
  axis: { x: string; y: string },
  showLabel: boolean,
  onPoint: (index: number) => void,
): Chart<'scatter'> {
  return new Chart(canvas, {
    type: 'scatter',
    data: { datasets: [{ data: points, pointRadius: 4 }] },
    options: {
      animation: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: axis.x } },
        y: { type: 'linear', title: { display: true, text: axis.y } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = ctx.raw as ZoomPoint
              return showLabel ? `${p.label}` : `(${p.x}, ${p.y})`
            },
          },
        },
        zoom: {
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' },
          pan: { enabled: true, mode: 'xy' },
        },
      },
      onClick: (_e, elements) => {
        const el = elements[0]
        if (el !== undefined) onPoint((points[el.index] as ZoomPoint).index)
      },
    },
  })
}
