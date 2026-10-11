import { ColumnType, type Import, phpFloatString } from '../import.ts'
import { ImportPlugin, type ImportPluginProperties } from '../plugin.ts'
import { fileBaseName } from './csv.ts'

interface XY {
  x: number
  y: number
}
interface ShpData {
  x?: number
  y?: number
  numpoints?: number
  numparts?: number
  points?: XY[]
  parts?: Array<{ points: XY[] }>
}

const NAMES: Record<number, string> = {
  [-1]: 'Unknown Shape',
  0: 'Null Shape',
  1: 'Point',
  3: 'PolyLine',
  5: 'Polygon',
  8: 'MultiPoint',
  11: 'PointZ',
  13: 'PolyLineZ',
  15: 'PolygonZ',
  18: 'MultiPointZ',
  21: 'PointM',
  23: 'PolyLineM',
  25: 'PolygonM',
  28: 'MultiPointM',
  31: 'MultiPatch',
}

/**
 * The SHP reader of phpmyadmin/shapefile over the import chunks (no .dbf: the dbase extension is
 * not available, as in the reference build).
 * pma: vendor/phpmyadmin/shapefile/src/ShapeFile.php, ShapeRecord.php; ImportShp::readFromBuffer
 */
class ShapeReader {
  #buffer = Buffer.alloc(0)
  eof = false
  readonly #imp: Import
  shapeType = 1
  lastError = ''
  records: Array<{ shapeType: number; shpData: ShpData }> = []

  constructor(imp: Import) {
    this.#imp = imp
  }

  /** ImportShp::readFromBuffer */
  read(length: number): Buffer {
    if (this.#buffer.length < length) {
      if (this.#imp.finished) this.eof = true
      else {
        const c = this.#imp.getNextChunk()
        if (Buffer.isBuffer(c)) this.#buffer = Buffer.concat([this.#buffer, c])
      }
    }
    const r = this.#buffer.subarray(0, length)
    this.#buffer = this.#buffer.subarray(length)
    return r
  }

  load(): boolean {
    const n = (b: Buffer) => (b.length >= 4 ? b.readUInt32BE(0) : null)
    if (n(this.read(4)) !== 9994) {
      this.lastError = 'Not a SHP file (file code mismatch)'
      return false
    }
    this.read(20)
    this.read(4)
    this.read(4)
    const t = this.read(4)
    const known = (v: number) => (NAMES[v] !== undefined ? v : -1)
    this.shapeType = t.length >= 4 ? known(t.readUInt32LE(0)) : -1
    this.read(64)
    while (!this.eof) {
      const rec = this.#record()
      if (rec === null) return false
      if (rec.shapeType === -1 && this.eof) break
      this.records.push(rec)
    }
    return true
  }

  #record(): { shapeType: number; shpData: ShpData } | null {
    let read = 0
    const data = (count: number): Buffer | null => {
      const b = this.read(count)
      read += b.length
      return b.length === 0 ? null : b
    }
    const V = () => data(4)?.readUInt32LE(0) ?? null
    const d = () => {
      const b = data(8)
      return b !== null && b.length === 8 ? b.readDoubleLE(0) : 0
    }
    const rec = { shapeType: -1, shpData: {} as ShpData }
    const num = data(4)
    if (num === null) return rec
    const sizeB = data(4)
    if (sizeB === null) return rec
    const size = (sizeB.length === 4 ? sizeB.readUInt32BE(0) : 0) * 2 + 8
    const st = V()
    if (st === null) return rec
    rec.shapeType = NAMES[st] !== undefined ? st : -1
    const point = (): XY => ({ x: d(), y: d() })
    const bbox = () => {
      d()
      d()
      d()
      d()
    }
    switch (rec.shapeType) {
      case 0:
        break
      case 1:
        rec.shpData = point()
        break
      case 8: {
        bbox()
        const np = V() ?? 0
        rec.shpData = { numpoints: np, points: [] }
        for (let i = 0; i < np; ++i) rec.shpData.points?.push(point())
        break
      }
      case 3:
      case 5: {
        bbox()
        const numparts = V() ?? 0
        const numpoints = V() ?? 0
        const starts: number[] = []
        for (let i = 0; i < numparts; ++i) starts.push(V() ?? 0)
        const parts: Array<{ points: XY[] }> = []
        let part = 0
        for (let i = 0; i < numpoints; ++i) {
          if (part + 1 < numparts && i === starts[part + 1]) ++part
          parts[part] ??= { points: [] }
          parts[part]?.points.push(point())
        }
        rec.shpData = { numparts, numpoints, parts }
        break
      }
      case -1:
      case 31:
        this.lastError = 'Invalid Shape type.'
        return null
      default:
        // Z / M variants: not supported by the importer, the record is skipped
        break
    }
    /* We need to skip rest of the record */
    while (read < size) {
      if (data(4) === null) break
    }
    if (read !== size) {
      this.lastError = 'Invalid Shape type.'
      return null
    }
    return rec
  }
}

