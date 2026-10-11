/**
 * GIS data editor model: WKT ⇄ coordinate rows, and the preview geometry.
 * phpMyAdmin does this on the server (/gis-data-editor); it needs no database, so it runs here.
 *
 * pma: src/Controllers/GisDataEditorController.php (extractGisType), src/Gis/Gis*.php
 *      (generateWkt, getWktCoord, generateParams/getCoordinateParams)
 */

export const GIS_TYPES = [
  'POINT',
  'MULTIPOINT',
  'LINESTRING',
  'MULTILINESTRING',
  'POLYGON',
  'MULTIPOLYGON',
  'GEOMETRYCOLLECTION',
] as const
export type GisType = (typeof GIS_TYPES)[number]

export interface Pt {
  x: string
  y: string
}
export type Geom =
  | { type: 'POINT'; point: Pt }
  | { type: 'MULTIPOINT' | 'LINESTRING'; points: Pt[] }
  | { type: 'MULTILINESTRING' | 'POLYGON'; lines: Pt[][] }
  | { type: 'MULTIPOLYGON'; polygons: Pt[][][] }
  | { type: 'GEOMETRYCOLLECTION'; geoms: Geom[] }

export interface GisValue {
  srid: string
  geom: Geom
}

const pt = (): Pt => ({ x: '', y: '' })
const pts = (n: number) => Array.from({ length: n }, pt)

/** Minimum rows per type (LINESTRING 2 points, POLYGON rings 4 points). */
export function emptyGeom(type: GisType): Geom {
  switch (type) {
    case 'POINT':
      return { type, point: pt() }
    case 'MULTIPOINT':
      return { type, points: pts(1) }
    case 'LINESTRING':
      return { type, points: pts(2) }
    case 'MULTILINESTRING':
      return { type, lines: [pts(2)] }
    case 'POLYGON':
      return { type, lines: [pts(4)] }
    case 'MULTIPOLYGON':
      return { type, polygons: [[pts(4)]] }
    case 'GEOMETRYCOLLECTION':
      return { type, geoms: [emptyGeom('POINT')] }
  }
}

/** getWktCoord */
const coord = (p: Pt | undefined, empty: string) =>
  `${p === undefined || p.x.trim() === '' ? empty : p.x} ${p === undefined || p.y.trim() === '' ? empty : p.y}`

const list = (ps: Pt[], min: number, empty: string) => {
  const out: string[] = []
  for (let i = 0; i < Math.max(min, ps.length); i++) out.push(coord(ps[i], empty))
  return out.join(',')
}

/** Gis*::generateWkt (`empty` = '0' for the preview copy) */
export function generateWkt(g: Geom, empty = ''): string {
  switch (g.type) {
    case 'POINT':
      return `POINT(${coord(g.point, '')})`
    case 'MULTIPOINT':
      return `MULTIPOINT(${list(g.points, 1, empty)})`
    case 'LINESTRING':
      return `LINESTRING(${list(g.points, 2, empty)})`
    case 'MULTILINESTRING':
      return `MULTILINESTRING(${g.lines.map((l) => `(${list(l, 2, empty)})`).join(',')})`
    case 'POLYGON':
      return `POLYGON(${g.lines.map((l) => `(${list(l, 4, empty)})`).join(',')})`
    case 'MULTIPOLYGON':
      return `MULTIPOLYGON(${g.polygons.map((p) => `(${p.map((l) => `(${list(l, 4, empty)})`).join(',')})`).join(',')})`
    case 'GEOMETRYCOLLECTION':
      return `GEOMETRYCOLLECTION(${g.geoms.map((x) => generateWkt(x, empty)).join(',')})`
  }
}

/** The value written into the row input: `'WKT',srid` */
export const resultValue = (v: GisValue) => `'${generateWkt(v.geom)}',${Number.parseInt(v.srid, 10) || 0}`

// ------------------------------------------------------------------ parsing

/** GisGeometry::parseWktAndSrid: `'WKT',srid` or bare WKT */
export function parseWktAndSrid(value: string): { wkt: string; srid: string } {
  const m = /^'(.*)',(\d*)$/s.exec(value.trim())
  if (m !== null) return { wkt: m[1] ?? '', srid: m[2] ?? '0' }
  return { wkt: value.trim(), srid: '0' }
}

function parsePoints(s: string): Pt[] {
  return s
    .split(',')
    .map((p) => p.trim().replace(/^\(|\)$/g, ''))
    .filter((p) => p !== '')
    .map((p) => {
      const [x = '', y = ''] = p.trim().split(/\s+/)
      return { x, y }
    })
}

/** Splits `a),(b` style groups at depth 0 of the inner text. */
function splitGroups(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(') {
      if (depth === 0) start = i + 1
      depth++
    } else if (c === ')') {
      depth--
      if (depth === 0 && start >= 0) out.push(s.slice(start, i))
    }
  }
  return out
}

