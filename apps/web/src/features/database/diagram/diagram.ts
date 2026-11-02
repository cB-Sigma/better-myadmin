import type { ErDiagramResponse, ErRelation, ErTable } from '@bettermyadmin/contracts'
import type * as Dagre from '@dagrejs/dagre'

/**
 * Database → Diagram (BetterMyAdmin-only, X63): the pure part of the automatic ER diagram — box
 * sizes, the graph handed to the layered layout (dagre), the packing of unrelated tables, the
 * relation paths, search and the fit-to-screen transform. DiagramPage.tsx draws the result.
 */

export const FONT_SIZE = 12
export const HEADER_H = 24
export const ROW_H = 18
export const PAD_X = 8
/** gap between the column name and its type, and around the key markers */
const GAP = 14
const MARKER_W = 22
const MIN_W = 120
const MAX_W = 420

/** Text width in px for {@link FONT_SIZE} (canvas measureText in the browser). */
export type Measure = (text: string, bold?: boolean) => number

/** A rough width when no canvas is available (tests, SSR). */
export const estimateWidth: Measure = (text, bold = false) => text.length * (bold ? 7.4 : 6.8)

export interface DiagramNode {
  id: string
  table: ErTable
  width: number
  height: number
  collapsed: boolean
}

export interface DiagramEdge {
  id: string
  /** referencing table → referenced table (both in this database) */
  from: string
  to: string
  relation: ErRelation
}