const f = phpFloatString
const xy = (p: XY) => `${f(p.x)} ${f(p.y)}`

/** Polygon::area */
function area(ring: XY[]): number {
  let n = ring.length
  const first = ring[0] as XY
  const last = ring[n - 1] as XY
  if (first.x === last.x && first.y === last.y) --n
  let a = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += (ring[i] as XY).x * (ring[j] as XY).y
    a -= (ring[i] as XY).y * (ring[j] as XY).x
  }
  return a / 2
}

/** Point::isInsidePolygon (ray casting) */
function inside(pt: XY, ring: XY[]): boolean {
  let n = ring.length
  const first = ring[0] as XY
  const last = ring[n - 1] as XY
  if (first.x === last.x && first.y === last.y) --n
  let counter = 0
  let p1 = first
  for (let i = 1; i <= n; i++) {
    const p2 = ring[i % n] as XY
    if (pt.y <= Math.min(p1.y, p2.y) || pt.y > Math.max(p1.y, p2.y) || pt.x > Math.max(p1.x, p2.x)) {
      p1 = p2
      continue
    }
    if (p1.y !== p2.y) {
      const xinters = ((pt.y - p1.y) * (p2.x - p1.x)) / (p2.y - p1.y) + p1.x
      if (p1.x === p2.x || pt.x <= xinters) counter++
    }
    p1 = p2
  }
  return counter % 2 !== 0
}

/** Polygon::getPointOnSurface */
function pointOnSurface(ring: XY[]): XY | false {
  let pair: [XY, XY] | null = null
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i] as XY
    const b = ring[i + 1] as XY
    if (a.y !== b.y) {
      pair = [b, a]
      break
    }
  }
  if (pair === null) return false
  const [prev, next] = pair
  const mid = { x: (prev.x + next.x) / 2, y: (prev.y + next.y) / 2 }
  let epsilon = 0.1
  const den = Math.sqrt((next.y - prev.y) ** 2 + (prev.x - next.x) ** 2)
  for (;;) {
    let x = mid.x + (epsilon * (next.y - prev.y)) / den
    const a = { x, y: mid.y + ((x - mid.x) * (prev.x - next.x)) / (next.y - prev.y) }
    x = mid.x + (epsilon * (next.y - prev.y)) / -den
    const b = { x, y: mid.y + ((x - mid.x) * (prev.x - next.x)) / (next.y - prev.y) }
    if (inside(a, ring)) return a
    if (inside(b, ring)) return b
    epsilon **= 2
    if (epsilon === 0) return false
  }
}

