import { phpFloatToString, sprintf } from '@bettermyadmin/i18n'

/**
 * What the relational schema plugins read about one table (TableStats::__construct) and its
 * relations, collected by the server so the plugins stay pure.
 * pma: src/Plugins/Schema/TableStats.php, ExportRelationSchema.php
 */
export interface SchemaTableData {
  name: string
  /** getColumnNames */
  columns: string[]
  /** the columns of every index, in Index::getFromTable order (for "Only show keys") */
  indexColumns: string[]
  /** SHOW INDEX … Key_name = PRIMARY */
  primary: string[]
  /** Relation::getDisplayField */
  displayField: string
  /** Relation::getForeignersInternal, keyed by master field in its order */
  internal: Array<{ masterField: string; foreignTable: string; foreignField: string }>
  /** Relation::getForeignKeysData */
  foreignKeys: Array<{ refTableName: string | null; indexList: string[]; refIndexList: string[] }>
}

export interface SchemaRequest {
  db: string
  /** page_number */
  pageNumber: number
  /** t_tbl[] decoded, in request order (duplicates kept) */
  tables: string[]
  /** t_h keys with their t_db / t_tbl / t_x / t_y */
  coordinates: Array<{ db: string; table: string; x: number; y: number }>
  /** the format-specific options (`svg_show_color`, `eps_orientation`, …) */
  options: Record<string, string>
  /** getFileName: the page name, else the database name */
  fileBase: string
  /** the author / creator line (phpMyAdmin: `'phpMyAdmin ' . Version::VERSION`) */
  creator: string
  /** Randomizer for "Show color" */
  random?: () => number
  /** date('j F Y, g:i a') for the EPS creation date */
  date?: string
  /** `Schema of the %s database - Page %s` (translated) */
  titleFormat: string
}

export interface SchemaResult {
  fileName: string
  mediaType: string
  data: string
}

/** (string) $float */
export const floatStr = (n: number): string => phpFloatToString(n)

/** TableStats::loadCoordinates */
export function coordinatesOf(req: SchemaRequest, table: string): { x: number; y: number } {
  for (const c of req.coordinates)
    if (`${req.db}.${table}` === `${c.db}.${c.table}`) return { x: c.x, y: c.y }
  return { x: 0, y: 0 }
}

/** TableStats::validateTableAndLoadFields (showKeys: the unique index columns) */
export function shownFields(t: SchemaTableData, showKeys: boolean): string[] {
  return showKeys ? [...new Set(t.indexColumns)] : t.columns
}

/** TableStats::getTitle: sprintf('%.0fx%0.f', width, heightCell) . ' ' . name */
export function titleOf(name: string, width: number, heightCell: number, tableDimension: boolean): string {
  return `${tableDimension ? `${width.toFixed(0)}x${heightCell.toFixed(6)}` : ''} ${name}`
}

/** sprintf(__('Schema of the %s database - Page %s'), db, page) */
export const titleLine = (req: SchemaRequest) => sprintf(req.titleFormat, req.db, req.pageNumber)

/** a key of a list (Randomizer::pickArrayKeys($list, 1)[0]) */
export const pick = <T>(req: SchemaRequest, list: readonly T[]): T =>
  list[Math.floor((req.random ?? Math.random)() * list.length)] as T

/** RelationStats: the source/destination sides and anchor points of a relation line */
export interface RelationEnds {
  xSrc: number
  ySrc: number
  srcDir: number
  xDest: number
  yDest: number
  destDir: number
}

interface Placed {
  x: number
  y: number
  width: number
  heightCell: number
  fields: string[]
}

/** RelationStats::__construct */
export function relationEnds(
  master: Placed,
  masterField: string,
  foreign: Placed,
  foreignField: string,
  wTick: number,
): RelationEnds {
  const xy = (t: Placed, column: string): [number, number, number] => {
    const pos = t.fields.indexOf(column)
    // array_search: false (0 in arithmetic) when the column is not shown
    const p = pos === -1 ? 0 : pos
    return [t.x, t.x + t.width, t.y + (p + 1.5) * t.heightCell]
  }
  const src = xy(master, masterField)
  const dest = xy(foreign, foreignField)
  const srcLeft = src[0] - wTick
  const srcRight = src[1] + wTick
  const destLeft = dest[0] - wTick
  const destRight = dest[1] + wTick
  const d1 = Math.abs(srcLeft - destLeft)
  const d2 = Math.abs(srcRight - destLeft)
  const d3 = Math.abs(srcLeft - destRight)
  const d4 = Math.abs(srcRight - destRight)
  const d = Math.min(d1, d2, d3, d4)
  let e: Omit<RelationEnds, 'ySrc' | 'yDest'>
  if (d === d1) e = { xSrc: src[0], srcDir: -1, xDest: dest[0], destDir: -1 }
  else if (d === d2) e = { xSrc: src[1], srcDir: 1, xDest: dest[0], destDir: -1 }
  else if (d === d3) e = { xSrc: src[0], srcDir: -1, xDest: dest[1], destDir: 1 }
  else e = { xSrc: src[1], srcDir: 1, xDest: dest[1], destDir: 1 }
  return { ...e, ySrc: src[2], yDest: dest[2] }
}

/**
 * The relations the plugins draw, in their order: for each requested table (duplicates too) its
 * internal relations then its FOREIGN KEY columns, when the other table was requested as well.
 * `skipWithoutInternal`: SvgRelationSchema skips a table without internal relations entirely (its
 * FOREIGN KEYs too).
 */
export function relationsOf(
  req: SchemaRequest,
  data: ReadonlyMap<string, SchemaTableData>,
  skipWithoutInternal: boolean,
): {
  seen: boolean
  list: Array<{ master: string; masterField: string; foreign: string; foreignField: string }>
} {
  const list: Array<{ master: string; masterField: string; foreign: string; foreignField: string }> = []
  let seen = false
  for (const one of req.tables) {
    const t = data.get(one)
    if (t === undefined) continue
    if (skipWithoutInternal && t.internal.length === 0) continue
    seen = true
    for (const r of t.internal) {
      if (!req.tables.includes(r.foreignTable)) continue
      list.push({
        master: one,
        masterField: r.masterField,
        foreign: r.foreignTable,
        foreignField: r.foreignField,
      })
    }
    for (const k of t.foreignKeys) {
      if (k.refTableName === null || !req.tables.includes(k.refTableName)) continue
      k.indexList.forEach((field, i) => {
        list.push({
          master: one,
          masterField: field,
          foreign: k.refTableName ?? '',
          foreignField: k.refIndexList[i] ?? '',
        })
      })
    }
  }
  return { seen, list }
}
