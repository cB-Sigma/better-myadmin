import { z } from 'zod'
import { SqlMessage } from './table-structure.ts'

/**
 * Table Tracking tab (docs/features/04-table-level.md#tracking): versions, activation, the report
 * with its filters and exports, the structure snapshot. Mounted at
 * /api/servers/:s/databases/:db/tables/:t/tracking…
 *
 * pma: src/Controllers/Table/TrackingController.php, src/Tracking/Tracking.php
 */

export const TrackingVersion = z.object({
  version: z.string(),
  dateCreated: z.string(),
  dateUpdated: z.string(),
  active: z.boolean(),
})
export type TrackingVersion = z.infer<typeof TrackingVersion>

/** The statements of create_tracking_version.twig, in its order. */
export const TRACKING_STATEMENTS = [
  'ALTER TABLE',
  'RENAME TABLE',
  'CREATE TABLE',
  'DROP TABLE',
  'ALTER VIEW',
  'CREATE VIEW',
  'DROP VIEW',
  'CREATE INDEX',
  'DROP INDEX',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
] as const
export const TrackingStatement = z.enum(TRACKING_STATEMENTS)
export type TrackingStatement = z.infer<typeof TrackingStatement>

export const TrackingPageResponse = z.object({
  db: z.string(),
  table: z.string(),
  type: z.enum(['table', 'view']),
  /** the configuration storage has a tracking table (Tracker::isActive) */
  available: z.boolean(),
  /** "Tracking of %s is activated." */
  activeMessage: z.boolean(),
  /** the select of tracked tables of the database (TrackingChecker::getTrackedTables) */
  trackedTables: z.array(z.object({ name: z.string(), active: z.boolean() })),
  /** 0 when the table has no version */
  lastVersion: z.number().int(),
  /** newest first */
  versions: z.array(TrackingVersion),
  /** $cfg['Servers'][$i]['tracking_default_statements'] */
  defaultStatements: z.string(),
})
export type TrackingPageResponse = z.infer<typeof TrackingPageResponse>

export const CreateTrackingVersionRequest = z.object({
  version: z.string().min(1),
  statements: z.array(TrackingStatement),
})
export type CreateTrackingVersionRequest = z.infer<typeof CreateTrackingVersionRequest>

/** submit_delete_version (one version, from its row) or submit_mult=delete_version */
export const DeleteTrackingVersionsRequest = z.object({
  versions: z.array(z.string()),
  multiple: z.boolean(),
})
export type DeleteTrackingVersionsRequest = z.infer<typeof DeleteTrackingVersionsRequest>

export const ToggleTrackingRequest = z.object({
  version: z.string().min(1),
  action: z.enum(['activate', 'deactivate']),
})
export type ToggleTrackingRequest = z.infer<typeof ToggleTrackingRequest>

export const TrackingLogType = z.enum(['schema', 'data', 'schema_and_data'])
export type TrackingLogType = z.infer<typeof TrackingLogType>

export const TrackingReportRequest = z.object({
  version: z.string().min(1),
  logType: TrackingLogType.default('schema_and_data'),
  /** 'Y-m-d H:i:s'; omitted: the dates of the first and last entries */
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  /** comma-separated user names, '*' for all */
  users: z.string().default('*'),
  /** delete_ddlog / delete_dmlog: the index of the entry in its log */
  deleteDdlog: z.number().int().min(0).optional(),
  deleteDmlog: z.number().int().min(0).optional(),
  exportType: z.enum(['sqldumpfile', 'sqldump', 'execution']).optional(),
})
export type TrackingReportRequest = z.infer<typeof TrackingReportRequest>

export const TrackingReportEntry = z.object({
  /** the # column (DDL entries count from 1, DML entries continue after them) */
  lineNumber: z.number().int(),
  /** delete_ddlog / delete_dmlog value of the row's Delete link */
  deleteId: z.number().int(),
  date: z.string(),
  username: z.string(),
  statement: z.string(),
})
export type TrackingReportEntry = z.infer<typeof TrackingReportEntry>

export const TrackingReportResponse = z.object({
  messages: z.array(SqlMessage),
  /** the `tracking` column: "Tracking statements …" */
  tracking: z.string(),
  logType: TrackingLogType,
  dateFrom: z.string(),
  dateTo: z.string(),
  users: z.string(),
  /** null when the log type hides the table (or, for DML, when the log is empty) */
  ddl: z.array(TrackingReportEntry).nullable(),
  dml: z.array(TrackingReportEntry).nullable(),
  /** both logs are empty ("No data") */
  noData: z.boolean(),
  /** export_type=sqldump: the dump for the SQL query box */
  sqlDump: z.string().optional(),
  /** export_type=sqldumpfile */
  download: z.object({ filename: z.string(), dump: z.string() }).optional(),
})
export type TrackingReportResponse = z.infer<typeof TrackingReportResponse>

export const TrackingSnapshotResponse = z.object({
  version: z.string(),
  /** the DROP + CREATE statements of the version's first log entries, null when the log is empty */
  sql: z.string().nullable(),
  columns: z.array(
    z.object({
      Field: z.string(),
      Type: z.string(),
      Collation: z.string().nullable(),
      Null: z.string(),
      Key: z.string(),
      Default: z.string().nullable(),
      Extra: z.string(),
      Comment: z.string(),
    }),
  ),
  indexes: z.array(z.record(z.string(), z.string().nullable())),
})
export type TrackingSnapshotResponse = z.infer<typeof TrackingSnapshotResponse>

export const TrackingResponse = z.object({ messages: z.array(SqlMessage) })
export type TrackingResponse = z.infer<typeof TrackingResponse>
