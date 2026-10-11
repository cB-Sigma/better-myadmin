/**
 * The "query by example" of the table Search tab and the Zoom search.
 *
 * pma: src/Table/Search.php::buildSqlQuery/generateWhereClause/getWhereClause/getGeomWhereClause/
 *      getEnumWhereClause, src/Utils/Gis.php::getFunctions/createData/getDataTypes
 */
import { backquote, quoteString } from './quote.ts'

export const GIS_DATA_TYPES: readonly string[] = [
  'geometry',
  'point',
  'linestring',
  'polygon',
  'multipoint',
  'multilinestring',
  'multipolygon',
  'geometrycollection',
]

export interface GisFunction {
  name: string
  params: number
  type: string
}

/**
 * pma: Gis::getFunctions($geomType, $binary, $display) — with `display`, separator entries have
 * params 0 and the display text as name (' ' first, then '--------').
 */
export function getGisFunctions(
  geomType: string | null,
  binary: boolean,
  display: boolean,
  version: number,
): GisFunction[] {
  const out: GisFunction[] = []
  const sep = (name: string) => out.push({ name, params: 0, type: '' })
  const add = (name: string, params: number, type: string) => {
    const i = out.findIndex((f) => f.params > 0 && f.name === name)
    if (i >= 0) out[i] = { name, params, type }
    else out.push({ name, params, type })
  }
  if (display) sep(' ')
  add('Dimension', 1, 'int')
  add('Envelope', 1, 'Polygon')
  add('GeometryType', 1, 'text')
  add('SRID', 1, 'int')
  add('IsEmpty', 1, 'int')
  add('IsSimple', 1, 'int')
  const g = (geomType ?? '').trim().toLowerCase()
  if (display && g !== 'geometry' && g !== 'multipoint') sep('--------')
  const st = version >= 50601 ? 'ST_' : ''
  if (g === 'point') {
    add(`${st}X`, 1, 'float')
    add(`${st}Y`, 1, 'float')
  } else if (g === 'linestring') {
    add('EndPoint', 1, 'point')
    add('GLength', 1, 'float')
    add('NumPoints', 1, 'int')
    add('StartPoint', 1, 'point')
    add('IsRing', 1, 'int')
  } else if (g === 'multilinestring') {
    add('GLength', 1, 'float')
    add('IsClosed', 1, 'int')
  } else if (g === 'polygon') {
    add('Area', 1, 'float')
    add('ExteriorRing', 1, 'linestring')
    add('NumInteriorRings', 1, 'int')
  } else if (g === 'multipolygon') {
    add('Area', 1, 'float')
    add('Centroid', 1, 'point')
  } else if (g === 'geometrycollection') {
    add('NumGeometries', 1, 'int')
  }
  if (binary) {
    if (display) sep('--------')
    for (const f of [
      'Crosses',
      'Contains',
      'Disjoint',
      'Equals',
      'Intersects',
      'Overlaps',
      'Touches',
      'Within',
    ]) {
      add(`${st}${f}`, 2, 'int')
    }
    if (display) sep('--------')
    for (const f of ['Contains', 'Disjoint', 'Equals', 'Intersects', 'Overlaps', 'Touches', 'Within']) {
      add(`MBR${f}`, 2, 'int')
    }
  }
  return out
}

/** pma: Gis::createData */
export function createGisData(gisString: string, version: number): string {
  const fromText = version >= 50600 ? 'ST_GeomFromText' : 'GeomFromText'
  const s = gisString.trim()
  const types = '(POINT|MULTIPOINT|LINESTRING|MULTILINESTRING|POLYGON|MULTIPOLYGON|GEOMETRYCOLLECTION)'
  if (new RegExp(`^'${types}\\(.*\\)',[0-9]*$`, 'is').test(s)) return `${fromText}(${s})`
  if (new RegExp(`^${types}\\(.*\\)$`, 'is').test(s)) return `${fromText}('${s}')`
  return s
}

export interface SearchCriterion {
  name: string
  /** criteriaColumnTypes[i] (lower-cased display type) */
  type: string
  operator: string
  /** a string, or the selected options of an ENUM select */
  value: string | readonly string[]
  geomFunc?: string | undefined
}

export interface SearchQueryInput {
  table: string
  distinct?: boolean
  /** null = SELECT * (displayAllColumns / zoom_submit) */
  columns: readonly string[] | null
  customWhere?: string
  criteria: readonly SearchCriterion[]
  /** '--nil--' or '' = none */
  orderBy?: string
  order?: string
  version: number
}

const UNARY = ['IS NULL', 'IS NOT NULL', "= ''", "!= ''"]

