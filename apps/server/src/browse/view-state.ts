import { createHash } from 'node:crypto'
import type { BrowseRequest, GridView } from '@bettermyadmin/contracts'
import type { SessionData } from '../session/store.ts'

/** The view parameters of a /sql request (session_max_rows, pos, pftext, … as posted). */
export type ViewParams = Pick<
  BrowseRequest,
  | 'pos'
  | 'maxRows'
  | 'pftext'
  | 'relationalDisplay'
  | 'geoOption'
  | 'displayBinary'
  | 'displayBlob'
  | 'hideTransformation'
  | 'displayOptionsForm'
  | 'fullTextButton'
>

interface QueryState {
  sql: string
  repeat_cells?: number
  max_rows?: number | 'all'
  pos?: number
  pftext?: 'P' | 'F'
  relational_display?: 'K' | 'D'
  geoOption?: 'GEOM' | 'WKT' | 'WKB'
  display_binary?: true
  display_blob?: true
  hide_transformation?: true
}

/** PHP empty() for the stored values */
const empty = (v: unknown) => v === undefined || v === null || v === 0 || v === '' || v === false

/**
 * The per-query grid state remembered for the last 10 queries, keyed by md5(server . db . sql).
 * pma: src/Display/Results.php::setConfigParamsForDisplayTable
 */
export function resolveViewState(
  session: SessionData,
  server: number,
  db: string,
  sql: string,
  isExplain: boolean,
  p: ViewParams,
  cfg: { RepeatCells: number; MaxRows: number; RelationalDisplay: string },
): Omit<GridView, 'possibleAsGeometry'> {
  const md5 = createHash('md5').update(`${server}${db}${sql}`).digest('hex')
  session.gridQueries ??= {}
  const all = session.gridQueries
  const query: QueryState = { ...((all[md5] as unknown as QueryState | undefined) ?? {}), sql }

  if (empty(query.repeat_cells)) query.repeat_cells = cfg.RepeatCells
  if (typeof p.maxRows === 'number') query.max_rows = p.maxRows
  else if (p.maxRows === 'all') query.max_rows = 'all'
  else if (empty(query.max_rows)) query.max_rows = cfg.MaxRows

  if (p.pos !== undefined) query.pos = p.pos
  else if (empty(query.pos)) query.pos = 0

  // Full text is needed in case of explain statements, if not specified.
  if (p.pftext !== undefined) query.pftext = p.pftext
  else if (isExplain) query.pftext = 'F'
  else if (empty(query.pftext)) query.pftext = 'P'

  if (p.relationalDisplay !== undefined) query.relational_display = p.relationalDisplay
  else if (empty(query.relational_display)) {
    // The current session value has priority over a change via Settings
    query.relational_display = cfg.RelationalDisplay === 'D' ? 'D' : 'K'
  }

  if (p.geoOption !== undefined) query.geoOption = p.geoOption
  else if (empty(query.geoOption)) query.geoOption = 'GEOM'

  if (p.displayBinary === true) query.display_binary = true
  else if (p.displayOptionsForm === true) delete query.display_binary
  else if (p.fullTextButton !== true) {
    // selected by default because some operations like OPTIMIZE TABLE and all queries involving
    // functions return "binary" contents, according to low-level field flags
    query.display_binary = true
  }

  if (p.displayBlob === true) query.display_blob = true
  else if (p.displayOptionsForm === true) delete query.display_blob

  if (p.hideTransformation === true) query.hide_transformation = true
  else if (p.displayOptionsForm === true) delete query.hide_transformation

  // move the current query to the last position; at most 10 queries are remembered
  delete all[md5]
  all[md5] = query as unknown as Record<string, unknown>
  const keys = Object.keys(all)
  if (keys.length > 10) delete all[keys[0]!]

  return {
    pos: query.pos ?? 0,
    maxRows: query.max_rows ?? cfg.MaxRows,
    pftext: query.pftext ?? 'P',
    relationalDisplay: query.relational_display ?? 'K',
    geoOption: query.geoOption ?? 'GEOM',
    displayBinary: query.display_binary === true,
    displayBlob: query.display_blob === true,
    hideTransformation: query.hide_transformation === true,
    repeatCells: query.repeat_cells ?? cfg.RepeatCells,
  }
}
