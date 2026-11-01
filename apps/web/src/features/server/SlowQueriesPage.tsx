import type {
  SlowQueriesResponse,
  SlowQueriesUnavailable,
  SlowQueryExplainResponse,
  SlowQueryRow,
  SlowQuerySort,
} from '@bettermyadmin/contracts'
import { formatNumber } from '@bettermyadmin/i18n'
import {
  Button,
  Loading,
  MessageBox,
  Modal,
  MySqlDocLink,
  NativeSelect,
  PageHeader,
  Panel,
  PanelBody,
  Table,
  useConfirm,
} from '@bettermyadmin/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Gauge, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { t, translator } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'

export interface SlowQueriesSearch {
  source: 'digest' | 'slowlog'
  db: string
  sort: SlowQuerySort
  order: 'asc' | 'desc'
}

/** A duration in ms as `12.3 ms` / `4.56 s` (unit symbols, not translated) */
export function duration(ms: number): string {
  const tr = translator()
  return ms < 1000 ? `${formatNumber(tr, ms, 3, 2)} ms` : `${formatNumber(tr, ms / 1000, 3, 2)} s`
}

const count = (n: number) => formatNumber(translator(), n, 0, 0)

/** The explanation of a source problem, with the manual page that shows how to enable it. */
function reasonText(r: SlowQueriesUnavailable): string {
  switch (r) {
    case 'pfs-off':
      // i18n-new: Status › Slow queries (parity exception X65)
      return t(
        'performance_schema is off on this server, so no statement statistics are collected. Set performance_schema = ON in the server configuration (my.cnf) and restart the server. MariaDB has it off by default.',
      )
    case 'pfs-denied':
      // i18n-new: Status › Slow queries (parity exception X65)
      return t(
        'Your account cannot read performance_schema.events_statements_summary_by_digest: it needs the SELECT privilege on performance_schema.',
      )
    case 'digest-consumer-off':
      // i18n-new: Status › Slow queries (parity exception X65)
      return t(
        "The statements_digest consumer is disabled, so new statements are not summarized: UPDATE performance_schema.setup_consumers SET ENABLED = 'YES' WHERE NAME = 'statements_digest';",
      )
    case 'log-not-table':
      // i18n-new: Status › Slow queries (parity exception X65)
      return t(
        "log_output does not include TABLE, so the slow query log is not written to mysql.slow_log: SET GLOBAL log_output = 'FILE,TABLE';",
      )
    case 'slow-log-off':
      // i18n-new: Status › Slow queries (parity exception X65)
      return t(
        'The slow query log is off: SET GLOBAL slow_query_log = ON; (long_query_time decides which statements are logged).',
      )
    case 'slow-log-denied':
      // i18n-new: Status › Slow queries (parity exception X65)
      return t('Your account cannot read mysql.slow_log: it needs the SELECT privilege on that table.')
  }
}

function reasonDoc(r: SlowQueriesUnavailable, isMariaDb: boolean): string {
  const pfs = r === 'pfs-off' || r === 'pfs-denied' || r === 'digest-consumer-off'
  if (isMariaDb)
    return pfs
      ? 'https://mariadb.com/kb/en/performance-schema-overview/'
      : 'https://mariadb.com/kb/en/slow-query-log-overview/'
  return pfs
    ? 'https://dev.mysql.com/doc/refman/8.4/en/performance-schema-quick-start.html'
    : 'https://dev.mysql.com/doc/refman/8.4/en/slow-query-log.html'
}

const COLUMNS: Array<{ sort: SlowQuerySort; label: () => string }> = [
  { sort: 'count', label: () => t('Count') },
  // i18n-new: Status › Slow queries (parity exception X65)
  { sort: 'total', label: () => t('Total time') },
  // i18n-new: Status › Slow queries (parity exception X65)
  { sort: 'avg', label: () => t('Average time') },
  // i18n-new: Status › Slow queries (parity exception X65)
  { sort: 'max', label: () => t('Maximum time') },
  // i18n-new: Status › Slow queries (parity exception X65)
  { sort: 'rowsExamined', label: () => t('Rows examined') },
  // i18n-new: Status › Slow queries (parity exception X65)
  { sort: 'rowsSent', label: () => t('Rows sent') },
  // i18n-new: Status › Slow queries (parity exception X65)
  { sort: 'errors', label: () => t('Errors / warnings') },
  // i18n-new: Status › Slow queries (parity exception X65)
  { sort: 'lastSeen', label: () => t('Last seen') },
]