/** pma: Search::buildSqlQuery */
export function buildSearchQuery(input: SearchQueryInput): string {
  let sql = 'SELECT '
  if (input.distinct === true) sql += 'DISTINCT '
  sql += input.columns === null ? '*' : input.columns.map((c) => backquote(c)).join(', ')
  sql += ` FROM ${backquote(input.table)}`
  sql += whereClause(input)
  if (input.orderBy !== undefined && input.orderBy !== '' && input.orderBy !== '--nil--') {
    sql += ` ORDER BY ${backquote(input.orderBy)} ${input.order ?? 'ASC'}`
  }
  return sql
}

function whereClause(input: SearchQueryInput): string {
  if (input.customWhere !== undefined && input.customWhere.trim() !== '') return ` WHERE ${input.customWhere}`
  const parts: string[] = []
  for (const c of input.criteria) {
    const w = criterionClause(c, input.version)
    if (w !== '') parts.push(w)
  }
  return parts.length > 0 ? ` WHERE ${parts.join(' AND ')}` : ''
}

const loose = (v: string | readonly string[]) =>
  typeof v === 'string' ? v !== '' && v !== '0' : v.length > 0

/** pma: Search::getWhereClause */
export function criterionClause(c: SearchCriterion, version: number): string {
  if (c.geomFunc !== undefined && c.geomFunc !== '') return geomClause(c, version)
  const name = backquote(c.name)
  let op = c.operator
  if (UNARY.includes(op)) return `${name} ${op}`
  if (/^enum/i.test(c.type) && loose(c.value)) return name + enumClause(c.value, op)
  // $criteriaValues != '' (PHP loose: an empty array and '' are empty)
  const empty = typeof c.value === 'string' ? c.value === '' : c.value.length === 0
  if (empty) return ''
  const needsQuoting =
    /char|binary|blob|inet4|text|set|date|time|year|uuid/i.test(c.type) || op.includes('LIKE')
  let value = typeof c.value === 'string' ? c.value : c.value.join(',')
  if (op === 'LIKE %...%') {
    op = 'LIKE'
    value = `%${value}%`
  }
  if (op === 'NOT LIKE %...%') {
    op = 'NOT LIKE'
    value = `%${value}%`
  }
  if (op === 'REGEXP ^...$') {
    op = 'REGEXP'
    value = `^${value}$`
  }
  if (op !== 'IN (...)' && op !== 'NOT IN (...)' && op !== 'BETWEEN' && op !== 'NOT BETWEEN') {
    return `${name} ${op} ${needsQuoting ? quoteString(value) : value}`
  }
  op = op.replace(' (...)', '')
  const values = typeof c.value === 'string' ? value.split(',') : [...c.value]
  let emptyKey = -1
  values.forEach((v, k) => {
    if (v === '') {
      emptyKey = k
      values[k] = 'NULL'
      return
    }
    if (needsQuoting) values[k] = quoteString(v.trim())
  })
  if (op === 'BETWEEN' || op === 'NOT BETWEEN') {
    return `${name} ${op} ${values[0] ?? ''} AND ${values[1] ?? ''}`
  }
  if (emptyKey >= 0) values.splice(emptyKey, 1)
  const wheres: string[] = []
  if (values.length > 0) wheres.push(`${name} ${op} (${values.join(',')})`)
  if (emptyKey >= 0) wheres.push(`${name} IS NULL`)
  const w = wheres.join(' OR ')
  return wheres.length > 1 ? `(${w})` : w
}

/** pma: Search::getEnumWhereClause */
function enumClause(v: string | readonly string[], operator: string): string {
  const values = typeof v === 'string' ? v.split(',') : v
  let op = operator
  let open = ''
  let close = ''
  if (op === '=' && values.length > 1) {
    op = 'IN'
    open = '('
    close = ')'
  } else if (op === '!=' && values.length > 1) {
    op = 'NOT IN'
    open = '('
    close = ')'
  }
  return ` ${op} ${open}${values.map((x) => quoteString(x)).join(', ')}${close}`
}

/** pma: Search::getGeomWhereClause */
function geomClause(c: SearchCriterion, version: number): string {
  const unary = ['IsEmpty', 'IsSimple', 'IsRing', 'IsClosed']
  const value = typeof c.value === 'string' ? c.value : c.value.join(',')
  const name = backquote(c.name)
  if (c.operator.includes('IS NULL') || c.operator.includes('IS NOT NULL')) return `${name} ${c.operator}`
  const funcs = getGisFunctions(c.type, true, false, version)
  const f = funcs.find((x) => x.name === c.geomFunc)
  if (f !== undefined && f.params > 1) return `${c.geomFunc}(${name}, ${createGisData(value, version)})`
  const applied = `${c.geomFunc}(${name})`
  if (unary.includes(c.geomFunc ?? '') && value.trim() === '') return applied
  if (f !== undefined && GIS_DATA_TYPES.includes(f.type) && value !== '' && value !== '0') {
    return `${applied} ${c.operator} ${createGisData(value, version)}`
  }
  if (value !== '') return `${applied} ${c.operator} '${value}'`
  return ''
}
