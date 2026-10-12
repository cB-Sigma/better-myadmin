/**
 * The GIS visualization's SVG: the extent of the rows, the scale, and one shape per geometry with
 * the colours and attributes phpMyAdmin writes (also the text of the SVG download).
 *
 * pma: src/Gis/GisVisualization.php (COLORS, scaleDataSet, prepareDataSet, svg),
 *      src/Gis/GisGeometry.php (getCoordinatesExtent, extractPointsInternal),
 *      src/Gis/Gis{Point,MultiPoint,LineString,MultiLineString,Polygon,MultiPolygon,GeometryCollection}.php
 *      (getExtent, prepareRowAsSvg, drawPath, explodeGeomCol), src/Gis/GisFactory.php::fromWkt
 */

/** GisVisualization::png: the PNG's background (new Color(229, 229, 229)) */
export const GIS_PNG_BACKGROUND = [229, 229, 229] as const

export const GIS_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [176, 46, 224],
  [224, 100, 46],
  [224, 214, 46],
  [46, 151, 224],
  [188, 224, 46],
  [224, 46, 117],
  [92, 224, 46],
  [224, 176, 46],
  [0, 34, 224],
  [114, 108, 177],
  [72, 26, 54],
  [186, 198, 88],
  [18, 114, 36],
  [130, 81, 25],
  [35, 140, 116],
  [76, 72, 155],
  [135, 201, 191],
]

interface Extent {
  minX: number
  minY: number
  maxX: number
  maxY: number
}
interface ScaleData {
  scale: number
  offsetX: number
  offsetY: number
}

/** one SVG element: its tag and attributes in phpMyAdmin's order */
export interface SvgShape {
  tag: 'circle' | 'polyline' | 'path'
  attrs: Array<[string, string]>
}

const EMPTY: Extent = {
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
}
const merge = (a: Extent, b: Extent): Extent => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
})

/** PHP (string) $float: precision 14, zend_gcvt formatting (as packages/import phpFloatString) */
export function phpFloat(f: number): string {
  if (Number.isNaN(f)) return 'NAN'
  if (!Number.isFinite(f)) return f > 0 ? 'INF' : '-INF'
  if (f === 0) return Object.is(f, -0) ? '-0' : '0'
  const neg = f < 0
  const [m, e] = Math.abs(f).toExponential(13).split('e') as [string, string]
  const digits = m.replace('.', '').replace(/0+$/, '')
  const decpt = Number(e) + 1
  let out: string
  if (decpt < 0 ? decpt < -3 : decpt > 14) {
    const exp = decpt - 1
    out = `${digits[0]}.${digits.length > 1 ? digits.slice(1) : '0'}E${exp < 0 ? '-' : '+'}${Math.abs(exp)}`
  } else if (decpt <= 0) {
    out = `0.${'0'.repeat(-decpt)}${digits}`
  } else if (digits.length <= decpt) {
    out = digits + '0'.repeat(decpt - digits.length)
  } else {
    out = `${digits.slice(0, decpt)}.${digits.slice(decpt)}`
  }
  return neg ? `-${out}` : out
}

/** PHP (float) of a coordinate string: the leading number, else 0 */
const float = (s: string | undefined): number => {
  const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s ?? '')
  return m === null ? 0 : Number(m[0])
}

/** mb_substr($wkt, $start, -$end) */
const inner = (wkt: string, start: number, end: number) => {
  const c = [...wkt]
  return c.slice(start, Math.max(start, c.length - end)).join('')
}

/** GisGeometry::getCoordinatesExtent (`$y <= $maxY` keeps the first maximum) */
function coordinatesExtent(pointSet: string): Extent {
  let { minX, minY, maxX, maxY } = EMPTY
  for (const point of pointSet.split(',')) {
    const c = point.split(' ')
    const x = float(c[0])
    const y = float(c[1])
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/** GisGeometry::extractPointsInternal (scaled) */
function points(pointSet: string, s: ScaleData): Array<[number, number]> {
  return pointSet.split(',').map((raw) => {
    const c = raw.replace(/[()]/g, '').split(' ')
    if (c[1] !== undefined && (c[0] ?? '').trim() !== '' && c[1].trim() !== '') {
      return [float(c[0]) * s.scale + s.offsetX, -float(c[1]) * s.scale - s.offsetY]
    }
    return [0, 0]
  })
}

/** GisGeometryCollection::explodeGeomCol (byte positions, like str_split + mb_substr on ASCII WKT) */
function explodeGeomCol(geomCol: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let count = 0
  for (const ch of geomCol) {
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) {
        parts.push(geomCol.slice(start, count + 1))
        start = count + 2
      }
    }
    count++
  }
  return parts
}

