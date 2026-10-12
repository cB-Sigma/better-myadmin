import {
  CreateTrackingVersionRequest,
  DeleteTrackingVersionsRequest,
  ToggleTrackingRequest,
  TrackingReportRequest,
} from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import {
  createTrackingVersion,
  deleteTrackingVersions,
  toggleTracking,
  trackingPage,
  trackingReport,
  trackingSnapshot,
} from '../table/tracking.ts'
import type { ServerEnv } from './server.ts'
import { body, parse, respond, withScope } from './table-scope.ts'

/**
 * Table Tracking tab (pma: /table/tracking). Mounted at /api/servers/:s/databases. The report,
 * snapshot and deletions only need the database (TrackingController checks selectDatabase only).
 */
export const tableTrackingRoutes = new Hono<ServerEnv>()

tableTrackingRoutes.get('/:db/tables/:t/tracking', async (c) => c.json(await withScope(c, trackingPage)))

/** submit_create_version */
tableTrackingRoutes.post('/:db/tables/:t/tracking/versions', async (c) => {
  const req = parse(CreateTrackingVersionRequest, await body(c))
  return respond(c, await withScope(c, (x) => createTrackingVersion(x, req)))
})

/** submit_delete_version / submit_mult=delete_version */
tableTrackingRoutes.post('/:db/tables/:t/tracking/versions/delete', async (c) => {
  const req = parse(DeleteTrackingVersionsRequest, await body(c))
  return respond(c, await withScope(c, (x) => deleteTrackingVersions(x, req), { table: false }))
})

/** toggle_activation=activate_now / deactivate_now */
tableTrackingRoutes.post('/:db/tables/:t/tracking/toggle', async (c) => {
  const req = parse(ToggleTrackingRequest, await body(c))
  return respond(c, await withScope(c, (x) => toggleTracking(x, req), { table: false }))
})

/** report=true (filters, delete_ddlog / delete_dmlog, export_type) */
tableTrackingRoutes.post('/:db/tables/:t/tracking/report', async (c) => {
  const req = parse(TrackingReportRequest, await body(c))
  return respond(c, await withScope(c, (x) => trackingReport(x, req), { table: false }))
})

/** snapshot=true */
tableTrackingRoutes.get('/:db/tables/:t/tracking/snapshot', async (c) =>
  c.json(await withScope(c, (x) => trackingSnapshot(x, c.req.query('version') ?? ''), { table: false })),
)
