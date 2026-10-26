import { z } from 'zod'

/**
 * Server › Status › Monitor (/server/status/monitor*): the page facts MonitorController puts in
 * `#js_data` and `window.variableNames`, and the AJAX endpoints of monitor.ts with phpMyAdmin's
 * request fields and answers (the `message` of its JSON). The browser polls the chart endpoint like
 * phpMyAdmin (one request per refresh, `requiredData` = the JSON of the chart grid's data points).
 * docs/features/06-server-level.md#status--monitor-serverstatusmonitor
 */

export const MonitorPage = z.object({
  /** `server_time`: the server clock in ms (the client keeps the difference to its own) */
  serverTime: z.number(),
  /** SysInfo::getOs(): `Linux`, `WINNT`, `SunOS`, else the OS name */
  serverOs: z.string(),
  isSuperUser: z.boolean(),
  /** Data::$dbIsLocal: the database host is localhost / 127.0.0.1 / ::1 */
  serverDbIsLocal: z.boolean(),
  /** the numeric status variables, sorted (the add-chart autocomplete) */
  variableNames: z.array(z.string()),
})
export type MonitorPage = z.infer<typeof MonitorPage>

/** A data point of the chart grid (monitor.ts `dataPoints`); the answer adds value or busy/idle. */
export const MonitorDataPoint = z
  .object({
    type: z.string(),
    name: z.string(),
    value: z.union([z.string(), z.number()]).nullable().optional(),
    busy: z.number().optional(),
    idle: z.number().optional(),
  })
  .passthrough()
export type MonitorDataPoint = z.infer<typeof MonitorDataPoint>

/** `requiredData`: chart id → node → data points, as JSON text (runtime.dataList) */
export const MonitorChartRequest = z.object({ requiredData: z.string().default('') })
export type MonitorChartRequest = z.input<typeof MonitorChartRequest>

/** The same structure with the values filled in, plus `x`: the server time of the reading in ms. */
export const MonitorChartResponse = z.object({
  message: z.record(z.string(), z.union([z.array(z.array(MonitorDataPoint)), z.number()])),
})
export type MonitorChartResponse = z.infer<typeof MonitorChartResponse>

export const MonitorLogRequest = z.object({
  time_start: z.string().default('0'),
  time_end: z.string().default('0'),
  /** general log only: SELECT, INSERT, UPDATE and DELETE statements only */
  limitTypes: z.string().optional(),
  /** general log only: consecutive INSERTs into one table are grouped */
  removeVariables: z.string().optional(),
})
export type MonitorLogRequest = z.input<typeof MonitorLogRequest>

/** The grouped log rows (columns as selected, `#` last), per statement type sums and TOTAL. */
export const MonitorLogResponse = z.object({
  /** false when the log query failed (phpMyAdmin answers `success: false`) */
  success: z.boolean(),
  message: z
    .object({
      rows: z.array(z.record(z.string(), z.string().nullable())),
      sum: z.record(z.string(), z.number()),
      numRows: z.number().int(),
    })
    .nullable(),
})
export type MonitorLogResponse = z.infer<typeof MonitorLogResponse>

/** log-vars: optionally `SET GLOBAL varName = varValue` first */
export const MonitorLogVarsRequest = z.object({
  varName: z.string().optional(),
  varValue: z.string().optional(),
})
export type MonitorLogVarsRequest = z.input<typeof MonitorLogVarsRequest>

export const MonitorLogVarsResponse = z.object({ message: z.record(z.string(), z.string()) })
export type MonitorLogVarsResponse = z.infer<typeof MonitorLogVarsResponse>

export const MonitorQueryRequest = z.object({
  database: z.string().default(''),
  query: z.string().default(''),
})
export type MonitorQueryRequest = z.input<typeof MonitorQueryRequest>

/** The query analyzer: affected rows, EXPLAIN rows, the last error, the profile (when supported). */
export const MonitorQueryResponse = z.object({
  message: z.object({
    affectedRows: z.number(),
    explain: z.array(z.record(z.string(), z.string().nullable())).optional(),
    error: z.string(),
    profiling: z.array(z.record(z.string(), z.string().nullable())).optional(),
  }),
})
export type MonitorQueryResponse = z.infer<typeof MonitorQueryResponse>