export interface DiagramGraph {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  /** relations to another database or to a table the user cannot see: listed, not drawn */
  external: ErRelation[]
  /** columns of each table that reference another table (the FK marker) */
  fkColumns: Map<string, Set<string>>
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type Positions = Map<string, Rect>

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** The size of one table box: header plus a row per column, or the header alone when collapsed. */
export function nodeSize(
  table: ErTable,
  collapsed: boolean,
  measure: Measure = estimateWidth,
): { width: number; height: number } {
  let w = measure(table.name, true) + 2 * PAD_X + 20 // + the collapse toggle
  if (!collapsed) {
    for (const c of table.columns) {
      w = Math.max(w, MARKER_W + measure(c.name) + GAP + measure(c.type) + 2 * PAD_X)
    }
  }
  const width = Math.round(Math.min(MAX_W, Math.max(MIN_W, w)))
  const height = HEADER_H + (collapsed ? 0 : Math.max(1, table.columns.length) * ROW_H + 4)
  return { width, height }
}

/** The nodes and edges of the diagram. */
export function buildGraph(
  data: ErDiagramResponse,
  collapsed: ReadonlySet<string>,
  measure: Measure = estimateWidth,
): DiagramGraph {
  const nodes = data.tables.map((table) => {
    const c = collapsed.has(table.name)
    return { id: table.name, table, collapsed: c, ...nodeSize(table, c, measure) }
  })
  const names = new Set(data.tables.map((t) => t.name))
  const edges: DiagramEdge[] = []
  const external: ErRelation[] = []
  const fkColumns = new Map<string, Set<string>>()
  data.relations.forEach((relation, i) => {
    const set = fkColumns.get(relation.table) ?? new Set<string>()
    fkColumns.set(relation.table, set)
    for (const c of relation.columns) set.add(c)
    if (relation.refDb === data.db && names.has(relation.refTable) && names.has(relation.table)) {
      edges.push({ id: `e${i}`, from: relation.table, to: relation.refTable, relation })
    } else {
      external.push(relation)
    }
  })
  return { nodes, edges, external, fkColumns }
}

export type DagreModule = Pick<typeof Dagre, 'graphlib' | 'layout'>

const RANK_SEP = 90
const NODE_SEP = 28
const MARGIN = 20
const PACK_GAP = 28

/**
 * Positions (top-left corners) of every node: the tables with relations through dagre's layered
 * layout (referenced tables left of the tables that reference them), then the unrelated ones packed
 * in rows below it, so a database of unrelated tables still reads as a grid and not one long column.
 */
export function layoutGraph(
  graph: DiagramGraph,
  dagre: DagreModule,
): { positions: Positions; bounds: Bounds } {
  const positions: Positions = new Map()
  const linked = new Set<string>()
  for (const e of graph.edges) {
    if (e.from === e.to) continue
    linked.add(e.from)
    linked.add(e.to)
  }
  let width = 0
  let height = 0
  if (linked.size > 0) {
    const g = new dagre.graphlib.Graph({ multigraph: true })
    g.setGraph({ rankdir: 'LR', ranksep: RANK_SEP, nodesep: NODE_SEP, marginx: MARGIN, marginy: MARGIN })
    g.setDefaultEdgeLabel(() => ({}))
    for (const n of graph.nodes) if (linked.has(n.id)) g.setNode(n.id, { width: n.width, height: n.height })
    for (const e of graph.edges) if (e.from !== e.to) g.setEdge(e.to, e.from, { minlen: 1 }, e.id)
    dagre.layout(g)
    const placed: Positions = new Map()
    for (const n of graph.nodes) {
      if (!linked.has(n.id)) continue
      const p = g.node(n.id)
      placed.set(n.id, {
        x: (p.x ?? 0) - n.width / 2,
        y: (p.y ?? 0) - n.height / 2,
        width: n.width,
        height: n.height,
      })
    }
    for (const [id, r] of wrapRanks(placed)) {
      positions.set(id, r)
      width = Math.max(width, r.x + r.width + MARGIN)
      height = Math.max(height, r.y + r.height + MARGIN)
    }
  }
  const rest = graph.nodes.filter((n) => !linked.has(n.id))
  if (rest.length > 0) {
    const area = rest.reduce((s, n) => s + (n.width + PACK_GAP) * (n.height + PACK_GAP), 0)
    const rowWidth = Math.max(width, Math.sqrt(area) * 1.6, 600)
    let x = MARGIN
    let y = height + (height > 0 ? PACK_GAP : MARGIN)
    let rowH = 0
    for (const n of rest) {
      if (x > MARGIN && x + n.width > rowWidth) {
        x = MARGIN
        y += rowH + PACK_GAP
        rowH = 0
      }
      positions.set(n.id, { x, y, width: n.width, height: n.height })
      x += n.width + PACK_GAP
      rowH = Math.max(rowH, n.height)
      width = Math.max(width, x - PACK_GAP + MARGIN)
    }
    height = y + rowH + MARGIN
  }
  return { positions, bounds: { x: 0, y: 0, width: Math.max(width, 1), height: Math.max(height, 1) } }
}

/** Width / height the layered part aims at when its ranks are too tall (a landscape screen). */
const ASPECT = 1.6

/**
 * dagre's layered layout puts every table of a rank in one column: a wide tree (hundreds of tables
 * referencing a few) becomes a column thousands of pixels high. When the layout is much taller than
 * a landscape box of the same area, every rank is stacked again in dagre's order, wrapped into
 * several sub-columns of at most that height, and the ranks are placed left to right again.
 */
export function wrapRanks(placed: Positions): Positions {
  const rects = [...placed.entries()]
  if (rects.length === 0) return placed
  const area = rects.reduce((s, [, r]) => s + (r.width + NODE_SEP) * (r.height + NODE_SEP), 0)
  const tallest = Math.max(...rects.map(([, r]) => r.height))
  const limit = Math.max(tallest, Math.sqrt(area / ASPECT))
  const top = Math.min(...rects.map(([, r]) => r.y))
  const bottom = Math.max(...rects.map(([, r]) => r.y + r.height))
  if (bottom - top <= limit * 1.25) return placed
  // ranks: dagre centres the boxes of a rank on one x (rankdir LR)
  const ranks = new Map<number, Array<[string, Rect]>>()
  for (const e of rects) {
    const cx = Math.round(e[1].x + e[1].width / 2)
    const list = ranks.get(cx) ?? []
    ranks.set(cx, list)
    list.push(e)
  }
  type Column = { items: Array<[string, Rect]>; width: number; height: number }
  const layout: Column[][] = [...ranks.keys()]
    .sort((a, b) => a - b)
    .map((cx) => {
      const cols: Column[] = []
      let col: Column = { items: [], width: 0, height: 0 }
      for (const e of (ranks.get(cx) ?? []).sort((a, b) => a[1].y - b[1].y)) {
        const h = e[1].height
        if (col.items.length > 0 && col.height + NODE_SEP + h > limit) {
          cols.push(col)
          col = { items: [], width: 0, height: 0 }
        }
        col.height += (col.items.length > 0 ? NODE_SEP : 0) + h
        col.width = Math.max(col.width, e[1].width)
        col.items.push(e)
      }
      cols.push(col)
      return cols
    })
  const full = Math.max(...layout.flat().map((c) => c.height))
  const out: Positions = new Map()
  let x = MARGIN
  for (const cols of layout) {
    cols.forEach((col, i) => {
      let y = MARGIN + (full - col.height) / 2
      for (const [id, r] of col.items) {
        out.set(id, { ...r, x: x + (col.width - r.width) / 2, y })
        y += r.height + NODE_SEP
      }
      x += col.width + (i < cols.length - 1 ? NODE_SEP * 1.5 : RANK_SEP)
    })
  }
  return out
}

/** The vertical centre of a column row (the header's centre when collapsed or not found). */
export function columnY(rect: Rect, node: DiagramNode, column: string | undefined): number {
  if (node.collapsed || column === undefined) return rect.y + HEADER_H / 2
  const i = node.table.columns.findIndex((c) => c.name === column)
  if (i < 0) return rect.y + HEADER_H / 2
  return rect.y + HEADER_H + 2 + i * ROW_H + ROW_H / 2
}

export interface EdgeGeometry {
  /** SVG path data of the relation line */
  d: string
  /** the arrow head at the referenced end (polygon points) */
  arrow: string
  /** the referencing end (a small circle) */
  start: { x: number; y: number }
}

/**
 * The line of a relation: from the referencing column's side of its box to the referenced column's
 * side, as a horizontal-tangent cubic curve; a self-reference loops out of the right side.
 */
export function edgeGeometry(
  edge: DiagramEdge,
  positions: Positions,
  nodes: ReadonlyMap<string, DiagramNode>,
): EdgeGeometry | null {
  const a = positions.get(edge.from)
  const b = positions.get(edge.to)
  const na = nodes.get(edge.from)
  const nb = nodes.get(edge.to)
  if (a === undefined || b === undefined || na === undefined || nb === undefined) return null
  const sy = columnY(a, na, edge.relation.columns[0])
  const ty = columnY(b, nb, edge.relation.refColumns[0])
  let sx: number
  let tx: number
  let sDir: number
  let tDir: number
  if (edge.from === edge.to) {
    sx = a.x + a.width
    tx = b.x + b.width
    sDir = 1
    tDir = 1
  } else if (b.x + b.width <= a.x) {
    // referenced box on the left
    sx = a.x
    tx = b.x + b.width
    sDir = -1
    tDir = 1
  } else if (b.x >= a.x + a.width) {
    sx = a.x + a.width
    tx = b.x
    sDir = 1
    tDir = -1
  } else {
    // stacked: both on the right side
    sx = a.x + a.width
    tx = b.x + b.width
    sDir = 1
    tDir = 1
  }
  const dist = Math.abs(tx - sx)
  const bend = edge.from === edge.to || sDir === tDir ? 40 + Math.abs(ty - sy) / 6 : Math.max(36, dist / 2)
  const ax = tx + tDir * 9
  const d = `M${r(sx)},${r(sy)} C${r(sx + sDir * bend)},${r(sy)} ${r(ax + tDir * bend)},${r(ty)} ${r(ax)},${r(ty)}`
  const arrow = `${r(tx)},${r(ty)} ${r(ax)},${r(ty - 4.5)} ${r(ax)},${r(ty + 4.5)}`
  return { d, arrow, start: { x: sx, y: sy } }
}

const r = (n: number) => Math.round(n * 10) / 10

/** Tables whose name contains the search text (case-insensitive), in diagram order. */
export function searchTables(tables: readonly ErTable[], text: string): string[] {
  const q = text.trim().toLowerCase()
  if (q === '') return []
  const exact = tables.filter((t) => t.name.toLowerCase() === q).map((t) => t.name)
  const rest = tables.filter((t) => t.name.toLowerCase() !== q && t.name.toLowerCase().includes(q))
  return [...exact, ...rest.map((t) => t.name)]
}

export interface View {
  x: number
  y: number
  k: number
}

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 4

export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))

