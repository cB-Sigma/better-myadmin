import type { SearchColumn, SearchPageResponse, SqlMessage, ZoomResponse } from '@bettermyadmin/contracts'
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeCheckbox,
  NativeSelect,
  Panel,
  PanelBody,
  showMessage,
} from '@bettermyadmin/ui'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { type TableRef, api } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { runQuery } from '../../sql/runner'
import { ResultMessages, errorMessage } from '../common/ResultMessages'
import { useSearchPage } from './SearchPage'
import { SearchPills } from './SearchPills'
import { type Criterion, OperatorSelect, UNARY, ValueInput, initialCriterion } from './criteria'

/**
 * Zoom search: two columns plotted against each other, a click on a point edits its row.
 *
 * pma: resources/templates/table/zoom_search/index.twig, result_form.twig,
 *      resources/js/table/zoom_search.ts
 */
export function ZoomSearchPage({ scope }: { scope: TableRef }) {
  const q = useSearchPage(scope)
  if (q.isError) return <ResultMessages messages={[errorMessage(q.error)]} />
  if (q.data === undefined) return null
  return (
    <div>
      <SearchPills scope={scope} active="zoom-search" />
      <ZoomForm scope={scope} page={q.data} />
    </div>
  )
}

interface Row {
  column: string
  c: Criterion
}

/** zoom_search.ts: numeric (int/decimal/year), time (date/time), else text (not plotted) */
function axisKind(type: string): 'numeric' | 'time' | 'text' {
  if (/int|decimal|year|float|double|real/.test(type)) return 'numeric'
  if (/date|time/.test(type)) return 'time'
  return 'text'
}

function axisValue(v: string | null, type: string): number {
  if (v === null) return Number.NaN
  if (axisKind(type) === 'time') return Date.parse(v.replace(' ', 'T'))
  return Number(v)
}

