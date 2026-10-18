import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeCheckbox,
  NativeSelect,
  Panel,
  PanelBody,
  Textarea,
} from '@bettermyadmin/ui'
import { useMemo, useState } from 'react'
import { pgettext, t } from '../../lib/i18n'
import { OlPlot } from './OlPlot'
import {
  GIS_TYPES,
  type Geom,
  type GisType,
  type GisValue,
  type Pt,
  emptyGeom,
  generateWkt,
  initialValue,
  resultValue,
  shapes,
} from './gis'
import { olDataset } from './visualization'

/**
 * The GIS data editor modal (`#gisEditorModal`): geometry type (GEOMETRY columns only), SRID,
 * coordinate rows with "+ Add …" buttons, an SVG preview and the `'WKT',srid` output.
 * "Use OpenStreetMaps as Base Layer" switches the preview to the OpenLayers map (on when the SRID
 * is not 0), redrawn after each change like GisVisualizationController.
 * pma: templates/gis_data_editor_form.twig, templates/modals/gis_editor.twig, js/gis_data_editor.ts
 */
export function GisEditor({
  field,
  columnType,
  value,
  onCopy,
  onClose,
}: {
  field: string
  /** the row's column type (span.column_type) */
  columnType: string
  value: string
  onCopy: (v: string) => void
  onClose: () => void
}) {
  const init = initialValue(columnType, value)
  const [v, setV] = useState<GisValue>(init.value)
  const fixedType = columnType.toUpperCase() !== 'GEOMETRY'
  const setGeom = (geom: Geom) => setV((s) => ({ ...s, geom }))
  const setGeomNow = (geom: Geom) => {
    setGeom(geom)
    setShown((s) => ({ ...s, geom }))
  }
  // updateResult() runs on `change` of an input (blur) and on the add/type buttons, not per key
  const [shown, setShown] = useState<GisValue>(init.value)
  const output = resultValue(shown)
  // gis_data_editor_form.twig: checked when srid != 0
  const [useOsm, setUseOsm] = useState((Number.parseInt(init.value.srid, 10) || 0) !== 0)
  const olData = useMemo(
    () =>
      olDataset(
        [{ wkt: generateWkt(shown.geom), srid: Number.parseInt(shown.srid, 10) || 0, label: '' }],
        PREVIEW_W,
        PREVIEW_H,
      ),
    [shown],
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl" id="gisEditorModal" aria-describedby={undefined} modal="static">
        <DialogHeader>
          <DialogTitle>{t('Value for the column "%s"', field)}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form id="gis_data_editor_form" onSubmit={(e) => e.preventDefault()} onBlur={() => setShown(v)}>
            <div className="flex flex-wrap gap-4">
              <div className="min-w-80 flex-1 space-y-3" id="gis_data">
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <Label htmlFor="gisDataEditorTypeSelect">{t('Geometry type:')}</Label>
                    {fixedType ? (
                      <Input
                        id="gisDataEditorTypeSelect"
                        name="gis_data[gis_type]"
                        value={v.geom.type}
                        disabled
                        readOnly
                      />
                    ) : (
                      <NativeSelect
                        id="gisDataEditorTypeSelect"
                        name="gis_data[gis_type]"
                        className="w-full"
                        value={v.geom.type}
                        onChange={(e) => setGeomNow(emptyGeom(e.target.value as GisType))}
                      >
                        {GIS_TYPES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="srid">
                      <abbr title={t('Spatial Reference System Identifier')}>
                        {pgettext('Spatial Reference System Identifier', 'SRID:')}
                      </abbr>
                    </Label>
                    <Input
                      id="srid"
                      name="gis_data[srid]"
                      value={v.srid}
                      onChange={(e) => setV((s) => ({ ...s, srid: e.target.value }))}
                      className="w-24"
                    />
                  </div>
                </div>
                <GeomInputs geom={v.geom} onChange={setGeom} />
              </div>
              <Panel className="self-start">
                <PanelBody>
                  <div
                    id="visualization-placeholder"
                    className="relative"
                    style={{ width: PREVIEW_W, height: PREVIEW_H }}
                  >
                    {!useOsm && <Preview geom={shown.geom} />}
                    {/* onCoordinateEdit: the map is made again for the new geometry */}
                    <OlPlot key={JSON.stringify(olData)} data={olData} visible={useOsm} />
                  </div>
                </PanelBody>
                <div className="border-t border-border px-3 py-2">
                  <Label className="flex items-center gap-2" id="useOsmAsBaseLayerSwitchLabel">
                    <NativeCheckbox
                      role="switch"
                      id="useOsmAsBaseLayerSwitch"
                      value="useBaseLayer"
                      checked={useOsm}
                      onChange={(e) => setUseOsm(e.target.checked)}
                    />
                    {t('Use OpenStreetMaps as Base Layer')}
                  </Label>
                </div>
              </Panel>
            </div>
            <div className="mt-3">
              <Label htmlFor="gis_data_textarea">{t('Output')}</Label>
              <Textarea key={output} id="gis_data_textarea" rows={5} defaultValue={output} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="primary" className="gis-copy-data" onClick={() => onCopy(resultValue(v))}>
                {t('Copy')}
              </Button>
              <Button onClick={onClose}>{t('Cancel')}</Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

/** Coordinate rows, rings and geometries are positional (gis_data[i]…). */
const keyOf = (i: number) => `n${i}`

function PointRow({ label, p, onChange }: { label: string; p: Pt; onChange: (p: Pt) => void }) {
  return (
    <div className="gis-coordinates mb-2 flex items-center gap-2 text-[13px]">
      <div className="w-24 shrink-0">{label}</div>
      {(['x', 'y'] as const).map((k) => (
        <span key={k} className="flex flex-1 items-center gap-1">
          <Input
            aria-label={k === 'x' ? t('X') : t('Y')}
            placeholder={k === 'x' ? t('X') : t('Y')}
            value={p[k]}
            onChange={(e) => onChange({ ...p, [k]: e.target.value })}
          />
        </span>
      ))}
    </div>
  )
}

function PointList({ points, onChange, min }: { points: Pt[]; onChange: (p: Pt[]) => void; min: number }) {
  const list =
    points.length >= min
      ? points
      : [...points, ...Array.from({ length: min - points.length }, () => ({ x: '', y: '' }))]
  return (
    <div className="gis-coordinates-list">
      {list.map((p, i) => (
        <PointRow
          key={keyOf(i)}
          label={`${t('Point')} ${i + 1}:`}
          p={p}
          onChange={(np) => onChange(list.map((x, j) => (j === i ? np : x)))}
        />
      ))}
      <Button size="sm" className="addJs addPoint" onClick={() => onChange([...list, { x: '', y: '' }])}>
        + {t('Add a point')}
      </Button>
    </div>
  )
}

function Lines({
  lines,
  onChange,
  min,
  label,
  addLabel,
}: {
  lines: Pt[][]
  onChange: (l: Pt[][]) => void
  min: number
  label: (i: number) => string
  addLabel: string
}) {
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <Panel key={keyOf(i)} title={label(i)}>
          <PanelBody>
            <PointList
              points={l}
              min={min}
              onChange={(nl) => onChange(lines.map((x, j) => (j === i ? nl : x)))}
            />
          </PanelBody>
        </Panel>
      ))}
      <Button
        size="sm"
        className="addJs addLine"
        onClick={() => onChange([...lines, Array.from({ length: min }, () => ({ x: '', y: '' }))])}
      >
        + {addLabel}
      </Button>
    </div>
  )
}

function GeomInputs({
  geom,
  onChange,
  sub = false,
}: { geom: Geom; onChange: (g: Geom) => void; sub?: boolean }) {
  switch (geom.type) {
    case 'POINT':
      return (
        <PointRow
          label={`${t('Point')}:`}
          p={geom.point}
          onChange={(point) => onChange({ ...geom, point })}
        />
      )
    case 'MULTIPOINT':
      return <PointList points={geom.points} min={1} onChange={(points) => onChange({ ...geom, points })} />
    case 'LINESTRING':
      return <PointList points={geom.points} min={2} onChange={(points) => onChange({ ...geom, points })} />
    case 'MULTILINESTRING':
      return (
        <Lines
          lines={geom.lines}
          min={2}
          label={(i) => `${t('Linestring')} ${i + 1}:`}
          addLabel={t('Add a linestring')}
          onChange={(lines) => onChange({ ...geom, lines })}
        />
      )
    case 'POLYGON':
      return (
        <Lines
          lines={geom.lines}
          min={4}
          label={(i) => `${i === 0 ? t('Outer ring') : `${t('Inner ring')} ${i}`}:`}
          addLabel={t('Add an inner ring')}
          onChange={(lines) => onChange({ ...geom, lines })}
        />
      )
    case 'MULTIPOLYGON':
      return (
        <div className="space-y-2">
          {geom.polygons.map((p, i) => (
            <Panel key={keyOf(i)} title={`${t('Polygon')} ${i + 1}:`}>
              <PanelBody>
                <GeomInputs
                  geom={{ type: 'POLYGON', lines: p }}
                  onChange={(g) =>
                    g.type === 'POLYGON' &&
                    onChange({ ...geom, polygons: geom.polygons.map((x, j) => (j === i ? g.lines : x)) })
                  }
                />
              </PanelBody>
            </Panel>
          ))}
          <Button
            size="sm"
            className="addJs addPolygon"
            onClick={() =>
              onChange({
                ...geom,
                polygons: [...geom.polygons, [Array.from({ length: 4 }, () => ({ x: '', y: '' }))]],
              })
            }
          >
            + {t('Add a polygon')}
          </Button>
        </div>
      )
    case 'GEOMETRYCOLLECTION':
      if (sub) return null
      return (
        <div className="space-y-2">
          {geom.geoms.map((g, i) => (
            <Panel key={keyOf(i)} title={`${t('Geometry')} ${i + 1}:`}>
              <PanelBody className="space-y-2">
                <NativeSelect
                  className="gis_type"
                  value={g.type}
                  onChange={(e) =>
                    onChange({
                      ...geom,
                      geoms: geom.geoms.map((x, j) => (j === i ? emptyGeom(e.target.value as GisType) : x)),
                    })
                  }
                >
                  {GIS_TYPES.filter((x) => x !== 'GEOMETRYCOLLECTION').map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </NativeSelect>
                <GeomInputs
                  sub
                  geom={g}
                  onChange={(ng) =>
                    onChange({ ...geom, geoms: geom.geoms.map((x, j) => (j === i ? ng : x)) })
                  }
                />
              </PanelBody>
            </Panel>
          ))}
          <Button
            size="sm"
            className="addJs addGeom"
            onClick={() => onChange({ ...geom, geoms: [...geom.geoms, emptyGeom('POINT')] })}
          >
            + {t('Add geometry')}
          </Button>
        </div>
      )
  }
}

/** GisDataEditorController: the visualization is 450×300 */
const PREVIEW_W = 450
const PREVIEW_H = 300

/** GisVisualization::asSVG (450×300), drawn client-side */
function Preview({ geom }: { geom: Geom }) {
  const W = PREVIEW_W
  const H = PREVIEW_H
  const all = shapes(geom)
  const coords = all.flatMap((s) => s.paths.flat())
  const xs = coords.map((c) => c[0])
  const ys = coords.map((c) => c[1])
  const minX = Math.min(...xs, 0)
  const maxX = Math.max(...xs, 1)
  const minY = Math.min(...ys, 0)
  const maxY = Math.max(...ys, 1)
  const scale = Math.min((W - 40) / (maxX - minX || 1), (H - 40) / (maxY - minY || 1))
  const px = (c: [number, number]) => `${20 + (c[0] - minX) * scale},${H - 20 - (c[1] - minY) * scale}`
  return (
    <svg
      width={W}
      height={H}
      className="visualization-target visualization-target-svg bg-bg"
      role="img"
      aria-label={t('Output')}
    >
      {all.map((s, i) =>
        s.kind === 'point' ? (
          s.paths[0]?.[0] !== undefined && (
            <circle
              key={keyOf(i)}
              cx={px(s.paths[0][0]).split(',')[0]}
              cy={px(s.paths[0][0]).split(',')[1]}
              r={3}
              className="fill-accent"
            />
          )
        ) : s.kind === 'line' ? (
          <polyline
            key={keyOf(i)}
            points={(s.paths[0] ?? []).map(px).join(' ')}
            className="fill-none stroke-accent"
            strokeWidth={2}
          />
        ) : (
          <path
            key={keyOf(i)}
            d={s.paths.map((r) => `M${r.map(px).join(' L')} Z`).join(' ')}
            fillRule="evenodd"
            className="fill-accent/30 stroke-accent"
          />
        ),
      )}
    </svg>
  )
}