/** The view that shows `b` whole in a viewport of `w`×`h` (never zoomed in beyond 100 %). */
export function fitView(b: Bounds, w: number, h: number, pad = 16): View {
  const k = clampZoom(Math.min(1, (w - 2 * pad) / b.width, (h - 2 * pad) / b.height))
  return { k, x: (w - b.width * k) / 2 - b.x * k, y: (h - b.height * k) / 2 - b.y * k }
}

/** The view that centres `rect` at zoom `k` (at least 0.8 so a found table is readable). */
export function centreView(rect: Rect, w: number, h: number, k: number): View {
  const z = Math.max(k, 0.8)
  return { k: z, x: w / 2 - (rect.x + rect.width / 2) * z, y: h / 2 - (rect.y + rect.height / 2) * z }
}

/** Zoom by `factor` keeping the point (px, py) of the viewport in place. */
export function zoomAt(v: View, factor: number, px: number, py: number): View {
  const k = clampZoom(v.k * factor)
  const f = k / v.k
  return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f }
}

/** "a.x, a.y" for the text alternative and titles. */
export const columnsText = (cols: readonly string[]) => cols.join(', ')

/** The referenced side as written in the text alternative: `table.col` or `db.table.col`. */
export function refText(rel: ErRelation, db: string): string {
  const prefix = rel.refDb === db ? '' : `${rel.refDb}.`
  return `${prefix}${rel.refTable} (${columnsText(rel.refColumns)})`
}

/** A file name for the exported image: the database name without path separators. */
export function diagramFileName(db: string, ext: 'svg' | 'png'): string {
  const printable = [...db].map((ch) => ((ch.codePointAt(0) ?? 0) < 32 ? '_' : ch)).join('')
  const base = printable.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'diagram'
  return `${base}.${ext}`
}

/** Canvas size limits: iOS / iPadOS Safari draws at most 16,777,216 pixels (4096²) on one canvas
 * and returns no image past it; other browsers take far more. */
export const IOS_CANVAS_AREA = 16_777_216
export const CANVAS_AREA = 100_000_000
export function canvasAreaLimit(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): number {
  // iPadOS reports a Mac user agent: a touch-screen "Macintosh" is an iPad
  const ios =
    /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)
  return ios ? IOS_CANVAS_AREA : CANVAS_AREA
}

/** The largest PNG scale (≤ 2) whose canvas stays inside the browser limits. */
export function pngScale(b: Bounds, maxSide = 16384, maxArea = CANVAS_AREA): number {
  let s = 2
  s = Math.min(s, maxSide / b.width, maxSide / b.height)
  s = Math.min(s, Math.sqrt(maxArea / (b.width * b.height)))
  return Math.max(0.1, s)
}