/** One geometry of a WKT, or null when unparsable. */
export function parseGeom(wkt: string): Geom | null {
  const m = /^\s*([A-Za-z]+)\s*\(([\s\S]*)\)\s*$/.exec(wkt)
  if (m === null) return null
  const type = (m[1] ?? '').toUpperCase() as GisType
  const body = m[2] ?? ''
  switch (type) {
    case 'POINT':
      return { type, point: parsePoints(body)[0] ?? pt() }
    case 'MULTIPOINT':
      return { type, points: parsePoints(body.replace(/[()]/g, '')) }
    case 'LINESTRING':
      return { type, points: parsePoints(body) }
    case 'MULTILINESTRING':
    case 'POLYGON':
      return { type, lines: splitGroups(body).map(parsePoints) }
    case 'MULTIPOLYGON':
      return { type, polygons: splitGroups(body).map((p) => splitGroups(p).map(parsePoints)) }
    case 'GEOMETRYCOLLECTION': {
      const geoms: Geom[] = []
      let depth = 0
      let start = 0
      for (let i = 0; i <= body.length; i++) {
        const c = body[i]
        if (c === '(') depth++
        else if (c === ')') depth--
        else if ((c === ',' || c === undefined) && depth === 0) {
          const g = parseGeom(body.slice(start, i))
          if (g !== null) geoms.push(g)
          start = i + 1
        }
      }
      return { type, geoms }
    }
    default:
      return null
  }
}

/**
 * GisDataEditorController::extractGisType + generateParams: the column type wins, else the WKT
 * keyword of the value, else POINT.
 */
export function initialValue(columnType: string, value: string): { type: GisType; value: GisValue } {
  const upper = columnType.toUpperCase()
  const { wkt, srid } = parseWktAndSrid(value)
  const fromValue = /^'?(\w+)\b/.exec(value)?.[1]?.toUpperCase()
  let type: GisType = 'POINT'
  if ((GIS_TYPES as readonly string[]).includes(upper)) type = upper as GisType
  else if (fromValue !== undefined && (GIS_TYPES as readonly string[]).includes(fromValue))
    type = fromValue as GisType
  const parsed = value.trim() === '' ? null : parseGeom(wkt)
  // an empty value is parsed too (generateParams('')): its first coordinates read as 0 0
  const geom = parsed !== null && parsed.type === type ? parsed : zeroFirst(emptyGeom(type))
  return { type, value: { srid: String(Number.parseInt(srid, 10) || 0), geom } }
}

/** The first point of a geometry set to 0 0 (phpMyAdmin casts the empty coordinates to float). */
function zeroFirst(g: Geom): Geom {
  const z = (p: Pt[]): Pt[] => p.map((x, i) => (i === 0 ? { x: '0', y: '0' } : x))
  switch (g.type) {
    case 'POINT':
      return { ...g, point: { x: '0', y: '0' } }
    case 'MULTIPOINT':
    case 'LINESTRING':
      return { ...g, points: z(g.points) }
    case 'MULTILINESTRING':
    case 'POLYGON':
      return { ...g, lines: g.lines.map((l, i) => (i === 0 ? z(l) : l)) }
    case 'MULTIPOLYGON':
      return {
        ...g,
        polygons: g.polygons.map((p, i) => (i === 0 ? p.map((l, j) => (j === 0 ? z(l) : l)) : p)),
      }
    case 'GEOMETRYCOLLECTION':
      return { ...g, geoms: g.geoms.map((x, i) => (i === 0 ? zeroFirst(x) : x)) }
  }
}

// ------------------------------------------------------------------ preview

export interface Shape {
  kind: 'point' | 'line' | 'polygon'
  /** rings / lines of [x, y] */
  paths: Array<Array<[number, number]>>
}

const num = (p: Pt): [number, number] | null => {
  const x = Number(p.x === '' ? '0' : p.x)
  const y = Number(p.y === '' ? '0' : p.y)
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
}
const path = (ps: Pt[]) => ps.map(num).filter((p): p is [number, number] => p !== null)

export function shapes(g: Geom): Shape[] {
  switch (g.type) {
    case 'POINT':
      return [{ kind: 'point', paths: [path([g.point])] }]
    case 'MULTIPOINT':
      return g.points.map((p) => ({ kind: 'point', paths: [path([p])] }))
    case 'LINESTRING':
      return [{ kind: 'line', paths: [path(g.points)] }]
    case 'MULTILINESTRING':
      return g.lines.map((l) => ({ kind: 'line', paths: [path(l)] }))
    case 'POLYGON':
      return [{ kind: 'polygon', paths: g.lines.map(path) }]
    case 'MULTIPOLYGON':
      return g.polygons.map((p) => ({ kind: 'polygon', paths: p.map(path) }))
    case 'GEOMETRYCOLLECTION':
      return g.geoms.flatMap(shapes)
  }
}
