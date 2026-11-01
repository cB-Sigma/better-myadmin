import type { DashboardSample } from '@bettermyadmin/contracts'
import { formatByteDown, formatNumber, timespanFormat } from '@bettermyadmin/i18n'
import {
  Alert,
  Button,
  Loading,
  MessageBox,
  NativeSelect,
  PageHeader,
  Panel,
  PanelBody,
  cn,
} from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { Activity, CircleAlert, Pause, Play, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { ngettext, t, translator } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import {
  DASHBOARD_RATES,
  type Level,
  type Metrics,
  type ThresholdKey,
  computeMetrics,
  level,
  pushHistory,
  replicaLevel,
  sparkPath,
  sparkPoints,
} from './dashboard'
import { clock } from './monitorChart'

/** Whether the document is shown (polling stops while the tab is hidden). */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

/** plain grouped numbers (no SI prefix: Util::formatNumber with digitsLeft 0) */
const num = (v: number | null, right = 1) => (v === null ? '–' : formatNumber(translator(), v, 0, right))
const pct = (v: number | null) => (v === null ? '–' : `${formatNumber(translator(), v, 0, 1)} %`)
const bytes = (v: number | null) => (v === null ? '–' : formatByteDown(translator(), v, 3, 1)!.join(' '))

/**
 * A sparkline of one series (theme accent, 2px line, light area), right-aligned so new points
 * enter on the right; hovering shows the value and time of the nearest point.
 */
function Sparkline({
  values,
  times,
  format,
  label,
}: {
  values: Array<number | null>
  times: number[]
  format: (v: number | null) => string
  label: string
}) {
  const W = 240
  const H = 44
  const [hover, setHover] = useState<number | null>(null)
  const pts = sparkPoints(values, W, H)
  const line = sparkPath(pts)
  const last = [...pts].reverse().find((p) => p !== null) ?? null
  const first = pts.find((p) => p !== null) ?? null
  const area =
    line !== '' && first !== null && last !== null ? `${line}L${last[0]},${H}L${first[0]},${H}Z` : ''
  const p = hover === null ? null : pts[hover]
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-11 w-full"
        role="img"
        aria-label={label}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const x = ((e.clientX - r.left) / r.width) * W
          let best: number | null = null
          let dist = Number.POSITIVE_INFINITY
          pts.forEach((q, i) => {
            if (q !== null && Math.abs(q[0] - x) < dist) {
              dist = Math.abs(q[0] - x)
              best = i
            }
          })
          setHover(best)
        }}
        onMouseLeave={() => setHover(null)}
      >
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} style={{ stroke: 'var(--border)' }} strokeWidth="1" />
        {area !== '' && <path d={area} style={{ fill: 'var(--accent)', opacity: 0.12 }} />}
        {line !== '' && (
          <path
            d={line}
            fill="none"
            style={{ stroke: 'var(--accent)' }}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {p !== null && p !== undefined && (
          <line
            x1={p[0]}
            x2={p[0]}
            y1="0"
            y2={H}
            style={{ stroke: 'var(--fg-muted)' }}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {hover !== null && p !== null && p !== undefined && (
        <div
          className="pointer-events-none absolute -top-7 z-10 rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-xs whitespace-nowrap text-fg shadow"
          style={{ left: `${Math.min(70, (p[0] / W) * 100)}%` }}
        >
          <span className="font-mono">{format(values[hover] ?? null)}</span>{' '}
          <span className="text-fg-muted">{clock(times[hover] ?? 0)}</span>
        </div>
      )}
    </div>
  )
}

/** A card: title, the current value, a caption, the threshold state (icon + text) and the sparkline */
function MetricCard({
  id,
  title,
  value,
  unit,
  caption,
  lvl = 'ok',
  series,
  times,
  format,
}: {
  id: string
  title: string
  value: string
  unit?: string
  caption?: string
  lvl?: Level
  series?: Array<number | null>
  times: number[]
  format: (v: number | null) => string
}) {
  const head = useId()
  return (
    <Panel
      title={title}
      headerId={head}
      data-card={id}
      data-level={lvl}
      className={cn('mb-0', lvl === 'warning' && 'border-warning', lvl === 'critical' && 'border-error')}
      actions={
        lvl === 'ok' ? undefined : (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs font-semibold',
              lvl === 'warning' ? 'text-warning' : 'text-error',
            )}
          >
            {lvl === 'warning' ? (
              <TriangleAlert className="size-3.5" aria-hidden />
            ) : (
              <CircleAlert className="size-3.5" aria-hidden />
            )}
            {lvl === 'warning'
              ? t('Warning')
              : // i18n-new: Status › Dashboard (parity exception X64)
                t('Critical')}
          </span>
        )
      }
    >
      <PanelBody className="space-y-1">
        <p className="flex items-baseline gap-1.5">
          <span className="font-mono text-2xl leading-tight text-fg" data-value>
            {value}
          </span>
          {unit !== undefined && <span className="text-xs text-fg-muted">{unit}</span>}
        </p>
        <p className="min-h-[1.25em] text-xs text-fg-muted">{caption ?? ''}</p>
        {series !== undefined && <Sparkline values={series} times={times} format={format} label={title} />}
      </PanelBody>
    </Panel>
  )
}

