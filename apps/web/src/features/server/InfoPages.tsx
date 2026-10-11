import {
  Hint,
  Loading,
  MessageBox,
  MySqlDocLink,
  PageHeader,
  Panel,
  PanelBody,
  SafeHtml,
  Table,
} from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CaseSensitive, Cog, FileText, FileType, Puzzle, Table2 } from 'lucide-react'
import { Fragment } from 'react'
import { errorMessage } from '../../lib/api'
import { pgettext, t } from '../../lib/i18n'
import { serverApi, serverKeys } from './api'

/** pma: templates/server/collations/index.twig */
export function CollationsPage({ server }: { server: number }) {
  const q = useQuery({ queryKey: serverKeys.collations(server), queryFn: () => serverApi.collations(server) })
  return (
    <div>
      <PageHeader icon={CaseSensitive}>{t('Character sets and collations')}</PageHeader>
      {q.error !== null && <MessageBox {...errorMessage(q.error)} />}
      {q.data === undefined ? (
        q.isPending && <Loading />
      ) : (
        <div className="grid max-w-4xl gap-3" id="collations">
          {q.data.charsets.map((cs) => (
            <section key={cs.name} className="rounded border border-border" data-charset={cs.name}>
              <div className="border-b border-border bg-bg-subtle px-3 py-2 text-sm">
                <div>
                  <strong>{cs.name}</strong>
                </div>
                <div>{cs.description}</div>
              </div>
              <ul className="divide-y divide-border text-sm">
                {cs.collations.map((c) => (
                  <li key={c.name} className="flex items-center gap-2 px-3 py-1.5">
                    <div className="flex-1">
                      <div>
                        <strong>{c.name}</strong>
                      </div>
                      <div>{c.description}</div>
                    </div>
                    {c.isDefault && (
                      <span className="rounded bg-fg-muted px-1.5 py-0.5 text-xs text-bg">
                        {pgettext('The collation is the default one', 'default')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/** pma: templates/server/engines/index.twig */
export function EnginesPage({ server }: { server: number }) {
  const q = useQuery({ queryKey: serverKeys.engines(server), queryFn: () => serverApi.engines(server) })
  return (
    <div>
      <PageHeader icon={Cog}>{t('Storage engines')}</PageHeader>
      {q.error !== null && <MessageBox {...errorMessage(q.error)} />}
      {q.isPending && <Loading />}
      {q.data !== undefined && (
        <Table zebra id="enginesTable">
          <thead>
            <tr>
              <th scope="col">{t('Storage Engine')}</th>
              <th scope="col">{t('Description')}</th>
            </tr>
          </thead>
          <tbody>
            {q.data.engines.map((e) => {
              const disabled = e.support === 'NO' || e.support === 'DISABLED'
              return (
                <tr
                  key={e.engine}
                  className={`${disabled ? 'disabled text-fg-subtle' : ''} ${e.support === 'DEFAULT' ? 'marked font-semibold' : ''}`}
                >
                  <td>
                    <Link to="/s/$server/engines/$engine" params={{ server, engine: e.engine }}>
                      {e.engine}
                    </Link>
                  </td>
                  <td>{e.comment}</td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}

/** pma: templates/server/engines/show.twig, _innodb_buffer_pool.twig */
export function EnginePage({ server, engine, page }: { server: number; engine: string; page: string }) {
  const q = useQuery({
    queryKey: serverKeys.engines(server, engine, page),
    queryFn: () => serverApi.engine(server, engine, page),
  })
  const e = q.data
  return (
    <div>
      <PageHeader icon={Cog}>{t('Storage engines')}</PageHeader>
      {q.error !== null && <MessageBox {...errorMessage(q.error)} />}
      {q.isPending && <Loading />}
      {e !== undefined && !e.isValid && <MessageBox type="error">{t('Unknown storage engine.')}</MessageBox>}
      {e?.isValid === true && (
        <>
          <PageHeader icon={Cog} docUrl={e.docUrl}>
            {e.title}
          </PageHeader>
          <p className="mb-3 text-sm">
            <em>{e.comment}</em>
          </p>
          {e.infoPages.length > 0 && (
            <p className="mb-3 text-sm" id="engineNav">
              <strong>[</strong>{' '}
              {page === '' ? (
                <strong>{t('Variables')}</strong>
              ) : (
                <Link to="/s/$server/engines/$engine" params={{ server, engine }}>
                  {t('Variables')}
                </Link>
              )}
              {e.infoPages.map((p) => (
                <Fragment key={p.id}>
                  {' '}
                  <strong>|</strong>{' '}
                  {page === p.id ? (
                    <strong>{p.label}</strong>
                  ) : (
                    <Link to="/s/$server/engines/$engine/$page" params={{ server, engine, page: p.id }}>
                      {p.label}
                    </Link>
                  )}
                </Fragment>
              ))}{' '}
              <strong>]</strong>
            </p>
          )}
          {e.pageContent.kind === 'none' && (
            <>
              <p className="mb-3 text-sm">{e.support}</p>
              {e.variables.length === 0 ? (
                <p className="text-sm">
                  {t('There is no detailed status information available for this storage engine.')}
                </p>
              ) : (
                <Table zebra id="engineVariables">
                  <tbody>
                    {e.variables.map((v) => (
                      <tr key={v.name}>
                        <td>{v.desc !== null && <Hint message={v.desc} />}</td>
                        <th scope="row">{v.title}</th>
                        <td className="text-end font-mono">{v.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </>
          )}
          {e.pageContent.kind === 'bufferpool' && <BufferPool b={e.pageContent.bufferPool} />}
          {e.pageContent.kind === 'status' && (
            <pre
              id="pre_innodb_status"
              className="overflow-x-auto rounded border border-border bg-bg-inset p-2 font-mono text-xs"
            >
              {e.pageContent.status}
            </pre>
          )}
          {e.pageContent.kind === 'documentation' && (
            <SafeHtml as="p" className="text-sm" html={e.pageContent.html} />
          )}
        </>
      )}
    </div>
  )
}

function BufferPool({ b }: { b: import('@bettermyadmin/contracts').InnodbBufferPool }) {
  const row = (label: string, value: string) => (
    <tr key={label}>
      <th scope="row">{label}</th>
      <td className="text-end font-mono">{value}</td>
    </tr>
  )
  return (
    <div className="flex flex-wrap items-start gap-6" id="bufferPool">
      <Table zebra>
        <caption className="caption-top text-start text-sm font-semibold">{t('Buffer pool usage')}</caption>
        <tbody>
          {row(t('Free pages'), b.pagesFree)}
          {row(t('Dirty pages'), b.pagesDirty)}
          {row(t('Pages containing data'), b.pagesData)}
          {row(t('Pages to be flushed'), b.pagesFlushed)}
          {row(t('Busy pages'), b.pagesMisc)}
          {b.pagesLatched !== null && row(t('Latched pages'), b.pagesLatched)}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={2}>
              {t('Total:')} {b.totalPages} / {b.totalSize}
            </th>
          </tr>
        </tfoot>
      </Table>
      <Table zebra>
        <caption className="caption-top text-start text-sm font-semibold">
          {t('Buffer pool activity')}
        </caption>
        <tbody>
          {row(t('Read requests'), b.readRequests)}
          {row(t('Write requests'), b.writeRequests)}
          {row(t('Read misses'), b.reads)}
          {row(t('Write waits'), b.waitFree)}
          {row(t('Read misses in %'), b.readMissesPct)}
          {row(t('Write waits in %'), b.writeWaitsPct)}
        </tbody>
      </Table>
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = {
  INACTIVE: 'inactive',
  DISABLED: 'disabled',
  DELETING: 'deleting',
  DELETED: 'deleted',
}

/** pma: templates/server/plugins/index.twig (+ plugins.ts table sorting by name) */
export function PluginsPage({ server }: { server: number }) {
  const q = useQuery({ queryKey: serverKeys.plugins(server), queryFn: () => serverApi.plugins(server) })
  return (
    <div>
      <PageHeader icon={Puzzle}>{t('Plugins')}</PageHeader>
      {q.error !== null && <MessageBox {...errorMessage(q.error)} />}
      {q.isPending && <Loading />}
      {q.data !== undefined && (
        <div id="plugins_plugins">
          <Panel>
            <PanelBody>
              <div className="flex flex-wrap gap-1.5">
                {q.data.types.map((ty) => (
                  <a
                    key={ty.type}
                    href={`#plugins-${ty.cleanType}`}
                    className="rounded bg-accent px-2 py-1 text-xs text-accent-fg hover:no-underline"
                  >
                    {ty.type}
                  </a>
                ))}
              </div>
            </PanelBody>
          </Panel>
          {q.data.types.map((ty) => (
            <Table key={ty.type} id={`plugins-${ty.cleanType}`} zebra className="mb-4">
              <caption className="caption-top text-start text-sm font-semibold">{ty.type}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('Plugin')}</th>
                  <th scope="col">{t('Description')}</th>
                  <th scope="col">{t('Version')}</th>
                  <th scope="col">{t('Author')}</th>
                  <th scope="col">{t('License')}</th>
                </tr>
              </thead>
              <tbody>
                {ty.plugins.map((p) => (
                  <tr key={p.name} className="noclick">
                    <th>
                      {p.name}
                      {p.status !== 'ACTIVE' && (
                        <span className="ms-1 rounded bg-error px-1 text-xs text-bg">
                          {STATUS_LABEL[p.status] !== undefined ? t(STATUS_LABEL[p.status]!) : ''}
                        </span>
                      )}
                    </th>
                    <td>{p.description}</td>
                    <td>{p.version}</td>
                    <td>{p.author}</td>
                    <td>{p.license}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}
        </div>
      )}
    </div>
  )
}

/** pma: templates/server/binlog/index.twig */
export function BinlogPage({
  server,
  log,
  pos,
  full,
  onChange,
}: {
  server: number
  log: string
  pos: number
  full: boolean
  onChange: (s: { log?: string; pos?: number; full?: boolean }) => void
}) {
  const q = useQuery({
    queryKey: serverKeys.binlog(server, { log, pos, full }),
    queryFn: () => serverApi.binlog(server, { log, pos, is_full_query: full }),
    placeholderData: (prev) => prev,
  })
  const b = q.data
  const nav = (label: string, icon: string, to: { pos?: number }) =>
    b?.hasIcons === true && !b.hasText ? (
      <button
        type="button"
        className="text-accent hover:underline"
        title={label}
        onClick={() => onChange({ log: b.selectedLog ?? '', full, ...to })}
      >
        {icon}
      </button>
    ) : (
      <button
        type="button"
        className="text-accent hover:underline"
        onClick={() => onChange({ log: b?.selectedLog ?? '', full, ...to })}
      >
        {label} {icon}
      </button>
    )
  return (
    <div>
      <PageHeader icon={Table2}>{t('Binary log')}</PageHeader>
      {q.error !== null && <MessageBox {...errorMessage(q.error)} />}
      {q.isPending && <Loading />}
      {b !== undefined && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const v = new FormData(e.currentTarget).get('log')
              onChange({ log: String(v ?? ''), full, pos: 0 })
            }}
          >
            <Panel
              title={t('Select binary log to view')}
              footer={
                <input
                  type="submit"
                  value={t('Go')}
                  className="cursor-pointer rounded bg-accent px-4 py-1 text-accent-fg"
                />
              }
            >
              <PanelBody>
                <select
                  name="log"
                  defaultValue={b.log}
                  key={b.log}
                  className="input me-2 w-auto"
                  aria-label={t('Select binary log to view')}
                >
                  {b.binaryLogs.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name}
                      {l.size !== null ? ` (${l.size})` : ''}
                    </option>
                  ))}
                </select>
                {b.fileCount} {t('Files')},{b.totalSize !== null ? ` ${b.totalSize}` : ''}
              </PanelBody>
            </Panel>
          </form>
          <MessageBox type="success" text={b.sqlMessage.message.text} sql={b.sqlMessage.sql} />
          <Table zebra className="w-full" id="binlogTable">
            <thead>
              <tr>
                <td colSpan={6} className="text-center">
                  {b.previous !== null && (
                    <>{nav(pgettext('Previous page', 'Previous'), '«', { pos: b.previous.pos ?? 0 })} - </>
                  )}
                  <button
                    type="button"
                    className="align-middle"
                    title={full ? t('Truncate shown queries') : t('Show full queries')}
                    onClick={() => onChange({ log: b.selectedLog ?? '', pos, full: !full })}
                  >
                    {full ? (
                      <FileType className="inline size-4" aria-label={t('Truncate shown queries')} />
                    ) : (
                      <FileText className="inline size-4" aria-label={t('Show full queries')} />
                    )}
                  </button>
                  {b.next !== null && <> - {nav(pgettext('Next page', 'Next'), '»', { pos: b.next.pos })}</>}
                </td>
              </tr>
              <tr className="whitespace-nowrap">
                <th>{t('Log name')}</th>
                <th>{t('Position')}</th>
                <th>{t('Event type')}</th>
                <th>{t('Server ID')}</th>
                <th>{t('Original position')}</th>
                <th>{t('Information')}</th>
              </tr>
            </thead>
            <tbody>
              {b.events.map((e) => (
                <tr key={`${e.logName}:${e.pos}`} className="noclick">
                  <td>{e.logName}</td>
                  <td className="text-end">{e.pos}</td>
                  <td>{e.eventType}</td>
                  <td className="text-end">{e.serverId}</td>
                  <td className="text-end">{e.origLogPos}</td>
                  <td>
                    <pre className="whitespace-pre-wrap font-mono text-xs" dir="ltr">
                      <code className="sql">{e.info}</code>
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
      <MySqlDocLink url={null} />
    </div>
  )
}
