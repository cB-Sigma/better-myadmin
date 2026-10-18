import type { MonitorLogResponse, MonitorQueryResponse } from '@bettermyadmin/contracts'
import {
  Button,
  DateTimeTrigger,
  Hint,
  Input,
  Label,
  Loading,
  MessageBox,
  Modal,
  MySqlDocLink,
  NativeCheckbox,
  Panel,
  PanelBody,
  PmaIcon,
  SafeHtml,
  Table,
  Textarea,
  parsePickerValue,
  useUiSettings,
} from '@bettermyadmin/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Chart } from 'chart.js'
import { Fragment, useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { pgettext, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { createProfilingChart } from '../sql/profilingChart'
import {
  type LogRow,
  filterLogRows,
  prettyProfilingNum,
  profilingSlices,
  sumLabel,
  userHost,
} from './monitor'

/** jQuery datetimepicker's `yy-mm-dd HH:mm:ss` */
function dateTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

type LogResult = {
  src: 'slow' | 'general'
  data: NonNullable<MonitorLogResponse['message']>
  grouped: boolean
}

/**
 * The log analysis of a chart's time span: the dialog (time range, limit / group options, slow or
 * general log), the cancellable "Analysing logs" request, the summary, the grouped log table with its
 * filters and the query analyzer of a SELECT.
 * pma: resources/js/server/status/monitor.ts::getLogAnalyseDialog, loadLogStatistics, buildLogTable,
 *      filterQueries, openQueryAnalyzer, loadQueryAnalysis
 */
export function LogAnalysis({
  server,
  range,
  onClose,
  serverTimeDiff,
  onServerError,
}: {
  server: number
  /** the chart's first and fifth x tick (server time, ms); null when the dialog is closed */
  range: { from: number; to: number } | null
  onClose: () => void
  serverTimeDiff: number
  onServerError: () => void
}) {
  const [limitTypes, setLimitTypes] = useState(true)
  const [removeVariables, setRemoveVariables] = useState(true)
  const [loading, setLoading] = useState<AbortController | null>(null)
  const [noData, setNoData] = useState(false)
  const [loaded, setLoaded] = useState<LogResult | null>(null)
  const [summary, setSummary] = useState(false)
  const [analyzer, setAnalyzer] = useState<LogRow | null>(null)
  const table = useRef<HTMLDivElement>(null)
  void serverTimeDiff
  // dateStart / dateEnd: readonly fields, set by their pickers (setDate(min) / setDate(max))
  const [dates, setDates] = useState<{ start: string; end: string } | null>(null)
  const [shownRange, setShownRange] = useState(range)
  if (range !== shownRange) {
    setShownRange(range)
    setDates(range === null ? null : { start: dateTime(range.from), end: dateTime(range.to) })
  }
  const { FirstDayOfCalendar } = useUiSettings()
  const pickerOptions = {
    showMillisec: false,
    showMicrosec: false,
    timeFormat: 'HH:mm:ss',
    firstDay: FirstDayOfCalendar,
  }
  /** `Date.parse($input.datepicker('getDate').toString()) || fallback` */
  const picked = (v: string | undefined, fallback: number) => {
    const p = parsePickerValue('datetime', v ?? '', new Date())
    if (p.date === null) return fallback
    const t = p.time
    return new Date(p.date.year, p.date.month, p.date.day, t.hour, t.minute, t.second).getTime() || fallback
  }

  const load = async (src: 'slow' | 'general') => {
    if (range === null) return
    onClose()
    const abort = new AbortController()
    setLoading(abort)
    try {
      const r = await api.monitorLog(
        server,
        src,
        {
          time_start: String(Math.round(picked(dates?.start, range.from) / 1000)),
          time_end: String(Math.round(picked(dates?.end, range.to) / 1000)),
          // jQuery posts the booleans as "true" / "false"
          removeVariables: String(removeVariables),
          limitTypes: String(limitTypes),
        },
        abort.signal,
      )
      setLoading(null)
      if (!r.success || r.message === null) {
        onServerError()
        return
      }
      if (r.message.rows.length === 0) {
        setNoData(true)
        return
      }
      setLoaded({ src, data: r.message, grouped: removeVariables })
      setSummary(true)
    } catch {
      setLoading(null)
      if (!abort.signal.aborted) onServerError()
    }
  }

  return (
    <>
      <Modal
        title={t('Log statistics')}
        open={range !== null}
        onClose={onClose}
        size="xl"
        id="logAnalyseModal"
        footer={
          <>
            <Button onClick={onClose}>{t('Close')}</Button>
            <Button variant="primary" id="logAnalyseModalSlowLogButton" onClick={() => void load('slow')}>
              {t('From slow log')}
            </Button>
            <Button
              variant="primary"
              id="logAnalyseModalGeneralLogButton"
              onClick={() => void load('general')}
            >
              {t('From general log')}
            </Button>
          </>
        }
      >
        {range !== null && (
          <div id="logAnalyseDialog" className="space-y-2 text-[13px]">
            <p className="flex flex-wrap items-center gap-1">
              {t('Selected time range:')}
              <Input
                type="text"
                name="dateStart"
                aria-label={t('Selected time range:')}
                className="datetimefield w-44"
                readOnly
                value={dates?.start ?? dateTime(range.from)}
              />
              <DateTimeTrigger
                kind="datetime"
                value={dates?.start ?? dateTime(range.from)}
                options={pickerOptions}
                title="..."
                onChange={(v) =>
                  setDates((d) => ({
                    ...(d ?? { start: dateTime(range.from), end: dateTime(range.to) }),
                    start: v,
                  }))
                }
              />
              -
              <Input
                type="text"
                name="dateEnd"
                aria-label={t('Selected time range:')}
                className="datetimefield w-44"
                readOnly
                value={dates?.end ?? dateTime(range.to)}
              />
              <DateTimeTrigger
                kind="datetime"
                value={dates?.end ?? dateTime(range.to)}
                options={pickerOptions}
                title="..."
                onChange={(v) =>
                  setDates((d) => ({
                    ...(d ?? { start: dateTime(range.from), end: dateTime(range.to) }),
                    end: v,
                  }))
                }
              />
            </p>
            <div className="flex items-center gap-1.5">
              <NativeCheckbox
                id="limitTypes"
                value="1"
                checked={limitTypes}
                onChange={(e) => setLimitTypes(e.target.checked)}
              />
              <Label htmlFor="limitTypes">
                {t('Only retrieve SELECT,INSERT,UPDATE and DELETE Statements')}
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <NativeCheckbox
                id="removeVariables"
                value="1"
                checked={removeVariables}
                onChange={(e) => setRemoveVariables(e.target.checked)}
              />
              <Label htmlFor="removeVariables">
                {t('Remove variable data in INSERT statements for better grouping')}
              </Label>
            </div>
            <p>{t('Choose from which log you want the statistics to be generated from.')}</p>
            <p>{t('Results are grouped by query text.')}</p>
          </div>
        )}
      </Modal>

      <Modal
        title={t('Analysing logs')}
        open={loading !== null}
        onClose={() => {
          loading?.abort()
          setLoading(null)
        }}
        id="analysingLogsModal"
        footer={
          <Button
            onClick={() => {
              loading?.abort()
              setLoading(null)
            }}
          >
            {t('Cancel request')}
          </Button>
        }
      >
        <p>{t('Analysing and loading logs. This may take a while.')}</p>
        <Loading />
      </Modal>

      <Modal
        title={t('No data found')}
        open={noData}
        onClose={() => setNoData(false)}
        id="analysingLogsNoDataFoundModal"
        footer={<Button onClick={() => setNoData(false)}>{t('Close')}</Button>}
      >
        {t('Log analysed, but no data found in this time span.')}
      </Modal>

      <Modal
        title={t('Loading logs')}
        open={summary && loaded !== null}
        onClose={() => setSummary(false)}
        id="analysingLogsLogDataLoadedModal"
        footer={
          <>
            <Button onClick={() => setSummary(false)}>{t('Close')}</Button>
            <Button
              variant="primary"
              id="analysingLogsLogDataLoadedModalJumpButton"
              onClick={() => {
                setSummary(false)
                table.current?.scrollIntoView()
              }}
            >
              {t('Jump to the log table')}
            </Button>
          </>
        }
      >
        <p>{t('Log data loaded. Queries executed in this time span:')}</p>
        <div>
          {Object.entries(loaded?.data.sum ?? {}).map(([k, v]) => (
            <div key={k}>
              {sumLabel(k) === 'Total' ? <b>{sumLabel(k)}</b> : sumLabel(k)}: {v}
            </div>
          ))}
        </div>
      </Modal>

      <div id="logTable" ref={table} className="mt-4">
        {loaded !== null && <LogTable result={loaded} onAnalyze={setAnalyzer} />}
      </div>

      <QueryAnalyzer server={server} row={analyzer} onClose={() => setAnalyzer(null)} />
    </>
  )
}

/** buildLogTable + the "Log table filter options" card (more than 12 rows) */
function LogTable({ result, onAnalyze }: { result: LogResult; onAnalyze: (row: LogRow) => void }) {
  const { data, src, grouped } = result
  const cols = Object.keys(data.rows[0] ?? {})
  const [text, setText] = useState('')
  const [applied, setApplied] = useState('')
  const [group, setGroup] = useState(false)
  const [sort, setSort] = useState<{ col: number; desc: boolean }>({ col: cols.length - 1, desc: true })
  const button = data.numRows > 250
  const view = filterLogRows(data.rows, cols, { text: button ? applied : text, group, slow: src === 'slow' })
  const shownValue = (r: (typeof view.rows)[number], c: string, i: number): string => {
    if (i === cols.length - 2) return r.query
    if (i === cols.length - 1) return String(r.count)
    if (r.slow !== undefined && i >= 2 && i <= 5) return r.slow[i - 2]!
    const v = r.row[c] ?? ''
    return c === 'user_host' ? userHost(v) : v
  }
  const sorted = [...view.rows].sort((a, b) => {
    const c = cols[sort.col] ?? ''
    const va = shownValue(a, c, sort.col)
    const vb = shownValue(b, c, sort.col)
    const na = Number(va)
    const nb = Number(vb)
    const d =
      !Number.isNaN(na) && !Number.isNaN(nb) && va !== '' && vb !== '' ? na - nb : va.localeCompare(vb)
    return sort.desc ? -d : d
  })
  const explanation = grouped
    ? `${t('This column shows the amount of identical queries that are grouped together. However only the SQL query itself has been used as a grouping criteria, so the other attributes of queries, such as start time, may differ.')} ${t('Since grouping of INSERTs queries has been selected, INSERT queries into the same table are also being grouped together, disregarding of the inserted data.')}`
    : t(
        'This column shows the amount of identical queries that are grouped together. However only the SQL query itself has been used as a grouping criteria, so the other attributes of queries, such as start time, may differ.',
      )
  return (
    <>
      {data.numRows > 12 && (
        <Panel title={t('Log table filter options')}>
          <PanelBody className="space-y-2">
            <div>
              <Label htmlFor="filterQueryText" className="mb-1 block">
                {t('Filter queries by word/regexp:')}
              </Label>
              <Input
                name="filterQueryText"
                type="text"
                id="filterQueryText"
                className={view.invalid ? 'error border-error' : ''}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <NativeCheckbox
                id="noWHEREData"
                name="noWHEREData"
                value="1"
                checked={group}
                onChange={(e) => setGroup(e.target.checked)}
              />
              <Label htmlFor="noWHEREData">
                {t('Group queries, ignoring variable data in WHERE clauses')}
              </Label>
            </div>
            {button && (
              <Button name="startFilterQueryText" id="startFilterQueryText" onClick={() => setApplied(text)}>
                {t('Filter')}
              </Button>
            )}
          </PanelBody>
        </Panel>
      )}
      <Table zebra className="sortable">
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th
                key={c}
                className="whitespace-nowrap"
                aria-sort={sort.col === i ? (sort.desc ? 'descending' : 'ascending') : 'none'}
              >
                <button
                  type="button"
                  className="cursor-pointer font-semibold"
                  onClick={() => setSort((s) => ({ col: i, desc: s.col === i ? !s.desc : false }))}
                >
                  {c}
                </button>
                {c.includes('#') && (
                  <>
                    {' '}
                    <Hint message={explanation} />
                  </>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted
            .filter((r) => !r.hidden)
            .map((r, n) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: log rows have no key of their own
              <tr key={n} className="noclick">
                {cols.map((c, i) =>
                  i === cols.length - 2 && /^SELECT/i.test(r.row[c] ?? '') ? (
                    <td key={c} className="linkElem queryCell">
                      <Button
                        variant="link"
                        className="h-auto text-left whitespace-normal"
                        onClick={() => onAnalyze(r.row)}
                      >
                        {shownValue(r, c, i)}
                      </Button>
                    </td>
                  ) : (
                    // escapeHtml(value): the general log's grouped INSERTs show their `<br>...` as text
                    <td key={c}>{shownValue(r, c, i)}</td>
                  ),
                )}
              </tr>
            ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={cols.length - 1}>
              {t('Sum of grouped rows:')} {view.shown}
              <span className="float-end">{t('Total:')}</span>
            </th>
            <th className="text-end">{view.total}</th>
          </tr>
        </tfoot>
      </Table>
    </>
  )
}

/** #queryAnalyzerModal: EXPLAIN, affected rows and the profile of a logged SELECT */
function QueryAnalyzer({
  server,
  row,
  onClose,
}: { server: number; row: LogRow | null; onClose: () => void }) {
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (row !== null) setQuery(row.argument ?? row.sql_text ?? '')
  }, [row])
  const analyse = useMutation({ mutationFn: () => api.monitorQuery(server, row?.db ?? '', query) })
  const close = () => {
    analyse.reset()
    setQuery('')
    onClose()
  }
  return (
    <Modal
      title={t('Query analyzer')}
      open={row !== null}
      onClose={close}
      size="xl"
      id="queryAnalyzerModal"
      footer={
        <>
          <Button onClick={close}>{t('Close')}</Button>
          <Button variant="primary" id="queryAnalyzerModalAnalyseButton" onClick={() => analyse.mutate()}>
            {t('Analyse query')}
          </Button>
        </>
      }
    >
      <div id="queryAnalyzerDialog" className="space-y-2">
        <Textarea
          id="sqlquery"
          aria-label={t('Query')}
          className="min-h-24 w-full font-mono"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="placeHolder">
          {analyse.isPending && (
            <span>
              {t('Analyzing…')} <Loading />
            </span>
          )}
          {analyse.error !== null && <MessageBox {...errorMessage(analyse.error)} />}
          {analyse.data !== undefined && <Analysis result={analyse.data.message} />}
        </div>
      </div>
    </Modal>
  )
}

function Analysis({ result }: { result: MonitorQueryResponse['message'] }) {
  const [shown, setShown] = useState(0)
  // both are shown until a#showNums / a#showChart hides the other one
  const [view, setView] = useState<'both' | 'nums' | 'chart'>('both')
  const canvas = useRef<HTMLCanvasElement>(null)
  const chart = useRef<Chart | null>(null)
  const profiling = (result.profiling ?? []).map((p) => ({
    state: p.state ?? '',
    duration: Number.parseFloat(p.duration ?? '0'),
  }))
  const slices = profilingSlices(profiling, t('Other'))
  useEffect(() => {
    if (canvas.current === null || result.profiling === undefined) return
    chart.current = createProfilingChart(
      canvas.current,
      { labels: slices.labels, data: slices.data },
      'right',
    )
    return () => chart.current?.destroy()
  }, [result, slices.labels, slices.data])
  if (result.error !== '') {
    const error =
      result.error.includes('1146') || result.error.includes('1046')
        ? t("The database name is not known for this query in the server's logs.")
        : result.error
    return (
      <MessageBox type="error">
        <SafeHtml html={error} />
      </MessageBox>
    )
  }
  const explain = result.explain ?? []
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="explain text-[13px]">
        <b>{t('Explain output')}</b> <MySqlDocLink link="explain-output" />
        {explain.length > 1 && (
          <>
            {' ('}
            {explain.map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: EXPLAIN rows are positional
              <Fragment key={i}>
                {i > 0 && ', '}
                <Button variant="link" data-href={`#showExplain-${i}`} onClick={() => setShown(i)}>
                  {i}
                </Button>
              </Fragment>
            ))}
            {')'}
          </>
        )}
        <div className={`explain-${shown} mt-2`}>
          {Object.entries(explain[shown] ?? {}).map(([k, v]) => {
            const value = v === null ? 'null' : v
            return (
              <div key={k}>
                {k}:{' '}
                {k === 'type' && value.toLowerCase() === 'all' ? (
                  <span className="text-error">{value}</span>
                ) : k === 'Extra' ? (
                  value.split(/(using (?:temporary|filesort))/i).map((part, i) =>
                    /^using (temporary|filesort)$/i.test(part) ? (
                      // biome-ignore lint/suspicious/noArrayIndexKey: parts of one value
                      <span key={i} className="text-error">
                        {part}
                      </span>
                    ) : (
                      part
                    ),
                  )
                ) : (
                  value
                )}
              </div>
            )
          })}
        </div>
        <p className="mt-2">
          <b>{t('Affected rows:')}</b> {result.affectedRows}
        </p>
      </div>
      {result.profiling !== undefined && (
        <div className="chart text-[13px]">
          <b>
            {t('Profiling results')} <MySqlDocLink link="general-thread-states" />
          </b>{' '}
          (
          <Button variant="link" data-href="#showNums" onClick={() => setView('nums')}>
            {pgettext('Display format', 'Table')}
          </Button>
          ,{' '}
          <Button variant="link" data-href="#showChart" onClick={() => setView('chart')}>
            {t('Chart')}
          </Button>
          )
          {view !== 'chart' && (
            <Table zebra className="queryNums mt-2 w-auto">
              <thead>
                <tr>
                  <th>{t('Status')}</th>
                  <th>{t('Time')}</th>
                </tr>
              </thead>
              <tbody>
                {profiling.map((p, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: profile rows are positional
                  <tr key={i}>
                    <td>{p.state}</td>
                    <td>{prettyProfilingNum(p.duration, 2)}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <b>{t('Total time:')}</b>
                  </td>
                  <td>{prettyProfilingNum(slices.total, 2)}</td>
                </tr>
              </tbody>
            </Table>
          )}
          <div className="h-[500px]">
            <canvas id="queryProfilingCanvas" role="img" ref={canvas} hidden={view === 'nums'} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The live part of the instructions dialog (loadLogVars): which logs are on, log_output, the
 * long_query_time advice and, for a superuser, the links that SET GLOBAL the logging variables.
 */
export function LogVarsInstructions({
  server,
  isSuperUser,
  onError,
}: {
  server: number
  isSuperUser: boolean
  onError: () => void
}) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: qk.monitorLogVars(server), queryFn: () => api.monitorLogVars(server) })
  const set = useMutation({
    mutationFn: (v: { varName: string; varValue: string }) => api.monitorLogVars(server, v),
    onSuccess: (r) => qc.setQueryData(qk.monitorLogVars(server), r),
    onError,
  })
  useEffect(() => {
    if (q.error !== null) onError()
  }, [q.error, onError])
  const v = q.data?.message
  const icon = (name: 'success' | 'error' | 'attention') => (
    <PmaIcon name={name === 'success' ? 's_success' : name === 'error' ? 's_error' : 's_attention'} alt="" />
  )
  let state: string
  let ok = true
  if (v?.general_log === 'ON')
    state =
      v.slow_query_log === 'ON'
        ? t('general_log and slow_query_log are enabled.')
        : t('general_log is enabled.')
  else if (v?.slow_query_log === 'ON') state = t('slow_query_log is enabled.')
  else {
    state = t('slow_query_log and general_log are disabled.')
    ok = false
  }
  const lqt = Number(v?.long_query_time ?? 0)
  const output = v?.log_output === 'TABLE' ? 'FILE' : 'TABLE'
  const link = (varName: string, varValue: string, label: string) => (
    <div>
      -{' '}
      <Button variant="link" className="set" onClick={() => set.mutate({ varName, varValue })}>
        {label}
      </Button>
    </div>
  )
  return (
    <div className="space-y-2 text-[13px]">
      <p>
        {t(
          "The phpMyAdmin Monitor can assist you in optimizing the server configuration and track down time intensive queries. For the latter you will need to set log_output to 'TABLE' and have either the slow_query_log or general_log enabled. Note however, that the general_log produces a lot of data and increases server load by up to 15%.",
        )}
      </p>
      {(q.isPending || set.isPending) && <Loading />}
      {v !== undefined && (
        <div className="ajaxContent">
          <b>{t('Current settings')}</b>
          <div className="ms-4">
            <div>
              {icon(ok ? 'success' : 'error')}
              {state}
            </div>
            <div>
              {v.log_output !== 'TABLE' ? icon('error') : icon('success')}{' '}
              {v.log_output !== 'TABLE'
                ? t('log_output is not set to TABLE.')
                : t('log_output is set to TABLE.')}
            </div>
            {v.slow_query_log === 'ON' && lqt > 2 && (
              <div>
                {icon('attention')}{' '}
                {t(
                  'slow_query_log is enabled, but the server logs only queries that take longer than %d seconds. It is advisable to set this long_query_time 0-2 seconds, depending on your system.',
                ).replace('%d', String(Math.trunc(lqt)))}
              </div>
            )}
            {v.slow_query_log === 'ON' && lqt < 2 && (
              <div>
                {icon('success')}{' '}
                {t('long_query_time is set to %d second(s).').replace('%d', String(Math.trunc(lqt)))}
              </div>
            )}
          </div>
          <p />
          {isSuperUser ? (
            <>
              <b>{t('Change settings')}</b>
              <div className="ms-4">
                {t('Following settings will be applied globally and reset to default on server restart:')}
                {link('log_output', output, t('Set log_output to %s').replace('%s', output))}
                {v.general_log !== 'ON'
                  ? link('general_log', 'ON', t('Enable %s').replace('%s', 'general_log'))
                  : link('general_log', 'OFF', t('Disable %s').replace('%s', 'general_log'))}
                {v.slow_query_log !== 'ON'
                  ? link('slow_query_log', 'ON', t('Enable %s').replace('%s', 'slow_query_log'))
                  : link('slow_query_log', 'OFF', t('Disable %s').replace('%s', 'slow_query_log'))}
                {link(
                  'long_query_time',
                  lqt > 2 ? '1' : '5',
                  t('Set long_query_time to %d seconds.').replace('%d', lqt > 2 ? '1' : '5'),
                )}
              </div>
            </>
          ) : (
            <div className="ms-4">
              {t(
                "You can't change these variables. Please log in as root or contact your database administrator.",
              )}
            </div>
          )}
        </div>
      )}
      {v !== undefined &&
        v.log_output === 'TABLE' &&
        (v.slow_query_log === 'ON' || v.general_log === 'ON') && (
          <div className="monitorUse space-y-2">
            <p>
              <strong>{t('Using the monitor:')}</strong>
            </p>
            <p>
              {t(
                "Your browser will refresh all displayed charts in a regular interval. You may add charts and change the refresh rate under 'Settings', or remove any chart using the cog icon on each respective chart.",
              )}
            </p>
            <p>
              {t(
                'To display queries from the logs, click on any chart. Once confirmed, this will load a table of grouped queries, there you may click on any occurring SELECT statements to further analyze them.',
              )}
            </p>
            <p>
              {icon('attention')}
              <strong>{t('Please note:')}</strong>
            </p>
            <p>
              {t(
                'Enabling the general_log may increase the server load by 5-15%. Also be aware that generating statistics from the logs is a load intensive task, so it is advisable to select only a small time span and to disable the general_log and empty its table once monitoring is not required any more.',
              )}
            </p>
          </div>
        )}
    </div>
  )
}
