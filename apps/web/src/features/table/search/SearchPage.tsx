import type { SearchPageResponse, SqlMessage } from '@bettermyadmin/contracts'
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Disclosure,
  Input,
  Label,
  MySqlDocLink,
  NativeCheckbox,
  NativeSelect,
  Panel,
  PanelBody,
  Radio,
  removeMessage,
  showMessage,
} from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { type TableRef, api } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import { BrowsePage } from '../../browse/BrowsePage'
import { useFormLock } from '../../shell/page-chrome'
import { ResultMessages, errorMessage } from '../common/ResultMessages'
import { SearchPills } from './SearchPills'
import {
  type Criterion,
  OperatorSelect,
  UNARY,
  ValueInput,
  criteriaToSend,
  initialCriterion,
  searchFieldError,
} from './criteria'

/**
 * Table search: "query by example". The results show under the form, which hides behind the
 * "Show search criteria" toggle (select.ts).
 *
 * pma: resources/templates/table/search/index.twig, column_comparison_operators.twig, input_box.twig,
 *      resources/js/table/select.ts
 */
export function SearchPage({ scope }: { scope: TableRef }) {
  const q = useSearchPage(scope)
  if (q.isError) return <ResultMessages messages={[errorMessage(q.error)]} />
  if (q.data === undefined) return null
  return (
    <div>
      <SearchPills scope={scope} active="search" />
      <SearchForm scope={scope} page={q.data} />
    </div>
  )
}

export function useSearchPage(scope: TableRef) {
  return useQuery({
    queryKey: qk.tblPage(scope, 'search'),
    queryFn: () => api.tableSearchPage(scope),
  })
}

const RANGE_TYPES =
  /^(tinyint|smallint|mediumint|int|bigint|decimal|float|double|real|date|datetime|timestamp|time|year)/

