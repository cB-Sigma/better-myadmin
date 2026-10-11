import type { GisPageRequest, GisPageResponse } from '@bettermyadmin/contracts'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconText,
  MessageBox,
  NativeSelect,
  Panel,
} from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Globe, ZoomIn, ZoomOut } from 'lucide-react'
import { type PointerEvent, type WheelEvent, useMemo, useRef, useState } from 'react'
import { type TableRef, api, errorMessage } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { RowsFieldsetInputs } from '../table/chart/ChartPage'
import type { VisualizationSearch } from '../table/chart/ChartPage'
import { GIS_PNG_BACKGROUND, hex, svgDocument, svgShapes } from './visualization'

/**
 * Visualize GIS data of a query result: the label / spatial column selects (autosubmit), the
 * rows fieldset, the SVG with its zoom and pan controls, the PNG / SVG download.
 *
 * pma: resources/templates/table/gis_visualization/gis_visualization.twig,
 *      resources/js/table/gis_visualization.ts (SvgVisualization)
 */
export function GisVisualizationPage({ scope, search }: { scope: TableRef; search: VisualizationSearch }) {
  const [settings, setSettings] = useState<{
    spatialColumn?: string
    labelColumn?: string
    pos?: number
    sessionMaxRows?: number
  }>({})
  const req: GisPageRequest = {
    sql: search.sql,
    unlimNumRows: search.unlimNumRows,
    ...(search.pos === undefined ? {} : { pos: search.pos }),
    ...(search.sessionMaxRows === undefined ? {} : { sessionMaxRows: search.sessionMaxRows }),
    ...settings,
  }
  const q = useQuery({
    queryKey: qk.visualization(scope, 'gis', req),
    queryFn: () => api.gisPage(scope, req),
    placeholderData: (prev) => prev,
  })
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined) return null
  if (q.data.error !== null || q.data.fieldset === null)
    return <MessageBox type="error">{q.data.error ?? ''}</MessageBox>
  return (
    <GisForm
      key={q.data.fieldset.sql}
      page={q.data}
      onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
    />
  )
}

