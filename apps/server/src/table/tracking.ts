/**
 * Table Tracking tab: versions (create, delete, activate/deactivate), the tracking report with its
 * filters, entry deletion and the three exports, the structure snapshot. Every configuration-storage
 * statement goes through the control link, as phpMyAdmin's `queryAsControlUser`.
 *
 * The statements run afterwards are logged by Tracker::handleQuery (table/tracker.ts).
 *
 * pma: src/Controllers/Table/TrackingController.php, src/Tracking/Tracking.php,
 *      src/Tracking/Tracker.php, src/Tracking/TrackingChecker.php
 */
import type {
  CreateTrackingVersionRequest,
  DeleteTrackingVersionsRequest,
  SqlMessage,
  ToggleTrackingRequest,
  TrackingLogType,
  TrackingPageResponse,
  TrackingReportEntry,
  TrackingReportRequest,
  TrackingReportResponse,
  TrackingResponse,
  TrackingSnapshotResponse,
} from '@bettermyadmin/contracts'
import { TRACKING_STATEMENTS } from '@bettermyadmin/contracts'
import { type Translator, sprintf } from '@bettermyadmin/i18n'
import {
  type TrackingLogEntry as LogEntry,
  type MetaConn,
  type RelationParameters,
  changeTrackingData,
  changeTracking as changeTrackingRow,
  deleteTracking,
  insertTrackingVersion,
  phpSerialize,
  phpUnserialize,
  getTrackedData as trackedRow,
  trackedTables,
  trackingDate,
  trackingLogComment,
  trackingVersions,
} from '@bettermyadmin/metadata'
import { backquote } from '@bettermyadmin/sql-gen'
import type { z } from 'zod'
import type { AppConfig, ServerConfig } from '../config.ts'
import { MysqlError, ValidationError } from '../http/errors.ts'
import type { OpsCtx } from './operations.ts'
import type { TableReader } from './read.ts'
import { sqlStructurePlugin } from './table-def.ts'

type In<T extends z.ZodTypeAny> = z.output<T>

