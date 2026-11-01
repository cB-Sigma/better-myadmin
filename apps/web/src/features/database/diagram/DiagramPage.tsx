import type { ErDiagramResponse, ErRelation } from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import { Button, Input, Loading, MessageBox, PageHeader, Panel, Table, showMessage } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Maximize, Minus, Plus, Workflow } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { api, errorMessage } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import {
  type DagreModule,
  type DiagramEdge,
  type DiagramNode,
  FONT_SIZE,
  HEADER_H,
  type Measure,
  PAD_X,
  ROW_H,
  type Rect,
  type View,
  buildGraph,
  centreView,
  columnsText,
  diagramFileName,
  edgeGeometry,
  estimateWidth,
  fitView,
  layoutGraph,
  refText,
  searchTables,
  zoomAt,
} from './diagram.ts'
import { diagramPng, diagramSvg, saveFile } from './exportImage.ts'

/**
 * Database → Diagram: the automatic, read-only ER diagram of the whole database (BetterMyAdmin-only,
 * parity exception X63; docs/features/05-database-level.md). Unlike the Designer it saves nothing:
 * dagre (loaded with this page only) lays the tables out on every visit.
 */
export function DiagramPage({ server, db }: { server: number; db: string }) {
  const ref = { server, db }
  const q = useQuery({ queryKey: qk.dbPage(ref, 'er-diagram'), queryFn: () => api.erDiagram(ref) })
  const [dagre, setDagre] = useState<DagreModule | null>(null)
  const [listView, setListView] = useState(false)
  useEffect(() => {
    let live = true
    void import('@dagrejs/dagre').then((m) => {
      if (live) setDagre(m)
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="container-fluid" id="er_diagram">
      <PageHeader icon={Workflow}>{labels().diagram}</PageHeader>
      {q.isError ? (
        <MessageBox type="error" text={errorMessage(q.error).text} sql={errorMessage(q.error).sql} />
      ) : q.data === undefined || dagre === null ? (
        <Loading />
      ) : q.data.tables.length === 0 ? (
        <MessageBox type="notice" text={t('No tables found in database.')} />
      ) : (
        <Diagram
          data={q.data}
          dagre={dagre}
          server={server}
          listView={listView}
          onListView={() => setListView((v) => !v)}
        />
      )}
    </div>
  )
}

/** The BetterMyAdmin-only texts of the diagram (X63): new msgids, not in phpMyAdmin's catalogue. */
function labels() {
  return {
    // i18n-new: the BetterMyAdmin-only Diagram tab (X63)
    diagram: t('Diagram'),
    // i18n-new: the accessible name of the ER diagram (X63)
    title: t('Entity-relationship diagram of the database %s'),
    // i18n-new: ER diagram (X63) search result
    noMatch: t('No matching table'),
    // i18n-new: ER diagram (X63) zoom button
    zoomIn: t('Zoom in'),
    // i18n-new: ER diagram (X63) zoom button
    zoomOut: t('Zoom out'),
    // i18n-new: ER diagram (X63) zoom button
    fit: t('Zoom to fit'),
    // i18n-new: ER diagram (X63): show every table's columns again
    expandAll: t('Expand all'),
    // i18n-new: ER diagram (X63) export
    exportSvg: t('Export as SVG'),
    // i18n-new: ER diagram (X63) export
    exportPng: t('Export as PNG'),
    // i18n-new: ER diagram (X63): the text alternative of the canvas
    listView: t('List view'),
    // i18n-new: ER diagram (X63) usage hint
    hint: t('Drag to move, scroll or pinch to zoom, click a table to open its structure.'),
    // i18n-new: ER diagram (X63) text alternative: the list of relations
    relations: t('Relations'),
    // i18n-new: ER diagram (X63) column marker: primary key
    pk: t('PK'),
    // i18n-new: ER diagram (X63) column marker: foreign key
    fk: t('FK'),
    // i18n-new: ER diagram (X63) column marker: unique key
    uq: t('UQ'),
  }
}

/** Canvas measureText in the page font, or the estimate when no canvas context exists. */
function useMeasure(font: string): Measure {
  return useMemo(() => {
    const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
    if (ctx === null) return estimateWidth
    const cache = new Map<string, number>()
    return (text: string, bold = false) => {
      const k = `${bold ? 1 : 0}${text}`
      let w = cache.get(k)
      if (w === undefined) {
        ctx.font = `${bold ? 'bold ' : ''}${FONT_SIZE}px ${font}`
        w = ctx.measureText(text).width
        cache.set(k, w)
      }
      return w
    }
  }, [font])
}

const enc = encodeURIComponent

function Diagram({
  data,
  dagre,
  server,
  listView,
  onListView,
}: {
  data: ErDiagramResponse
  dagre: DagreModule
  server: number
  listView: boolean
  onListView: () => void
}) {
  const navigate = useNavigate()
  const svgRef = useRef<SVGSVGElement>(null)
  const contentRef = useRef<SVGGElement>(null)
  const [font, setFont] = useState('sans-serif')
  useEffect(() => {
    if (svgRef.current !== null) setFont(getComputedStyle(svgRef.current).fontFamily || 'sans-serif')
  }, [])
  const measure = useMeasure(font)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const graph = useMemo(() => buildGraph(data, collapsed, measure), [data, collapsed, measure])
  const layout = useMemo(() => layoutGraph(graph, dagre), [graph, dagre])
  const nodes = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const [size, setSize] = useState({ w: 800, h: 500 })
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)
  const [hoverTable, setHoverTable] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const matches = useMemo(() => searchTables(data.tables, search), [data.tables, search])
  const fitted = useRef(false)

  // viewport size; the first layout is fitted to it (the svg is a new element after the list view)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach to the svg remounted with listView
  useEffect(() => {
    const el = svgRef.current
    if (el === null) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [listView])
  useEffect(() => {
    if (fitted.current || size.w <= 1) return
    fitted.current = true
    setView(fitView(layout.bounds, size.w, size.h))
  }, [layout, size])

  const fit = () => setView(fitView(layout.bounds, size.w, size.h))
  const zoomBy = (f: number) => setView((v) => zoomAt(v, f, size.w / 2, size.h / 2))
  const centreOn = useCallback(
    (name: string) => {
      const rect = layout.positions.get(name)
      if (rect !== undefined) setView((v) => centreView(rect, size.w, size.h, v.k))
    },
    [layout, size],
  )
  const onSearch = (text: string) => {
    setSearch(text)
    setMatchIndex(0)
    const first = searchTables(data.tables, text)[0]
    if (first !== undefined) centreOn(first)
  }
  const nextMatch = () => {
    if (matches.length === 0) return
    const i = (matchIndex + 1) % matches.length
    setMatchIndex(i)
    centreOn(matches[i] ?? '')
  }

  // wheel zoom around the pointer (a non-passive listener so the page does not scroll)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach to the svg remounted with listView
  useEffect(() => {
    const el = svgRef.current
    if (el === null) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      setView((v) => zoomAt(v, Math.exp(-dy * 0.0015), e.clientX - r.left, e.clientY - r.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [listView])

  // drag to pan, two pointers to pinch-zoom; a drag does not count as a click on a table
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const dragged = useRef(false)
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    if (pointers.current.size === 0) dragged.current = false
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const el = svgRef.current
    if (el === null) return
    const move = (ev: PointerEvent) => {
      const prev = pointers.current.get(ev.pointerId)
      if (prev === undefined) return
      const pts = [...pointers.current.entries()]
      if (pts.length === 1) {
        const dx = ev.clientX - prev.x
        const dy = ev.clientY - prev.y
        if (!dragged.current && Math.hypot(dx, dy) < 3) return
        dragged.current = true
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
      } else if (pts.length === 2) {
        const other = pts.find(([id]) => id !== ev.pointerId)?.[1]
        if (other !== undefined) {
          const before = Math.hypot(prev.x - other.x, prev.y - other.y)
          const after = Math.hypot(ev.clientX - other.x, ev.clientY - other.y)
          const r = el.getBoundingClientRect()
          if (before > 0) {
            dragged.current = true
            setView((v) =>
              zoomAt(
                v,
                after / before,
                (ev.clientX + other.x) / 2 - r.left,
                (ev.clientY + other.y) / 2 - r.top,
              ),
            )
          }
        }
      }
      pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    }
    const up = (ev: PointerEvent) => {
      pointers.current.delete(ev.pointerId)
      if (pointers.current.size === 0) {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
    }
    if (pointers.current.size === 1) {
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    if (e.target !== e.currentTarget) return
    const step = 60
    const keys: Record<string, () => void> = {
      '+': () => zoomBy(1.25),
      '=': () => zoomBy(1.25),
      '-': () => zoomBy(0.8),
      '0': fit,
      ArrowLeft: () => setView((v) => ({ ...v, x: v.x + step })),
      ArrowRight: () => setView((v) => ({ ...v, x: v.x - step })),
      ArrowUp: () => setView((v) => ({ ...v, y: v.y + step })),
      ArrowDown: () => setView((v) => ({ ...v, y: v.y - step })),
    }
    const fn = keys[e.key]
    if (fn !== undefined) {
      e.preventDefault()
      fn()
    }
  }

  const structureHref = useCallback(
    (table: string) => `/s/${server}/db/${enc(data.db)}/t/${enc(table)}/structure`,
    [server, data.db],
  )
  const open = useCallback(
    (table: string) => {
      if (dragged.current) return
      void navigate({ to: structureHref(table) })
    },
    [navigate, structureHref],
  )
  const toggle = useCallback((table: string) => {
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(table)) n.delete(table)
      else n.add(table)
      return n
    })
  }, [])

  // what to highlight: the two ends of the hovered relation, or the relations of the hovered table
  const hl = useMemo(() => {
    const tables = new Set<string>()
    const edges = new Set<string>()
    const cols = new Map<string, Set<string>>()
    const addCols = (table: string, c: readonly string[]) => {
      const s = cols.get(table) ?? new Set<string>()
      cols.set(table, s)
      for (const x of c) s.add(x)
    }
    for (const e of graph.edges) {
      if (e.id !== hoverEdge && (hoverTable === null || (e.from !== hoverTable && e.to !== hoverTable)))
        continue
      if (hoverEdge === null && hoverTable === null) continue
      edges.add(e.id)
      tables.add(e.from)
      tables.add(e.to)
      addCols(e.from, e.relation.columns)
      addCols(e.to, e.relation.refColumns)
    }
    return { tables, edges, cols }
  }, [graph, hoverEdge, hoverTable])
  const found = useMemo(() => new Set(matches), [matches])
  const current = matches[matchIndex] ?? null

  const L = labels()
  const title = sprintf(L.title, data.db)

  const exportSvg = () => {
    if (svgRef.current === null || contentRef.current === null) return
    const text = diagramSvg(svgRef.current, contentRef.current, layout.bounds, title)
    saveFile(new Blob([text], { type: 'image/svg+xml' }), diagramFileName(data.db, 'svg'))
  }
  const exportPng = async () => {
    if (svgRef.current === null || contentRef.current === null) return
    const text = diagramSvg(svgRef.current, contentRef.current, layout.bounds, title)
    try {
      saveFile(await diagramPng(text, layout.bounds), diagramFileName(data.db, 'png'))
    } catch (e) {
      showMessage(String(e), false, 'error')
    }
  }

  const content = useMemo(
    () => (
      <DiagramContent
        nodes={graph.nodes}
        edges={graph.edges}
        fkColumns={graph.fkColumns}
        positions={layout.positions}
        nodeMap={nodes}
        hl={hl}
        found={found}
        current={current}
        href={structureHref}
        onOpen={open}
        onToggle={toggle}
        onHoverEdge={setHoverEdge}
        onHoverTable={setHoverTable}
      />
    ),
    [graph, layout, nodes, hl, found, current, structureHref, open, toggle],
  )

  const allCollapsed = collapsed.size === data.tables.length
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2" role="toolbar" aria-label={title}>
        <div className="flex items-center gap-1">
          <Input
            type="search"
            className="w-56"
            aria-label={t('Search')}
            placeholder={t('Table name')}
            value={search}
            disabled={listView}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                nextMatch()
              }
            }}
          />
          {search.trim() !== '' && (
            <span
              className="whitespace-nowrap text-[13px] text-fg-muted"
              aria-live="polite"
              data-testid="er-search-count"
            >
              {matches.length === 0 ? L.noMatch : `${matchIndex + 1} / ${matches.length}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            title={L.zoomIn}
            aria-label={L.zoomIn}
            disabled={listView}
            onClick={() => zoomBy(1.25)}
          >
            <Plus aria-hidden />
          </Button>
          <Button
            size="icon"
            title={L.zoomOut}
            aria-label={L.zoomOut}
            disabled={listView}
            onClick={() => zoomBy(0.8)}
          >
            <Minus aria-hidden />
          </Button>
          <Button size="icon" title={L.fit} aria-label={L.fit} disabled={listView} onClick={fit}>
            <Maximize aria-hidden />
          </Button>
          <Button
            disabled={listView}
            onClick={() => setView((v) => zoomAt(v, 1 / v.k, size.w / 2, size.h / 2))}
          >
            {t('Reset zoom')}
          </Button>
          <span className="min-w-12 text-[13px] text-fg-muted tabular-nums" data-testid="er-zoom">
            {Math.round(view.k * 100)}%
          </span>
        </div>
        <Button
          disabled={listView}
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(data.tables.map((x) => x.name)))}
        >
          {allCollapsed ? L.expandAll : t('Collapse all')}
        </Button>
        <div className="flex items-center gap-1">
          <Button disabled={listView} onClick={exportSvg}>
            {L.exportSvg}
          </Button>
          <Button disabled={listView} onClick={() => void exportPng()}>
            {L.exportPng}
          </Button>
        </div>
        <Button aria-pressed={listView} onClick={onListView}>
          {L.listView}
        </Button>
      </div>
      {listView ? (
        <DiagramText data={data} href={structureHref} />
      ) : (
        <>
          <svg
            ref={svgRef}
            role="group"
            aria-label={title}
            aria-roledescription="diagram"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas pans (arrows) and zooms (+, -, 0) from the keyboard
            tabIndex={0}
            data-testid="er-canvas"
            className="block h-[calc(100vh-240px)] min-h-[420px] w-full cursor-grab touch-none select-none rounded-(--radius) border border-border focus-visible:outline-2 focus-visible:outline-(--focus-ring) active:cursor-grabbing"
            style={{ background: 'var(--bg-inset)', fontSize: FONT_SIZE }}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
          >
            <g ref={contentRef} transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {content}
            </g>
          </svg>
          <p className="mt-1 text-[12px] text-fg-muted">{L.hint}</p>
        </>
      )}
    </>
  )
}

interface Highlight {
  tables: ReadonlySet<string>
  edges: ReadonlySet<string>
  cols: ReadonlyMap<string, ReadonlySet<string>>
}

/** The edges below the tables; memoised so panning and zooming only change the transform. */
const DiagramContent = memo(function DiagramContent({
  nodes,
  edges,
  fkColumns,
  positions,
  nodeMap,
  hl,
  found,
  current,
  href,
  onOpen,
  onToggle,
  onHoverEdge,
  onHoverTable,
}: {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  fkColumns: ReadonlyMap<string, ReadonlySet<string>>
  positions: ReadonlyMap<string, Rect>
  nodeMap: ReadonlyMap<string, DiagramNode>
  hl: Highlight
  found: ReadonlySet<string>
  current: string | null
  href: (table: string) => string
  onOpen: (table: string) => void
  onToggle: (table: string) => void
  onHoverEdge: (id: string | null) => void
  onHoverTable: (table: string | null) => void
}) {
  return (
    <>
      <g data-layer="edges">
        {edges.map((e) => {
          const geo = edgeGeometry(e, positions as Map<string, Rect>, nodeMap)
          if (geo === null) return null
          const on = hl.edges.has(e.id)
          const color = on ? 'var(--accent)' : 'var(--fg-subtle)'
          const label = `${e.from} (${columnsText(e.relation.columns)}) → ${e.to} (${columnsText(e.relation.refColumns)})`
          return (
            <g
              key={e.id}
              data-edge={e.id}
              data-from={e.from}
              data-to={e.to}
              data-highlighted={on ? 'true' : undefined}
              className="er-edge"
              onPointerEnter={() => onHoverEdge(e.id)}
              onPointerLeave={() => onHoverEdge(null)}
            >
              <title>{label}</title>
              <path
                d={geo.d}
                style={{ fill: 'none', stroke: 'transparent', strokeWidth: 10 }}
                data-export="skip"
              />
              <path
                d={geo.d}
                style={{
                  fill: 'none',
                  stroke: color,
                  strokeWidth: on ? 2.5 : 1.3,
                  strokeDasharray: e.relation.kind === 'internal' ? '5 4' : undefined,
                }}
              />
              <polygon points={geo.arrow} style={{ fill: color }} />
              <circle cx={geo.start.x} cy={geo.start.y} r={2.8} style={{ fill: color }} />
            </g>
          )
        })}
      </g>
      <g data-layer="tables">
        {nodes.map((n) => {
          const rect = positions.get(n.id)
          if (rect === undefined) return null
          return (
            <TableBox
              key={n.id}
              node={n}
              rect={rect}
              fk={fkColumns.get(n.id)}
              highlighted={hl.tables.has(n.id)}
              cols={hl.cols.get(n.id)}
              found={found.has(n.id)}
              current={current === n.id}
              href={href(n.id)}
              onOpen={onOpen}
              onToggle={onToggle}
              onHover={onHoverTable}
            />
          )
        })}
      </g>
    </>
  )
})

const TableBox = memo(function TableBox({
  node,
  rect,
  fk,
  highlighted,
  cols,
  found,
  current,
  href,
  onOpen,
  onToggle,
  onHover,
}: {
  node: DiagramNode
  rect: Rect
  fk: ReadonlySet<string> | undefined
  highlighted: boolean
  cols: ReadonlySet<string> | undefined
  found: boolean
  current: boolean
  href: string
  onOpen: (table: string) => void
  onToggle: (table: string) => void
  onHover: (table: string | null) => void
}) {
  const { table } = node
  const view = table.view
  const stroke = current || found || highlighted ? 'var(--accent)' : 'var(--card-border)'
  const strokeWidth = current ? 3 : found || highlighted ? 2 : 1
  const headerBg = view ? 'var(--bg-subtle)' : 'var(--card-head-bg)'
  const headerFg = view ? 'var(--fg)' : 'var(--card-head-fg)'
  const L = labels()
  return (
    <g
      transform={`translate(${rect.x},${rect.y})`}
      data-table={table.name}
      data-collapsed={node.collapsed ? 'true' : undefined}
      data-view={view ? 'true' : undefined}
      data-found={found ? 'true' : undefined}
      data-current={current ? 'true' : undefined}
      data-highlighted={highlighted ? 'true' : undefined}
      className="er-table"
      onPointerEnter={() => onHover(table.name)}
      onPointerLeave={() => onHover(null)}
    >
      <a
        href={href}
        aria-label={table.name}
        style={{ textDecoration: 'none' }}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
          e.preventDefault()
          onOpen(table.name)
        }}
      >
        <title>
          {view
            ? `${t('View')}: ${table.name}`
            : table.comment !== ''
              ? `${table.name}: ${table.comment}`
              : table.name}
        </title>
        <rect
          width={rect.width}
          height={rect.height}
          rx={4}
          style={{
            fill: 'var(--card-bg)',
            stroke,
            strokeWidth,
            strokeDasharray: view ? '6 3' : undefined,
          }}
        />
        <path
          d={`M0,${HEADER_H} V4 q0,-4 4,-4 H${rect.width - 4} q4,0 4,4 V${HEADER_H} Z`}
          style={{ fill: headerBg }}
        />
        <text
          x={PAD_X}
          y={HEADER_H / 2}
          dominantBaseline="central"
          style={{ fill: headerFg, fontWeight: 'bold', fontStyle: view ? 'italic' : undefined }}
        >
          {table.name}
        </text>
        {!node.collapsed &&
          table.columns.map((c, i) => {
            const y = HEADER_H + 2 + i * ROW_H
            const isFk = fk?.has(c.name) ?? false
            const on = cols?.has(c.name) ?? false
            const marker = c.pk ? L.pk : isFk ? L.fk : c.unique ? L.uq : ''
            return (
              <g key={c.name} transform={`translate(0,${y})`} data-column={c.name}>
                {on && (
                  <rect
                    x={1}
                    width={rect.width - 2}
                    height={ROW_H}
                    style={{ fill: 'var(--grid-row-marked)' }}
                  />
                )}
                {marker !== '' && (
                  <text
                    x={PAD_X - 2}
                    y={ROW_H / 2}
                    dominantBaseline="central"
                    style={{
                      fill: c.pk ? 'var(--accent)' : 'var(--fg-muted)',
                      fontSize: 9,
                      fontWeight: 'bold',
                    }}
                  >
                    <title>{c.pk ? t('Primary') : isFk ? t('Foreign key constraint') : t('Unique')}</title>
                    {marker}
                  </text>
                )}
                <text
                  x={PAD_X + 20}
                  y={ROW_H / 2}
                  dominantBaseline="central"
                  style={{ fill: 'var(--fg)', fontWeight: c.pk ? 'bold' : undefined }}
                >
                  {c.name}
                  {c.nullable && (
                    <tspan style={{ fill: 'var(--fg-muted)' }}>
                      <title>{t('Null')}</title>?
                    </tspan>
                  )}
                </text>
                <text
                  x={rect.width - PAD_X}
                  y={ROW_H / 2}
                  dominantBaseline="central"
                  textAnchor="end"
                  style={{ fill: 'var(--fg-muted)' }}
                >
                  {c.type.length > 32 ? `${c.type.slice(0, 31)}…` : c.type}
                </text>
              </g>
            )
          })}
      </a>
      <g
        role="button"
        tabIndex={0}
        aria-label={node.collapsed ? t('Expand') : t('Collapse')}
        aria-expanded={!node.collapsed}
        data-export="skip"
        className="er-toggle cursor-pointer"
        transform={`translate(${rect.width - 20},4)`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onToggle(table.name)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle(table.name)
          }
        }}
      >
        <rect width={16} height={16} rx={3} style={{ fill: 'var(--bg)', stroke: 'var(--card-border)' }} />
        <path
          d={node.collapsed ? 'M4,8 H12 M8,4 V12' : 'M4,8 H12'}
          style={{ stroke: 'var(--fg)', strokeWidth: 1.5 }}
        />
      </g>
    </g>
  )
})

/** The text alternative of the canvas: the tables with their columns, then every relation. */
function DiagramText({ data, href }: { data: ErDiagramResponse; href: (table: string) => string }) {
  const navigate = useNavigate()
  const link = (table: string) => (
    <a
      href={href(table)}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        void navigate({ to: href(table) })
      }}
    >
      {table}
    </a>
  )
  const relKind = (r: ErRelation) => (r.kind === 'fk' ? t('Foreign key constraint') : t('Internal relation'))
  return (
    <div data-testid="er-list">
      <Panel title={t('Tables')}>
        <Table zebra className="w-full">
          <thead>
            <tr>
              <th>{t('Table')}</th>
              <th>{t('Type')}</th>
              <th>{t('Columns')}</th>
            </tr>
          </thead>
          <tbody>
            {data.tables.map((tb) => (
              <tr key={tb.name}>
                <td>{link(tb.name)}</td>
                <td>{tb.view ? t('View') : tb.engine}</td>
                <td>
                  {tb.columns
                    .map(
                      (c) =>
                        `${c.name} ${c.type}${c.pk ? ` (${t('Primary')})` : c.unique ? ` (${t('Unique')})` : ''}${c.nullable ? ` ${t('Null')}` : ''}`,
                    )
                    .join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      <Panel title={labels().relations}>
        {data.relations.length === 0 ? (
          <p className="p-2 text-[13px]">{t('None')}</p>
        ) : (
          <Table zebra className="w-full">
            <thead>
              <tr>
                <th>{t('Table')}</th>
                <th>{t('Columns')}</th>
                <th>{t('Links to')}</th>
                <th>{t('Type')}</th>
              </tr>
            </thead>
            <tbody>
              {data.relations.map((r) => (
                <tr key={`${r.kind}\u0000${r.table}\u0000${r.name}\u0000${r.columns.join(',')}`}>
                  <td>{link(r.table)}</td>
                  <td>{columnsText(r.columns)}</td>
                  <td>{refText(r, data.db)}</td>
                  <td>
                    {relKind(r)}
                    {r.name !== '' ? ` ${r.name}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  )
}
