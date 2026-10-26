import { z } from 'zod'

/**
 * Display chart and the GIS visualization of a query result (the "Query results operations"
 * links). Mounted at /api/servers/:s/databases/:db/tables/:t/{chart,gis}….
 *
 * pma: src/Controllers/Table/ChartController.php, src/Controllers/Table/GisVisualizationController.php,
 *      src/Html/Generator.php::getStartAndNumberOfRowsFieldsetData
 */

/** table/start_and_number_of_rows_fieldset.twig */
export const RowsFieldset = z.object({
  pos: z.number().int(),
  rows: z.number().int(),
  unlimNumRows: z.number().int(),
  sql: z.string(),
  /** the signature of `sql` for the form's requests */
  sig: z.string(),
})
export type RowsFieldset = z.infer<typeof RowsFieldset>

/** the page request: the query of the results and the fieldset's parameters */
export const VisualizationPageRequest = z.object({
  sql: z.string().default(''),
  /**
   * The signature of `sql` (Core::signSqlQuery). The links carry the query in the URL, so the
   * page sends it; when present it must verify, else the query is dropped ("No SQL query was set").
   */
  sig: z.string().optional(),
  /** `pos` (absent: the session's, else the last page) */
  pos: z.coerce.number().int().optional(),
  /** `session_max_rows` (absent: $cfg['MaxRows']) */
  sessionMaxRows: z.coerce.number().int().optional(),
  /** `unlim_num_rows` */
  unlimNumRows: z.coerce.number().int().default(0),
})
export type VisualizationPageRequest = z.input<typeof VisualizationPageRequest>

export const ChartColumn = z.object({
  name: z.string(),
  /** FieldMetadata::isNumeric (INT or REAL) */
  numeric: z.boolean(),
  /** FieldMetadata::isDateTimeType (DATE, TIME, DATETIME, TIMESTAMP) */
  dateTime: z.boolean(),
})

/** POST …/chart: the form's columns (the keys of the query's first row) */
export const ChartPageResponse = z.object({
  /** "No SQL query was set to fetch data." / "No numeric columns present in the table to plot." */
  error: z.string().nullable(),
  columns: z.array(ChartColumn),
  fieldset: RowsFieldset.nullable(),
})
export type ChartPageResponse = z.infer<typeof ChartPageResponse>

/** POST …/chart/data (the form's ajax submit: pos, session_max_rows) */
export const ChartDataRequest = z.object({
  sql: z.string(),
  /** as VisualizationPageRequest.sig: when present it must verify */
  sig: z.string().optional(),
  pos: z.coerce.number().int().default(0),
  sessionMaxRows: z.coerce.number().int().default(0),
})
export type ChartDataRequest = z.input<typeof ChartDataRequest>

export const ChartDataResponse = z.object({
  /** "No data to display" (or the parser's error) */
  error: z.string().nullable(),
  /** fetchAllAssoc: one object per row, by column name */
  data: z.array(z.record(z.string(), z.string().nullable())),
})
export type ChartDataResponse = z.infer<typeof ChartDataResponse>

/** POST …/gis: the candidates, the settings and the rows of the visualization */
export const GisPageRequest = VisualizationPageRequest.extend({
  spatialColumn: z.string().optional(),
  labelColumn: z.string().optional(),
})
export type GisPageRequest = z.input<typeof GisPageRequest>

export const GisPageResponse = z.object({
  /** "No SQL query was set to fetch data." / "No spatial column found for this SQL query." */
  error: z.string().nullable(),
  labelCandidates: z.array(z.string()),
  spatialCandidates: z.array(z.string()),
  spatialColumn: z.string(),
  /** '' for none */
  labelColumn: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  fieldset: RowsFieldset.nullable(),
  /** the rows of the modified query: WKT (ST_ASTEXT), SRID and the label */
  rows: z.array(z.object({ wkt: z.string().nullable(), srid: z.number().int(), label: z.string() })),
  /** GisVisualization::hasSrid (OpenStreetMaps as the initial base layer) */
  hasSrid: z.boolean(),
})
export type GisPageResponse = z.infer<typeof GisPageResponse>