function SearchForm({ scope, page }: { scope: TableRef; page: SearchPageResponse }) {
  // form.lock-page (AJAX.lockPageHandler)
  const lockRef = useFormLock()
  const [rows, setRows] = useState<Criterion[]>(() => page.columns.map(initialCriterion))
  const [display, setDisplay] = useState<string[]>(() => page.columns.map((c) => c.name))
  const [distinct, setDistinct] = useState(false)
  const [customWhere, setCustomWhere] = useState('')
  const [maxRows, setMaxRows] = useState(page.maxRows)
  const [orderBy, setOrderBy] = useState('--nil--')
  const [order, setOrder] = useState<'ASC' | 'DESC'>('ASC')
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const [range, setRange] = useState<{
    index: number
    operator: string
    min: string
    max: string
    colMin: string | null
    colMax: string | null
  } | null>(null)
  /** the search's signed query: shown in #sqlqueryresultsouter under the form */
  const [result, setResult] = useState<{ sql: string; sig: string } | null>(null)
  /** #tbl_search_form slides up once results exist; #togglesearchformlink shows it again */
  const [formShown, setFormShown] = useState(true)

  const patch = (i: number, p: Partial<Criterion>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))

  // select.ts: BETWEEN on numeric/date columns opens the Range search dialog with the column min/max
  const onOperator = async (i: number, op: string) => {
    patch(i, { operator: op })
    const c = page.columns[i]
    if (c === undefined || (op !== 'BETWEEN' && op !== 'NOT BETWEEN') || !RANGE_TYPES.test(c.type)) return
    try {
      const r = await api.tableSearchRange(scope, c.name)
      // "Reset input values on reuse"
      setRange({ index: i, operator: op, min: '', max: '', colMin: r.min, colMax: r.max })
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  const errors = page.columns.map((c, i) => {
    const r = rows[i]
    return r === undefined || UNARY.includes(r.operator) ? null : searchFieldError(c, r.operator, r.value)
  })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    // jQuery Validation stops the submit while a field is invalid
    if (errors.some((x) => x !== null)) return
    const box = showMessage(t('Searching'), false)
    try {
      const r = await api.tableSearch(scope, {
        distinct,
        columns: display.length === page.columns.length ? null : display,
        customWhere,
        criteria: criteriaToSend(page.columns, rows),
        orderBy,
        order,
      })
      setMessages([])
      setResult({ sql: r.sql, sig: r.sig })
      setFormShown(false)
      window.scrollTo({ top: 0 })
    } catch (err) {
      setMessages([errorMessage(err)])
    } finally {
      removeMessage(box)
    }
  }

  return (
    <>
      <ResultMessages messages={messages} />
      <form
        ref={lockRef}
        id="tbl_search_form"
        name="insertForm"
        className={formShown ? undefined : 'hidden'}
        onSubmit={(e) => void submit(e)}
      >
        <Panel
          title={t('Do a "query by example" (wildcard: "%")')}
          footer=<Button type="submit" variant="primary" name="submit">
            {t('Go')}
          </Button>
        >
          <PanelBody className="space-y-3">
            <div id="fieldset_table_qbe" className="overflow-x-auto">
              <table className="w-auto text-sm">
                <thead>
                  <tr className="text-left">
                    {page.geomColumnFlag && <th className="px-2">{t('Function')}</th>}
                    <th className="px-2">{t('Column')}</th>
                    <th className="px-2">{t('Type')}</th>
                    <th className="px-2">{t('Collation')}</th>
                    <th className="px-2">{t('Operator')}</th>
                    <th className="px-2">{t('Value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.columns.map((c, i) => {
                    const r = rows[i] ?? initialCriterion(c)
                    return (
                      <tr
                        key={c.name}
                        className="noclick odd:bg-grid-odd even:bg-grid-even"
                        data-testid={`criteria-${c.name}`}
                      >
                        {page.geomColumnFlag && (
                          <td className="px-2 py-1">
                            {c.geomFunctions !== undefined && (
                              <NativeSelect
                                className="geom_func"
                                name={`geom_func[${i}]`}
                                value={r.geomFunc}
                                onChange={(e) => patch(i, { geomFunc: e.target.value })}
                              >
                                {c.geomFunctions.map((f, k) => (
                                  // biome-ignore lint/suspicious/noArrayIndexKey: separators repeat
                                  <option key={k} value={f}>
                                    {f}
                                  </option>
                                ))}
                              </NativeSelect>
                            )}
                          </td>
                        )}
                        <th className="px-2 py-1 text-left">{c.name}</th>
                        <td className="px-2 py-1" dir="ltr">
                          {c.type}
                        </td>
                        <td className="px-2 py-1">{c.collation}</td>
                        <td className="px-2 py-1">
                          <OperatorSelect
                            column={c}
                            index={i}
                            value={r.operator}
                            onChange={(v) => void onOperator(i, v)}
                          />
                        </td>
                        <td className="px-2 py-1" data-type={c.type}>
                          <ValueInput
                            column={c}
                            index={i}
                            value={r.value}
                            disabled={UNARY.includes(r.operator)}
                            onChange={(v) => patch(i, { value: v })}
                            scope={scope}
                            geomFunc={r.geomFunc}
                          />
                          {errors[i] != null && (
                            <label className="error block text-xs text-error" htmlFor={`fieldID_${i}`}>
                              {errors[i]}
                            </label>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <Disclosure label={t('Extra options')} id="searchExtraOptions" initialState={page.slidersState}>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="columnsToDisplaySelect" className="block">
                    {t('Select columns (at least one):')}
                  </Label>
                  <NativeSelect
                    id="columnsToDisplaySelect"
                    name="columnsToDisplay[]"
                    multiple
                    size={Math.min(page.columns.length, 10)}
                    className="h-auto w-full"
                    value={display}
                    onChange={(e) => setDisplay([...e.target.selectedOptions].map((o) => o.value))}
                  >
                    {page.columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div>
                  <NativeCheckbox
                    id="oDistinct"
                    name="distinct"
                    value="DISTINCT"
                    checked={distinct}
                    onChange={(e) => setDistinct(e.target.checked)}
                  />{' '}
                  <Label htmlFor="oDistinct" dir="ltr" lang="en">
                    DISTINCT
                  </Label>
                </div>
                <div>
                  <Label htmlFor="customWhereClauseInput" className="block">
                    <em>{t('Or')}</em> {t('Add search conditions (body of the "where" clause):')}{' '}
                    <MySqlDocLink link="Functions" />
                  </Label>
                  <Input
                    id="customWhereClauseInput"
                    name="customWhereClause"
                    size={64}
                    value={customWhere}
                    onChange={(e) => setCustomWhere(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="maxRowsInput" className="block">
                    {t('Number of rows per page')}
                  </Label>
                  <Input
                    id="maxRowsInput"
                    type="number"
                    name="session_max_rows"
                    min={1}
                    required
                    className="w-32"
                    value={maxRows}
                    onChange={(e) => setMaxRows(Number(e.target.value))}
                  />
                </div>
                <fieldset>
                  <legend className="sr-only">{t('Display order:')}</legend>
                  <Label htmlFor="orderByColumnSelect" className="block">
                    {t('Order by:')}
                  </Label>
                  <NativeSelect
                    id="orderByColumnSelect"
                    name="orderByColumn"
                    value={orderBy}
                    onChange={(e) => setOrderBy(e.target.value)}
                  >
                    <option value="--nil--" />
                    {page.columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <div className="mt-1 flex gap-3">
                    {(['ASC', 'DESC'] as const).map((o) => (
                      <span key={o}>
                        <Radio
                          id={`order${o}`}
                          name="order"
                          value={o}
                          checked={order === o}
                          onChange={() => setOrder(o)}
                        />{' '}
                        <Label htmlFor={`order${o}`}>{t(o === 'ASC' ? 'Ascending' : 'Descending')}</Label>
                      </span>
                    ))}
                  </div>
                </fieldset>
              </div>
            </Disclosure>
          </PanelBody>
        </Panel>
      </form>
      {result !== null && (
        <div id="togglesearchformdiv" className="my-2">
          <Button size="sm" id="togglesearchformlink" onClick={() => setFormShown(!formShown)}>
            {formShown ? t('Hide search criteria') : t('Show search criteria')}
          </Button>
        </div>
      )}
      {result !== null && (
        <BrowsePage key={result.sig} server={scope.server} db={scope.db} table={scope.table} {...result} />
      )}

      <Dialog open={range !== null} onOpenChange={(o) => !o && setRange(null)}>
        <DialogContent id="rangeSearchModal">
          <DialogHeader>
            <DialogTitle>{t('Range search')}</DialogTitle>
          </DialogHeader>
          {range !== null && (
            <DialogBody>
              <fieldset className="space-y-1">
                <legend id="rangeSearchLegend" className="font-semibold">
                  {range.operator}
                </legend>
                <Label htmlFor="min_value">{t('Minimum value:')}</Label>{' '}
                <Input
                  id="min_value"
                  className="w-48"
                  value={range.min}
                  onChange={(e) => setRange({ ...range, min: e.target.value })}
                />
                <br />
                <span className="small_font text-fg-muted" id="rangeSearchMin">
                  {range.colMin ? `(${t('Column minimum:')} ${range.colMin})` : ''}
                </span>
                <br />
                <Label htmlFor="max_value">{t('Maximum value:')}</Label>{' '}
                <Input
                  id="max_value"
                  className="w-48"
                  value={range.max}
                  onChange={(e) => setRange({ ...range, max: e.target.value })}
                />
                <br />
                <span className="small_font text-fg-muted" id="rangeSearchMax">
                  {range.colMax ? `(${t('Column maximum:')} ${range.colMax})` : ''}
                </span>
              </fieldset>
            </DialogBody>
          )}
          <DialogFooter>
            <Button
              id="rangeSearchModalGo"
              onClick={() => {
                if (range !== null)
                  patch(range.index, { value: rangeValue(page.columns[range.index], range) })
                setRange(null)
              }}
            >
              {t('Go')}
            </Button>
            <Button onClick={() => setRange(null)}>{t('Cancel')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * #rangeSearchModalGo: "min, max" when both are given; a select target takes the option closest
 * to the minimum, then the one closest to the maximum (both get `selected`, the last one wins).
 */
export function rangeValue(
  column: SearchPageResponse['columns'][number] | undefined,
  range: { min: string; max: string },
): string {
  const inp = column?.input
  if (inp !== undefined && (inp.kind === 'foreign' || inp.kind === 'enum')) {
    const values =
      inp.kind === 'foreign' ? (inp.foreign ?? []).map((o) => o.value) : ['', ...(inp.values ?? [])]
    let closest: string | null = null
    for (const v of values) {
      if (
        closest === null ||
        Math.abs(Number(v) - Number(range.max)) < Math.abs(Number(closest) - Number(range.max))
      )
        closest = v
    }
    return closest ?? ''
  }
  return range.min.length > 0 && range.max.length > 0 ? `${range.min}, ${range.max}` : ''
}