function GisForm({
  page,
  onChange,
}: {
  page: GisPageResponse
  onChange: (patch: {
    spatialColumn?: string
    labelColumn?: string
    pos?: number
    sessionMaxRows?: number
  }) => void
}) {
  const fieldset = page.fieldset ?? { pos: 0, rows: 0, unlimNumRows: 0, sql: '' }
  const [pos, setPos] = useState(fieldset.pos)
  const [rows, setRows] = useState(fieldset.rows)
  const shapes = useMemo(() => svgShapes(page.rows, page.width, page.height), [page])
  const download = (format: 'png' | 'svg') => {
    const doc = svgDocument(shapes, page.width, page.height)
    const name = `${page.spatialColumn}.${format}`
    if (format === 'svg') {
      save(new Blob([doc], { type: 'image/svg+xml' }), name)
      return
    }
    // the PNG of the same drawing on phpMyAdmin's grey background
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = page.width
      canvas.height = page.height
      const ctx = canvas.getContext('2d')
      if (ctx === null) return
      ctx.fillStyle = hex(GIS_PNG_BACKGROUND)
      ctx.fillRect(0, 0, page.width, page.height)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((b) => b !== null && save(b, name), 'image/png')
    }
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(doc)}`
  }
  return (
    <div id="div_view_options" className="my-3">
      <h2 className="mb-3 text-lg font-semibold">{t('Display GIS Visualization')}</h2>
      <Panel>
        <div id="gis_div">
          <form
            className="flex flex-wrap items-start gap-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault()
              onChange({ pos, sessionMaxRows: rows })
            }}
          >
            <div>
              <label className="mb-1 block" htmlFor="labelColumn">
                {t('Label column')}
              </label>
              <NativeSelect
                name="visualizationSettings[labelColumn]"
                id="labelColumn"
                className="autosubmit"
                value={page.labelColumn}
                onChange={(e) => onChange({ labelColumn: e.target.value, pos, sessionMaxRows: rows })}
              >
                <option value="">{t('-- None --')}</option>
                {page.labelCandidates.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <label className="mb-1 block" htmlFor="spatialColumn">
                {t('Spatial column')}
              </label>
              <NativeSelect
                name="visualizationSettings[spatialColumn]"
                id="spatialColumn"
                className="autosubmit"
                value={page.spatialColumn}
                onChange={(e) => onChange({ spatialColumn: e.target.value, pos, sessionMaxRows: rows })}
              >
                {page.spatialCandidates.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="w-full">
              <RowsFieldsetInputs
                fieldset={fieldset}
                pos={pos}
                rows={rows}
                setPos={setPos}
                setRows={setRows}
              />
            </div>
            <div className="flex w-full items-center justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" id="saveImageButton">
                    <IconText icon="b_saveimage" text={t('Save')} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => download('png')}>PNG</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => download('svg')}>SVG</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </form>
          <SvgPlot shapes={shapes} width={page.width} height={page.height} />
        </div>
      </Panel>
    </div>
  )
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const ZOOM_FACTOR = 1.5

/** SvgVisualization: wheel / double-click zoom, drag pan, the arrow and zoom buttons, tooltips */
function SvgPlot({
  shapes,
  width,
  height,
}: {
  shapes: ReturnType<typeof svgShapes>
  width: number
  height: number
}) {
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const rel = (e: { clientX: number; clientY: number }) => {
    const r = box.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }
  const zoomAt = (p: { x: number; y: number }, factor: number) =>
    setView((v) => ({
      scale: v.scale * factor,
      x: p.x - (p.x - v.x) * factor,
      y: p.y - (p.y - v.y) * factor,
    }))
  const center = { x: width / 2, y: height / 2 }
  const onWheel = (e: WheelEvent) => {
    if (e.deltaY === 0) return
    zoomAt(rel(e), e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (drag.current === null) return
    const dx = Math.round(e.clientX - drag.current.x)
    const dy = Math.round(e.clientY - drag.current.y)
    drag.current = { x: e.clientX, y: e.clientY }
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }
  const controls: Array<[string, React.ReactNode, () => void]> = [
    ['left_arrow', <ArrowLeft key="l" className="size-3" />, () => setView((v) => ({ ...v, x: v.x + 100 }))],
    [
      'right_arrow',
      <ArrowRight key="r" className="size-3" />,
      () => setView((v) => ({ ...v, x: v.x - 100 })),
    ],
    ['up_arrow', <ArrowUp key="u" className="size-3" />, () => setView((v) => ({ ...v, y: v.y + 100 }))],
    ['down_arrow', <ArrowDown key="d" className="size-3" />, () => setView((v) => ({ ...v, y: v.y - 100 }))],
    ['zoom_in', <ZoomIn key="i" className="size-3" />, () => zoomAt(center, ZOOM_FACTOR)],
    ['zoom_world', <Globe key="w" className="size-3" />, () => setView({ x: 0, y: 0, scale: 1 })],
    ['zoom_out', <ZoomOut key="o" className="size-3" />, () => zoomAt(center, 1 / ZOOM_FACTOR)],
  ]
  return (
    <div
      id="visualization-placeholder"
      ref={box}
      className="relative mt-3 overflow-hidden border border-border"
      style={{ height }}
    >
      <div className="visualization-target visualization-target-svg">
        <svg
          width={width}
          height={height}
          className="cursor-move touch-none"
          role="img"
          aria-label={t('Display GIS Visualization')}
          onWheel={onWheel}
          onDoubleClick={(e) => zoomAt(rel(e), ZOOM_FACTOR)}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={onPointerMove}
          onPointerUp={() => {
            drag.current = null
          }}
        >
          <g transform={`translate(${view.x}, ${view.y}) scale(${view.scale})`}>
            {shapes.map((sh, i) => {
              const attrs = Object.fromEntries(
                sh.attrs.map(([k, v]) => [k === 'class' ? 'className' : k, v]),
              ) as Record<string, string>
              // zoomAndPan keeps the marks' size: radius and stroke widths divided by the scale
              const sized =
                sh.tag === 'circle'
                  ? { r: String(3 / view.scale), 'stroke-width': String(2 / view.scale) }
                  : sh.tag === 'polyline'
                    ? { 'stroke-width': String(2 / view.scale) }
                    : { 'stroke-width': String(0.5 / view.scale) }
              const label = attrs['data-label']
              const Tag = sh.tag
              return (
                <Tag
                  // biome-ignore lint/suspicious/noArrayIndexKey: shapes in drawing order
                  key={i}
                  {...attrs}
                  {...sized}
                  onMouseMove={
                    label === undefined
                      ? undefined
                      : (e: React.MouseEvent) => setTip({ text: label, x: e.clientX + 10, y: e.clientY + 10 })
                  }
                  onMouseLeave={() => setTip(null)}
                />
              )
            })}
          </g>
        </svg>
      </div>
      {controls.map(([cls, icon, run], i) => (
        <button
          key={cls}
          type="button"
          className={`button ${cls} absolute rounded border border-border bg-bg-elevated p-0.5`}
          style={{ left: 8 + (i < 4 ? i * 18 : (i - 4) * 18), top: i < 4 ? 8 : 30 }}
          onClick={run}
        >
          {icon}
        </button>
      ))}
      {tip !== null && (
        <div
          id="tooltip"
          className="fixed z-50 rounded border border-border bg-bg-elevated px-1 text-sm"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      )}
    </div>
  )
}
