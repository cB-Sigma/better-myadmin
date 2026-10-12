import {
  ChartDataRequest,
  GisPageRequest,
  type GisPageResponse,
  VisualizationPageRequest,
} from '@bettermyadmin/contracts'
import { type Context, Hono } from 'hono'
import { withDb } from '../database/context.ts'
import { isSuperUser } from '../server-admin/context.ts'
import { chartData, chartPage, gisPage } from '../table/visualization.ts'
import type { ServerEnv } from './server.ts'
import { body, parse, withScope } from './table-scope.ts'

/**
 * Display chart (pma: /table/chart) and the GIS visualization (pma: /table/gis-visualization) of a
 * query result, at the table, database or server level as Results::getResultsOperations links
 * them for any SELECT. The query travels in the body.
 *
 * pma: src/Controllers/Table/ChartController.php (the table / database / server branches),
 *      src/Controllers/Table/GisVisualizationController.php (needs a database)
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

// ---------------------------------------------------------------- a result without a table

/** ChartController's database branch: the database selected ("No databases selected.") */
tableVisualizationRoutes.post('/:db/chart', async (c) => {
  const req = parse(VisualizationPageRequest, await body(c))
  return c.json(await withDb(c, (x) => chartPage(x, req)))
})
/**
 * ChartController::ajax selects the database only with a table: the rows' query runs on the link
 * as it is (a pooled link may still have a database from an earlier request)
 */
tableVisualizationRoutes.post('/:db/chart/data', async (c) => {
  const req = parse(ChartDataRequest, await body(c))
  return c.json(await withDb(c, (x) => chartData(x, req), { select: false }))
})
tableVisualizationRoutes.post('/:db/gis', async (c) => {
  const req = parse(GisPageRequest, await body(c))
  return c.json(await withDb(c, (x) => gisPage(x, req)))
})

/** Mounted at /api/servers/:s/visualization: a result without a database */
export const serverVisualizationRoutes = new Hono<ServerEnv>()

/** ChartController's server branch: `mysql` selected for a super user */
const withServer = <T>(c: Context<ServerEnv>, fn: Parameters<typeof withDb<T>>[1]) =>
  withDb(
    c,
    async (x) => {
      if (await isSuperUser(x.dbi)) await x.reader.selectDb('mysql')
      return fn(x)
    },
    { select: false, db: '' },
  )

serverVisualizationRoutes.post('/chart', async (c) => {
  const req = parse(VisualizationPageRequest, await body(c))
  return c.json(await withServer(c, (x) => chartPage(x, req)))
})
serverVisualizationRoutes.post('/chart/data', async (c) => {
  const req = parse(ChartDataRequest, await body(c))
  return c.json(await withDb(c, (x) => chartData(x, req), { select: false, db: '' }))
})
/** GisVisualizationController: `missingParameterError('db')` */
serverVisualizationRoutes.post('/gis', async (c) => {
  const tr = c.get('tr')
  const res: GisPageResponse = {
    error: `${tr.gettext('Missing parameter:')} db`,
    labelCandidates: [],
    spatialCandidates: [],
    spatialColumn: '',
    labelColumn: '',
    width: 600,
    height: 450,
    fieldset: null,
    rows: [],
    hasSrid: false,
  }
  return c.json(res)
})