/**
 * Status › Slow queries (BetterMyAdmin only, parity exception X65): the statement digests of
 * performance_schema (or the slow log grouped by query), sortable and filtered by database; a row
 * opens its detail with the formatted text and EXPLAIN of a representative statement.
 */
export function SlowQueriesPage({
  server,
  search,
  onSearch,
}: {
  server: number
  search: SlowQueriesSearch
  onSearch: (s: Partial<SlowQueriesSearch>) => void
}) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [open, setOpen] = useState<SlowQueryRow | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const q = useQuery({
    queryKey: qk.status(server, 'slow-queries', search),
    queryFn: () => api.slowQueries(server, search),
    placeholderData: (prev) => prev,
  })
  const reset = useMutation({
    mutationFn: () => api.resetSlowQueries(server),
    onSuccess: (r) => {
      setMessage(r.message)
      void qc.invalidateQueries({ queryKey: qk.status(server, 'slow-queries') })
    },
  })
  const d = q.data
  const sortBy = (s: SlowQuerySort) =>
    onSearch({ sort: s, order: search.sort === s && search.order === 'desc' ? 'asc' : 'desc' })

  return (
    <div id="slowQueries">
      <PageHeader icon={Gauge}>
        {/* i18n-new: Status › Slow queries (parity exception X65) */}
        {t('Slow queries')}
      </PageHeader>
      <Panel title={t('Filters')} id="slowQueriesFilter">
        <PanelBody>
          <form
            className="flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void q.refetch()
            }}
          >
            <label className="flex items-center gap-1.5" htmlFor="slowQueriesSource">
              {/* i18n-new: Status › Slow queries (parity exception X65) */}
              {t('Source:')}
              <NativeSelect
                id="slowQueriesSource"
                className="w-auto"
                value={search.source}
                onChange={(e) => onSearch({ source: e.target.value as SlowQueriesSearch['source'], db: '' })}
              >
                {/* i18n-new: Status › Slow queries (parity exception X65) */}
                <option value="digest">{t('Statement digests (performance_schema)')}</option>
                {/* i18n-new: Status › Slow queries (parity exception X65) */}
                <option value="slowlog">{t('Slow query log (mysql.slow_log)')}</option>
              </NativeSelect>
            </label>
            <label className="flex items-center gap-1.5" htmlFor="slowQueriesDb">
              {t('Database')}
              <NativeSelect
                id="slowQueriesDb"
                className="w-auto"
                value={search.db}
                onChange={(e) => onSearch({ db: e.target.value })}
              >
                <option value="">{t('All')}</option>
                {[...new Set([...(d?.databases ?? []), ...(search.db !== '' ? [search.db] : [])])].map(
                  (db) => (
                    <option key={db} value={db}>
                      {db}
                    </option>
                  ),
                )}
              </NativeSelect>
            </label>
            <Button type="submit">{t('Refresh')}</Button>
            {d?.source === 'digest' && d.canReset && (
              <Button
                id="slowQueriesReset"
                variant="destructive"
                className="ms-auto"
                onClick={async () => {
                  const ok = await confirm({
                    // i18n-new: Status › Slow queries (parity exception X65)
                    question: t(
                      'Reset the statement statistics of the whole server? This truncates performance_schema.events_statements_summary_by_digest for every user.',
                    ),
                    destructive: true,
                  })
                  if (ok) reset.mutate()
                }}
              >
                <RotateCcw aria-hidden />
                {/* i18n-new: Status › Slow queries (parity exception X65) */}
                {t('Reset statistics')}
              </Button>
            )}
          </form>
        </PanelBody>
      </Panel>
      {message !== null && <MessageBox type={message.type}>{message.text}</MessageBox>}
      {reset.error !== null && <MessageBox {...errorMessage(reset.error)} />}
      {q.error !== null && <MessageBox {...errorMessage(q.error)} />}
      {d === undefined ? (
        q.error === null && <Loading />
      ) : (
        <SlowQueriesList d={d} search={search} sortBy={sortBy} onOpen={setOpen} />
      )}
      {open !== null && d !== undefined && (
        <SlowQueryDetailDialog server={server} source={d.source} row={open} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}

function SlowQueriesList({
  d,
  search,
  sortBy,
  onOpen,
}: {
  d: SlowQueriesResponse
  search: SlowQueriesSearch
  sortBy: (s: SlowQuerySort) => void
  onOpen: (r: SlowQueryRow) => void
}) {
  return (
    <>
      {d.reasons.map((r) => (
        <MessageBox key={r} type={d.available ? 'notice' : 'error'} data-reason={r}>
          {reasonText(r)} <MySqlDocLink url={reasonDoc(r, d.isMariaDb)}>{t('Documentation')}</MySqlDocLink>
        </MessageBox>
      ))}
      {d.source === 'slowlog' && d.settings.long_query_time !== undefined && (
        <p className="mb-2 text-xs text-fg-muted" id="slowQueriesSettings">
          slow_query_log = {d.settings.slow_query_log ?? ''} · long_query_time = {d.settings.long_query_time}{' '}
          · log_output = {d.settings.log_output ?? ''}
        </p>
      )}
      {d.available && (
        <>
          <p className="mb-2 text-xs text-fg-muted">
            {/* i18n-new: Status › Slow queries (parity exception X65) */}
            {t('Showing %1$s of %2$s statements.', count(d.rows.length), count(d.total))}
          </p>
          {d.rows.length === 0 ? (
            <MessageBox type="notice">
              {/* i18n-new: Status › Slow queries (parity exception X65) */}
              {t('No statements recorded yet.')}
            </MessageBox>
          ) : (
            <div className="overflow-x-auto">
              <Table zebra id="slowQueriesTable" className="w-full">
                <thead>
                  <tr>
                    <th scope="col">{t('Query')}</th>
                    <th scope="col">{t('Database')}</th>
                    {COLUMNS.map((c) => {
                      const active = search.sort === c.sort
                      return (
                        <th
                          key={c.sort}
                          scope="col"
                          className="!text-end whitespace-nowrap"
                          aria-sort={active ? (search.order === 'asc' ? 'ascending' : 'descending') : 'none'}
                          data-sort={c.sort}
                        >
                          <button
                            type="button"
                            className="sortlink inline-flex items-center gap-1 text-accent"
                            onClick={() => sortBy(c.sort)}
                          >
                            {c.label()}
                            {active &&
                              (search.order === 'asc' ? (
                                <ArrowUp className="size-3" aria-hidden />
                              ) : (
                                <ArrowDown className="size-3" aria-hidden />
                              ))}
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={`${r.schema ?? ''}/${r.digest}`} data-digest={r.digest}>
                      <td className="max-w-[32rem]">
                        <button
                          type="button"
                          className="slow-query-open block w-full truncate text-start font-mono text-xs text-accent hover:underline"
                          title={r.text}
                          dir="ltr"
                          onClick={() => onOpen(r)}
                        >
                          {r.text}
                        </button>
                      </td>
                      <td>{r.schema ?? <em className="text-fg-muted">{t('None')}</em>}</td>
                      <td className="text-end font-mono" data-col="count">
                        {count(r.count)}
                      </td>
                      <td className="text-end font-mono" data-col="total">
                        {duration(r.totalMs)}
                      </td>
                      <td className="text-end font-mono">{duration(r.avgMs)}</td>
                      <td className="text-end font-mono">{duration(r.maxMs)}</td>
                      <td className="text-end font-mono">{count(r.rowsExamined)}</td>
                      <td className="text-end font-mono">{count(r.rowsSent)}</td>
                      <td className={`text-end font-mono ${r.errors > 0 ? 'text-error' : ''}`}>
                        {count(r.errors)} / {count(r.warnings)}
                      </td>
                      <td className="text-end font-mono text-xs whitespace-nowrap" title={r.firstSeen ?? ''}>
                        {r.lastSeen ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}
    </>
  )
}

function SlowQueryDetailDialog({
  server,
  source,
  row,
  onClose,
}: {
  server: number
  source: 'digest' | 'slowlog'
  row: SlowQueryRow
  onClose: () => void
}) {
  const db = row.schema ?? ''
  const detail = useQuery({
    queryKey: qk.status(server, 'slow-query', { source, digest: row.digest, db }),
    queryFn: () => api.slowQueryDetail(server, { source, digest: row.digest, db }),
  })
  const explain = useMutation<SlowQueryExplainResponse, Error, string>({
    mutationFn: (query) => api.explainSlowQuery(server, db, query),
  })
  const d = detail.data
  const toSql = d?.sample ?? d?.text ?? row.text
  return (
    <Modal
      open
      id="slowQueryDetail"
      // i18n-new: Status › Slow queries (parity exception X65)
      title={t('Statement details')}
      size="lg"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('Close')}
        </Button>
      }
    >
      {detail.error !== null && <MessageBox {...errorMessage(detail.error)} />}
      {d === undefined ? (
        detail.error === null && <Loading />
      ) : (
        <div className="space-y-3 text-[13px]">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt className="font-semibold">{t('Database')}</dt>
            <dd>{d.schema ?? <em className="text-fg-muted">{t('None')}</em>}</dd>
            <dt className="font-semibold">{t('Count')}</dt>
            <dd className="font-mono">{count(row.count)}</dd>
            {/* i18n-new: Status › Slow queries (parity exception X65) */}
            <dt className="font-semibold">{t('Average time')}</dt>
            <dd className="font-mono">{duration(row.avgMs)}</dd>
            {/* i18n-new: Status › Slow queries (parity exception X65) */}
            <dt className="font-semibold">{t('Maximum time')}</dt>
            <dd className="font-mono">{duration(row.maxMs)}</dd>
            {/* i18n-new: Status › Slow queries (parity exception X65) */}
            <dt className="font-semibold">{t('First seen')}</dt>
            <dd className="font-mono">{row.firstSeen ?? ''}</dd>
          </dl>
          <section>
            {/* i18n-new: Status › Slow queries (parity exception X65) */}
            <h3 className="mb-1 font-semibold">{t('Normalized statement')}</h3>
            <pre
              className="max-h-64 overflow-auto rounded border border-border bg-bg-inset p-2 font-mono text-xs whitespace-pre-wrap"
              dir="ltr"
              id="slowQueryFormatted"
            >
              <code className="sql">{d.formatted}</code>
            </pre>
          </section>
          <section>
            {/* i18n-new: Status › Slow queries (parity exception X65) */}
            <h3 className="mb-1 font-semibold">{t('Example statement')}</h3>
            {d.sample !== null ? (
              <pre
                className="max-h-40 overflow-auto rounded border border-border bg-bg-inset p-2 font-mono text-xs whitespace-pre-wrap"
                dir="ltr"
                id="slowQuerySample"
              >
                <code className="sql">{d.sample}</code>
              </pre>
            ) : (
              <p className="text-fg-muted" id="slowQueryNoSample">
                {/* i18n-new: Status › Slow queries (parity exception X65) */}
                {t(
                  'performance_schema keeps no example of this statement with its values. Open it in the SQL tab, replace the ? placeholders with values and explain it there.',
                )}
              </p>
            )}
          </section>
          <div className="flex flex-wrap items-center gap-2">
            {d.explainable && d.sample !== null && (
              <Button
                id="slowQueryExplain"
                variant="primary"
                disabled={explain.isPending}
                onClick={() => explain.mutate(d.sample!)}
              >
                {t('Explain SQL')}
              </Button>
            )}
            {db !== '' ? (
              <Link
                to="/s/$server/db/$db/sql"
                params={{ server, db }}
                search={{ sql: toSql } as never}
                className="text-accent"
                id="slowQueryOpenSql"
              >
                {/* i18n-new: Status › Slow queries (parity exception X65) */}
                {t('Open in the SQL tab')}
              </Link>
            ) : (
              <Link
                to="/s/$server/sql"
                params={{ server }}
                search={{ sql: toSql } as never}
                className="text-accent"
                id="slowQueryOpenSql"
              >
                {/* i18n-new: Status › Slow queries (parity exception X65) */}
                {t('Open in the SQL tab')}
              </Link>
            )}
          </div>
          {explain.error !== null && <MessageBox {...errorMessage(explain.error)} />}
          {explain.data !== undefined && <ExplainResult r={explain.data} />}
        </div>
      )}
    </Modal>
  )
}

function ExplainResult({ r }: { r: SlowQueryExplainResponse }) {
  if (r.error !== null) return <MessageBox type="error">{r.error}</MessageBox>
  return (
    <section id="slowQueryExplainResult">
      <h3 className="mb-1 font-semibold">{t('Explain output')}</h3>
      <pre className="mb-2 font-mono text-xs whitespace-pre-wrap" dir="ltr">
        {r.sql}
      </pre>
      <div className="overflow-x-auto">
        <Table zebra>
          <thead>
            <tr>
              {r.columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: EXPLAIN rows have no key
              <tr key={i}>
                {row.map((v, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns by position
                  <td key={j} className="font-mono text-xs">
                    {v ?? <em className="text-fg-muted">NULL</em>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </section>
  )
}