type GisKind =
  | 'POINT'
  | 'MULTIPOINT'
  | 'LINESTRING'
  | 'MULTILINESTRING'
  | 'POLYGON'
  | 'MULTIPOLYGON'
  | 'GEOMETRYCOLLECTION'

/** GisFactory::fromWkt: the type before the first `(` */
function kindOf(wkt: string): GisKind | null {
  const i = wkt.indexOf('(')
  if (i === -1) return null
  const t = wkt.slice(0, i).toUpperCase()
  return [
    'POINT',
    'MULTIPOINT',
    'LINESTRING',
    'MULTILINESTRING',
    'POLYGON',
    'MULTIPOLYGON',
    'GEOMETRYCOLLECTION',
  ].includes(t)
    ? (t as GisKind)
    : null
}

/** Gis*::getExtent */
function extentOf(wkt: string): Extent {
  switch (kindOf(wkt)) {
    case 'POINT':
      return coordinatesExtent(inner(wkt, 6, 1))
    case 'MULTIPOINT':
    case 'LINESTRING':
      return coordinatesExtent(inner(wkt, 11, 1))
    case 'MULTILINESTRING':
      return inner(wkt, 17, 2)
        .split('),(')
        .reduce((e, l) => merge(e, coordinatesExtent(l)), EMPTY)
    case 'POLYGON':
      return coordinatesExtent(inner(wkt, 9, 2).split('),(')[0] ?? '')
    case 'MULTIPOLYGON':
      return inner(wkt, 15, 3)
        .split(')),((')
        .reduce((e, p) => merge(e, coordinatesExtent(p.split('),(')[0] ?? '')), EMPTY)
    case 'GEOMETRYCOLLECTION':
      return explodeGeomCol(inner(wkt, 19, 1)).reduce(
        (e, part) => (kindOf(part) === null ? e : merge(e, extentOf(part))),
        EMPTY,
      )
    default:
      return EMPTY
  }
}