/**
 * Status › Dashboard (BetterMyAdmin only, parity exception X64): cards with the live rates of the
 * server, polled every 2/5/10/30 s (paused on demand and while the browser tab is hidden).
 */
export function DashboardPage({ server }: { server: number }) {
  const [rate, setRate] = useState<number>(5)
  const [paused, setPaused] = useState(false)
  const visible = useDocumentVisible()
  const running = !paused && visible
  const q = useQuery({
    queryKey: qk.status(server, 'dashboard'),
    queryFn: ({ signal }) => api.dashboard(server, signal),
    refetchInterval: running ? rate * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: 0,
  })
  const prev = useRef<DashboardSample | null>(null)
  const [history, setHistory] = useState<Metrics[]>([])
  const [latest, setLatest] = useState<DashboardSample | null>(null)

  // a pause or a hidden tab breaks the series: the next reading starts a new segment
  useEffect(() => {
    if (!running) prev.current = null
  }, [running])

  useEffect(() => {
    const s = q.data
    if (s === undefined || s.serverTime === prev.current?.serverTime) return
    const m = computeMetrics(prev.current, s)
    prev.current = s
    setLatest(s)
    setHistory((h) => pushHistory(h, m))
  }, [q.data])

  const refetch = q.refetch
  // back from a hidden tab or a pause: read at once instead of waiting a full interval
  useEffect(() => {
    if (running) void refetch()
  }, [running, refetch])

  if (q.error !== null && latest === null) return <MessageBox {...errorMessage(q.error)} />
  if (latest === null) return <Loading />
  const m = history.at(-1)!
  const times = history.map((h) => h.t)
  const series = (k: keyof Metrics) => history.map((h) => h[k] as number | null)
  const th = (k: ThresholdKey) => level(k, m[k as keyof Metrics] as number | null)
  const replica = latest.replica
  const persec = t('per second')
  const version = `${latest.variables.version ?? ''}${latest.variables.version_comment !== undefined ? ` - ${latest.variables.version_comment}` : ''}`

  return (
    <div id="statusDashboard">
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <PageHeader icon={Activity} className="mb-0">
          {/* i18n-new: Status › Dashboard (parity exception X64) */}
          {t('Dashboard')}
        </PageHeader>
        <span>
          {t('Server version:')} <span className="font-mono">{version}</span>
        </span>
        {m.uptime !== null && (
          <span data-uptime>
            {/* i18n-new: Status › Dashboard (parity exception X64) */}
            {t('Uptime:')} {timespanFormat(translator(), m.uptime)}
          </span>
        )}
        <span className="ms-auto flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5" htmlFor="dashboardRate">
            {t('Refresh rate')}
            <NativeSelect
              id="dashboardRate"
              className="w-auto"
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
            >
              {DASHBOARD_RATES.map((r) => (
                <option key={r} value={r}>
                  {ngettext('%d second', '%d seconds', r).replace('%d', String(r))}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Button id="dashboardPause" onClick={() => setPaused(!paused)} aria-pressed={paused}>
            {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
            {paused ? t('Resume monitor') : t('Pause monitor')}
          </Button>
          <span
            className="text-xs text-fg-muted"
            data-state={running ? 'running' : 'stopped'}
            id="dashboardState"
          >
            {running
              ? // i18n-new: Status › Dashboard (parity exception X64)
                t('Last update: %s', clock(latest.serverTime))
              : paused
                ? // i18n-new: Status › Dashboard (parity exception X64)
                  t('Paused')
                : // i18n-new: Status › Dashboard (parity exception X64)
                  t('Paused while the page is hidden')}
          </span>
        </span>
      </div>
      {q.error !== null && <MessageBox {...errorMessage(q.error)} />}
      {latest.status === null && (
        <MessageBox type="error">{t('Not enough privilege to view server status.')}</MessageBox>
      )}
      {replica === 'denied' && (
        <Alert variant="info" className="mb-3" id="dashboardReplicaNote">
          {/* i18n-new: Status › Dashboard (parity exception X64) */}
          {t(
            'The replication lag is not shown: reading the replica status needs the REPLICATION CLIENT privilege (REPLICA MONITOR or SLAVE MONITOR on MariaDB).',
          )}
        </Alert>
      )}
      {latest.status !== null && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
          <MetricCard
            id="qps"
            // i18n-new: Status › Dashboard (parity exception X64)
            title={t('Queries per second')}
            value={num(m.qps)}
            unit={persec}
            caption={t('Questions')}
            series={series('qps')}
            times={times}
            format={(v) => num(v)}
          />
          <MetricCard
            id="connections"
            title={t('Connections')}
            value={`${num(m.threadsConnected, 0)} / ${num(m.maxConnections, 0)}`}
            caption={`${pct(m.connectionUsage)} · ${t('Max. concurrent connections')}: ${num(m.maxUsedConnections, 0)} · ${t('Aborted')}: ${num(m.abortedTotal, 0)}`}
            lvl={th('connectionUsage')}
            series={series('threadsConnected')}
            times={times}
            format={(v) => num(v, 0)}
          />
          <MetricCard
            id="threads"
            // i18n-new: Status › Dashboard (parity exception X64)
            title={t('Threads running')}
            value={num(m.threadsRunning, 0)}
            series={series('threadsRunning')}
            times={times}
            format={(v) => num(v, 0)}
          />
          <MetricCard
            id="bufferPoolHitRate"
            // i18n-new: Status › Dashboard (parity exception X64)
            title={t('InnoDB buffer pool hit rate')}
            value={pct(m.bufferPoolHitRate)}
            caption={t('Read requests')}
            lvl={th('bufferPoolHitRate')}
            series={series('bufferPoolHitRate')}
            times={times}
            format={pct}
          />
          <MetricCard
            id="bufferPoolUsage"
            title={t('Buffer pool usage')}
            value={pct(m.bufferPoolUsage)}
            caption={bytes(Number(latest.variables.innodb_buffer_pool_size ?? Number.NaN) || null)}
            series={series('bufferPoolUsage')}
            times={times}
            format={pct}
          />
          <MetricCard
            id="bytesIn"
            title={t('Bytes received')}
            value={bytes(m.bytesInPerSec)}
            unit={persec}
            series={series('bytesInPerSec')}
            times={times}
            format={bytes}
          />
          <MetricCard
            id="bytesOut"
            title={t('Bytes sent')}
            value={bytes(m.bytesOutPerSec)}
            unit={persec}
            series={series('bytesOutPerSec')}
            times={times}
            format={bytes}
          />
          <MetricCard
            id="slow"
            // i18n-new: Status › Dashboard (parity exception X64)
            title={t('Slow queries')}
            value={num(m.slowPerMinute)}
            unit={t('per minute')}
            caption={`${t('Total')}: ${num(m.slowTotal, 0)}`}
            lvl={th('slowPerMinute')}
            series={series('slowPerMinute')}
            times={times}
            format={(v) => num(v)}
          />
          <MetricCard
            id="tableLocks"
            // i18n-new: Status › Dashboard (parity exception X64)
            title={t('Table locks waited')}
            value={num(m.tableLocksWaitedPerSec)}
            unit={persec}
            caption={`${t('Total')}: ${num(m.tableLocksWaitedTotal, 0)}`}
            lvl={th('tableLocksWaitedPerSec')}
            series={series('tableLocksWaitedPerSec')}
            times={times}
            format={(v) => num(v)}
          />
          <MetricCard
            id="tmpDisk"
            // i18n-new: Status › Dashboard (parity exception X64)
            title={t('Temporary tables on disk')}
            value={pct(m.tmpDiskRatio)}
            lvl={th('tmpDiskRatio')}
            series={series('tmpDiskRatio')}
            times={times}
            format={pct}
          />
          {replica !== null && replica !== 'denied' && (
            <MetricCard
              id="replicaLag"
              // i18n-new: Status › Dashboard (parity exception X64)
              title={t('Replication lag')}
              value={
                replica.lag === null
                  ? '–'
                  : ngettext('%d second', '%d seconds', replica.lag).replace('%d', num(replica.lag, 0))
              }
              caption={`IO: ${replica.ioRunning} · SQL: ${replica.sqlRunning}`}
              lvl={replicaLevel(replica)}
              series={series('replicaLag')}
              times={times}
              format={(v) => num(v, 0)}
            />
          )}
        </div>
      )}
    </div>
  )
}
