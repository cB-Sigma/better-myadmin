import type {
  DbStructureResponse,
  DbStructureTable,
  MaintenanceResponse,
  ShowCreateResponse,
  SqlMessage,
} from '@bettermyadmin/contracts'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconText,
  Input,
  Label,
  NativeSelect,
  Panel,
  PanelBody,
  PmaIcon,
  useConfirm,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Printer } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { runQuery } from '../sql/runner'
import {
  path,
  CreateTableBox,
  DbModal,
  ListNavigator,
  Messages,
  dbBase,
  errorMessage,
  tableBase,
  useDefaultFkCheck,
} from './common'

/**
 * The database Structure tab.
 * pma: templates/database/structure/*.twig, resources/js/database/structure.ts,
 *      modules/functions/adjustTotals.ts
 */
export interface DbStructureSearch {
  [k: string]: string | undefined
  pos?: string | undefined
  sort?: string | undefined
  sort_order?: string | undefined
  tbl_group?: string | undefined
  tbl_type?: string | undefined
}

type DialogState =
  | { kind: 'copy'; tables: string[] }
  | { kind: 'prefix'; action: 'add-prefix' | 'replace-prefix' | 'copy-with-prefix'; tables: string[] }
  | { kind: 'show-create'; data: ShowCreateResponse }
  | null

const BULK_TITLES = {
  'add-prefix': 'Add table prefix',
  'replace-prefix': 'Replace table with prefix',
  'copy-with-prefix': 'Copy table with prefix',
} as const

function localFavorites(): string {
  try {
    return window.localStorage.getItem('favoriteTables') ?? ''
  } catch {
    return ''
  }
}

