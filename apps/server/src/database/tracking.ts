import type { DbActionResponse, DbTrackingRequest, DbTrackingResponse } from '@bettermyadmin/contracts'
import {
  changeTracking,
  deleteTracking,
  getTrackedData,
  headVersions,
  insertTrackingVersion,
  phpSerialize,
  trackedTables,
  trackingDate,
  trackingLogComment,
  trackingSet,
} from '@bettermyadmin/metadata'
import { backquote } from '@bettermyadmin/sql-gen'
import { type DbCtx, isSystemSchema, listTables, msg, tf } from './context.ts'
import { getTableDef } from './table-mover.ts'
import { isView } from './tables.ts'

/**
 * Database → Tracking: tracked and untracked tables, deleting tracking data, creating a version
 * for several tables, and the database log.
 * pma: src/Controllers/Database/TrackingController.php, src/Tracking/Tracking.php,
 *      src/Tracking/Tracker.php::createVersion, templates/database/tracking/tables.twig
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

/**
 * Tracker::createVersion: the structure snapshot, the DROP/CREATE statements as the first log
 * entries, then the INSERT into pma__tracking (and the previous version deactivated).
 */
export async function createVersion(
  ctx: DbCtx,
  table: string,
  version: string,
  statements: string,
  view: boolean,
): Promise<boolean> {
  const set = statements !== '' ? statements : ctx.server.tracking_default_statements
  const date = trackingDate()
  const columns = (await ctx.reader.getColumns(ctx.db, table)).map((c) => ({
    Field: c.Field,
    Type: c.Type,
    Collation: c.Collation,
    Null: c.Null,
    Key: c.Key,
    Default: c.Default,
    Extra: c.Extra,
    Comment: c.Comment,
  }))
  const indexes = await ctx.dbi.fetchResultSimple(
    `SHOW INDEXES FROM ${backquote(ctx.db)}.${backquote(table)}`,
  )
  const snapshot = phpSerialize({ COLUMNS: columns, INDEXES: indexes })
  const log = trackingLogComment(date, ctx.user)
  let createSql = ''
  if (ctx.server.tracking_add_drop_table && !view)
    createSql += `${log}DROP TABLE IF EXISTS ${backquote(table)};\n`
  if (ctx.server.tracking_add_drop_view && view)
    createSql += `${log}DROP VIEW IF EXISTS ${backquote(table)};\n`
  // ExportSql::getTableDef with the plugin defaults ($view = false, no AUTO_INCREMENT value)
  createSql += `${log}${(await getTableDef(ctx, ctx.db, table, false, false)).create};\n`
  return insertTrackingVersion(ctx.control, ctx.rp, {
    db: ctx.db,
    table,
    version,
    date,
    snapshot,
    schemaSql: createSql,
    trackingSet: set,
  })
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
  for (const t of req.tables) await createVersion(ctx, t, req.version, set, await isView(ctx, ctx.db, t))
  return {
    messages: [
      msg(
        'success',
        tf(tr, 'Version %1$s was created for selected tables, tracking is active for them.', req.version),
      ),
    ],
  }
}
