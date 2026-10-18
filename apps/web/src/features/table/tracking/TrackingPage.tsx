import type {
  SqlMessage,
  TrackingLogType,
  TrackingPageResponse,
  TrackingReportEntry,
  TrackingReportRequest,
  TrackingReportResponse,
  TrackingSnapshotResponse,
  TrackingStatement,
} from '@bettermyadmin/contracts'
import { TRACKING_STATEMENTS } from '@bettermyadmin/contracts'
import {
  Button,
  IconLink,
  IconText,
  Input,
  NativeCheckbox,
  NativeSelect,
  Panel,
  PanelBody,
  PmaIcon,
  Table,
  useConfirm,
} from '@bettermyadmin/ui'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { type TableRef, api } from '../../../lib/api'
import { Trans, pgettext, t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import { HighlightedSql } from '../../sql/HighlightedSql'
import { SqlPage } from '../../sql/SqlPage'
import { PageMessages } from '../../sql/page-card'
import { ResultMessages, errorMessage } from '../common/ResultMessages'

/**
 * Table Tracking tab: the tracked tables of the database, the versions with their report and
 * structure snapshot, (de)activation and "Create version".
 *
 * pma: resources/templates/table/tracking/{index,main,report_table,structure_snapshot_columns,
 *      structure_snapshot_indexes}.twig, resources/templates/create_tracking_version.twig,
 *      src/Tracking/Tracking.php (report and snapshot HTML), resources/js/table/tracking.ts
 */

type View =
  | { kind: 'main' }
  | { kind: 'report'; version: string; data: TrackingReportResponse }
  | { kind: 'snapshot'; data: TrackingSnapshotResponse }

const VIEW_STATEMENTS: readonly TrackingStatement[] = ['ALTER VIEW', 'CREATE VIEW', 'DROP VIEW']
const TABLE_STATEMENTS: readonly TrackingStatement[] = [
  'ALTER TABLE',
  'RENAME TABLE',
  'CREATE TABLE',
  'DROP TABLE',
]

export function TrackingPage({
  scope,
  open = null,
}: {
  scope: TableRef
  /** TrackingController's `report` / `snapshot` request with `version`: shown once the page loads */
  open?: { kind: 'report' | 'snapshot'; version: string } | null
}) {
  const qc = useQueryClient()
  const key = qk.tblPage(scope, 'tracking')
  const q = useQuery({ queryKey: key, queryFn: () => api.tableTracking(scope) })
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const [view, setView] = useState<View>({ kind: 'main' })
  const [dump, setDump] = useState<string | null>(null)
  // TrackingController: "Tracking of … is activated." reflects the state before the posted action
  // (none for deactivate_now); null until an action ran
  const [activeShown, setActiveShown] = useState<boolean | null>(null)
  const actions = useRef<{ report: (v: string) => void; snapshot: (v: string) => void } | null>(null)
  const loaded = q.data !== undefined
  const pending = useRef(open)
  useEffect(() => {
    const o = pending.current
    if (!loaded || o === null || actions.current === null) return
    pending.current = null
    if (o.kind === 'report') actions.current.report(o.version)
    else actions.current.snapshot(o.version)
  }, [loaded])
  if (q.isError) return <ResultMessages messages={[errorMessage(q.error)]} />
  if (q.data === undefined) return null
  const page = q.data

  const run = async (fn: () => Promise<{ messages: SqlMessage[] }>, deactivate = false) => {
    setActiveShown(deactivate ? false : page.activeMessage)
    try {
      const r = await fn()
      setMessages(r.messages)
    } catch (e) {
      setMessages([errorMessage(e)])
    }
    setDump(null)
    await qc.invalidateQueries({ queryKey: key })
  }

  const report = async (version: string, req: Partial<TrackingReportRequest> = {}) => {
    try {
      const data = await api.tableTrackingReport(scope, { version, ...req })
      if (data.download !== undefined) {
        // export_type=sqldumpfile (Core::downloadHeader)
        const url = URL.createObjectURL(new Blob([data.download.dump], { type: 'text/x-sql' }))
        const a = document.createElement('a')
        a.href = url
        a.download = data.download.filename
        a.click()
        URL.revokeObjectURL(url)
        return
      }
      setMessages(data.messages)
      setDump(data.sqlDump ?? null)
      setView({ kind: 'report', version, data })
      if (req.exportType === 'execution') await qc.invalidateQueries({ queryKey: key })
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  const snapshot = async (version: string) => {
    try {
      setMessages([])
      setDump(null)
      setView({ kind: 'snapshot', data: await api.tableTrackingSnapshot(scope, version) })
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  const close = () => {
    setView({ kind: 'main' })
    setDump(null)
  }
  actions.current = { report: (v) => void report(v), snapshot: (v) => void snapshot(v) }

  return (
    <div className="flex flex-col gap-3">
      {(activeShown ?? page.activeMessage) && (
        <ResultMessages
          messages={[{ type: 'notice', text: t('Tracking of %s is activated.', `${page.db}.${page.table}`) }]}
        />
      )}
      <ResultMessages messages={messages} />
      {dump !== null && <SqlPage server={scope.server} db="" table="" sql={dump} />}
      {view.kind === 'snapshot' && <Snapshot scope={scope} data={view.data} close={close} />}
      {view.kind === 'report' && (
        <Report data={view.data} close={close} run={(req) => report(view.version, req)} />
      )}
      <Main scope={scope} page={page} run={run} report={(v) => report(v)} snapshot={snapshot} />
    </div>
  )
}

function Main({
  scope,
  page,
  run,
  report,
  snapshot,
}: {
  scope: TableRef
  page: TrackingPageResponse
  run: (fn: () => Promise<{ messages: SqlMessage[] }>, deactivate?: boolean) => Promise<void>
  report: (version: string) => void
  snapshot: (version: string) => void
}) {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string[]>([])
  const target = `${page.db}.${page.table}`
  const last = page.versions[0]

  const deleteOne = async (version: string) => {
    if (!(await confirm({ question: t('Delete tracking data for this version?') }))) return
    await run(() => api.tableTrackingDelete(scope, { versions: [version], multiple: false }))
  }
  const deleteMany = async (e: FormEvent) => {
    e.preventDefault()
    if (!(await confirm({ question: t('Delete tracking data for these versions?') }))) return
    await run(() => api.tableTrackingDelete(scope, { versions: selected, multiple: true }))
    setSelected([])
  }

  return (
    <>
      {page.trackedTables.length > 0 && (
        <div>
          <NativeSelect
            name="table"
            className="w-auto"
            value={page.table}
            onChange={(e) => {
              // main.twig: the select auto-submits to the chosen table's tracking page
              void navigate({
                to: `/s/${scope.server}/db/${encodeURIComponent(page.db)}/t/${encodeURIComponent(e.target.value)}/tracking`,
              })
            }}
          >
            {!page.trackedTables.some((x) => x.name === page.table) && <option value={page.table} />}
            {page.trackedTables.map((x) => (
              <option key={x.name} value={x.name}>
                {page.db}.{x.name} ({x.active ? t('active') : t('not active')})
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {page.lastVersion > 0 && (
        <form id="versionsForm" onSubmit={deleteMany} className="flex flex-col gap-2">
          <Table zebra id="versions" className="w-auto text-sm">
            <thead>
              <tr>
                <th className="px-2" />
                <th>{t('Version')}</th>
                <th>{t('Created')}</th>
                <th>{t('Updated')}</th>
                <th>{t('Status')}</th>
                <th>{t('Action')}</th>
                <th>{t('Show')}</th>
              </tr>
            </thead>
            <tbody>
              {page.versions.map((v) => (
                <tr key={v.version}>
                  <td className="text-center">
                    <NativeCheckbox
                      name="selected_versions[]"
                      id={`selected_versions_${v.version}`}
                      value={v.version}
                      checked={selected.includes(v.version)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, v.version]
                            : selected.filter((x) => x !== v.version),
                        )
                      }
                    />
                  </td>
                  <td>
                    <label htmlFor={`selected_versions_${v.version}`}>
                      <b>{v.version}</b>
                    </label>
                  </td>
                  <td>{v.dateCreated}</td>
                  <td>{v.dateUpdated}</td>
                  <td>{v.active ? t('active') : t('not active')}</td>
                  <td>
                    <IconLink
                      icon="b_drop"
                      text={t('Delete version')}
                      className="delete_version_anchor"
                      href="#"
                      onClick={(ev) => {
                        ev.preventDefault()
                        void deleteOne(v.version)
                      }}
                    />
                  </td>
                  <td className="flex gap-2 px-2">
                    <IconLink
                      icon="b_report"
                      text={t('Tracking report')}
                      href="#"
                      onClick={(ev) => {
                        ev.preventDefault()
                        report(v.version)
                      }}
                    />
                    <IconLink
                      icon="b_props"
                      text={t('Structure snapshot')}
                      href="#"
                      onClick={(ev) => {
                        ev.preventDefault()
                        snapshot(v.version)
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center gap-3 text-sm">
            <NativeCheckbox
              id="versionsForm_checkall"
              checked={selected.length === page.versions.length}
              onChange={(e) => setSelected(e.target.checked ? page.versions.map((v) => v.version) : [])}
            />
            <label htmlFor="versionsForm_checkall">{t('Check all')}</label>
            <i>{t('With selected:')}</i>
            <Button
              type="submit"
              variant="link"
              name="submit_mult"
              value="delete_version"
              title={t('Delete version')}
            >
              <IconText icon="b_drop" text={t('Delete version')} />
            </Button>
          </div>
        </form>
      )}
      {last !== undefined && (
        <Panel
          title={
            last.active ? t('Deactivate tracking for %s', target) : t('Activate tracking for %s', target)
          }
        >
          <PanelBody>
            <Button
              onClick={() =>
                void run(
                  () =>
                    api.tableTrackingToggle(scope, {
                      version: String(page.lastVersion),
                      action: last.active ? 'deactivate' : 'activate',
                    }),
                  last.active,
                )
              }
            >
              {last.active ? t('Deactivate now') : t('Activate now')}
            </Button>
          </PanelBody>
        </Panel>
      )}
      <CreateVersion
        key={page.lastVersion}
        page={page}
        create={(statements) =>
          run(() => api.tableTrackingCreate(scope, { version: String(page.lastVersion + 1), statements }))
        }
      />
    </>
  )
}

/** create_tracking_version.twig */
function CreateVersion({
  page,
  create,
}: {
  page: TrackingPageResponse
  create: (statements: TrackingStatement[]) => Promise<void>
}) {
  // the checkboxes of the form (a table's or a view's statements): only those are posted
  const shown: readonly TrackingStatement[] = [
    ...(page.type === 'table' ? TABLE_STATEMENTS : VIEW_STATEMENTS),
    'CREATE INDEX',
    'DROP INDEX',
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
  ]
  const [checked, setChecked] = useState<TrackingStatement[]>(() =>
    TRACKING_STATEMENTS.filter((s) => shown.includes(s) && page.defaultStatements.includes(s)),
  )
  const box = (s: TrackingStatement) => (
    // the template's checkboxes have no <label>
    <span key={s} className="flex items-center gap-1">
      <NativeCheckbox
        name={s.toLowerCase().replace(' ', '_')}
        value="true"
        checked={checked.includes(s)}
        onChange={(e) => setChecked(e.target.checked ? [...checked, s] : checked.filter((x) => x !== s))}
      />
      {s}
    </span>
  )
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void create(checked)
  }
  return (
    <form onSubmit={submit}>
      <Panel
        title={t('Create version %1$s of %2$s', page.lastVersion + 1, `${page.db}.${page.table}`)}
        footer={
          <Button type="submit" variant="primary">
            {t('Create version')}
          </Button>
        }
      >
        <PanelBody className="flex flex-col gap-1 text-sm">
          <p>{t('Track these data definition statements:')}</p>
          {(page.type === 'table' ? TABLE_STATEMENTS : VIEW_STATEMENTS).map(box)}
          <br />
          {box('CREATE INDEX')}
          {box('DROP INDEX')}
          <p className="mt-2">{t('Track these data manipulation statements:')}</p>
          {(['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const).map(box)}
        </PanelBody>
      </Panel>
    </form>
  )
}

const CloseLink = ({ close }: { close: () => void }) => (
  <>
    {' '}
    [
    <Button variant="link" className="text-lg" onClick={close}>
      {t('Close')}
    </Button>
    ]
  </>
)

/** Tracking::getHtmlForTrackingReport */
function Report({
  data,
  close,
  run,
}: {
  data: TrackingReportResponse
  close: () => void
  run: (req: Partial<TrackingReportRequest>) => Promise<void>
}) {
  const confirm = useConfirm()
  const [logType, setLogType] = useState<TrackingLogType>(data.logType)
  const [dateFrom, setDateFrom] = useState(data.dateFrom)
  const [dateTo, setDateTo] = useState(data.dateTo)
  const [users, setUsers] = useState(data.users)
  const [exportType, setExportType] = useState<'sqldumpfile' | 'sqldump' | 'execution'>('sqldumpfile')
  const filters = { logType, dateFrom, dateTo, users }
  const list = (e: FormEvent) => {
    e.preventDefault()
    void run(filters)
  }
  const del = async (which: 'deleteDdlog' | 'deleteDmlog', id: number) => {
    if (!(await confirm({ question: t('Delete entry from tracking report?') }))) return
    await run({ [which]: id })
  }
  const elements: ReactNode = (
    <Trans
      id="Show %1$s with dates from %2$s to %3$s by user %4$s %5$s"
      args={[
        <NativeSelect
          key="t"
          name="log_type"
          className="mx-1 inline-block w-auto"
          value={logType}
          onChange={(e) => setLogType(e.target.value as TrackingLogType)}
        >
          <option value="schema">{t('Structure only')}</option>
          <option value="data">{t('Data only')}</option>
          <option value="schema_and_data">{t('Structure and data')}</option>
        </NativeSelect>,
        <Input
          key="f"
          name="date_from"
          size={19}
          className="mx-1 inline-block max-w-44"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
        />,
        <Input
          key="to"
          name="date_to"
          size={19}
          className="mx-1 inline-block max-w-44"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
        />,
        <Input
          key="u"
          name="users"
          className="mx-1 inline-block max-w-48"
          value={users}
          onChange={(e) => setUsers(e.target.value)}
        />,
        <Button key="go" type="submit" variant="primary" className="ml-1">
          {t('Go')}
        </Button>,
      ]}
    />
  )
  const exportGo = async (e: FormEvent) => {
    e.preventDefault()
    if (exportType === 'execution') window.alert(t('This option will replace your table and contained data.'))
    // the export form posts the filters the report was shown with
    await run({
      logType: data.logType,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      users: data.users,
      exportType,
    })
  }
  return (
    <div className="text-sm">
      <h3 className="mb-2 text-lg">
        {t('Tracking report')}
        <CloseLink close={close} />
      </h3>
      <small>
        {t('Tracking statements')} {data.tracking}
      </small>
      <br />
      <br />
      {data.noData && <ResultMessages messages={[{ type: 'notice', text: t('No data') }]} />}
      <form onSubmit={list} className="flex flex-col gap-2">
        <div>{elements}</div>
        {data.ddl !== null && (
          <ReportTable
            id="ddl_versions"
            header={t('Data definition statement')}
            entries={data.ddl}
            onDelete={(id) => void del('deleteDdlog', id)}
          />
        )}
        {data.dml !== null && (
          <ReportTable
            id="dml_versions"
            header={t('Data manipulation statement')}
            entries={data.dml}
            onDelete={(id) => void del('deleteDmlog', id)}
          />
        )}
      </form>
      <form onSubmit={list} className="mt-2">
        {elements}
      </form>
      <form onSubmit={exportGo} className="mt-2">
        <Trans
          id="Export as %s"
          args={[
            <NativeSelect
              key="e"
              name="export_type"
              className="mx-1 inline-block w-auto"
              value={exportType}
              onChange={(e) => setExportType(e.target.value as typeof exportType)}
            >
              <option value="sqldumpfile">{t('SQL dump (file download)')}</option>
              <option value="sqldump">{t('SQL dump')}</option>
              <option value="execution">{t('SQL execution')}</option>
            </NativeSelect>,
          ]}
        />
        <Button type="submit" variant="primary">
          {t('Go')}
        </Button>
      </form>
      <hr className="my-4 border-border" />
    </div>
  )
}

/** table/tracking/report_table.twig */
function ReportTable({
  id,
  header,
  entries,
  onDelete,
}: {
  id: string
  header: string
  entries: TrackingReportEntry[]
  onDelete: (id: number) => void
}) {
  return (
    <Table zebra id={id} className="w-full text-sm">
      <thead>
        <tr>
          <th>{pgettext('Number', '#')}</th>
          <th>{t('Date')}</th>
          <th>{t('Username')}</th>
          <th>{header}</th>
          <th>{t('Action')}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.lineNumber} className="noclick">
            <td className="text-right">
              <small>{e.lineNumber}</small>
            </td>
            <td>
              <small>{e.date}</small>
            </td>
            <td>
              <small>{e.username}</small>
            </td>
            <td>
              {/* Generator::formatSql */}
              <HighlightedSql sql={e.statement.trim()} />
            </td>
            <td className="whitespace-nowrap px-2">
              {/* the image's title, then the text (ActionLinksMode both) */}
              <Button
                variant="link"
                className="delete_entry_anchor gap-1"
                onClick={() => onDelete(e.deleteId)}
              >
                <span title={t('Delete tracking data row from report')}>
                  <PmaIcon name="b_drop" />
                </span>
                {t('Delete')}
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

/** Tracking::getHtmlForSchemaSnapshot */
function Snapshot({
  scope,
  data,
  close,
}: {
  scope: TableRef
  data: TrackingSnapshotResponse
  close: () => void
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <h3 className="text-lg">
        {t('Structure snapshot')}
        <CloseLink close={close} />
      </h3>
      {data.sql !== null && (
        // Generator::getMessage(new Message(…), $dropCreateStatements): a notice with the query card
        <PageMessages
          server={scope.server}
          messages={[
            { type: 'notice', text: t('Version %s snapshot (SQL code)', data.version), sql: data.sql.trim() },
          ]}
          scope={{ db: scope.db, table: scope.table }}
        />
      )}
      <Panel title={t('Structure')}>
        <PanelBody>
          <Table zebra id="tablestructure" className="w-auto text-sm">
            <thead>
              <tr>
                <th>{pgettext('Number', '#')}</th>
                <th>{t('Column')}</th>
                <th>{t('Type')}</th>
                <th>{t('Collation')}</th>
                <th>{t('Null')}</th>
                <th>{t('Default')}</th>
                <th>{t('Extra')}</th>
                <th>{t('Comment')}</th>
              </tr>
            </thead>
            <tbody>
              {data.columns.map((c, i) => (
                <tr key={c.Field} className="noclick">
                  <td>{i + 1}</td>
                  <td>
                    <strong className="inline-flex items-center gap-1">
                      {c.Field}
                      {c.Key === 'PRI' ? (
                        <PmaIcon name="b_primary" alt={t('Primary')} />
                      ) : c.Key !== '' ? (
                        <span className="opacity-50">
                          <PmaIcon name="b_primary" alt={t('Index')} />
                        </span>
                      ) : null}
                    </strong>
                  </td>
                  <td>{c.Type}</td>
                  <td>{c.Collation}</td>
                  <td>{c.Null === 'YES' ? t('Yes') : t('No')}</td>
                  {/* the key is always defined in the snapshot: a NULL default prints empty */}
                  <td>{bitDefault(c.Type, c.Default)}</td>
                  <td>{c.Extra}</td>
                  <td>{c.Comment}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </PanelBody>
      </Panel>
      {data.indexes.length > 0 && (
        <Panel title={t('Indexes')}>
          <PanelBody>
            <Table zebra id="tablestructure_indexes" className="w-auto text-sm">
              <thead>
                <tr>
                  <th>{t('Keyname')}</th>
                  <th>{t('Type')}</th>
                  <th>{t('Unique')}</th>
                  <th>{t('Packed')}</th>
                  <th>{t('Column')}</th>
                  <th>{t('Cardinality')}</th>
                  <th>{t('Collation')}</th>
                  <th>{t('Null')}</th>
                  <th>{t('Comment')}</th>
                </tr>
              </thead>
              <tbody>
                {data.indexes.map((x, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: one row per index column
                  <tr key={i} className="noclick">
                    <td>
                      <strong>{x.Key_name}</strong>
                    </td>
                    <td>{x.Index_type}</td>
                    <td>{x.Non_unique === '0' ? t('Yes') : t('No')}</td>
                    <td>{(x.Packed ?? '') !== '' ? t('Yes') : t('No')}</td>
                    <td>{x.Column_name}</td>
                    <td>{x.Cardinality}</td>
                    <td>{x.Collation}</td>
                    <td>{x.Null}</td>
                    <td>{x.Comment}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </PanelBody>
        </Panel>
      )}
      <hr className="my-2 border-border" />
    </div>
  )
}

/** Util::convertBitDefaultValue for BIT columns (b'101' → 101), the default otherwise */
function bitDefault(type: string, value: string | null): string {
  if (value === null) return ''
  if (!/^bit\b/i.test(type)) return value
  return value.replace(/^b'(.*)'$/, '$1')
}