interface TrackedData {
  dateFrom: string
  dateTo: string
  ddlog: LogEntry[]
  dmlog: LogEntry[]
  tracking: string
  schemaSnapshot: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const formatDate = (d: Date) => trackingDate(d)

/** format('Y-m-d H:i:sP') */
function formatDateOffset(d: Date): string {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const a = Math.abs(off)
  return `${formatDate(d)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
}

/** new DateTimeImmutable($s) for the 'Y-m-d H:i:s' strings the log and the form use; null when invalid */
function parseDate(s: string): Date | null {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?\s*$/.exec(s)
  if (m !== null) {
    const [, y, mo, d, h, mi, se] = m
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(se ?? 0))
  }
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t)
}

/** strtotime() of a log date (false → NaN compares false, as in PHP's int comparisons it would be 0) */
const strtotime = (s: string) => parseDate(s)?.getTime() ?? 0

/** TrackingController::validateDateTimeParam */
function validateDateTimeParam(s: string | undefined): Date {
  if (s === undefined || s === '') return new Date()
  return parseDate(s) ?? new Date()
}

/** the control link and the relation parameters, when tracking is configured */
function storage(ctx: OpsCtx): { conn: MetaConn; rp: RelationParameters } | null {
  const rp = ctx.meta?.rp ?? null
  const conn = ctx.meta?.control ?? null
  if (rp === null || rp.trackingFeature === null || conn === null) return null
  return { conn, rp }
}

function requireTracking(ctx: OpsCtx) {
  const t = storage(ctx)
  if (t === null) throw new ValidationError(ctx.tr.gettext('Tracking is not active.'))
  return t
}

const success = (text: string): SqlMessage => ({ type: 'success', text })

// ---------------------------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------------------------

/** pma: TrackingController::__invoke (no action) + Tracking::getHtmlForMainPage */
export async function trackingPage(ctx: OpsCtx): Promise<TrackingPageResponse> {
  const t = storage(ctx)
  const available = t !== null
  const tracked = t === null ? new Map<string, boolean>() : await trackedTables(t.conn, t.rp, ctx.db)
  const rows = t === null ? [] : await trackingVersions(t.conn, t.rp, ctx.db, ctx.table)
  const isView = await ctx.reader.isView(ctx.db, ctx.table)
  return {
    db: ctx.db,
    table: ctx.table,
    type: isView ? 'view' : 'table',
    available,
    activeMessage: tracked.get(ctx.table) === true,
    trackedTables: [...tracked].map(([name, active]) => ({ name, active })),
    // Tracking::getTableLastVersionNumber: (int) of the first row's version
    lastVersion: Number.parseInt(rows[0]?.version ?? '0', 10) || 0,
    versions: rows.map((r) => ({
      version: r.version ?? '',
      dateCreated: r.date_created ?? '',
      dateUpdated: r.date_updated ?? '',
      active: Number(r.tracking_active) === 1,
    })),
    defaultStatements: ctx.server.tracking_default_statements,
  }
}

// ---------------------------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------------------------

/** pma: Tracker::changeTracking */
async function changeTracking(ctx: OpsCtx, version: string, state: 0 | 1): Promise<boolean> {
  const t = requireTracking(ctx)
  return changeTrackingRow(t.conn, t.rp, ctx.db, ctx.table, version, state)
}

export interface VersionCtx {
  reader: TableReader
  cfg: AppConfig
  tr: Translator
  server: ServerConfig
  /** the logged-in MySQL user */
  user: string
  control: MetaConn | null
  rp: RelationParameters
}

/**
 * pma: Tracker::createVersion — the structure snapshot, the DROP/CREATE statements as the first
 * log entries, then the INSERT into pma__tracking (and the previous version deactivated). Shared
 * by the table Tracking tab and Database > Tracking.
 */
export async function createVersion(
  ctx: VersionCtx,
  db: string,
  table: string,
  version: string,
  statements: string,
  isView: boolean,
): Promise<boolean> {
  const { reader, server } = ctx
  const trackingSet = statements === '' ? server.tracking_default_statements : statements
  const date = trackingDate()

  // Get data definition snapshot of table
  const columns = (await reader.getColumns(db, table)).map((c) => ({
    Field: c.Field,
    Type: c.Type,
    Collation: c.Collation,
    Null: c.Null,
    Key: c.Key,
    Default: c.Default,
    Extra: c.Extra,
    Comment: c.Comment,
  }))
  // DatabaseInterface::getTableIndexes: the rows of SHOW INDEXES as mysqli returns them (strings)
  const indexRows = await reader.dbi.fetchResultSimple(
    `SHOW INDEXES FROM ${backquote(db)}.${backquote(table)}`,
  )
  const indexes = indexRows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? null : String(v)])),
  )
  const snapshot = phpSerialize({ COLUMNS: columns, INDEXES: indexes })

  // Get DROP TABLE / DROP VIEW and CREATE TABLE SQL statements
  const log = trackingLogComment(date, ctx.user)
  let createSql = ''
  if (server.tracking_add_drop_table && !isView) {
    createSql += `${log}DROP TABLE IF EXISTS ${backquote(table)};\n`
  }
  if (server.tracking_add_drop_view && isView) {
    createSql += `${log}DROP VIEW IF EXISTS ${backquote(table)};\n`
  }
  // ExportSql::getTableDef($db, $table) with the plugin's defaults: no view handling, no
  // AUTO_INCREMENT value, keys and constraints left out of the CREATE statement, a semicolon added
  createSql += `${log}${await sqlStructurePlugin(ctx).getTableDef(db, table)}`

  return insertTrackingVersion(ctx.control, ctx.rp, {
    db,
    table,
    version,
    date,
    snapshot,
    schemaSql: createSql,
    trackingSet,
  })
}

/** pma: Tracking::createTrackingVersion (submit_create_version) */
export async function createTrackingVersion(
  ctx: OpsCtx,
  req: In<typeof CreateTrackingVersionRequest>,
): Promise<TrackingResponse> {
  // Tracking::getTrackingSet: the checked statements, in the form's order
  const set = TRACKING_STATEMENTS.filter((s) => req.statements.includes(s)).join(',')
  const isView = await ctx.reader.isView(ctx.db, ctx.table)
  const t = requireTracking(ctx)
  const vctx = { ...ctx, control: t.conn, rp: t.rp }
  const ok = await createVersion(vctx, ctx.db, ctx.table, req.version, set, isView)
  if (!ok) return { messages: [] }
  return {
    messages: [
      success(
        sprintf(
          ctx.tr.gettext('Version %1$s was created, tracking for %2$s is active.'),
          req.version,
          `${ctx.db}.${ctx.table}`,
        ),
      ),
    ],
  }
}

/** pma: Tracking::deleteTracking */
async function deleteVersion(ctx: OpsCtx, version: string): Promise<boolean> {
  const t = requireTracking(ctx)
  return deleteTracking(t.conn, t.rp, ctx.db, ctx.table, version)
}

/** pma: TrackingController (submit_mult=delete_version) / Tracking::deleteTrackingVersion */
export async function deleteTrackingVersions(
  ctx: OpsCtx,
  req: In<typeof DeleteTrackingVersionsRequest>,
): Promise<TrackingResponse> {
  const { tr } = ctx
  if (req.multiple) {
    if (req.versions.length === 0)
      return { messages: [{ type: 'notice', text: tr.gettext('No versions selected.') }] }
    for (const v of req.versions) await deleteVersion(ctx, v)
    return { messages: [success(tr.gettext('Tracking versions deleted successfully.'))] }
  }
  const version = req.versions[0] ?? ''
  if (!(await deleteVersion(ctx, version))) return { messages: [] }
  return {
    messages: [
      success(sprintf(tr.gettext('Version %1$s of %2$s was deleted.'), version, `${ctx.db}.${ctx.table}`)),
    ],
  }
}

/** pma: Tracking::changeTracking (toggle_activation=activate_now / deactivate_now) */
export async function toggleTracking(
  ctx: OpsCtx,
  req: In<typeof ToggleTrackingRequest>,
): Promise<TrackingResponse> {
  const { tr } = ctx
  const activate = req.action === 'activate'
  const ok = await changeTracking(ctx, req.version, activate ? 1 : 0)
  if (!ok) return { messages: [] }
  const message = activate
    ? tr.gettext('Tracking for %1$s was activated at version %2$s.')
    : tr.gettext('Tracking for %1$s was deactivated at version %2$s.')
  return { messages: [success(sprintf(message, `${ctx.db}.${ctx.table}`, req.version))] }
}

// ---------------------------------------------------------------------------------------------
// Tracked data, report, exports
// ---------------------------------------------------------------------------------------------

/** pma: Tracking::getTrackedData, with the report's date range */
async function getTrackedData(ctx: OpsCtx, version: string): Promise<TrackedData> {
  const t = requireTracking(ctx)
  const row = await trackedRow(t.conn, t.rp, ctx.db, ctx.table, version)
  const { ddlog, dmlog } = row
  const now = formatDate(new Date())
  const ddlFrom = ddlog[0]?.date ?? now
  const ddlTo = ddlog.at(-1)?.date ?? now
  const dmlFrom = dmlog[0]?.date ?? ddlFrom
  const dmlTo = dmlog.at(-1)?.date ?? ddlTo
  return {
    dateFrom: strtotime(ddlFrom) <= strtotime(dmlFrom) ? ddlFrom : dmlFrom,
    dateTo: strtotime(ddlTo) >= strtotime(dmlTo) ? ddlTo : dmlTo,
    ddlog,
    dmlog,
    tracking: row.tracking,
    schemaSnapshot: row.snapshot,
  }
}

const matches = (e: LogEntry, users: string[], from: Date, to: Date) => {
  const d = parseDate(e.date)?.getTime() ?? Number.NaN
  return d >= from.getTime() && d <= to.getTime() && (users.includes('*') || users.includes(e.username))
}

/** pma: Tracking::getEntries (filter + array_multisort by timestamp, id, username, statement) */
function getEntries(data: TrackedData, users: string[], logType: TrackingLogType, from: Date, to: Date) {
  const filter = (log: LogEntry[]) =>
    log.flatMap((e, id) =>
      matches(e, users, from, to)
        ? [{ id, timestamp: strtotime(e.date), username: e.username, statement: e.statement }]
        : [],
    )
  const entries = [
    ...(logType !== 'data' ? filter(data.ddlog) : []),
    ...(logType !== 'schema' ? filter(data.dmlog) : []),
  ]
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  return entries.sort(
    (a, b) =>
      a.timestamp - b.timestamp ||
      a.id - b.id ||
      cmp(a.username, b.username) ||
      cmp(a.statement, b.statement),
  )
}

/** pma: Tracking::getHtmlForDataStatements: the rows shown, numbered from `lineNumber` */
function reportRows(
  log: LogEntry[],
  users: string[],
  from: Date,
  to: Date,
  lineNumber: number,
): [TrackingReportEntry[], number] {
  const offset = lineNumber
  const out: TrackingReportEntry[] = []
  let n = lineNumber
  for (const e of log) {
    if (matches(e, users, from, to)) out.push({ ...e, lineNumber: n, deleteId: n - offset })
    n++
  }
  return [out, n]
}

/** pma: TrackingController (report=true …) + Tracking::getHtmlForTrackingReport */
export async function trackingReport(
  ctx: OpsCtx,
  req: In<typeof TrackingReportRequest>,
): Promise<TrackingReportResponse> {
  const { tr } = ctx
  const messages: SqlMessage[] = []
  let data = await getTrackedData(ctx, req.version)
  const from = validateDateTimeParam(req.dateFrom ?? data.dateFrom)
  const to = validateDateTimeParam(req.dateTo ?? data.dateTo)
  const users = req.users
  const filterUsers = users.split(',').map((u) => u.trim())
  const out: Partial<TrackingReportResponse> = {}

  if (req.exportType !== undefined) {
    const entries = getEntries(data, filterUsers, req.logType, from, to)
    if (req.exportType === 'sqldumpfile') {
      // Tracking::getDownloadInfoForExport
      const table = ctx.table.replace(/\s+/g, ' ')
      let dump = `# ${sprintf(tr.gettext('Tracking report for table `%s`'), table)}\n# ${formatDateOffset(new Date())}\n`
      for (const e of entries) dump += e.statement
      out.download = { filename: `log_${table}.sql`, dump }
    } else if (req.exportType === 'execution') {
      // Tracking::exportAsSqlExecution
      try {
        for (const e of entries)
          await ctx.reader.conn.query(`/*NOTRACK*/\n${e.statement}`, 'tracking.execute')
        messages.push(success(tr.gettext('SQL statements executed.')))
      } catch (e) {
        if (!(e instanceof MysqlError)) throw e
        messages.push({ type: 'error', text: `#${e.extra.errno ?? 0} - ${e.message}` })
      }
    } else {
      // Tracking::exportAsSqlDump
      let dump = `# ${tr.gettext('You can execute the dump by creating and using a temporary database. Please ensure that you have the privileges to do so.')}\n# ${tr.gettext('Comment out these two lines if you do not need them.')}\n\nCREATE database IF NOT EXISTS pma_temp_db; \nUSE pma_temp_db; \n\n`
      for (const e of entries) dump += e.statement
      messages.push(success(tr.gettext('SQL statements exported. Please copy the dump or execute it.')))
      out.sqlDump = dump
    }
  }

  // Tracking::deleteFromTrackingReportLog
  const t = requireTracking(ctx)
  const del = async (log: LogEntry[], id: number, column: 'schema_sql' | 'data_sql', ok: string) => {
    const kept = log.filter((_, i) => i !== id)
    messages.push(
      (await changeTrackingData(t.conn, t.rp, ctx.db, ctx.table, req.version, column, kept))
        ? success(ok)
        : { type: 'error', text: tr.gettext('Query error') },
    )
    data = await getTrackedData(ctx, req.version)
  }
  if (req.deleteDdlog !== undefined) {
    await del(
      data.ddlog,
      req.deleteDdlog,
      'schema_sql',
      tr.gettext('Tracking data definition successfully deleted'),
    )
  } else if (req.deleteDmlog !== undefined) {
    await del(
      data.dmlog,
      req.deleteDmlog,
      'data_sql',
      tr.gettext('Tracking data manipulation successfully deleted'),
    )
  }

  // getHtmlForTrackingReportExportForm1 (operator precedence as upstream: a Structure-only report
  // shows the empty DDL table; DML numbering continues after the whole DDL log, or starts at 0)
  let ddl: TrackingReportEntry[] | null = null
  let ddlogCount = 0
  if (req.logType === 'schema' || (req.logType === 'schema_and_data' && data.ddlog.length > 0)) {
    ;[ddl, ddlogCount] = reportRows(data.ddlog, filterUsers, from, to, 1)
  }
  let dml: TrackingReportEntry[] | null = null
  if (req.logType !== 'schema' && data.dmlog.length > 0) {
    ;[dml] = reportRows(data.dmlog, filterUsers, from, to, ddlogCount)
  }
  return {
    messages,
    tracking: data.tracking,
    logType: req.logType,
    dateFrom: formatDate(from),
    dateTo: formatDate(to),
    users,
    ddl,
    dml,
    noData: data.ddlog.length === 0 && data.dmlog.length === 0,
    ...out,
  }
}