/** Gis*::getShape for the SHP record types */
function getShape(type: string, s: ShpData): string {
  switch (type) {
    case 'point':
      return `POINT(${s.x === undefined ? '' : f(s.x)} ${s.y === undefined ? '' : f(s.y)})`
    case 'multipoint':
      return `MULTIPOINT(${(s.points ?? []).map(xy).join(',')})`
    case 'multilinestring':
      return `MULTILINESTRING(${(s.parts ?? []).map((p) => `(${p.points.map(xy).join(',')})`).join(',')})`
    default: {
      // multipolygon: classify inner rings to their outer rings
      const parts = (s.parts ?? []).map((p) => ({
        points: p.points,
        isOuter: area(p.points) < 0,
        pos: null as XY | false | null,
        inner: [] as number[],
      }))
      for (const p of parts) if (!p.isOuter) p.pos = pointOnSurface(p.points)
      parts.forEach((r1, j) => {
        if (r1.isOuter) return
        for (const r2 of parts) {
          if (!r2.isOuter) continue
          if (r1.pos === false || r1.pos === null || !inside(r1.pos, r2.points)) continue
          r2.inner.push(j)
        }
      })
      const polys = parts
        .filter((p) => p.isOuter)
        .map((p) => {
          let w = `((${p.points.map(xy).join(',')})`
          for (const j of p.inner) w += `,(${(parts[j]?.points ?? []).map(xy).join(',')})`
          return `${w})`
        })
      return `MULTIPOLYGON(${polys.join(',')})`
    }
  }
}

/**
 * Handles the import for ESRI Shape files.
 * pma: src/Plugins/Import/ImportShp.php
 */
export class ImportShp extends ImportPlugin {
  get name(): string {
    return 'shp'
  }

  protected setProperties(): ImportPluginProperties {
    return { name: 'shp', text: this.__('ESRI Shape File'), extension: 'shp', mimeType: '', options: null }
  }

  async doImport(imp: Import): Promise<void> {
    imp.finished = false
    const file = imp.file
    if (file === null) return
    // If the zip archive has more than one file, get the correct content from the .shp file.
    if (file.compression === 'application/zip' && file.zipEntries().length > 1) {
      try {
        file.openZip(/^.*\.shp$/i)
      } catch (e) {
        imp.message = imp.error(
          'There was an error importing the ESRI shape file: "%s".',
          (e as Error).message,
        )
        return
      }
    }
    const shp = new ShapeReader(imp)
    shp.load()
    if (shp.lastError !== '') {
      imp.hasError = true
      imp.message = imp.error('There was an error importing the ESRI shape file: "%s".', shp.lastError)
      return
    }
    const gisType = { 1: 'point', 3: 'multilinestring', 5: 'multipolygon', 8: 'multipoint' }[
      shp.shapeType as 1
    ]
    if (gisType === undefined && shp.shapeType !== 0) {
      imp.hasError = true
      imp.message = imp.error(
        'MySQL Spatial Extension does not support ESRI type "%s".',
        NAMES[shp.shapeType] ?? '',
      )
      return
    }
    const rows: Array<Array<string | null>> = shp.records.map((r) => [
      gisType === undefined ? null : `GeomFromText('${getShape(gisType, r.shpData)}')`,
    ])
    if (rows.length === 0) {
      imp.hasError = true
      imp.message = imp.error('The imported file does not contain any data!')
      return
    }
    const tableName =
      imp.db !== ''
        ? await imp.getNextAvailableTableName(imp.db, fileBaseName(imp.importFileName))
        : 'TBL_NAME'
    const table = { tableName, columns: ['SPATIAL'], rows }
    const analysis = imp.analyzeTable(table)
    // The first column is the SPATIAL column: SQL functions, not formatted by buildSql()
    const first = analysis[0]
    if (first !== undefined) {
      first.type = ColumnType.Geometry
      first.isFullyFormattedSql = true
    }
    const dbName = imp.db !== '' ? imp.db : 'SHP_DB'
    if (imp.db === '') await imp.createDatabase(dbName, 'utf8', 'utf8_general_ci')
    await imp.buildSql(dbName, [table], [analysis])
    imp.finished = true
    imp.hasError = false
    // Commit any possible data in buffers
    await imp.runQuery('')
  }
}
