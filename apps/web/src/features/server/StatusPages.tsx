import type { ProcessList, StatusLink, StatusVariable } from '@bettermyadmin/contracts'
import {
  Button,
  Hint,
  Loading,
  MessageBox,
  Modal,
  MySqlDocLink,
  Panel,
  PanelBody,
  SafeHtml,
  Table,
  buttonVariants,
  stripTags,
} from '@bettermyadmin/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, CircleHelp, FileText, FileType, Pause, Play } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { ApiError, api, errorMessage } from '../../lib/api'
import { ngettext, t } from '../../lib/i18n'
import { path } from '../../lib/paths'
import { qk } from '../../lib/queryKeys'
import { ReplicationStatusTable } from './ReplicationPage'

/** pma: templates/server/status/base.twig — the pills shared by the Status sub-pages */
export function StatusLayout({ server }: { server: number }) {
  const { pathname } = useLocation()
  const pills: Array<[string, string]> = [
    ['', t('Server')],
    ['processes', t('Processes')],
    ['queries', t('Query statistics')],
    ['variables', t('All status variables')],
    ['monitor', t('Monitor')],
    ['advisor', t('Advisor')],
  ]
  const here = pathname.replace(/\/$/, '').split('/status')[1]?.replace(/^\//, '') ?? ''
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-1 text-sm" id="statusPills">
        {pills.map(([sub, label]) => (
          <li key={sub}>
            <Link
              to={path(`/s/${server}/status${sub === '' ? '' : '/'}${sub}`)}
              className={`block rounded px-3 py-1.5 hover:no-underline ${here === sub ? 'active bg-accent text-accent-fg' : 'text-accent hover:bg-bg-subtle'}`}
              aria-current={here === sub ? 'page' : undefined}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
      <Outlet />
    </div>
  )
}

/** pma: templates/server/status/status/index.twig */
export function StatusOverviewPage({ server }: { server: number }) {
  const q = useQuery({
    queryKey: qk.status(server, 'overview'),
    queryFn: () => api.statusOverview(server),
  })
  const o = q.data
  if (q.error !== null) return <MessageBox {...errorMessage(q.error)} />
  if (o === undefined) return <Loading />
  if (!o.isDataLoaded)
    return <MessageBox type="error">{t('Not enough privilege to view server status.')}</MessageBox>
  return (
    <div>
      <h3 className="mb-2 text-base font-semibold">
        {t('Network traffic since startup: %s', o.networkTraffic ?? '')}
      </h3>
      <p className="mb-3 text-sm">
        {t(
          'This MySQL server has been running for %1$s. It started up on %2$s.',
          o.uptime ?? '',
          o.startTime ?? '',
        )}
      </p>
      <div className="flex flex-wrap items-start gap-6">
        <Table zebra id="trafficTable">
          <thead>
            <tr>
              <th scope="col">
                {t('Traffic')}{' '}
                <Hint
                  message={t(
                    'On a busy server, the byte counters may overrun, so those statistics as reported by the MySQL server may be incorrect.',
                  )}
                />
              </th>
              <th scope="col" className="!text-end">
                #
              </th>
              <th scope="col" className="!text-end">
                {t('ø per hour')}
              </th>
            </tr>
          </thead>
          <tbody>
            {o.traffic.map((r) => (
              <tr key={r.name}>
                <th scope="row">{r.name}</th>
                <td className="text-end font-mono">{r.number}</td>
                <td className="text-end font-mono">{r.perHour}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Table zebra id="connectionsTable">
          <thead>
            <tr>
              <th scope="col">{t('Connections')}</th>
              <th scope="col" className="!text-end">
                #
              </th>
              <th scope="col" className="!text-end">
                {t('ø per hour')}
              </th>
              <th scope="col" className="!text-end">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {o.connections.map((r) => (
              <tr key={r.name}>
                <th>{r.name}</th>
                <td className="text-end font-mono">{r.number}</td>
                <td className="text-end font-mono">{r.perHour}</td>
                <td className="text-end font-mono">{r.percentage}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      {(o.isPrimary || o.isReplica) && (
        <>
          <MessageBox type="info" className="mt-4">
            <SafeHtml
              html={
                o.isPrimary && o.isReplica
                  ? t(
                      'This MySQL server works as <b>primary</b> and <b>replica</b> in <b>replication</b> process.',
                    )
                  : o.isPrimary
                    ? t('This MySQL server works as <b>primary</b> in <b>replication</b> process.')
                    : t('This MySQL server works as <b>replica</b> in <b>replication</b> process.')
              }
            />
          </MessageBox>
          <hr className="my-3 border-border" />
          <h3 className="mb-2 text-base font-semibold">{t('Replication status')}</h3>
          {o.replication.map((r) => (
            <ReplicationStatusTable key={r.type} table={r} title />
          ))}
        </>
      )}
    </div>
  )
}

const RATES = [2, 3, 4, 5, 10, 20, 40, 60, 120, 300, 600, 1200]

/**
 * pma: templates/server/status/processes/{index,list}.twig, resources/js/server/status/processes.ts.
 * The auto-refresh requests the list with `full` set, like phpMyAdmin's RefreshController (which
 * only checks the parameter's presence).
 */
export function ProcessesPage({
  server,
  search,
  onSearch,
}: {
  server: number
  search: { showExecuting: boolean; full: boolean; order_by_field: string; sort_order: string }
  onSearch: (
    s: Partial<{ showExecuting: boolean; full: boolean; order_by_field: string; sort_order: string }>,
  ) => void
}) {
  const qc = useQueryClient()
  const [auto, setAuto] = useState(false)
  const [rate, setRate] = useState(5)
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'notice'; text: string } | null>(null)
  const key = qk.status(server, 'processes', { ...search, auto })
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => {
      void signal
      return api.processes(server, { ...search, full: auto ? true : search.full })
    },
    refetchInterval: auto ? rate * 1000 : false,
    placeholderData: (prev) => prev,
  })
  const kill = useMutation({
    mutationFn: (id: string) => api.killProcess(server, id),
    onSuccess: (r, id) => {
      setMessage(r.message)
      qc.setQueryData<ProcessList>(key, (old) =>
        old === undefined ? old : { ...old, rows: old.rows.filter((p) => p.id !== id) },
      )
    },
    onError: (e) => {
      const env = e instanceof ApiError ? (e.envelope as unknown as { message?: unknown }) : null
      setMessage({ type: 'error', text: typeof env?.message === 'string' ? env.message : String(e) })
    },
  })
  const l = q.data
  return (
    <div>
      <Panel title={t('Filters')} id="tableFilter">
        <PanelBody>
          <form
            className="flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void q.refetch()
            }}
          >
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                id="showExecuting"
                name="showExecuting"
                className="autosubmit"
                checked={search.showExecuting}
                onChange={(e) => onSearch({ showExecuting: e.target.checked })}
              />
              {t('Show only active')}
            </label>
            <input type="submit" value={t('Refresh')} className={buttonVariants()} />
          </form>
        </PanelBody>
      </Panel>
      {message !== null && <MessageBox type={message.type}>{message.text}</MessageBox>}
      {q.error !== null && <MessageBox {...errorMessage(q.error)} />}
      {l === undefined ? (
        <Loading />
      ) : (
        <Table id="tableprocesslist" zebra className="mb-3">
          <thead>
            <tr>
              <th>{t('Processes')}</th>
              {l.columns.map((c) => (
                <th key={c.orderByField} scope="col" className="whitespace-nowrap">
                  <button
                    type="button"
                    className="sortlink inline-flex items-center gap-1 text-accent"
                    onClick={() =>
                      onSearch({ order_by_field: c.orderByField, sort_order: c.sortOrder, full: false })
                    }
                  >
                    {c.name}
                    {c.isSorted &&
                      (c.sortOrder === 'DESC' ? (
                        <ArrowUp className="size-3" aria-label={t('Ascending')} />
                      ) : (
                        <ArrowDown className="size-3" aria-label={t('Descending')} />
                      ))}
                  </button>
                  {c.hasFullQuery && (
                    <button
                      type="button"
                      className="ms-1 align-middle"
                      title={c.isFull ? t('Truncate shown queries') : t('Show full queries')}
                      onClick={() => onSearch({ full: !c.isFull })}
                    >
                      {c.isFull ? (
                        <FileType className="inline size-4" aria-label={t('Truncate shown queries')} />
                      ) : (
                        <FileText className="inline size-4" aria-label={t('Show full queries')} />
                      )}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {l.rows.map((p) => (
              <tr key={p.id} data-process-id={p.id}>
                <td>
                  <button
                    type="button"
                    className="kill_process text-accent"
                    onClick={() => kill.mutate(p.id)}
                  >
                    {t('Kill')}
                  </button>
                </td>
                <td className="text-end font-mono">{p.id}</td>
                <td>
                  {['system user', 'event_scheduler', 'unauthenticated user'].includes(p.user) ? (
                    p.user
                  ) : (
                    <Link
                      to={path(`/s/${server}/privileges`)}
                      search={
                        {
                          username: p.user,
                          hostname: p.userHost,
                          dbname: p.db,
                          tablename: '',
                          routinename: '',
                        } as never
                      }
                    >
                      {p.user}
                    </Link>
                  )}
                </td>
                <td>{p.host}</td>
                <td>
                  {p.db !== '' ? (
                    <Link to="/s/$server/db/$db" params={{ server, db: p.db }}>
                      {p.db}
                    </Link>
                  ) : (
                    <em>{t('None')}</em>
                  )}
                </td>
                <td>{p.command}</td>
                <td className="text-end font-mono">{p.time}</td>
                <td>{p.state}</td>
                {l.isMariaDb && <td>{p.progress}</td>}
                <td>
                  {p.info === null ? (
                    '---'
                  ) : (
                    <pre className="whitespace-pre-wrap font-mono text-xs" dir="ltr">
                      <code className="sql">{p.info}</code>
                    </pre>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <MessageBox type="notice">
        {t(
          'Note: Enabling the auto refresh here might cause heavy traffic between the web server and the MySQL server.',
        )}
      </MessageBox>
      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          {t('Refresh rate')}:
          <select
            id="id_refreshRate"
            name="refreshRate"
            className="input w-auto"
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r < 60
                  ? ngettext('%d second', '%d seconds', r).replace('%d', String(r))
                  : ngettext('%d minute', '%d minutes', r / 60).replace('%d', String(r / 60))}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          id="toggleRefresh"
          className="flex items-center gap-1 text-accent"
          onClick={() => setAuto(!auto)}
        >
          {auto ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {auto ? t('Stop auto refresh') : t('Start auto refresh')}
        </button>
      </div>
    </div>
  )
}

/** chart series tokens (packages/ui themes.css) */
const PIE_COLORS = Array.from({ length: 10 }, (_, i) => `var(--chart-${i + 1})`)

/** A small SVG pie (the Chart.js pie of queries.ts) */
function Pie({ labels, data, ariaLabel }: { labels: string[]; data: number[]; ariaLabel: string }) {
  const total = data.reduce((a, b) => a + b, 0)
  let angle = -Math.PI / 2
  const slices = data.map((v, i) => {
    const a = (v / (total || 1)) * Math.PI * 2
    const start = angle
    angle += a
    const large = a > Math.PI ? 1 : 0
    const p = (x: number) => [100 + 90 * Math.cos(x), 100 + 90 * Math.sin(x)]
    const [x1, y1] = p(start)
    const [x2, y2] = p(angle)
    const d =
      data.length === 1
        ? 'M100,10 A90,90 0 1,1 99.99,10 Z'
        : `M100,100 L${x1},${y1} A90,90 0 ${large},1 ${x2},${y2} Z`
    return { d, color: PIE_COLORS[i % PIE_COLORS.length]!, label: labels[i]!, v }
  })
  return (
    <figure
      className="flex flex-wrap items-start gap-4"
      id="query-statistics-chart"
      role="img"
      aria-label={ariaLabel}
    >
      <svg viewBox="0 0 200 200" className="size-60" aria-hidden="true">
        <title>{ariaLabel}</title>
        {slices.map((s) => (
          <path key={s.label} d={s.d} style={{ fill: s.color }}>
            <title>{`${s.label}: ${s.v}`}</title>
          </path>
        ))}
      </svg>
      <ul className="text-xs">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block size-3" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </figure>
  )
}

/** pma: templates/server/status/queries/index.twig */
export function QueriesPage({ server }: { server: number }) {
  const q = useQuery({
    queryKey: qk.status(server, 'queries'),
    queryFn: () => api.queryStatistics(server),
  })
  const s = q.data
  if (q.error !== null) return <MessageBox {...errorMessage(q.error)} />
  if (s === undefined) return <Loading />
  if (!s.isDataLoaded)
    return <MessageBox type="error">{t('Not enough privilege to view query statistics.')}</MessageBox>
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1 text-base font-semibold">
        {t('Questions since startup:')} {s.total} <MySqlDocLink url={s.questionsDocUrl} />
      </h3>
      <ul className="mb-3 list-disc ps-6 text-sm" id="questionsAverages">
        <li>{t('ø per hour: %s', s.perHour)}</li>
        <li>{t('ø per minute: %s', s.perMinute)}</li>
        {s.perSecond !== null && <li>{t('ø per second: %s', s.perSecond)}</li>}
      </ul>
      <div className="flex flex-wrap items-start gap-6">
        <Table id="serverStatusQueriesDetails" zebra>
          <thead>
            <tr>
              <th scope="col">{t('Statements')}</th>
              <th scope="col" className="!text-end">
                {t('#')}
              </th>
              <th scope="col" className="!text-end">
                {t('ø per hour')}
              </th>
              <th scope="col" className="!text-end">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {s.queries.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.name}</th>
                <td className="text-end font-mono">{r.value}</td>
                <td className="text-end font-mono">{r.perHour}</td>
                <td className="text-end font-mono">{r.percentage}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Pie
          labels={s.chart.labels}
          data={s.chart.data}
          ariaLabel={t('Pie chart with the most frequent statements.')}
        />
      </div>
    </div>
  )
}

function LinkView({
  link,
  onFlush,
  server,
}: { link: StatusLink; onFlush: (f: string) => void; server: number }): ReactNode {
  switch (link.kind) {
    case 'doc':
      return <MySqlDocLink url={link.url} />
    case 'flush':
      return (
        <button type="button" className="text-accent hover:underline" onClick={() => onFlush(link.flush)}>
          {link.label}
        </button>
      )
    case 'sql':
      return (
        <Link to="/s/$server/sql" params={{ server }} search={{ sql: link.sql }}>
          {link.label}
        </Link>
      )
    case 'route':
      return link.route.startsWith('#') ? (
        <Link to="/s/$server/status" params={{ server }} hash={link.route.slice(1)}>
          {link.label}
        </Link>
      ) : (
        <Link to={path(`/s/${server}${link.route.replace(/^\/server/, '')}`)}>{link.label}</Link>
      )
  }
}

/**
 * pma: templates/server/status/variables/index.twig with resources/js/server/status/variables.ts
 * (client-side text / alert / category filters, unformatted toggle, related links box).
 */
export function StatusVariablesPage({
  server,
  initial,
}: {
  server: number
  initial: { filterText: string; filterAlert: boolean; filterCategory: string; dontFormat: boolean }
}) {
  const qc = useQueryClient()
  const key = qk.status(server, 'variables')
  const q = useQuery({ queryKey: key, queryFn: () => api.statusVariables(server) })
  const [text, setText] = useState(initial.filterText)
  const [alertOnly, setAlertOnly] = useState(initial.filterAlert)
  const [category, setCategory] = useState(initial.filterCategory)
  const [raw, setRaw] = useState(initial.dontFormat)
  const [flushed, setFlushed] = useState<string | null>(null)
  const flush = useMutation({
    mutationFn: (f: string) => api.statusVariables(server, { flush: f }),
    onSuccess: (r) => {
      setFlushed(r.flushed)
      qc.setQueryData(key, r)
    },
  })
  const word = text.replace(/_/g, ' ')
  const textFilter = useMemo(() => {
    if (word.length === 0 || word.length >= 32768) return { re: null, error: false }
    try {
      return { re: new RegExp(`(^| )${word}`, 'i'), error: false }
    } catch {
      return { re: null, error: true }
    }
  }, [word])
  const v = q.data
  if (q.error !== null) return <MessageBox {...errorMessage(q.error)} />
  if (v === undefined) return <Loading />
  if (!v.isDataLoaded)
    return <MessageBox type="error">{t('Not enough privilege to view status variables.')}</MessageBox>
  const section = category.length > 0 ? category : word
  const links =
    section.length > 1 ? v.links.filter((l) => `status_${l.section}`.includes(`status_${section}`)) : []
  const visible = (x: StatusVariable) =>
    (textFilter.re === null || textFilter.re.test(x.name.replaceAll('_', ' '))) &&
    (!alertOnly || x.isAlert) &&
    (category === '' || x.section === category)
  return (
    <div>
      <Panel title={t('Filters')} id="tableFilter">
        <PanelBody>
          <form
            className="flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void q.refetch()
            }}
          >
            <label htmlFor="filterText">{t('Containing the word:')}</label>
            <input
              id="filterText"
              name="filterText"
              type="text"
              className={`input w-56 ${textFilter.error ? 'error border-error' : ''}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                id="filterAlert"
                checked={alertOnly}
                onChange={(e) => setAlertOnly(e.target.checked)}
              />
              {t('Show only alert values')}
            </label>
            <label className="sr-only" htmlFor="filterCategory">
              {t('Filter by category…')}
            </label>
            <select
              id="filterCategory"
              className="input w-auto"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">{t('Filter by category…')}</option>
              {v.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                id="dontFormat"
                checked={raw}
                onChange={(e) => setRaw(e.target.checked)}
              />
              {t('Show unformatted values')}
            </label>
            <input type="submit" value={t('Refresh')} className={buttonVariants()} />
          </form>
        </PanelBody>
      </Panel>
      {flush.error !== null && <MessageBox {...errorMessage(flush.error)} />}
      {flushed !== null && <MessageBox type="success">{flushed}</MessageBox>}
      {links.length > 0 && (
        <MessageBox type="info" className="">
          <span id="linkSuggestions">
            {t('Related links:')}{' '}
            {links.map((l) => (
              <span key={l.section} className={`status_${l.section}`}>
                {l.links.map((x, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static list
                  <span key={i}>
                    <LinkView link={x} server={server} onFlush={(f) => flush.mutate(f)} /> |{' '}
                  </span>
                ))}
              </span>
            ))}
          </span>
        </MessageBox>
      )}
      <Table id="serverStatusVariables" zebra className="w-full">
        <thead>
          <tr>
            <th scope="col">{t('Variable')}</th>
            <th scope="col">{t('Value')}</th>
            <th scope="col">{t('Description')}</th>
          </tr>
        </thead>
        <tbody>
          {v.variables.filter(visible).map((x) => (
            <tr key={x.name} className={x.section !== null ? `s_${x.section}` : undefined}>
              <th className="name">
                {x.name.replaceAll('_', ' ')} <MySqlDocLink url={x.docUrl} />
              </th>
              <td className="value text-end font-mono">
                <span className={x.hasAlert ? (x.isAlert ? 'text-error' : 'text-success') : undefined}>
                  {raw ? (
                    x.value
                  ) : x.formatted.title !== undefined ? (
                    <abbr title={x.formatted.title}>{x.formatted.text}</abbr>
                  ) : (
                    x.formatted.text
                  )}
                </span>
              </td>
              <td className="w-1/2">
                {x.description}{' '}
                {x.descriptionLinks.map((l, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static list
                  <LinkView key={i} link={l} server={server} onFlush={(f) => flush.mutate(f)} />
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

/** pma: templates/server/status/advisor/index.twig */
export function AdvisorPage({ server }: { server: number }) {
  const q = useQuery({
    queryKey: qk.status(server, 'advisor'),
    queryFn: () => api.advisor(server),
  })
  const [open, setOpen] = useState(0)
  const [instructions, setInstructions] = useState(false)
  const navigate = useNavigate()
  const a = q.data
  if (q.error !== null) return <MessageBox {...errorMessage(q.error)} />
  if (a === undefined) return <Loading />
  // in-app variable links (`{var}` → /s/n/variables?filter=var) navigate without a reload
  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('a')
    const href = el?.getAttribute('href') ?? ''
    if (href.startsWith('/s/')) {
      e.preventDefault()
      const u = new URL(href, window.location.origin)
      void navigate({ to: u.pathname, search: Object.fromEntries(u.searchParams) as never })
    }
  }
  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">{t('Advisor system')}</h2>
      {!a.isDataLoaded ? (
        <MessageBox type="error">{t('Not enough privilege to view the advisor.')}</MessageBox>
      ) : (
        <>
          <Button className="mb-4" onClick={() => setInstructions(true)}>
            <CircleHelp aria-hidden />
            {t('Instructions')}
          </Button>
          <Modal
            open={instructions}
            id="advisorInstructionsModal"
            title={t('Advisor system')}
            size="md"
            onClose={() => setInstructions(false)}
            footer={
              <Button variant="primary" onClick={() => setInstructions(false)}>
                {t('Close')}
              </Button>
            }
          >
            <div className="space-y-2">
              <p>
                {t(
                  'The Advisor system can provide recommendations on server variables by analyzing the server status variables.',
                )}
              </p>
              <p>
                {t(
                  'Do note however that this system provides recommendations based on simple calculations and by rule of thumb which may not necessarily apply to your system.',
                )}
              </p>
              <p>
                {t(
                  'Prior to changing any of the configuration, be sure to know what you are changing (by reading the documentation) and how to undo the change. Wrong tuning can have a very negative effect on performance.',
                )}
              </p>
              <p>
                {t(
                  'The best way to tune your system would be to change only one setting at a time, observe or benchmark your database, and undo the change if there was no clearly measurable improvement.',
                )}
              </p>
            </div>
          </Modal>
          {a.errors.length > 0 && (
            <MessageBox type="error">
              <h4 className="font-semibold">{t('Errors occurred while executing rule expressions:')}</h4>
              <ul className="list-disc ps-5">
                {a.errors.map((e, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: messages may repeat
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </MessageBox>
          )}
          {a.fired.length > 0 && (
            <>
              <h4 className="mb-2 font-semibold">{t('Possible performance issues')}</h4>
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: delegates link clicks only */}
              <div
                id="rulesAccordion"
                className="mb-4 divide-y divide-border rounded border border-border"
                onClick={onClick}
              >
                {a.fired.map((r, i) => (
                  <div key={`${r.id}-${i}`} className="accordion-item">
                    <button
                      type="button"
                      className="w-full bg-bg-subtle px-3 py-2 text-start text-sm font-medium"
                      aria-expanded={open === i}
                      aria-controls={`collapse${i + 1}`}
                      onClick={() => setOpen(open === i ? -1 : i)}
                    >
                      {stripTags(r.issue)}
                    </button>
                    {open === i && (
                      <dl
                        id={`collapse${i + 1}`}
                        className="space-y-1 px-3 py-2 text-sm [&_dt]:font-semibold"
                      >
                        <dt>{t('Issue:')}</dt>
                        <SafeHtml as="dd" html={r.issue} />
                        <dt>{t('Recommendation:')}</dt>
                        <SafeHtml as="dd" html={r.recommendation} />
                        <dt>{t('Justification:')}</dt>
                        <dd>{r.justification}</dd>
                        <dt>{t('Used variable / formula:')}</dt>
                        <dd className="font-mono">{r.formula}</dd>
                        <dt>{t('Test:')}</dt>
                        <dd className="font-mono">{r.test}</dd>
                      </dl>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