export function DbStructurePage({
  server,
  db,
  search,
  onSearch,
}: {
  server: number
  db: string
  search: DbStructureSearch
  onSearch: (s: DbStructureSearch) => void
}) {
  const scope = { server, db }
  const confirm = useConfirm()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: qk.dbPage(server, db, 'structure', search),
    queryFn: () => api.dbStructure(server, db, search),
  })
  const fkDefault = useDefaultFkCheck(server)
  const [selected, setSelected] = useState<string[]>([])
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const [maintenance, setMaintenance] = useState<MaintenanceResponse | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [filter, setFilter] = useState('')
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [favorites, setFavorites] = useState<Record<string, boolean>>({})

  const refresh = async () => {
    setCounts({})
    await qc.invalidateQueries({ queryKey: qk.db(server, db) })
    await qc.invalidateQueries({ queryKey: qk.nav(server) })
  }
  const act = async (fn: () => Promise<{ messages: SqlMessage[] }>) => {
    try {
      const r = await fn()
      setMessages(r.messages)
      setMaintenance(null)
      setSelected([])
      await refresh()
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  if (q.isError) return <Messages messages={[errorMessage(q.error)]} />
  const d = q.data
  if (d === undefined) return null
  if (d.redirectPos !== undefined) {
    onSearch({ ...search, pos: String(d.redirectPos) })
    return null
  }
  const c = d.config
  const needle = filter.toUpperCase()
  const rows = d.tables.filter((tb) => tb.name.toUpperCase().includes(needle))
  const views = new Set(d.tables.filter((tb) => tb.isView).map((tb) => tb.name))

  const onBulk = async (value: string) => {
    const tables = d.tables.map((tb) => tb.name).filter((n) => selected.includes(n))
    if (['copy_tbl', 'add_prefix_tbl', 'replace_prefix_tbl', 'copy_tbl_change_prefix'].includes(value)) {
      // copy/prefix actions silently do nothing without a selection
      if (tables.length === 0) return
      if (value === 'copy_tbl') setDialog({ kind: 'copy', tables })
      else
        setDialog({
          kind: 'prefix',
          action:
            value === 'add_prefix_tbl'
              ? 'add-prefix'
              : value === 'replace_prefix_tbl'
                ? 'replace-prefix'
                : 'copy-with-prefix',
          tables,
        })
      return
    }
    if (tables.length === 0) {
      setMessages([{ type: 'error', text: t('No table selected.') }])
      return
    }
    if (value === 'export') {
      void navigate({ to: path(`${dbBase(server, db)}/export`), search: { table_select: tables } as never })
      return
    }
    if (value === 'show_create') {
      try {
        setDialog({ kind: 'show-create', data: await api.dbShowCreate(server, db, tables) })
      } catch (e) {
        setMessages([errorMessage(e)])
      }
      return
    }
    if (value === 'empty_tbl') {
      await bulkConfirm('empty', tables, tables.map((n) => `TRUNCATE \`${n}\`;`).join('\n'))
      return
    }
    if (value === 'drop_tbl') {
      const tbls = tables.filter((n) => !views.has(n))
      const vws = tables.filter((n) => views.has(n))
      const lines: string[] = []
      if (tbls.length > 0) lines.push(`DROP TABLE ${tbls.map((n) => `\`${n}\``).join(', ')};`)
      if (vws.length > 0) lines.push(`DROP VIEW ${vws.map((n) => `\`${n}\``).join(', ')};`)
      await bulkConfirm('drop', tables, lines.join('\n'))
      return
    }
    const op = {
      analyze_tbl: 'analyze',
      check_tbl: 'check',
      checksum_tbl: 'checksum',
      optimize_tbl: 'optimize',
      repair_tbl: 'repair',
    }[value]
    if (op !== undefined) {
      try {
        const r = await api.dbMaintenance(server, db, op, tables)
        setMaintenance(r)
        setMessages([])
        await refresh()
      } catch (e) {
        setMessages([errorMessage(e)])
      }
      return
    }
    if (value === 'sync_unique_columns_central_list' || value === 'delete_unique_columns_central_list') {
      await act(() =>
        api.dbStructureAction(
          server,
          db,
          value === 'sync_unique_columns_central_list' ? 'central-add' : 'central-remove',
          {
            tables,
          },
        ),
      )
      return
    }
    if (value === 'make_consistent_with_central_list') {
      const ok = await confirm({
        title: t('Are you sure?'),
        question: t(
          'This action may change some of the columns definition.[br]Are you sure you want to continue?',
        )
          .split('[br]')
          .map((line) => <p key={line}>{line}</p>),
        okLabel: t('Continue'),
        closeLabel: t('Cancel'),
      })
      if (!ok) return
      await act(() => api.dbStructureAction(server, db, 'central-make-consistent', { tables }))
    }
  }

  const toggleFavorite = async (tb: DbStructureTable) => {
    const isFav = favorites[tb.name] ?? tb.favorite
    try {
      const r = await api.favorite(server, {
        db,
        table: tb.name,
        action: isFav ? 'remove' : 'add',
        favoriteTables: localFavorites(),
      })
      if (!r.changes) {
        setMessages([{ type: 'error', text: r.message?.text ?? t('Favorite List is full!') }])
        return
      }
      if (r.favoriteTables !== undefined) {
        try {
          window.localStorage.setItem('favoriteTables', r.favoriteTables)
        } catch {
          // storage unavailable
        }
      }
      setFavorites({ ...favorites, [tb.name]: !isFav })
      await qc.invalidateQueries({ queryKey: qk.nav(server) })
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  const realCount = async (table: string | null) => {
    try {
      const r = await api.dbRealRowCount(server, db, table)
      if (r.realRowCount !== undefined && table !== null) setCounts({ ...counts, [table]: r.realRowCount })
      if (r.realRowCountAll !== undefined)
        setCounts(Object.fromEntries(r.realRowCountAll.map((x) => [x.table, x.rowCount])))
    } catch {
      setMessages([{ type: 'error', text: t('Failed to get real row count.') }])
    }
  }

  /** Util::sortableTableHeader: `table` is the requested sort when none is given */
  const sortLink = (key: string, label: string, initialOrder: 'ASC' | 'DESC' = 'ASC') => {
    const requested = d.sort !== '' ? d.sort : 'table'
    const requestedOrder = d.sort !== '' && d.sortOrder !== '' ? d.sortOrder : initialOrder
    const active = requested === key
    const future = active ? (requestedOrder === 'ASC' ? 'DESC' : 'ASC') : initialOrder
    return (
      <button
        type="button"
        title={t('Sort')}
        className="inline-flex items-center gap-1 text-accent"
        onClick={() => onSearch({ ...search, sort: key, sort_order: future })}
      >
        {label}
        {active &&
          (requestedOrder === 'ASC' ? (
            <ArrowUp className="size-3" aria-label={t('Ascending')} />
          ) : (
            <ArrowDown className="size-3" aria-label={t('Descending')} />
          ))}
      </button>
    )
  }

  // adjustTotals: the sum with the exact counts fetched so far
  const parse = (s: string) => Number(s.replace(/[^0-9-]/g, '')) || 0
  const rowText = (tb: DbStructureTable) => counts[tb.name] ?? tb.rowsText
  const rowApprox = (tb: DbStructureTable) => tb.approx && counts[tb.name] === undefined
  const anyCounted = Object.keys(counts).length > 0
  const sumText = anyCounted
    ? d.tables
        .filter((tb) => !tb.isMerge)
        .reduce((s, tb) => s + parse(rowText(tb)), 0)
        .toLocaleString('en-US')
    : (d.summary?.rowsText ?? '0')
  const sumApprox = anyCounted ? d.tables.some(rowApprox) : (d.summary?.approx ?? false)
  const actionCols = (d.isSystemSchema ? 3 : 6) + (c.numFavoriteTables > 0 ? 1 : 0)
  const allChecked = d.tables.length > 0 && d.tables.every((tb) => selected.includes(tb.name))

  /** The "Enable foreign key checks" box of the confirmations; null when cancelled. */
  const askFk = async (question: ReactNode, yesNo: boolean): Promise<boolean | null> => {
    const box = { checked: fkDefault }
    const ok = await confirm({
      question: (
        <>
          {question}
          <FkCheckbox box={box} />
        </>
      ),
      destructive: true,
      ...(yesNo ? { okLabel: t('Yes'), closeLabel: t('No') } : {}),
    })
    return ok ? box.checked : null
  }

  /** drop_form.twig / empty_form.twig */
  const bulkConfirm = async (action: 'empty' | 'drop', tables: string[], sql: string) => {
    const fk = await askFk(
      <>
        <p className="mb-2">{t('Do you really want to execute the following query?')}</p>
        <pre className="mb-2 rounded bg-bg-inset p-2 font-mono text-xs">{sql}</pre>
      </>,
      true,
    )
    if (fk === null) {
      setMessages([{ type: 'success', text: t('No change') }])
      return
    }
    await act(() => api.dbStructureAction(server, db, action, { tables, fkChecks: fk }))
  }

  /** structure.ts truncate_table_anchor / drop_table_anchor, posted to /sql */
  const rowAction = async (action: 'empty' | 'drop', tb: DbStructureTable) => {
    const sql =
      action === 'empty' ? `TRUNCATE \`${tb.name}\`` : `DROP ${tb.isView ? 'VIEW' : 'TABLE'} \`${tb.name}\``
    const fk = await askFk(
      <p className="mb-2">
        {!tb.isView &&
          `${t(action === 'empty' ? 'You are about to TRUNCATE a complete table!' : 'You are about to DESTROY a complete table!')} `}
        {t('Do you really want to execute "%s"?', sql)}
      </p>,
      false,
    )
    if (fk === null) return
    try {
      const r = await runQuery(server, { sql, db, table: tb.name, fkChecks: fk }, 'page')
      const err = r.statements.find((st) => st.kind === 'error')
      if (err !== undefined) {
        setMessages([{ type: 'error', text: err.message?.text ?? '', sql }])
      } else {
        setMessages([
          {
            type: 'success',
            text:
              action === 'empty'
                ? t('Table %s has been emptied.', tb.name)
                : t(tb.isView ? 'View %s has been dropped.' : 'Table %s has been dropped.', tb.name),
            sql,
          },
        ])
      }
      await refresh()
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  return (
    <div id="tableslistcontainer">
      <Messages messages={messages} />
      {maintenance !== null && <MaintenanceCard m={maintenance} />}
      {d.tables.length === 0 ? (
        <Alert variant="notice" className="mb-3">
          {t('No tables found in database.')}
        </Alert>
      ) : (
        <>
          <ListNavigator pager={d.pager} onPos={(pos) => onSearch({ ...search, pos: String(pos) })} />
          <Panel title={t('Filters')} className="mb-3 print:hidden">
            <PanelBody>
              <Label className="flex items-center gap-2 text-sm">
                {t('Containing the word:')}
                <Input id="filterText" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </Label>
            </PanelBody>
          </Panel>
          <form id="tablesForm" onSubmit={(e) => e.preventDefault()}>
            <div className="overflow-x-auto">
              <table id="structureTable" className="w-auto border-collapse text-sm">
                <thead>
                  <tr className="bg-grid-header text-left [&_th]:px-2 [&_th]:py-1">
                    <th className="print:hidden" />
                    <th>{sortLink('table', t('Table'))}</th>
                    {d.replicaStatus && <th>{t('Replication')}</th>}
                    <th colSpan={actionCols} className="print:hidden">
                      {t('Action')}
                    </th>
                    <th>
                      {sortLink('records', t('Rows'), 'DESC')}{' '}
                      <span
                        className="pma_hint"
                        title={t(
                          'May be approximate. Click on the number to get the exact count. See [doc@faq3-11]FAQ 3.11[/doc].',
                        ).replace(/\[\/?doc[^\]]*\]/g, '')}
                      >
                        <PmaIcon name="s_info" alt={t('May be approximate.')} />
                      </span>
                    </th>
                    {c.showDbDetails && (
                      <>
                        <th>{sortLink('type', t('Type'))}</th>
                        <th>{sortLink('collation', t('Collation'))}</th>
                      </>
                    )}
                    {c.showStats && (
                      <>
                        <th>{sortLink('size', t('Size'), 'DESC')}</th>
                        <th>{sortLink('overhead', t('Overhead'), 'DESC')}</th>
                      </>
                    )}
                    {c.showCharset && <th>{sortLink('charset', t('Charset'))}</th>}
                    {c.showComment && <th>{sortLink('comment', t('Comment'))}</th>}
                    {c.showCreation && <th>{sortLink('creation', t('Creation'), 'DESC')}</th>}
                    {c.showLastUpdate && <th>{sortLink('last_update', t('Last update'), 'DESC')}</th>}
                    {c.showLastCheck && <th>{sortLink('last_check', t('Last check'), 'DESC')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((tb, i) => {
                    const fav = favorites[tb.name] ?? tb.favorite
                    const tbase = tableBase(server, db, tb.name)
                    const grey = tb.mayHaveRows ? '' : 'opacity-50'
                    return (
                      <tr
                        key={tb.name}
                        id={`row_tbl_${i + 1}`}
                        className={`odd:bg-grid-odd even:bg-grid-even hover:bg-grid-hover [&_td]:px-2 [&_td]:py-1 ${tb.isView ? 'is_view' : ''}`}
                        data-testid={`db-structure-row-${tb.name}`}
                      >
                        <td className="text-center print:hidden">
                          <Checkbox
                            id={`checkbox_tbl_${i + 1}`}
                            aria-label={tb.name}
                            className={tb.overhead !== null ? 'tbl-overhead' : ''}
                            checked={selected.includes(tb.name)}
                            onCheckedChange={(v) =>
                              setSelected(
                                v === true ? [...selected, tb.name] : selected.filter((x) => x !== tb.name),
                              )
                            }
                          />
                        </td>
                        <th className="px-2 text-left font-semibold">
                          <Link to={path(`${tbase}/browse`)} search={{ pos: 0 } as never} title={tb.comment}>
                            {tb.name}
                          </Link>
                          {tb.tracking !== null && (
                            <Link to={path(`${tbase}/tracking`)} className="ml-1">
                              <PmaIcon
                                name="eye"
                                className={tb.tracking === 'inactive' ? 'opacity-40' : ''}
                                alt={
                                  tb.tracking === 'active'
                                    ? t('Tracking is active.')
                                    : t('Tracking is not active.')
                                }
                              />
                            </Link>
                          )}
                        </th>
                        {d.replicaStatus && (
                          <td className="text-center">
                            {tb.replication.ignored && <PmaIcon name="s_error" alt={t('Not replicated')} />}
                            {tb.replication.do && <PmaIcon name="s_success" alt={t('Replicated')} />}
                          </td>
                        )}
                        {c.numFavoriteTables > 0 && (
                          <td className="text-center print:hidden">
                            <button
                              type="button"
                              className="favorite_table_anchor"
                              title={fav ? t('Remove from Favorites') : t('Add to Favorites')}
                              onClick={() => void toggleFavorite(tb)}
                            >
                              <PmaIcon name={fav ? 'b_favorite' : 'b_no_favorite'} />
                            </button>
                          </td>
                        )}
                        <td className="text-center print:hidden">
                          <Link to={path(`${tbase}/browse`)} search={{ pos: 0 } as never} className={grey}>
                            <IconText icon="b_browse" text={t('Browse')} />
                          </Link>
                        </td>
                        <td className="text-center print:hidden">
                          <Link to={path(`${tbase}/structure`)}>
                            <IconText icon="b_props" text={t('Structure')} />
                          </Link>
                        </td>
                        <td className="text-center print:hidden">
                          <Link to={path(`${tbase}/search`)} className={grey}>
                            <IconText icon="b_select" text={t('Search')} />
                          </Link>
                        </td>
                        {!d.isSystemSchema && (
                          <>
                            <td className="text-center print:hidden">
                              <Link to={path(`${tbase}/insert`)}>
                                <IconText icon="b_insrow" text={t('Insert')} />
                              </Link>
                            </td>
                            <td className="text-center print:hidden">
                              {tb.isView ? (
                                <Link
                                  to={path(`${dbBase(server, db)}/view-create`)}
                                  search={{ table: tb.name } as never}
                                >
                                  <IconText icon="b_edit" text={t('Edit')} />
                                </Link>
                              ) : (
                                <button
                                  type="button"
                                  className={`truncate_table_anchor text-accent ${grey}`}
                                  onClick={() => void rowAction('empty', tb)}
                                >
                                  <IconText icon="b_empty" text={t('Empty')} />
                                </button>
                              )}
                            </td>
                            <td className="text-center print:hidden">
                              <button
                                type="button"
                                className="drop_table_anchor text-accent"
                                onClick={() => void rowAction('drop', tb)}
                              >
                                <IconText icon="b_drop" text={t('Drop')} />
                              </button>
                            </td>
                          </>
                        )}
                        {tb.inUse !== null ? (
                          <td colSpan={20} className="text-center">
                            {tb.inUse}
                          </td>
                        ) : (
                          <>
                            <td className="tbl_rows text-right font-mono" data-table={tb.name}>
                              {rowApprox(tb) ? (
                                <button
                                  type="button"
                                  className="real_row_count text-accent"
                                  onClick={() => void realCount(tb.name)}
                                >
                                  <bdi>~{tb.rowsText}</bdi>
                                </button>
                              ) : (
                                rowText(tb)
                              )}
                              {tb.viewHint && (
                                <sup
                                  title={t(
                                    'This view has at least this number of rows. Please refer to %sdocumentation%s.',
                                    '',
                                    '',
                                  )}
                                >
                                  <PmaIcon name="s_info" />
                                </sup>
                              )}
                            </td>
                            {c.showDbDetails && (
                              <>
                                <td className="whitespace-nowrap">
                                  {tb.engine !== '' ? tb.engine : tb.isView ? t('View') : ''}
                                </td>
                                <td className="whitespace-nowrap">
                                  {tb.collation !== null ? (
                                    <dfn title={tb.collation.description}>{tb.collation.name}</dfn>
                                  ) : (
                                    '---'
                                  )}
                                </td>
                              </>
                            )}
                            {c.showStats && (
                              <>
                                <td className="tbl_size text-right font-mono">
                                  {'text' in tb.size ? (
                                    tb.size.text
                                  ) : (
                                    <Link to={path(`${tbase}/structure`)} hash="showusage">
                                      {tb.size.value}&nbsp;<span className="unit">{tb.size.unit}</span>
                                    </Link>
                                  )}
                                </td>
                                <td className="tbl_overhead text-right font-mono">
                                  {tb.overhead === null ? (
                                    '-'
                                  ) : (
                                    <Link to={path(`${tbase}/structure`)} hash="showusage">
                                      {tb.overhead.value}&nbsp;
                                      <span className="unit">{tb.overhead.unit}</span>
                                    </Link>
                                  )}
                                </td>
                              </>
                            )}
                            {c.showCharset && <td>{tb.charset}</td>}
                            {c.showComment && (
                              <td>
                                {tb.comment.length > c.limitChars ? (
                                  <abbr title={tb.comment}>{`${tb.comment.slice(0, c.limitChars)}...`}</abbr>
                                ) : (
                                  tb.comment
                                )}
                              </td>
                            )}
                            {c.showCreation && <td className="text-right font-mono">{tb.createTime}</td>}
                            {c.showLastUpdate && <td className="text-right font-mono">{tb.updateTime}</td>}
                            {c.showLastCheck && <td className="text-right font-mono">{tb.checkTime}</td>}
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                {d.summary !== null && (
                  <tfoot id="tbl_summary_row">
                    <tr className="bg-grid-header [&_th]:px-2 [&_th]:py-1">
                      <th className="print:hidden" />
                      <th className="tbl_num whitespace-nowrap text-left">
                        {t(d.summary.numTables === 1 ? '%s table' : '%s tables', String(rows.length))}
                      </th>
                      {d.replicaStatus && <th>{t('Replication')}</th>}
                      <th colSpan={actionCols} className="text-left print:hidden">
                        {t('Sum')}
                      </th>
                      <th className="tbl_rows text-right font-mono" data-testid="rows-sum">
                        {sumApprox ? (
                          <button
                            type="button"
                            className="row_count_sum text-accent"
                            onClick={() => void realCount(null)}
                          >
                            ~{sumText}
                          </button>
                        ) : (
                          sumText
                        )}
                      </th>
                      {c.showDbDetails && (
                        <>
                          <th className="text-center">
                            <dfn
                              title={t(
                                '%s is the default storage engine on this MySQL server.',
                                d.summary.defaultStorageEngine,
                              )}
                            >
                              {d.summary.defaultStorageEngine}
                            </dfn>
                          </th>
                          <th className="text-left">
                            {d.summary.collation !== null && (
                              <dfn title={`${d.summary.collation.description} (${t('Default')})`}>
                                {d.summary.collation.name}
                              </dfn>
                            )}
                          </th>
                        </>
                      )}
                      {c.showStats && (
                        <>
                          <th className="tbl_size text-right font-mono">
                            {d.summary.size[0]} {d.summary.size[1]}
                          </th>
                          <th className="tbl_overhead text-right font-mono">
                            {d.summary.overhead[0]} {d.summary.overhead[1]}
                          </th>
                        </>
                      )}
                      {c.showCharset && <th>{d.summary.charset}</th>}
                      {c.showComment && <th />}
                      {c.showCreation && <th className="text-right font-mono">{d.summary.createTime}</th>}
                      {c.showLastUpdate && <th className="text-right font-mono">{d.summary.updateTime}</th>}
                      {c.showLastCheck && <th className="text-right font-mono">{d.summary.checkTime}</th>}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="my-2 flex flex-wrap items-center gap-2 text-sm print:hidden">
              <Checkbox
                id="tablesForm_checkall"
                checked={allChecked}
                onCheckedChange={(v) => setSelected(v === true ? d.tables.map((tb) => tb.name) : [])}
              />
              <Label htmlFor="tablesForm_checkall">{t('Check all')}</Label>
              {d.overheadCheck && (
                <>
                  /
                  <Button
                    variant="link"
                    onClick={() =>
                      setSelected(d.tables.filter((tb) => tb.overhead !== null).map((tb) => tb.name))
                    }
                  >
                    {t('Check tables having overhead')}
                  </Button>
                </>
              )}
              <NativeSelect
                name="submit_mult"
                aria-label={t('With selected:')}
                className="mx-4 w-auto"
                value=""
                onChange={(e) => void onBulk(e.target.value)}
              >
                <option value="">{t('With selected:')}</option>
                <option value="copy_tbl">{t('Copy table')}</option>
                <option value="show_create">{t('Show create')}</option>
                <option value="export">{t('Export')}</option>
                {!d.isSystemSchema && !c.disableMultiTableMaintenance && (
                  <>
                    <optgroup label={t('Delete data or table')}>
                      <option value="empty_tbl">{t('Empty')}</option>
                      <option value="drop_tbl">{t('Drop')}</option>
                    </optgroup>
                    <optgroup label={t('Table maintenance')}>
                      <option value="analyze_tbl">{t('Analyze table')}</option>
                      <option value="check_tbl">{t('Check table')}</option>
                      <option value="checksum_tbl">{t('Checksum table')}</option>
                      <option value="optimize_tbl">{t('Optimize table')}</option>
                      <option value="repair_tbl">{t('Repair table')}</option>
                    </optgroup>
                    <optgroup label={t('Prefix')}>
                      <option value="add_prefix_tbl">{t('Add prefix to table')}</option>
                      <option value="replace_prefix_tbl">{t('Replace table prefix')}</option>
                      <option value="copy_tbl_change_prefix">{t('Copy table with prefix')}</option>
                    </optgroup>
                  </>
                )}
                {c.centralColumns && (
                  <optgroup label={t('Central columns')}>
                    <option value="sync_unique_columns_central_list">
                      {t('Add columns to central list')}
                    </option>
                    <option value="delete_unique_columns_central_list">
                      {t('Remove columns from central list')}
                    </option>
                    <option value="make_consistent_with_central_list">
                      {t('Make consistent with central list')}
                    </option>
                  </optgroup>
                )}
              </NativeSelect>
            </div>
          </form>
          <ListNavigator pager={d.pager} onPos={(pos) => onSearch({ ...search, pos: String(pos) })} />
        </>
      )}
      <hr className="my-3 border-border print:hidden" />
      <p className="mb-3 flex items-center gap-3 text-sm print:hidden">
        <Button onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden /> {t('Print')}
        </Button>
        <Link to={path(`${dbBase(server, db)}/data-dictionary`)}>
          <IconText icon="b_tblanalyse" text={t('Data dictionary')} />
        </Link>
      </p>
      {!d.isSystemSchema && <CreateTableBox server={server} db={db} />}

      {dialog?.kind === 'copy' && (
        <CopyTablesDialog
          scope={scope}
          tables={dialog.tables}
          onClose={() => setDialog(null)}
          onDone={(r) => {
            setDialog(null)
            void act(async () => r)
          }}
        />
      )}
      {dialog?.kind === 'prefix' && (
        <PrefixDialog
          action={dialog.action}
          onClose={() => setDialog(null)}
          onSubmit={(v) => {
            const tables = dialog.tables
            setDialog(null)
            void act(() =>
              api.dbStructureAction(
                server,
                db,
                dialog.action,
                dialog.action === 'add-prefix'
                  ? { tables, prefix: v.from }
                  : { tables, fromPrefix: v.from, toPrefix: v.to },
              ),
            )
          }}
        />
      )}
      {dialog?.kind === 'show-create' && (
        <DbModal title={t('Show create')} wide onClose={() => setDialog(null)}>
          <h2 className="mb-2 font-semibold">{t('Showing create queries')}</h2>
          {(['tables', 'views'] as const).map((k) =>
            dialog.data[k].length === 0 ? null : (
              <Panel key={k} title={k === 'tables' ? t('Tables') : t('Views')} className="mb-3">
                <PanelBody>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left">
                        <th>{k === 'tables' ? t('Table') : t('View')}</th>
                        <th>{k === 'tables' ? t('Create table') : t('Create view')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dialog.data[k].map((x) => (
                        <tr key={x.name} className="align-top">
                          <td className="pr-2 font-semibold">{x.name}</td>
                          <td>
                            <pre className="overflow-x-auto font-mono text-xs" dir="ltr">
                              <code className="sql">{x.sql}</code>
                            </pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </PanelBody>
              </Panel>
            ),
          )}
        </DbModal>
      )}
    </div>
  )
}

function MaintenanceCard({ m }: { m: MaintenanceResponse }) {
  return (
    <Panel title={m.title} className="mb-3">
      <PanelBody>
        <Messages messages={m.messages} />
        {m.groups.map((g) => (
          <div key={g.table} className="mb-2 rounded border border-border">
            <div className="border-b border-border bg-bg-subtle px-2 py-1 font-semibold">{g.table}</div>
            <ul className="px-2 py-1 text-sm">
              {g.rows.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: result rows
                <li key={i}>
                  {r.operation.toLowerCase() !== m.docPage.split('_')[0]?.toLowerCase() && (
                    <span className="mr-1 rounded bg-bg-inset px-1">{r.operation}</span>
                  )}
                  <span className="mr-1 rounded bg-bg-inset px-1">{r.type}</span>
                  {r.text}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {m.checksums.length > 0 && (
          <table className="text-sm">
            <thead>
              <tr>
                <th className="pr-4 text-left">{t('Table')}</th>
                <th className="text-left">{t('Checksum')}</th>
              </tr>
            </thead>
            <tbody>
              {m.checksums.map((r) => (
                <tr key={r.table}>
                  <td className="pr-4">{r.table}</td>
                  <td className="text-right">{r.checksum ?? <em className="text-fg-muted">NULL</em>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {m.warnings.map((w) => (
          <Alert key={w} variant="notice">
            {w}
          </Alert>
        ))}
      </PanelBody>
    </Panel>
  )
}

function CopyTablesDialog({
  scope,
  tables,
  onClose,
  onDone,
}: {
  scope: { server: number; db: string }
  tables: string[]
  onClose: () => void
  onDone: (r: { messages: SqlMessage[] }) => void
}) {
  const form = useQuery({
    queryKey: qk.dbPage(scope.server, scope.db, 'copy-form'),
    queryFn: () => api.dbCopyForm(scope.server, scope.db),
  })
  const [target, setTarget] = useState<string | null>(null)
  const [what, setWhat] = useState<'data' | 'structure' | 'dataonly'>('data')
  const [drop, setDrop] = useState(false)
  const [ai, setAi] = useState(false)
  const [constraints, setConstraints] = useState(true)
  const [adjust, setAdjust] = useState(false)
  const [error, setError] = useState<SqlMessage | null>(null)
  const dbs = form.data?.databases ?? []
  const targetDb = target ?? dbs[0] ?? ''
  const submit = async () => {
    try {
      onDone(
        await api.dbStructureAction(scope.server, scope.db, 'copy', {
          tables,
          targetDb,
          what,
          dropIfExists: drop,
          autoIncrement: ai,
          addConstraints: constraints,
          adjustPrivileges: adjust,
        }),
      )
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return (
    <DbModal
      id="bulkActionModal"
      title={t('Copy tables to')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => void submit()}>
            {t('Continue')}
          </Button>
        </>
      }
    >
      {error !== null && <Messages messages={[error]} />}
      <div className="flex flex-col gap-2 text-sm">
        <Label className="flex flex-col gap-1">
          {t('Database:')}
          <NativeSelect id="databaseNameSelect" value={targetDb} onChange={(e) => setTarget(e.target.value)}>
            {dbs.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <fieldset>
          <legend>{t('Options:')}</legend>
          {(
            [
              ['data', t('Structure and data')],
              ['structure', t('Structure only')],
              ['dataonly', t('Data only')],
            ] as const
          ).map(([v, label]) => (
            <Label key={v} className="flex items-center gap-2">
              <input type="radio" name="what" checked={what === v} onChange={() => setWhat(v)} /> {label}
            </Label>
          ))}
        </fieldset>
        <Label className="flex items-center gap-2">
          <Checkbox checked={drop} onCheckedChange={(v) => setDrop(v === true)} /> {t('Add DROP TABLE')}
        </Label>
        <Label className="flex items-center gap-2">
          <Checkbox checked={ai} onCheckedChange={(v) => setAi(v === true)} /> {t('Add AUTO INCREMENT value')}
        </Label>
        <Label className="flex items-center gap-2">
          <Checkbox checked={constraints} onCheckedChange={(v) => setConstraints(v === true)} />{' '}
          {t('Add constraints')}
        </Label>
        <Label className="flex items-center gap-2">
          <Checkbox checked={adjust} onCheckedChange={(v) => setAdjust(v === true)} />{' '}
          {t('Adjust privileges')}
        </Label>
      </div>
    </DbModal>
  )
}

function PrefixDialog({
  action,
  onClose,
  onSubmit,
}: {
  action: 'add-prefix' | 'replace-prefix' | 'copy-with-prefix'
  onClose: () => void
  onSubmit: (v: { from: string; to: string }) => void
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  return (
    <DbModal
      title={t(BULK_TITLES[action])}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => onSubmit({ from, to })}>
            {t('Continue')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        {action === 'add-prefix' ? (
          <Label className="flex flex-col gap-1">
            {t('Add prefix')}
            <Input id="addTablePrefixInput" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Label>
        ) : (
          <>
            <Label className="flex flex-col gap-1">
              {t('From')}
              <Input id="initialPrefixInput" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Label>
            <Label className="flex flex-col gap-1">
              {t('To')}
              <Input id="newPrefixInput" value={to} onChange={(e) => setTo(e.target.value)} />
            </Label>
          </>
        )}
      </div>
    </DbModal>
  )
}

/** The "Enable foreign key checks" checkbox inside a confirmation. */
function FkCheckbox({ box }: { box: { checked: boolean } }) {
  const [checked, setChecked] = useState(box.checked)
  return (
    <Label className="flex items-center gap-2">
      <Checkbox
        id="checkForeignKeyCheckbox"
        checked={checked}
        onCheckedChange={(v) => {
          box.checked = v === true
          setChecked(v === true)
        }}
      />
      {t('Enable foreign key checks')}
    </Label>
  )
}