/** sprintf('#%02x%02x%02x') of a Color */
export const hex = (c: readonly [number, number, number]) =>
  `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** GisPolygon::drawPath: M first, L for the others but the closing point, Z */
function drawPath(ring: string, s: ScaleData): string {
  const p = points(ring, s)
  let d = `M${phpFloat(p[0]?.[0] ?? 0)},${phpFloat(p[0]?.[1] ?? 0)}`
  for (const q of p.slice(1, p.length - 1)) d += `L${phpFloat(q[0])},${phpFloat(q[1])}`
  return `${d}Z`
}

/** Gis*::prepareRowAsSvg */
function shapesOf(
  wkt: string,
  label: string,
  color: readonly [number, number, number],
  s: ScaleData,
): SvgShape[] {
  const withLabel = (attrs: Array<[string, string]>) =>
    label !== '' ? [...attrs, ['data-label', label] as [string, string]] : attrs
  const stroke = hex(color)
  const pointAttrs = (cls: string) =>
    withLabel([
      ['class', cls],
      ['fill', 'white'],
      ['stroke', stroke],
      ['stroke-width', '2'],
    ])
  const lineAttrs = (cls: string) =>
    withLabel([
      ['class', cls],
      ['fill', 'none'],
      ['stroke', stroke],
      ['stroke-width', '2'],
    ])
  const polyAttrs = (cls: string) =>
    withLabel([
      ['class', cls],
      ['stroke', 'black'],
      ['stroke-width', '0.5'],
      ['fill', stroke],
      ['fill-rule', 'evenodd'],
      ['fill-opacity', '0.8'],
    ])
  const circle = (p: [number, number], attrs: Array<[string, string]>): SvgShape => ({
    tag: 'circle',
    attrs: [['cx', phpFloat(p[0])], ['cy', phpFloat(p[1])], ['r', '3'], ...attrs],
  })
  const polyline = (line: string, attrs: Array<[string, string]>): SvgShape => ({
    tag: 'polyline',
    attrs: [
      [
        'points',
        points(line, s)
          .map((p) => `${phpFloat(p[0])},${phpFloat(p[1])} `)
          .join(''),
      ],
      ...attrs,
    ],
  })
  switch (kindOf(wkt)) {
    case 'POINT': {
      const p = points(inner(wkt, 6, 1), s)[0] ?? [0, 0]
      // `$pointsArr[0] !== 0.0 && $pointsArr[1] !== 0.0`
      return p[0] !== 0 && p[1] !== 0 ? [circle(p, pointAttrs('point vector'))] : []
    }
    case 'MULTIPOINT':
      return points(inner(wkt, 11, 1), s)
        .filter((p) => p[0] !== 0 && p[1] !== 0)
        .map((p) => circle(p, pointAttrs('multipoint vector')))
    case 'LINESTRING':
      return [polyline(inner(wkt, 11, 1), lineAttrs('linestring vector'))]
    case 'MULTILINESTRING':
      return inner(wkt, 17, 2)
        .split('),(')
        .map((l) => polyline(l, lineAttrs('multilinestring vector')))
    case 'POLYGON':
      return [
        {
          tag: 'path',
          attrs: [
            [
              'd',
              inner(wkt, 9, 2)
                .split('),(')
                .map((r) => drawPath(r, s))
                .join(''),
            ],
            ...polyAttrs('polygon vector'),
          ],
        },
      ]
    case 'MULTIPOLYGON':
      return inner(wkt, 15, 3)
        .split(')),((')
        .map((p) => ({
          tag: 'path' as const,
          attrs: [
            [
              'd',
              p
                .split('),(')
                .map((r) => drawPath(r, s))
                .join(''),
            ] as [string, string],
            ...polyAttrs('multipolygon vector'),
          ],
        }))
    case 'GEOMETRYCOLLECTION':
      return explodeGeomCol(inner(wkt, 19, 1)).flatMap((part) =>
        kindOf(part) === null ? [] : shapesOf(part, label, color, s),
      )
    default:
      return []
  }
}

/** GisVisualization::scaleDataSet */
function scaleData(wkts: string[], width: number, height: number): ScaleData | null {
  let extent = EMPTY
  for (const wkt of wkts) if (kindOf(wkt) !== null) extent = merge(extent, extentOf(wkt))
  if (extent.minX > extent.maxX || extent.minY > extent.maxY) return null
  const border = 15
  const plotWidth = width - 2 * border
  const plotHeight = height - 2 * border
  const xRatio = (extent.maxX - extent.minX) / plotWidth
  const yRatio = (extent.maxY - extent.minY) / plotHeight
  const ratio = Math.max(xRatio, yRatio)
  const scale = ratio === 0 ? 1 : 1 / ratio
  let offsetX = -extent.minX * scale + border
  if (ratio === 0 || xRatio < yRatio) offsetX += (plotWidth - (extent.maxX - extent.minX) * scale) / 2
  let offsetY = -extent.minY * scale + border - height
  if (ratio === 0 || xRatio > yRatio) offsetY += (plotHeight - (extent.maxY - extent.minY) * scale) / 2
  return { scale, offsetX, offsetY }
}

/** GisVisualization::prepareDataSet (Format::Svg): the shapes of every row, one colour per row */
export function svgShapes(
  rows: ReadonlyArray<{ wkt: string | null; label: string }>,
  width: number,
  height: number,
): SvgShape[] {
  const s = scaleData(
    rows.flatMap((r) => (r.wkt === null ? [] : [r.wkt])),
    width,
    height,
  )
  if (s === null) return []
  const out: SvgShape[] = []
  let colorIndex = 0
  for (const r of rows) {
    if (r.wkt === null || kindOf(r.wkt) === null) continue
    out.push(...shapesOf(r.wkt, r.label, GIS_COLORS[colorIndex] ?? [0, 0, 0], s))
    colorIndex = (colorIndex + 1) % GIS_COLORS.length
  }
  return out
}

const attr = (v: string) =>
  v.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** GisVisualization::svg: the document of the SVG download */
export function svgDocument(shapes: SvgShape[], width: number, height: number): string {
  const body = shapes
    .map(
      (sh) =>
        `<${sh.tag}${sh.attrs.map(([k, v]) => ` ${k}="${k === 'data-label' ? attr(v) : v}"`).join('')}/>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg version="1.1" xmlns:svg="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g>${body}</g></svg>`
}

/** GisVisualization::asOl: the geometries (prepareRowAsOl) and the colours of the OpenLayers map */
export function olDataset(
  rows: ReadonlyArray<{ wkt: string | null; srid: number; label: string }>,
  width: number,
  height: number,
): { geometries: Array<{ wkt: string; srid?: number; label?: string }>; colors: typeof GIS_COLORS } {
  const valid = rows.flatMap((r) => (r.wkt === null || kindOf(r.wkt) === null ? [] : [{ ...r, wkt: r.wkt }]))
  // prepareDataSet draws nothing when the extent is empty
  const geometries =
    scaleData(
      valid.map((r) => r.wkt),
      width,
      height,
    ) === null
      ? []
      : valid.map((r) => ({
          wkt: r.wkt,
          ...(r.srid !== 0 ? { srid: r.srid } : {}),
          ...(r.label !== '' ? { label: r.label } : {}),
        }))
  return { geometries, colors: GIS_COLORS }
}