/** pma: Tracking::getHtmlForSchemaSnapshot */
export async function trackingSnapshot(ctx: OpsCtx, version: string): Promise<TrackingSnapshotResponse> {
  const data = await getTrackedData(ctx, version)
  let sql: string | null = null
  const first = data.ddlog[0]
  if (first !== undefined) {
    sql = first.statement
    if (first.statement.includes('DROP TABLE') || first.statement.includes('DROP VIEW')) {
      sql += data.ddlog[1]?.statement ?? ''
    }
  }
  const snap = phpUnserialize(data.schemaSnapshot) as {
    COLUMNS?: unknown
    INDEXES?: unknown
  } | null
  const list = (v: unknown) =>
    Array.isArray(v) ? v : v !== null && typeof v === 'object' ? Object.values(v) : []
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v))
  return {
    version,
    sql,
    columns: list(snap?.COLUMNS).map((c: Record<string, unknown>) => ({
      Field: String(c.Field ?? ''),
      Type: String(c.Type ?? ''),
      Collation: str(c.Collation),
      Null: String(c.Null ?? ''),
      Key: String(c.Key ?? ''),
      Default: str(c.Default),
      Extra: String(c.Extra ?? ''),
      Comment: String(c.Comment ?? ''),
    })),
    indexes: list(snap?.INDEXES).map((i: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(i).map(([k, v]) => [k, str(v)])),
    ),
  }
}
