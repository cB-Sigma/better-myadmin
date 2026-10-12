/**
 * Display chart and the GIS visualization of a query result: the form data (the result's columns,
 * the start / number of rows fieldset), the chart's rows (the query limited by the form) and the
 * GIS rows (the query wrapped in ST_ASTEXT / ST_SRID).
 *
 * pma: src/Controllers/Table/ChartController.php, src/Controllers/Table/GisVisualizationController.php,
 *      src/Gis/GisVisualization.php::modifySqlQuery / ::fetchRawData / ::hasSrid,
 *      src/Html/Generator.php::getStartAndNumberOfRowsFieldsetData
 */
import type {
  ChartDataRequest,
  ChartDataResponse,
  ChartPageResponse,
  GisPageRequest,
  GisPageResponse,
  RowsFieldset,
  VisualizationPageRequest,
} from '@bettermyadmin/contracts'
import { backquote } from '@bettermyadmin/sql-gen'
import { Limit, Parser, SelectStatement } from '@bettermyadmin/sql-lexer'
import type { z } from 'zod'
import type { AppConfig } from '../config.ts'
import type { ResultSet } from '../db/connection.ts'
import { MysqlError } from '../http/errors.ts'
import type { TableReader } from './read.ts'

interface VisCtx {
  reader: TableReader
  cfg: AppConfig
  tr: { gettext(s: string): string }
}

type PageIn = z.output<typeof VisualizationPageRequest>

/** DatabaseInterface::tryQuery + getFieldsMeta (null on a MySQL error) */
async function tryResult(ctx: VisCtx, sql: string, label: string): Promise<ResultSet | null> {
  try {
    const r = await ctx.reader.conn.query(sql, label)
    return r.resultSets[0] ?? { fields: [], rows: [] }
  } catch (e) {
    if (e instanceof MysqlError) return null
    throw e
  }
}

const text = (v: Buffer | null | undefined) => (v === null || v === undefined ? null : v.toString('utf8'))

/** fetchAssoc / fetchAllAssoc: by column name, a later duplicate name overwriting the earlier */
function assoc(set: ResultSet, row: Array<Buffer | null>): Record<string, string | null> {
  const o: Record<string, string | null> = {}
  set.fields.forEach((f, i) => {
    o[f.name] = text(row[i])
  })
  return o
}

/**
 * Generator::getStartAndNumberOfRowsFieldsetData. phpMyAdmin falls back to the session's
 * `tmpval` (the last displayed result's pos / max_rows); the results' links pass them instead.
 */
function fieldset(cfg: AppConfig, req: PageIn): RowsFieldset {
  const rows = req.sessionMaxRows ?? cfg.MaxRows
  const n = req.unlimNumRows
  const pos = req.pos ?? (Math.ceil(n / rows) - 1) * rows
  return { pos, rows, unlimNumRows: n, sql: req.sql }
}

/** ChartController (the page): the keys of the first row and their types */
export async function chartPage(ctx: VisCtx, req: PageIn): Promise<ChartPageResponse> {
  const { tr } = ctx
  if (req.sql === '')
    return { error: tr.gettext('No SQL query was set to fetch data.'), columns: [], fieldset: null }
  const set = await tryResult(ctx, req.sql, 'chart.page')
  const first = set?.rows[0]
  const keys = set === null || first === undefined ? [] : Object.keys(assoc(set, first))
  // $fieldsMeta[$idx] of the keys' positions
  const columns = keys.map((name, idx) => {
    const f = set?.fields[idx]
    const m = f?.mappedType ?? ''
    return {
      name,
      numeric: m === 'int' || m === 'real',
      dateTime: m === 'date' || m === 'time' || m === 'datetime' || m === 'timestamp',
    }
  })
  if (!columns.some((c) => c.numeric)) {
    return {
      error: tr.gettext('No numeric columns present in the table to plot.'),
      columns: [],
      fieldset: null,
    }
  }
  return { error: null, columns, fieldset: fieldset(ctx.cfg, req) }
}

/** ChartController::ajax: the query with the form's LIMIT, every row */
export async function chartData(
  ctx: VisCtx,
  req: z.output<typeof ChartDataRequest>,
): Promise<ChartDataResponse> {
  const statement = new Parser(req.sql).statements[0]
  const noData = { error: ctx.tr.gettext('No data to display'), data: [] }
  if (!(statement instanceof SelectStatement)) return noData
  if (statement.limit === null) {
    statement.limit = new Limit(req.sessionMaxRows, req.pos)
  } else {
    const start = Number(statement.limit.offset) + req.pos
    const rows = Math.min(req.sessionMaxRows, Number(statement.limit.rowCount) - req.pos)
    statement.limit = new Limit(rows, start)
  }
  const set = await tryResult(ctx, statement.build(), 'chart.data')
  const data = set === null ? [] : set.rows.map((r) => assoc(set, r))
  if (data.length === 0) return noData
  return { error: null, data }
}

