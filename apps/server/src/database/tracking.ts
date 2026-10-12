import type { DbActionResponse, DbTrackingRequest, DbTrackingResponse } from '@bettermyadmin/contracts'
import {
  changeTracking,
  deleteTracking,
  getTrackedData,
  headVersions,
  trackedTables,
  trackingSet,
} from '@bettermyadmin/metadata'
import { createVersion } from '../table/tracking.ts'
import { type DbCtx, isSystemSchema, listTables, msg, tf } from './context.ts'
import { isView } from './tables.ts'

/**
 * Database → Tracking: tracked and untracked tables, deleting tracking data, creating a version
 * for several tables, and the database log.
 * pma: src/Controllers/Database/TrackingController.php, src/Tracking/Tracking.php,
 *      templates/database/tracking/tables.twig
 */

/** TrackingController (GET): the page */
export async function trackingPage(ctx: DbCtx): Promise<DbTrackingResponse> {
  const enabled = ctx.rp.trackingFeature !== null
  const base: DbTrackingResponse = {
    db: ctx.db,
    enabled,
    noTables: false,
    isSystemSchema: isSystemSchema(ctx.db),
    tracked: [],
    untracked: [],
    log: null,
    defaultStatements: ctx.server.tracking_default_statements,
  }
  if (!enabled) return base
  const data = await getTrackedData(ctx.control, ctx.rp, ctx.db, '', '1')
  const tables = await listTables(ctx)
  if (data.ddlog.length === 0 && tables.length === 0) return { ...base, noTables: true }
  const versions = await headVersions(ctx.control, ctx.rp, ctx.db)
  const tracked = await trackedTables(ctx.control, ctx.rp, ctx.db)
  return {
    ...base,
    tracked: versions.map((v) => ({
      table: v.table_name ?? '',
      version: v.version ?? '',
      created: v.date_created ?? '',
      updated: v.date_updated ?? '',
      active: v.tracking_active === '1',
    })),
    untracked: tables.filter((t) => !tracked.has(t)),
    log:
      data.ddlog.length === 0
        ? null
        : data.ddlog.map((e) => `# ${e.date} ${e.username}\n${e.statement}\n`).join(''),
  }
}

/** TrackingController (POST): delete_tracking / submit_mult=delete_tracking / submit_create_version */
export async function trackingAction(ctx: DbCtx, req: DbTrackingRequest): Promise<DbActionResponse> {
  const { tr } = ctx
  if (req.action === 'delete') {
    for (const t of req.tables) await deleteTracking(ctx.control, ctx.rp, ctx.db, t)
    return { messages: [msg('success', tr.gettext('Tracking data deleted successfully.'))] }
  }
  if (req.action === 'toggle') {
    // Tracking::changeTracking (reached from the Status toggle through /table/tracking)
    const ok = await changeTracking(ctx.control, ctx.rp, ctx.db, req.table, req.version, req.active ? 1 : 0)
    if (!ok) return { messages: [] }
    const text = req.active
      ? 'Tracking for %1$s was activated at version %2$s.'
      : 'Tracking for %1$s was deactivated at version %2$s.'
    return { messages: [msg('success', tf(tr, text, `${ctx.db}.${req.table}`, req.version))] }
  }
  const set = trackingSet(req.statements)
  for (const t of req.tables)
    await createVersion(ctx, ctx.db, t, req.version, set, await isView(ctx, ctx.db, t))
  return {
    messages: [
      msg(
        'success',
        tf(tr, 'Version %1$s was created for selected tables, tracking is active for them.', req.version),
      ),
    ],
  }
}