function ZoomForm({ scope, page }: { scope: TableRef; page: SearchPageResponse }) {
  const byName = (n: string) => page.columns.find((c) => c.name === n)
  const [rows, setRows] = useState<Row[]>(() =>
    [0, 1, 2, 3].map(() => ({ column: 'pma_null', c: { operator: '', value: '', geomFunc: '' } })),
  )
  const [dataLabel, setDataLabel] = useState(page.displayField)
  const [maxPlot, setMaxPlot] = useState(page.maxPlotLimit)
  const [result, setResult] = useState<ZoomResponse | null>(null)
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const [shown, setShown] = useState(true)
  const [edit, setEdit] = useState<{ point: number; row: Record<string, string | null> } | null>(null)

  const setColumn = (i: number, name: string) =>
    setRows((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r
        const col = byName(name)
        return {
          column: name,
          c: col === undefined ? { operator: '', value: '', geomFunc: '' } : initialCriterion(col),
        }
      }),
    )
  const patch = (i: number, p: Partial<Criterion>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, c: { ...r.c, ...p } } : r)))

  const x = rows[0]?.column ?? 'pma_null'
  const y = rows[1]?.column ?? 'pma_null'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    // zoom_search.ts: #inputFormSubmitId validation
    if (x === 'pma_null' || y === 'pma_null') return void showMessage(t('Select two columns'), null, 'error')
    if (x === y) return void showMessage(t('Select two different columns'), null, 'error')
    try {
      const criteria = rows.flatMap((r) => {
        const col = byName(r.column)
        if (col === undefined) return []
        return [{ name: col.name, type: col.type, operator: r.c.operator, value: r.c.value }]
      })
      const z = await api.tableZoom(scope, { criteria, x, y, dataLabel, maxPlotLimit: maxPlot })
      setResult(z)
      setShown(false)
    } catch (err) {
      setMessages([errorMessage(err)])
    }
  }

  const openPoint = async (index: number) => {
    const p = result?.points[index]
    if (p === undefined) return
    try {
      const r = await api.tableZoomRow(scope, p.whereClause, p.sig)
      if (r.row !== null) setEdit({ point: index, row: r.row })
    } catch (err) {
      setMessages([errorMessage(err)])
    }
  }

  const criteriaRow = (i: number) => {
    const r = rows[i] as Row
    const col = byName(r.column)
    return (
      <tr key={i} className="noclick">
        <td className="px-2 py-1">
          <NativeSelect
            name="criteriaColumnNames[]"
            id={`tableid_${i}`}
            value={r.column}
            onChange={(e) => setColumn(i, e.target.value)}
          >
            <option value="pma_null">{t('None')}</option>
            {page.columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </td>
        <td className="px-2 py-1" dir="ltr">
          {col?.type}
        </td>
        <td className="px-2 py-1">{col?.collation}</td>
        <td className="px-2 py-1">
          {col !== undefined && (
            <OperatorSelect
              column={col}
              index={i}
              value={r.c.operator}
              onChange={(v) => patch(i, { operator: v })}
            />
          )}
        </td>
        <td className="px-2 py-1">
          {col !== undefined && (
            <ValueInput
              column={col}
              index={i}
              value={r.c.value}
              disabled={UNARY.includes(r.c.operator)}
              onChange={(v) => patch(i, { value: v })}
            />
          )}
        </td>
      </tr>
    )
  }

  return (
    <>
      <ResultMessages messages={messages} />
      {result !== null && (
        <div id="togglesearchformdiv" className="mb-2">
          <Button size="sm" id="togglesearchformlink" onClick={() => setShown(!shown)}>
            {t(shown ? 'Hide search criteria' : 'Show search criteria')}
          </Button>
        </div>
      )}
      {shown && (
        <form id="zoom_search_form" onSubmit={(e) => void submit(e)}>
          <Panel
            title={t('Do a "query by example" (wildcard: "%") for two different columns')}
            footer={
              <>
                <Button type="submit" variant="primary" name="zoom_submit" id="inputFormSubmitId">
                  {t('Go')}
                </Button>
              </>
            }
          >
            <PanelBody>
              <table id="tableFieldsId" className="w-auto text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="px-2">{t('Column')}</th>
                    <th className="px-2">{t('Type')}</th>
                    <th className="px-2">{t('Collation')}</th>
                    <th className="px-2">{t('Operator')}</th>
                    <th className="px-2">{t('Value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {criteriaRow(0)}
                  {criteriaRow(1)}
                  <tr>
                    <th colSpan={5} className="px-2 pt-2 text-left">
                      {t('Additional search criteria')}
                    </th>
                  </tr>
                  {criteriaRow(2)}
                  {criteriaRow(3)}
                </tbody>
              </table>
              <table className="mt-3 w-auto text-sm">
                <tbody>
                  <tr>
                    <td className="px-2">
                      <Label htmlFor="dataLabel">{t('Use this column to label each point')}</Label>
                    </td>
                    <td className="px-2">
                      <NativeSelect
                        id="dataLabel"
                        name="dataLabel"
                        value={dataLabel}
                        onChange={(e) => setDataLabel(e.target.value)}
                      >
                        <option value="">{t('None')}</option>
                        {page.columns.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-2">
                      <Label htmlFor="maxRowPlotLimit">{t('Maximum rows to plot')}</Label>
                    </td>
                    <td className="px-2">
                      <Input
                        id="maxRowPlotLimit"
                        type="number"
                        name="maxPlotLimit"
                        required
                        className="w-32"
                        value={maxPlot}
                        onChange={(e) => setMaxPlot(Number(e.target.value))}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </PanelBody>
          </Panel>
        </form>
      )}
      {result !== null && (
        <ZoomResult
          result={result}
          x={byName(x)}
          y={byName(y)}
          showLabel={result.dataLabel !== ''}
          onPoint={(i) => void openPoint(i)}
        />
      )}
      <DataPointDialog
        scope={scope}
        page={page}
        edit={edit}
        whereClause={edit === null ? '' : (result?.points[edit.point]?.whereClause ?? '')}
        onClose={() => setEdit(null)}
        onSaved={(m) => setMessages(m)}
      />
    </>
  )
}

function ZoomResult({
  result,
  x,
  y,
  showLabel,
  onPoint,
}: {
  result: ZoomResponse
  x: SearchColumn | undefined
  y: SearchColumn | undefined
  showLabel: boolean
  onPoint: (index: number) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const chart = useRef<{ resetZoom(): void; destroy(): void } | null>(null)
  const [help, setHelp] = useState(false)
  const pointCb = useRef(onPoint)
  pointCb.current = onPoint
  useEffect(() => {
    let alive = true
    const el = canvas.current
    if (el === null) return
    void import('./zoomChart').then(({ createZoomChart }) => {
      if (!alive) return
      const points = result.points
        .map((p, index) => ({
          x: axisValue(p.x, x?.type ?? ''),
          y: axisValue(p.y, y?.type ?? ''),
          label: p.label ?? '',
          index,
        }))
        .filter((p) => !Number.isNaN(p.x) && !Number.isNaN(p.y))
      chart.current = createZoomChart(el, points, { x: x?.name ?? '', y: y?.name ?? '' }, showLabel, (i) =>
        pointCb.current(i),
      )
    })
    return () => {
      alive = false
      chart.current?.destroy()
      chart.current = null
    }
  }, [result, x, y, showLabel])
  return (
    <Panel title={t('Browse/Edit the points')}>
      <PanelBody>
        <div className="mb-2 flex gap-2">
          <Button size="sm" id="help_dialog" onClick={() => setHelp(true)}>
            {t('How to use')}
          </Button>
          <Button size="sm" id="zoom_reset" onClick={() => chart.current?.resetZoom()}>
            {t('Reset zoom')}
          </Button>
        </div>
        <div
          id="resizer"
          className="resize overflow-hidden border border-border"
          style={{ width: 600, height: 400 }}
        >
          <canvas id="queryChartCanvas" ref={canvas} data-testid="zoom-chart" />
        </div>
      </PanelBody>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent id="helpModal">
          <DialogHeader>
            <DialogTitle>{t('Zoom search instructions')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <ul className="list-disc ps-5">
              {[
                'Each point represents a data row.',
                'Hovering over a point will show its label.',
                'To zoom in, select a section of the plot with the mouse.',
                'Click reset zoom button to come back to original state.',
                'Click a data point to view and possibly edit the data row.',
                'The plot can be resized by dragging it along the bottom right corner.',
              ].map((m) => (
                <li key={m}>{t(m)}</li>
              ))}
            </ul>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

/** pma: result_form.twig #dataPointModal + zoom_search.ts dataPointSave (UPDATE built client-side) */
function DataPointDialog({
  scope,
  page,
  edit,
  whereClause,
  onClose,
  onSaved,
}: {
  scope: TableRef
  page: SearchPageResponse
  edit: { point: number; row: Record<string, string | null> } | null
  whereClause: string
  onClose: () => void
  onSaved: (m: SqlMessage[]) => void
}) {
  const [values, setValues] = useState<Record<string, string | null>>({})
  useEffect(() => setValues(edit?.row ?? {}), [edit])
  const save = async () => {
    if (edit === null) return
    const changed = page.columns.filter((c) => (values[c.name] ?? null) !== (edit.row[c.name] ?? null))
    if (changed.length > 0) {
      let sql = `UPDATE \`${scope.table}\` SET `
      for (const c of changed) {
        const v = values[c.name] ?? null
        sql += `\`${c.name}\`=`
        if (v === null) sql += 'NULL, '
        else if (v.trim() === '') sql += "'', "
        else if (c.type.startsWith('bit')) sql += `b'${v}', `
        else if (Number.isNaN(Number(v))) sql += `'${v}', `
        else sql += `${v}, `
      }
      sql = `${sql.slice(0, -2)} WHERE ${whereClause}`
      try {
        await runQuery(scope.server, { sql, db: scope.db, table: scope.table }, 'page')
        onSaved([{ type: 'success', text: t('Your SQL query has been executed successfully.'), sql }])
      } catch (e) {
        onSaved([errorMessage(e)])
      }
    }
    onClose()
  }
  return (
    <Dialog open={edit !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent id="dataPointModal" size="lg">
        <DialogHeader>
          <DialogTitle>{t('Data point content')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th>{t('Column')}</th>
                  <th>{t('Null')}</th>
                  <th>{t('Value')}</th>
                </tr>
              </thead>
              <tbody>
                {page.columns.map((c, i) => (
                  <tr key={c.name}>
                    <th className="text-left">{c.name}</th>
                    <td>
                      {c.nullable && (
                        <NativeCheckbox
                          className="checkbox_null"
                          aria-label={`${c.name} ${t('Null')}`}
                          checked={values[c.name] === null}
                          onChange={(e) => setValues({ ...values, [c.name]: e.target.checked ? null : '' })}
                        />
                      )}
                    </td>
                    <td>
                      <Input
                        id={`edit_fieldID_${i}`}
                        value={values[c.name] ?? ''}
                        onChange={(e) => setValues({ ...values, [c.name]: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="submit" className="hidden" />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" id="dataPointSaveButton" onClick={() => void save()}>
            {t('Save')}
          </Button>
          <Button onClick={onClose}>{t('Close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
