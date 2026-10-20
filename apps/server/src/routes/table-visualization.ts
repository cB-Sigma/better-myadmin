import {
  ChartDataRequest,
  GisPageRequest,
  type GisPageResponse,
  VisualizationPageRequest,
} from '@bettermyadmin/contracts'
import { type Context, Hono } from 'hono'
import { withDb } from '../database/context.ts'
import { checkSqlSignature, signSql } from '../query/signature.ts'
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

/**
 * The links carry the query in the URL: like an unsigned GET sql_query, a query whose signature is
 * sent and does not verify is dropped (the page then says "No SQL query was set to fetch data.").
 */
function signedSql<T extends { sql: string; sig?: string | undefined }>(c: Context<ServerEnv>, req: T): T {
  if (req.sig === undefined) return req
  const ok = checkSqlSignature(
    req.sql,
    req.sig,
    c.get('session').hmacSecret,
    c.get('deps').cfg.blowfish_secret,
  )
  return ok ? req : { ...req, sql: '' }
}

/** The fieldset's query signed for the form's own requests (the chart's rows). */
async function withSignedFieldset<T extends { fieldset: { sql: string; sig: string } | null }>(
  c: Context<ServerEnv>,
  res: Promise<T>,
): Promise<T> {
  const r = await res
  if (r.fieldset !== null) {
    r.fieldset.sig = signSql(r.fieldset.sql, c.get('session').hmacSecret, c.get('deps').cfg.blowfish_secret)
  }
  return r
}

/** the chart form's data */
tableVisualizationRoutes.post('/:db/tables/:t/chart', async (c) => {
  const req = signedSql(c, parse(VisualizationPageRequest, await body(c)))
  return c.json(
    await withSignedFieldset(
      c,
      withScope(c, (x) => chartPage(x, req), { meta: false }),
    ),
  )
})

/** the form's submit (pos, session_max_rows): the rows to plot */
tableVisualizationRoutes.post('/:db/tables/:t/chart/data', async (c) => {
  const req = signedSql(c, parse(ChartDataRequest, await body(c)))
  return c.json(await withScope(c, (x) => chartData(x, req), { meta: false }))
})

/** the GIS visualization (first load and redraw) */
tableVisualizationRoutes.post('/:db/tables/:t/gis', async (c) => {
  const req = signedSql(c, parse(GisPageRequest, await body(c)))
  return c.json(
    await withSignedFieldset(
      c,
      withScope(c, (x) => gisPage(x, req), { meta: false }),
    ),
  )
})

// ---------------------------------------------------------------- a result without a table

/** ChartController's database branch: the database selected ("No database selected.") */
tableVisualizationRoutes.post('/:db/chart', async (c) => {
  const req = signedSql(c, parse(VisualizationPageRequest, await body(c)))
  return c.json(
    await withSignedFieldset(
      c,
      withDb(c, (x) => chartPage(x, req)),
    ),
  )
})
/**
 * ChartController::ajax selects the database only with a table: the rows' query runs on the link
 * as it is (a pooled link may still have a database from an earlier request)
 */
tableVisualizationRoutes.post('/:db/chart/data', async (c) => {
  const req = signedSql(c, parse(ChartDataRequest, await body(c)))
  return c.json(await withDb(c, (x) => chartData(x, req), { select: false }))
})
tableVisualizationRoutes.post('/:db/gis', async (c) => {
  const req = signedSql(c, parse(GisPageRequest, await body(c)))
  return c.json(
    await withSignedFieldset(
      c,
      withDb(c, (x) => gisPage(x, req)),
    ),
  )
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
  const req = signedSql(c, parse(VisualizationPageRequest, await body(c)))
  return c.json(
    await withSignedFieldset(
      c,
      withServer(c, (x) => chartPage(x, req)),
    ),
  )
})
serverVisualizationRoutes.post('/chart/data', async (c) => {
  const req = signedSql(c, parse(ChartDataRequest, await body(c)))
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
