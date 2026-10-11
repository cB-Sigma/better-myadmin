import type { DatabasesResponse, NavPageSelector } from '@bettermyadmin/contracts'
import { Loading, MessageBox, MySqlDocLink, PageHeader, Panel, PanelBody, Table } from '@bettermyadmin/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Check, Database, FileCode2, Shield, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { errorMessage } from '../../lib/api'
import { pgettext, t } from '../../lib/i18n'
import { path } from '../../lib/paths'
import { qk } from '../../lib/queryKeys'
import { serverApi, serverKeys } from './api'

export interface DatabasesSearch {
  statistics: boolean
  pos: number
  sort_by: string
  sort_order: string
}

/** DefaultTabDatabase route → SPA path below /s/:s/db/:db */
const tabPath = (route: string) => route.replace(/^\/database\/?/, '').replace(/^structure$/, '')

/**
 * pma: templates/server/databases/index.twig, resources/js/server/databases.ts
 */
export function DatabasesPage({
  server,
  search,
  onSearch,
}: {
  server: number
  search: DatabasesSearch
  onSearch: (s: Partial<DatabasesSearch>) => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: serverKeys.databases(server, search),
    queryFn: () => serverApi.databases(server, search),
    placeholderData: (prev) => prev,
  })
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'notice'; text: string } | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string[] | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const collationRef = useRef<HTMLSelectElement>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: serverKeys.allDatabases(server) })
    void qc.invalidateQueries({ queryKey: qk.nav(server) })
  }
  const create = useMutation({
    mutationFn: (v: { name: string; collation: string }) =>
      serverApi.createDatabase(server, v.name, v.collation),
    onSuccess: (r) => {
      setMessage(r.message)
      setCreated(r.sqlQuery?.sql ?? null)
      refresh()
      if (r.db !== undefined) {
        const tab = tabPath(r.route ?? '')
        void navigate({ to: `/s/${server}/db/${encodeURIComponent(r.db)}${tab !== '' ? `/${tab}` : ''}` })
      }
    },
    onError: (e) => {
      setCreated(null)
      setMessage(errorMessage(e))
    },
  })
  const drop = useMutation({
    mutationFn: (names: string[]) => serverApi.dropDatabases(server, names),
    onSuccess: (r) => {
      setMessage(r.message)
      setCreated(null)
      setSelected(new Set())
      refresh()
    },
    onError: (e) => {
      setCreated(null)
      setMessage(errorMessage(e))
    },
  })

  const d = q.data
  if (q.error !== null) return <MessageBox {...errorMessage(q.error)} />
  if (d === undefined) return <Loading />
  if (d.error !== null) return <MessageBox {...errorMessage(d.error.message)} />
  const needle = filter.toUpperCase().replace(/ /g, '_')
  const rows = d.databases.filter((db) => db.name.toUpperCase().includes(needle))
  const selectable = rows.filter((db) => !db.isSystemSchema && !db.isPmadb)
  const allChecked = selectable.length > 0 && selectable.every((db) => selected.has(db.name))

  const sortHeader = (key: string, label: string, colSpan?: number) => (
    <th key={key} colSpan={colSpan}>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-accent"
        onClick={() =>
          onSearch({ sort_by: key, sort_order: d.sortBy === key && d.sortOrder === 'asc' ? 'desc' : 'asc' })
        }
      >
        {label}
        {d.sortBy === key &&
          (d.sortOrder === 'asc' ? (
            <ArrowUp className="size-3" aria-label={t('Ascending')} />
          ) : (
            <ArrowDown className="size-3" aria-label={t('Descending')} />
          ))}
      </button>
    </th>
  )

  return (
    <div>
      <PageHeader icon={Database}>{d.hasStatistics ? t('Databases statistics') : t('Databases')}</PageHeader>
      {message !== null && <MessageBox type={message.type} text={message.text} sql={created ?? undefined} />}
      {d.isCreateDatabaseShown && (
        <Panel
          title={
            <span className="flex items-center gap-1">
              {t('Create database')} <MySqlDocLink url={d.createDatabaseDocUrl} />
            </span>
          }
        >
          <PanelBody>
            {d.hasCreateDatabasePrivileges ? (
              <form
                id="create_database_form"
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const name = nameRef.current?.value ?? ''
                  if (name === '') {
                    window.alert(t('Missing value in the form!'))
                    return
                  }
                  create.mutate({ name, collation: collationRef.current?.value ?? '' })
                }}
              >
                <input
                  ref={nameRef}
                  autoComplete="off"
                  type="text"
                  name="new_db"
                  maxLength={64}
                  className="input w-64"
                  defaultValue={d.databaseToCreate}
                  id="text_create_db"
                  placeholder={t('Database name')}
                  aria-label={t('Database name')}
                  required
                />
                {d.charsets.length > 0 && (
                  <select
                    ref={collationRef}
                    lang="en"
                    dir="ltr"
                    name="db_collation"
                    className="input w-auto"
                    aria-label={t('Collation')}
                    defaultValue={
                      d.charsets.flatMap((c) => c.collations).find((c) => c.isSelected)?.name ?? ''
                    }
                  >
                    <option value="">{t('Collation')}</option>
                    <option value="" />
                    {d.charsets.map((cs) => (
                      <optgroup key={cs.name} label={cs.name} title={cs.description}>
                        {cs.collations.map((c) => (
                          <option key={c.name} value={c.name} title={c.description}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}
                <input
                  id="buttonGo"
                  type="submit"
                  value={t('Create')}
                  disabled={create.isPending}
                  className="cursor-pointer rounded bg-accent px-4 py-1 text-accent-fg"
                />
              </form>
            ) : (
              <span className="text-error">{t('No privileges to create databases')}</span>
            )}
          </PanelBody>
        </Panel>
      )}

      {d.databaseCount > 0 ? (
        <>
          <div className="my-3 flex flex-wrap items-center gap-3">
            {d.isDropAllowed && (
              <div className="flex items-center gap-2 text-sm">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    id="checkAllCheckbox"
                    checked={allChecked}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(selectable.map((db) => db.name)) : new Set())
                    }
                  />
                  {t('Check all')}
                </label>
                <button
                  type="button"
                  id="bulkActionDropButton"
                  className="flex items-center gap-1 rounded border border-border-strong px-2 py-1"
                  title={t('Drop')}
                  onClick={() => {
                    if (selected.size === 0) {
                      setMessage({ type: 'notice', text: t('No databases selected.') })
                      return
                    }
                    setConfirm([...selected])
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {t('Drop')}
                </button>
              </div>
            )}
            <input
              className="input ms-auto w-56"
              name="filterText"
              type="text"
              id="filterText"
              placeholder={t('Search')}
              aria-label={t('Search')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          {d.pager !== null && <Pager pager={d.pager} onPos={(pos) => onSearch({ pos })} />}
          <Table zebra id="dbStatsTable">
            <thead>
              <tr>
                {d.isDropAllowed && <th />}
                {sortHeader('SCHEMA_NAME', t('Database'))}
                {sortHeader('DEFAULT_COLLATION_NAME', t('Collation'))}
                {d.hasStatistics &&
                  d.headerStatistics.map((s) =>
                    sortHeader(s.key, s.title, s.format === 'byte' ? 2 : undefined),
                  )}
                {d.hasPrimaryReplication && <th>{t('Primary replication')}</th>}
                {d.hasReplicaReplication && <th>{t('Replica replication')}</th>}
                <th colSpan={2}>{t('Action')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((db) => {
                const locked = db.isSystemSchema || db.isPmadb
                const tab = tabPath(d.defaultTabDatabase)
                return (
                  <tr
                    key={db.name}
                    className={`db-row ${locked ? 'noclick' : ''}`}
                    data-filter-row={db.name.toUpperCase()}
                  >
                    {d.isDropAllowed && (
                      <td>
                        <input
                          type="checkbox"
                          name="selected_dbs[]"
                          title={db.name}
                          value={db.name}
                          disabled={locked}
                          checked={selected.has(db.name)}
                          onChange={(e) => {
                            const next = new Set(selected)
                            if (e.target.checked) next.add(db.name)
                            else next.delete(db.name)
                            setSelected(next)
                          }}
                        />
                      </td>
                    )}
                    <td className="name">
                      <Link
                        to={path(
                          `/s/${server}/db/${encodeURIComponent(db.name)}${tab !== '' ? '/' : ''}${tab}`,
                        )}
                        title={t("Jump to database '%s'", db.name)}
                      >
                        {db.name}
                      </Link>
                    </td>
                    <td className="value">
                      <dfn title={db.collation?.description ?? ''} className="not-italic">
                        {db.collation?.name ?? ''}
                      </dfn>
                    </td>
                    {d.hasStatistics &&
                      db.statistics.flatMap((s) =>
                        s.format === 'byte'
                          ? [
                              <td key={s.key} className="value text-end">
                                <data value={s.raw} title={s.raw}>
                                  {s.value}
                                </data>
                              </td>,
                              <td key={`${s.key}-u`} className="unit">
                                {s.unit}
                              </td>,
                            ]
                          : [
                              <td key={s.key} className="value text-end">
                                <data value={s.raw} title={s.raw}>
                                  {s.value}
                                </data>
                              </td>,
                            ],
                      )}
                    {db.primaryReplicated !== null && <Replicated on={db.primaryReplicated} />}
                    {db.replicaReplicated !== null && <Replicated on={db.replicaReplicated} />}
                    <td>
                      <Link
                        to={path(`/s/${server}/db/${encodeURIComponent(db.name)}/privileges`)}
                        title={t('Check privileges for database "%s".', db.name)}
                        className="flex items-center gap-1"
                      >
                        <Shield className="size-4" aria-hidden />
                        {t('Check privileges')}
                      </Link>
                    </td>
                    <td>
                      <Link
                        to={path(`/s/${server}/db/${encodeURIComponent(db.name)}/sql`)}
                        title={t('Run SQL queries on database "%s".', db.name)}
                        className="flex items-center gap-1"
                      >
                        <FileCode2 className="size-4" aria-hidden />
                        {t('SQL')}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={d.isDropAllowed ? 3 : 2}>
                  {t('Total:')}{' '}
                  <span id="filter-rows-count">{filter === '' ? d.databaseCount : rows.length}</span>
                </th>
                {d.hasStatistics &&
                  d.totalStatistics.flatMap((s) =>
                    s.format === 'byte'
                      ? [
                          <th key={s.key} className="value text-end">
                            <data value={s.raw} title={s.raw}>
                              {s.value}
                            </data>
                          </th>,
                          <th key={`${s.key}-u`} className="unit">
                            {s.unit}
                          </th>,
                        ]
                      : [
                          <th key={s.key} className="value text-end">
                            <data value={s.raw} title={s.raw}>
                              {s.value}
                            </data>
                          </th>,
                        ],
                  )}
                {d.hasPrimaryReplication && <th />}
                {d.hasReplicaReplication && <th />}
                <th />
              </tr>
            </tfoot>
          </Table>
          {!d.hasStatistics && (
            <Panel className="mt-3">
              <PanelBody>
                <MessageBox type="info">
                  {t(
                    'Note: Enabling the database statistics here might cause heavy traffic between the web server and the MySQL server.',
                  )}
                </MessageBox>
                <button
                  type="button"
                  className="text-accent hover:underline"
                  title={t('Enable statistics')}
                  onClick={() => onSearch({ statistics: true })}
                >
                  {t('Enable statistics')}
                </button>
              </PanelBody>
            </Panel>
          )}
        </>
      ) : (
        <MessageBox type="info">{t('No databases')}</MessageBox>
      )}

      {confirm !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dropDatabaseModalLabel"
          className="fixed inset-0 z-50 grid place-items-center bg-black/40"
          id="dropDatabaseModal"
        >
          <div className="w-full max-w-lg rounded border border-border bg-bg">
            <h5 id="dropDatabaseModalLabel" className="border-b border-border px-4 py-2 font-semibold">
              {t('Confirm')}
            </h5>
            <div className="modal-body px-4 py-3 text-sm">
              {/* databases.ts: strDropDatabaseStrongWarning + ' ' + sprintf(strDoYouReally, statements joined by <br>) */}
              {`${t('You are about to DESTROY a complete database!')} ${t(
                'Do you really want to execute "%s"?',
                confirm.map((n) => `DROP DATABASE \`${n}\`;`).join('\n'),
              )}`
                .split('\n')
                .map((line, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static lines
                  <div key={i}>{line}</div>
                ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-2">
              <button
                type="button"
                className="flex items-center gap-1 rounded border border-border-strong px-3 py-1 text-sm"
                onClick={() => setConfirm(null)}
              >
                <X className="size-4" aria-hidden />
                {t('Cancel')}
              </button>
              <button
                type="button"
                id="dropDatabaseModalDropButton"
                className="flex items-center gap-1 rounded bg-error px-3 py-1 text-sm text-bg"
                onClick={() => {
                  drop.mutate(confirm)
                  setConfirm(null)
                }}
              >
                <Check className="size-4" aria-hidden />
                {t('Drop')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Replicated({ on }: { on: boolean }) {
  return (
    <td className="text-center">
      {on ? (
        <span className="flex items-center gap-1 text-success">
          <Check className="size-4" aria-hidden />
          {t('Replicated')}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-error">
          <X className="size-4" aria-hidden />
          {t('Not replicated')}
        </span>
      )}
    </td>
  )
}

/** list_navigator.twig (frame_content) */
function Pager({ pager, onPos }: { pager: NavPageSelector; onPos: (pos: number) => void }) {
  const b = (label: string, pos: number | null, icon: string) =>
    pos === null ? null : (
      <button type="button" className="text-accent" title={label} onClick={() => onPos(pos)}>
        {icon}
      </button>
    )
  return (
    <div className="mb-2 flex items-center gap-2 text-sm" id="databasesPager">
      {t('Page number:')}
      {b(pgettext('First page', 'Begin'), pager.begin, '<<')}
      {b(pgettext('Previous page', 'Previous'), pager.prev, '<')}
      <select
        className="input w-auto"
        aria-label={t('Page number:')}
        value={pager.pages.find((p) => p.selected)?.value ?? pager.pos}
        onChange={(e) => onPos(Number(e.target.value))}
      >
        {pager.pages.map((p) => (
          <option key={p.value} value={p.value}>
            {p.page}
          </option>
        ))}
      </select>
      {b(pgettext('Next page', 'Next'), pager.next, '>')}
      {b(pgettext('Last page', 'End'), pager.end, '>>')}
    </div>
  )
}

export type { DatabasesResponse }
