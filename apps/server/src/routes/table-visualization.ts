import { ChartDataRequest, GisPageRequest, VisualizationPageRequest } from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import { chartData, chartPage, gisPage } from '../table/visualization.ts'
import type { ServerEnv } from './server.ts'
import { body, parse, withScope } from './table-scope.ts'

/**
 * Display chart (pma: /table/chart) and the GIS visualization (pma: /table/gis-visualization) of a
 * query result. Mounted at /api/servers/:s/databases. The query travels in the body.
 */
export const tableVisualizationRoutes = new Hono<ServerEnv>()

/** the chart form's data */
tableVisualizationRoutes.post('/:db/tables/:t/chart', async (c) => {
  const req = parse(VisualizationPageRequest, await body(c))
  return c.json(await withScope(c, (x) => chartPage(x, req), { meta: false }))
})

/** the form's submit (pos, session_max_rows): the rows to plot */
tableVisualizationRoutes.post('/:db/tables/:t/chart/data', async (c) => {
  const req = parse(ChartDataRequest, await body(c))
  return c.json(await withScope(c, (x) => chartData(x, req), { meta: false }))
})

/** the GIS visualization (first load and redraw) */
tableVisualizationRoutes.post('/:db/tables/:t/gis', async (c) => {
  const req = parse(GisPageRequest, await body(c))
  return c.json(await withScope(c, (x) => gisPage(x, req), { meta: false }))
})