/** GisVisualizationController::getCandidateColumns: the result's columns of `LIMIT 0, 0` */
async function candidates(ctx: VisCtx, sql: string): Promise<{ label: string[]; spatial: string[] }> {
  const statement = new Parser(sql).statements[0]
  if (!(statement instanceof SelectStatement)) return { label: [], spatial: [] }
  statement.limit = new Limit(0, 0)
  const set = await tryResult(ctx, statement.build(), 'gis.columns')
  const label: string[] = []
  const spatial: string[] = []
  for (const f of set?.fields ?? []) (f.mappedType === 'geometry' ? spatial : label).push(f.name)
  return { label, spatial }
}

/** GisVisualization::modifySqlQuery */
function modifySqlQuery(
  sql: string,
  o: { spatialColumn: string; labelColumn: string; rows: number; pos: number },
  server: { versionInt: number; isMariaDb: boolean },
): string {
  let q = 'SELECT '
  let asText = 'ASTEXT'
  let srid = 'SRID'
  let axisOrder = ''
  if (server.versionInt >= 50600) {
    asText = 'ST_ASTEXT'
    srid = 'ST_SRID'
  }
  // If MYSQL version >= 8.0.1 override default axis order
  if (server.versionInt >= 80001 && !server.isMariaDb) axisOrder = ", 'axis-order=long-lat'"
  if (o.labelColumn !== '') q += `${backquote(o.labelColumn)}, `
  q += `${asText}(${backquote(o.spatialColumn)}${axisOrder}) AS ${backquote(o.spatialColumn)}, `
  q += `${srid}(${backquote(o.spatialColumn)}) AS ${backquote('srid')} `
  q += `FROM (${sql.replace(/;+$/, '')}) AS ${backquote('temp_gis')}`
  if (o.rows > 0) q += ` LIMIT ${o.pos > 0 ? `${o.pos}, ` : ''}${o.rows}`
  return q
}

/** GisVisualizationController (the page and the redraw) */
export async function gisPage(ctx: VisCtx, req: z.output<typeof GisPageRequest>): Promise<GisPageResponse> {
  const { tr } = ctx
  const empty: GisPageResponse = {
    error: null,
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
  if (req.sql === '') return { ...empty, error: tr.gettext('No SQL query was set to fetch data.') }
  const c = await candidates(ctx, req.sql)
  if (c.spatial.length === 0)
    return { ...empty, error: tr.gettext('No spatial column found for this SQL query.') }
  // getVisualizationSettings: the posted columns when they are candidates
  const labelColumn =
    req.labelColumn !== undefined && c.label.includes(req.labelColumn) ? req.labelColumn : ''
  const spatialColumn =
    req.spatialColumn !== undefined && c.spatial.includes(req.spatialColumn)
      ? req.spatialColumn
      : (c.spatial[0] ?? '')
  // getRows / getPos: the posted values, else the session's (here: $cfg['MaxRows'] and 0)
  const rows = req.sessionMaxRows ?? ctx.cfg.MaxRows
  const pos = req.pos ?? 0
  const info = ctx.reader.conn.serverInfo
  const sql = modifySqlQuery(
    req.sql,
    { spatialColumn, labelColumn, rows, pos },
    { versionInt: info?.versionInt ?? 0, isMariaDb: info?.isMariaDb ?? false },
  )
  const set = await tryResult(ctx, sql, 'gis.data')
  const data = set === null ? [] : set.rows.map((r) => assoc(set, r))
  const out = data.map((r) => ({
    wkt: r[spatialColumn] ?? null,
    srid: Number.parseInt(r.srid ?? '0', 10) || 0,
    label: (r[labelColumn] ?? '').trim(),
  }))
  return {
    error: null,
    labelCandidates: c.label,
    spatialCandidates: c.spatial,
    spatialColumn,
    labelColumn,
    width: 600,
    height: 450,
    fieldset: fieldset(ctx.cfg, req),
    rows: out,
    hasSrid: out.some((r) => r.srid !== 0),
  }
}
