import type {
  BrowseRequest,
  GridData,
  GridRow,
  SqlMessage as SqlMessageData,
  StatementResult,
} from '@bettermyadmin/contracts'
import { N_ } from '@bettermyadmin/i18n'
import {
  Alert,
  Button,
  Disclosure,
  DocLink,
  Hint,
  IconText,
  Input,
  MessageBox,
  NativeSelect,
  Panel,
  PanelBody,
  PmaIcon,
  showMessage,
  useConfirm,
} from '@bettermyadmin/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { type BrowseResponse, api } from '../../lib/api'
import { pgettext, t } from '../../lib/i18n'
import { bookmarks as bookmarkApi, useBookmarks } from '../bookmarks/provider'
import { ProfilingCard } from '../sql/ProfilingCard'
import { ResultGrid } from '../sql/ResultGrid'
import { type CardEnv, SqlMessage } from '../sql/SqlMessage'
import { DO_YOU_REALLY, confirmationText } from '../sql/logic'
import { ResultMessages } from '../table/common/ResultMessages'
import { CreateViewDialog } from '../table/view/ViewForm'
import { GridTable } from './GridTable'
import { rowsOptions, validRowNumbers } from './logic'
import './grid.css'

const MISSING = {
  unavailable: N_(
    'Current selection does not contain a unique column. Grid edit, checkbox, Edit, Copy and Delete features are not available. %s',
  ),
  undesired: N_(
    'Current selection does not contain a unique column. Grid edit, Edit, Copy and Delete features may result in undesired behavior. %s',
  ),
} as const

/** Link with a computed (splat) destination the route types cannot narrow. */
const AnyLink = Link as unknown as (p: Record<string, unknown>) => ReactNode

const SHOW_ALL_WARNING =
  'Do you really want to see all of the rows? For a big table this could crash the browser.'

export interface ResultsViewProps {
  server: number
  /** The statement as the SQL tab or the Browse request returned it (with its grid). */
  statement: StatementResult
  env: CardEnv
  usingBookmark?: string | null
  previous?: StatementResult | undefined
  /** The bookmark form's complete query (bkm_sql_query), the statement by default. */
  completeQuery?: string
}

/**
 * Everything around the results grid: header card, navigation bars, Extra options, the table,
 * "With selected", "Query results operations", "Bookmark this SQL query". Sorting, paging and
 * options re-run the query in place through POST /browse (phpMyAdmin's /sql AJAX loads).
 * pma: resources/templates/sql/sql_query_results.twig, display/results/table.twig, resources/js/sql.ts
 */
export function ResultsView(props: ResultsViewProps) {
  const { server, env } = props
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [st, setSt] = useState(props.statement)
  const [previous, setPrevious] = useState(props.previous)
  const [usingBookmark, setUsingBookmark] = useState(props.usingBookmark ?? null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [rows, setRows] = useState<GridRow[]>(props.statement.grid?.rows ?? [])
  const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null)
  const [pending, setPending] = useState<{ n: number; save: () => void }>({ n: 0, save: () => {} })
  const [restore, setRestore] = useState<{ visible: boolean; run: () => void }>({
    visible: false,
    run: () => {},
  })

  useEffect(() => {
    setSt(props.statement)
    setPrevious(props.previous)
    setUsingBookmark(props.usingBookmark ?? null)
  }, [props.statement, props.previous, props.usingBookmark])
  useEffect(() => {
    setRows(st.grid?.rows ?? [])
    setChecked(new Set())
  }, [st])

  const grid = st.grid
  if (grid === undefined) return null

  // the card's links: signed ones (Refresh, Profiling) go through /sql, the others through /import
  const cardEnv: CardEnv = {
    ...env,
    onAction: (a) => {
      if (a.type === 'edit') {
        env.onAction(a)
        return
      }
      if (
        a.sig !== undefined &&
        a.showAsPhp === undefined &&
        a.fkChecks === undefined &&
        a.profiling === undefined
      ) {
        void run({ sql: a.sql, sig: a.sig })
        return
      }
      env.onAction(a)
    },
  }

  const apply = (res: BrowseResponse) => {
    const next = res.statements[0]
    if (next === undefined) return
    setPrevious(res.previous)
    setUsingBookmark(res.usingBookmark)
    setSt(next)
    setDeleteConfirm(null)
  }

  const run = async (req: Partial<BrowseRequest>) => {
    setLoading(true)
    try {
      apply(await api.browse(server, { db: grid.db, table: grid.table, sql: grid.sql, ...req }))
    } catch (e) {
      showMessage((e as Error).message, false, 'error')
    } finally {
      setLoading(false)
    }
  }

  const deleteRow = async (row: GridRow): Promise<boolean> => {
    if (row.kill !== undefined) {
      if (!(await confirm({ question: confirmationText(row.kill.sql, t(DO_YOU_REALLY)) }))) return false
      const res = await api.browse(server, { db: 'mysql', sql: row.kill.sql, sig: row.kill.sig })
      showMessage(res.statements[0]?.message.text ?? '')
      return res.statements[0]?.kind !== 'error'
    }
    const del = row.del!
    if (!(await confirm({ question: confirmationText(del.confirm, t(DO_YOU_REALLY)), destructive: true }))) {
      return false
    }
    try {
      const res = await api.browse(server, {
        db: grid.db,
        table: grid.table,
        sql: del.sql,
        sig: del.sig,
        messageToShow: t('The row has been deleted.'),
      })
      const r = res.statements[0]
      if (r === undefined || r.kind === 'error') {
        showMessage(r?.error?.serverMessage ?? r?.message.text ?? '', false, 'error')
        return false
      }
      showMessage(r.message.text)
      return true
    } catch (e) {
      showMessage((e as Error).message, false, 'error')
      return false
    }
  }

  const followFk = (fk: { db: string; table: string; sql: string; sig: string }) =>
    void navigate({
      to: '/s/$server/db/$db/t/$table/browse',
      params: { server, db: fk.db, table: fk.table },
      search: { sql: fk.sql, sig: fk.sig, pos: 0 },
    } as never)

  const nav = grid.navigation
  const navBar = nav !== null && (
    <Navigation
      grid={grid}
      st={st}
      filter={filter}
      onFilter={setFilter}
      onRun={(r) => void run(r)}
      pending={pending}
      restore={restore}
      confirmShowAll={() => confirm({ question: t(SHOW_ALL_WARNING) })}
    />
  )

  const selected = [...checked].map((i) => rows[i]?.where).filter((w): w is string => w !== undefined)

  if (deleteConfirm !== null) {
    return (
      <DeleteConfirm
        server={server}
        table={grid.table}
        where={deleteConfirm}
        onAnswer={async (yes, fkChecks) => {
          if (!yes) {
            await run({ sql: grid.sql })
            return
          }
          try {
            apply(
              await api.deleteRows(server, {
                db: grid.db,
                table: grid.table,
                where: deleteConfirm,
                fkChecks,
                originalSql: grid.sql,
              }),
            )
          } catch (e) {
            showMessage((e as Error).message, false, 'error')
          }
        }}
      />
    )
  }

  const bulk = async (action: 'edit' | 'copy' | 'delete' | 'export') => {
    if (selected.length === 0) {
      showMessage(t('No row selected.'), false, 'error')
      return
    }
    if (action === 'delete') {
      setDeleteConfirm(selected)
      return
    }
    const splat = action === 'export' ? 'export' : 'edit'
    await navigate({
      to: '/s/$server/db/$db/t/$table/$',
      params: { server, db: grid.db, table: grid.table, _splat: splat },
      search: {
        where: selected,
        sig: [...checked].map((i) => rows[i]?.whereSig).filter((w): w is string => w !== undefined),
        unique: grid.clauseIsUnique ? '1' : '0',
        action: action === 'copy' ? 'insert' : 'update',
        sql: grid.sql,
        sql_sig: grid.sig,
        ...(action === 'export' ? { single_table: 'true' } : {}),
      },
    } as never)
  }

  return (
    <section className="sqlqueryresults ajax mb-4" aria-busy={loading}>
      {previous !== undefined && <SqlMessage st={previous} env={cardEnv} />}
      {st.profiling !== undefined && <ProfilingCard profiling={st.profiling} versionInt={env.versionInt} />}
      {grid.missingUnique !== null && (
        <Alert variant="notice" className="mb-3 flex items-center gap-1">
          <span>{t(MISSING[grid.missingUnique]).replace('%s', '')}</span>
          <DocLink page="config" anchor="cfg_RowActionLinksWithoutUnique" />
        </Alert>
      )}
      {usingBookmark !== null && (
        <div className="mb-2 flex items-center gap-1 text-sm">
          <MessageBox type="notice" text={usingBookmark} flush />
          <DocLink page="faq" anchor="faq6-22" />
        </div>
      )}
      <SqlMessage st={st} env={cardEnv} />
      {grid.viewHint && (
        <Hint
          message={t(
            'This view has at least this number of rows. Please refer to %sdocumentation%s.',
            '',
            '',
          )}
        />
      )}
      {navBar}
      {!grid.limited && <DisplayOptions grid={grid} onRun={(r) => void run(r)} />}
      <form name="resultsForm" id="resultsForm_grid" className="ajax" onSubmit={(e) => e.preventDefault()}>
        <GridTable
          server={server}
          grid={grid}
          fields={st.result?.fields ?? []}
          raw={st.result?.rows ?? []}
          filter={filter}
          checked={checked}
          onChecked={setChecked}
          onRows={setRows}
          versionInt={env.versionInt}
          onPendingChange={(n, save) => setPending({ n, save })}
          onRestoreChange={(visible, r) => setRestore({ visible, run: r })}
          actions={{
            sort: (sql, sig, discard) =>
              void run({
                sql,
                sig,
                maxRows: grid.view.maxRows,
                ...(discard ? { discardRememberedSort: true } : {}),
              }),
            toggleText: (pftext) => void run({ pftext, fullTextButton: true }),
            deleteRow,
            followFk,
          }}
        />
        {grid.displayParts.deleteLink === 'delete' && (
          <div className="d-print-none mt-1 flex flex-wrap items-center gap-2 text-sm">
            <PmaIcon name="select_all_arrow" alt={t('With selected:')} />
            <input
              type="checkbox"
              id="resultsForm_grid_checkall"
              className="checkall_box"
              title={t('Check all')}
              checked={rows.length > 0 && checked.size === rows.length}
              onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((_, i) => i)) : new Set())}
            />
            <label htmlFor="resultsForm_grid_checkall">{t('Check all')}</label>
            <em className="with-selected">{t('With selected:')}</em>
            <Button
              variant="link"
              className="mult_submit"
              name="submit_mult"
              value="edit"
              title={t('Edit')}
              onClick={() => void bulk('edit')}
            >
              <IconText icon="b_edit" text={t('Edit')} />
            </Button>
            <Button
              variant="link"
              className="mult_submit"
              name="submit_mult"
              value="copy"
              title={t('Copy')}
              onClick={() => void bulk('copy')}
            >
              <IconText icon="b_insrow" text={t('Copy')} />
            </Button>
            <Button
              variant="link"
              className="mult_submit"
              name="submit_mult"
              value="delete"
              title={t('Delete')}
              onClick={() => void bulk('delete')}
            >
              <IconText icon="b_drop" text={t('Delete')} />
            </Button>
            {grid.hasExportButton && (
              <Button
                variant="link"
                className="mult_submit"
                name="submit_mult"
                value="export"
                title={t('Export')}
                onClick={() => void bulk('export')}
              >
                <IconText icon="b_tblexport" text={t('Export')} />
              </Button>
            )}
          </div>
        )}
      </form>
      {navBar}
      {grid.operations !== null && <Operations server={server} grid={grid} st={st} rows={rows} />}
      {grid.displayParts.bookmarkForm && (
        <BookmarkForm
          server={server}
          db={grid.db}
          sql={props.completeQuery ?? grid.sql}
          allowShared={grid.settings.AllowSharedBookmarks}
        />
      )}
      {(st.moreResults ?? []).map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: result sets are positional
        <div key={i} className="mt-3">
          <SqlMessage st={st} env={env} message={r.message} />
          <ResultGrid fields={r.fields} rows={r.rows} />
        </div>
      ))}
      {st.warnings.map((w, i) => (
        <MessageBox
          // biome-ignore lint/suspicious/noArrayIndexKey: warnings are positional
          key={i}
          type="notice"
          text={`${w.level}: #${w.code}${w.message !== '' ? ` ${w.message}` : ''}`}
          flush
          className="mt-2"
        />
      ))}
    </section>
  )
}

/** The navigation bar (table.twig navigation_html), above and below the grid. */
function Navigation(props: {
  grid: GridData
  st: StatementResult
  filter: string
  onFilter: (v: string) => void
  onRun: (r: Partial<BrowseRequest>) => void
  pending: { n: number; save: () => void }
  restore: { visible: boolean; run: () => void }
  confirmShowAll: () => Promise<boolean>
}) {
  const { grid, onRun } = props
  const nav = grid.navigation!
  const mode = grid.settings.TableNavigationLinksMode
  const icons = mode !== 'text'
  const text = mode !== 'icons'
  const label = (sym: string, msg: string, ctx: string, after = false) => {
    const w = pgettext(ctx, msg)
    if (after) return `${text ? `${w} ` : ''}${icons ? sym : ''}`
    return `${icons ? sym : ''}${text ? ` ${w}` : ''}`
  }
  const pos = grid.view.pos
  const maxRows = grid.view.maxRows
  const go = (p: number) => onRun({ pos: p })
  return (
    // the row wraps between its cells (not inside a label) when the main panel is narrow
    <table className="navigation d-print-none mb-2 whitespace-nowrap [&>tbody>tr]:flex [&>tbody>tr]:flex-wrap [&>tbody>tr]:items-center">
      <tbody>
        <tr>
          <td className="navigation_separator" />
          {pos > 0 && !nav.isShowingAll && (
            <>
              <td>
                <Button size="sm" name="navig" title={pgettext('First page', 'Begin')} onClick={() => go(0)}>
                  {label('<<', 'Begin', 'First page')}
                </Button>
              </td>
              <td>
                <Button
                  size="sm"
                  name="navig"
                  title={pgettext('Previous page', 'Previous')}
                  onClick={() => go(nav.posPrevious)}
                >
                  {label('<', 'Previous', 'Previous page')}
                </Button>
              </td>
            </>
          )}
          {nav.pages.length > 0 && (
            <td>
              <NativeSelect
                className="pageselector ajax"
                name="pos"
                aria-label={t('Page number:')}
                value={String(
                  Math.floor(pos / (maxRows === 'all' ? 1 : maxRows)) * (maxRows === 'all' ? 1 : maxRows),
                )}
                onChange={(e) => go(Number(e.target.value))}
              >
                {nav.pages.map((p) => (
                  <option
                    key={p}
                    value={(p - 1) * (maxRows === 'all' ? 0 : maxRows)}
                    style={p === nav.pageNow ? { fontWeight: 'bold' } : undefined}
                  >
                    {p}
                  </option>
                ))}
              </NativeSelect>
            </td>
          )}
          {!nav.isLastPage && (
            <>
              <td>
                <Button
                  size="sm"
                  name="navig"
                  title={pgettext('Next page', 'Next')}
                  onClick={() => go(nav.posNext)}
                >
                  {label('>', 'Next', 'Next page', true)}
                </Button>
              </td>
              {nav.isLastPageKnown && (
                <td>
                  <Button
                    size="sm"
                    name="navig"
                    title={pgettext('Last page', 'End')}
                    onClick={() => nav.endAllowed && go(nav.posLast)}
                  >
                    {label('>>', 'End', 'Last page', true)}
                  </Button>
                </td>
              )}
            </>
          )}
          {nav.totalPages !== 1 && (
            <td>
              <div className="navigation_separator">|</div>
            </td>
          )}
          {nav.hasShowAll && (
            <>
              <td>
                <span className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    name="navig"
                    id="showAll_grid"
                    className="showAllRows"
                    value="all"
                    checked={nav.isShowingAll}
                    onChange={async (e) => {
                      if (e.target.checked && !(await props.confirmShowAll())) return
                      onRun({ maxRows: nav.showAllMaxRows, pos: 0 })
                    }}
                  />
                  <label htmlFor="showAll_grid">{t('Show all')}</label>
                </span>
              </td>
              <td>
                <div className="navigation_separator">|</div>
              </td>
            </>
          )}
          <td>
            {props.pending.n > 0 && (
              <div className="save_edited flex items-center gap-1">
                <Button variant="link" onClick={props.pending.save}>
                  {t('Save edited data')}
                </Button>
                <div className="navigation_separator">|</div>
              </div>
            )}
          </td>
          <td>
            {props.restore.visible && (
              <div className="restore_column flex items-center gap-1">
                <Button variant="link" onClick={props.restore.run}>
                  {t('Restore column order')}
                </Button>
                <div className="navigation_separator">|</div>
              </div>
            )}
          </td>
          <td className="navigation_goto">
            <form
              className="maxRowsForm flex items-center gap-1 text-sm"
              onSubmit={(e) => e.preventDefault()}
            >
              <label htmlFor="sessionMaxRowsSelect">{t('Number of rows:')}</label>
              <NativeSelect
                className="autosubmit"
                name="session_max_rows"
                id="sessionMaxRowsSelect"
                value={nav.isShowingAll ? '' : String(maxRows)}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!validRowNumbers(v, pos, grid.unlimNumRows)) {
                    showMessage(t('%d is not valid row number.', pos), false, 'error')
                    return
                  }
                  onRun({ maxRows: v, pos })
                }}
              >
                {nav.isShowingAll && (
                  <option value="" disabled>
                    {t('All')}
                  </option>
                )}
                {rowsOptions(maxRows).map((o) => (
                  <option key={o} value={String(o)}>
                    {o}
                  </option>
                ))}
              </NativeSelect>
            </form>
          </td>
          <td className="navigation_separator" />
          <td className="largescreenonly">
            <div className="flex items-center gap-1 p-1 text-sm">
              <label htmlFor="filterRows" className="whitespace-nowrap">
                {t('Filter rows:')}
              </label>
              <Input
                type="text"
                id="filterRows"
                className="filter_rows w-44"
                placeholder={t('Search this table')}
                value={props.filter}
                onChange={(e) => props.onFilter(e.target.value)}
              />
            </div>
          </td>
          <td className="largescreenonly">
            {grid.sortByKey !== null && (
              <span className="d-print-none flex items-center gap-1 text-sm">
                {t('Sort by key:')}
                <NativeSelect
                  name="sql_query"
                  className="autosubmit"
                  aria-label={t('Sort by key:')}
                  value={grid.sortByKey.options.find((o) => o.selected)?.sql ?? ''}
                  onChange={(e) => {
                    const o = grid.sortByKey!.options.find((x) => x.sql === e.target.value)
                    if (o === undefined) return
                    onRun({
                      sql: o.sql,
                      sortByKey: true,
                      ...(grid.sortByKey!.maxRows !== null ? { maxRows: grid.sortByKey!.maxRows } : {}),
                    })
                  }}
                >
                  {grid.sortByKey.options.map((o) => (
                    <option key={o.label} value={o.sql}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              </span>
            )}
          </td>
          <td className="navigation_separator" />
        </tr>
      </tbody>
    </table>
  )
}

/** "Extra options" (displayOptionsForm). */
function DisplayOptions({ grid, onRun }: { grid: GridData; onRun: (r: Partial<BrowseRequest>) => void }) {
  const v = grid.view
  const [pftext, setPftext] = useState(v.pftext)
  const [rel, setRel] = useState(v.relationalDisplay)
  const [bin, setBin] = useState(v.displayBinary)
  const [blob, setBlob] = useState(v.displayBlob)
  const [hide, setHide] = useState(v.hideTransformation)
  const [geo, setGeo] = useState(v.geoOption)
  useEffect(() => {
    setPftext(v.pftext)
    setRel(v.relationalDisplay)
    setBin(v.displayBinary)
    setBlob(v.displayBlob)
    setHide(v.hideTransformation)
    setGeo(v.geoOption)
  }, [v])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onRun({
      pftext,
      ...(grid.relationOptions ? { relationalDisplay: rel } : {}),
      displayBinary: bin,
      displayBlob: blob,
      hideTransformation: hide,
      geoOption: geo,
      displayOptionsForm: true,
    })
  }
  const radio = (
    name: string,
    id: string,
    value: string,
    cur: string,
    set: (v: never) => void,
    text: string,
  ) => (
    <div className="flex items-center gap-1">
      <input
        type="radio"
        name={name}
        id={id}
        value={value}
        checked={cur === value}
        onChange={() => set(value as never)}
      />
      <label htmlFor={id}>{text}</label>
    </div>
  )
  const check = (name: string, id: string, cur: boolean, set: (v: boolean) => void, text: string) => (
    <div className="flex items-center gap-1">
      <input type="checkbox" name={name} id={id} checked={cur} onChange={(e) => set(e.target.checked)} />
      <label htmlFor={id}>{text}</label>
    </div>
  )
  return (
    <form name="displayOptionsForm" className="ajax d-print-none mb-3" onSubmit={submit}>
      <Disclosure
        label={t('Extra options')}
        id="extraOptions"
        // table.twig: a Bootstrap collapse, closed on every page (InitialSlidersState is not read)
        initialState="closed"
      >
        <Panel>
          <PanelBody className="flex flex-wrap gap-6">
            <fieldset>
              {radio('pftext', 'partialFulltextRadioPgrid', 'P', pftext, setPftext, t('Partial texts'))}
              {radio('pftext', 'partialFulltextRadioFgrid', 'F', pftext, setPftext, t('Full texts'))}
            </fieldset>
            {grid.relationOptions && (
              <fieldset>
                {radio(
                  'relational_display',
                  'relationalDisplayRadioKgrid',
                  'K',
                  rel,
                  setRel,
                  t('Relational key'),
                )}
                {radio(
                  'relational_display',
                  'relationalDisplayRadioDgrid',
                  'D',
                  rel,
                  setRel,
                  t('Display column for relationships'),
                )}
              </fieldset>
            )}
            <fieldset>
              {check('display_binary', 'display_binary_grid', bin, setBin, t('Show binary contents'))}
              {check('display_blob', 'display_blob_grid', blob, setBlob, t('Show BLOB contents'))}
            </fieldset>
            <div>
              {check(
                'hide_transformation',
                'hide_transformation_grid',
                hide,
                setHide,
                t('Hide browser transformation'),
              )}
            </div>
            <fieldset>
              {v.possibleAsGeometry &&
                radio('geoOption', 'geoOptionRadioGeomgrid', 'GEOM', geo, setGeo, t('Geometry'))}
              {radio('geoOption', 'geoOptionRadioWktgrid', 'WKT', geo, setGeo, t('Well Known Text'))}
              {radio('geoOption', 'geoOptionRadioWkbgrid', 'WKB', geo, setGeo, t('Well Known Binary'))}
            </fieldset>
          </PanelBody>
          <div className="border-t border-border px-3 py-2">
            <Button type="submit" variant="primary">
              {t('Go')}
            </Button>
          </div>
        </Panel>
      </Disclosure>
    </form>
  )
}

/** "Query results operations" (getResultsOperations). */
function Operations({
  server,
  grid,
  st,
  rows,
}: { server: number; grid: GridData; st: StatementResult; rows: GridRow[] }) {
  const ops = grid.operations!
  // the Create view dialog; its success message replaces the result's query box (.result_query)
  const [createView, setCreateView] = useState(false)
  const [viewMessages, setViewMessages] = useState<SqlMessageData[]>([])
  const copy = async () => {
    // sql.ts #copyToClipBoard
    const lines: string[] = []
    lines.push(`${grid.db}${grid.table !== '' ? `/${grid.table}` : ''}\t\t${window.location.href}`)
    lines.push(st.message.text)
    lines.push(st.card?.display ?? st.sql)
    lines.push(
      grid.columns
        .filter((c) => !c.hidden)
        .map((c) => c.name)
        .join('\t'),
    )
    for (const r of rows) {
      lines.push(
        r.cells
          .filter((_, i) => !grid.columns[i]!.hidden)
          .map((c) => (c.k === 'null' ? 'NULL' : (c.t ?? '')))
          .join('\t'),
      )
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
    } catch {
      // pma: resources/js/sql.ts hard-codes it in English
      window.alert('Sorry! Unable to copy')
    }
  }
  const exportSearch = {
    printview: '1',
    sql: grid.sql,
    ...(ops.export?.singleTable ? { single_table: 'true' } : {}),
    ...(ops.export?.rawQuery ? { raw_query: 'true' } : {}),
    unlim_num_rows: String(ops.export?.unlimNumRows ?? 0),
  }
  const exportTable = ops.export?.table ?? grid.table
  const tableLink = (splat: string) => ({
    to: '/s/$server/db/$db/t/$table/$' as const,
    params: { server, db: grid.db, table: exportTable, _splat: splat },
    // the export page reads sql_query with its sql_signature
    search: { ...exportSearch, sql_query: grid.sql, sql_signature: grid.sig },
  })
  /**
   * Display chart / Visualize GIS data: /table/chart with the result's table, else its database,
   * else the server (ChartController's three branches); they start at the grid's page
   * ($_SESSION['tmpval'] pos / max_rows)
   */
  const viewLink = (splat: 'chart' | 'gis-visualization') => {
    const search = {
      ...exportSearch,
      sig: grid.sig,
      pos: String(grid.view.pos),
      ...(grid.view.maxRows === 'all' ? {} : { session_max_rows: String(grid.view.maxRows) }),
    }
    if (grid.db === '') return { to: '/s/$server/$' as const, params: { server, _splat: splat }, search }
    if (exportTable === '') {
      return { to: '/s/$server/db/$db/$' as const, params: { server, db: grid.db, _splat: splat }, search }
    }
    return { ...tableLink(splat), search }
  }
  return (
    <Panel title={t('Query results operations')} className="d-print-none mb-3">
      <PanelBody className="flex flex-wrap items-center gap-3">
        {ops.print && (
          <>
            <Button variant="link" className="jsPrintButton" onClick={() => window.print()}>
              <IconText icon="b_print" text={t('Print')} forceText />
            </Button>
            <Button variant="link" id="copyToClipBoard" onClick={() => void copy()}>
              <IconText icon="b_insrow" text={t('Copy to clipboard')} forceText />
            </Button>
          </>
        )}
        {!ops.procedure && (
          <>
            {ops.export !== null && (
              <>
                <AnyLink {...tableLink('export')} className="btn-link text-accent">
                  <IconText icon="b_tblexport" text={t('Export')} forceText />
                </AnyLink>
                <AnyLink {...viewLink('chart')} className="text-accent">
                  <IconText icon="b_chart" text={t('Display chart')} forceText />
                </AnyLink>
                {ops.gis && (
                  <AnyLink {...viewLink('gis-visualization')} className="text-accent">
                    <IconText icon="b_globe" text={t('Visualize GIS data')} forceText />
                  </AnyLink>
                )}
              </>
            )}
            <span>
              <Button variant="link" className="create_view ajax" onClick={() => setCreateView(true)}>
                <IconText icon="b_view_add" text={t('Create view')} forceText />
              </Button>
            </span>
          </>
        )}
      </PanelBody>
      {viewMessages.length > 0 && <ResultMessages messages={viewMessages} />}
      {createView && (
        <CreateViewDialog
          server={server}
          db={grid.db}
          sql={grid.sql}
          onClose={() => setCreateView(false)}
          onDone={(m) => {
            setViewMessages(m)
            setCreateView(false)
          }}
        />
      )}
    </Panel>
  )
}

/** "Bookmark this SQL query" (sql/_bookmark.twig). */
function BookmarkForm({
  server,
  db,
  sql,
  allowShared,
}: { server: number; db: string; sql: string; allowShared: boolean }) {
  const bm = useBookmarks(server, db)
  const [label, setLabel] = useState('')
  const [shared, setShared] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  if (!bm.enabled) return null
  return (
    <form
      className="bookmarkQueryForm d-print-none disableAjax mb-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (label === '') {
          showMessage(t('Missing value in the form!'), false, 'error')
          ref.current?.focus()
          return
        }
        const r = await bookmarkApi.create(server, { label, db, sql, shared })
        showMessage(r.message, r.ok ? null : false, r.ok ? null : 'error')
        if (r.ok) {
          setLabel('')
          void bm.refetch()
        }
      }}
    >
      <Panel title={<IconText icon="b_bookmark" text={t('Bookmark this SQL query')} forceText />}>
        <PanelBody>
          <label className="mb-1 block" htmlFor="bookmarkLabelField">
            {t('Bookmark label:')}
          </label>
          <Input
            ref={ref}
            id="bookmarkLabelField"
            type="text"
            name="bkm_fields[bkm_label]"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          {allowShared && (
            <label className="mt-2 flex items-center gap-1">
              <input
                type="checkbox"
                role="switch"
                aria-checked={shared}
                id="bookmarkAllUsersCheckbox"
                name="bkm_all_users"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              {t('Let every user access this bookmark')}
            </label>
          )}
        </PanelBody>
        <div className="border-t border-border px-3 py-2">
          <Button type="submit">{t('Create new bookmark')}</Button>
        </div>
      </Panel>
    </form>
  )
}

/** The multi-row delete confirmation (table/delete/confirm.twig). */
function DeleteConfirm(props: {
  server: number
  table: string
  where: string[]
  onAnswer: (yes: boolean, fkChecks: boolean) => Promise<void>
}) {
  const [fk, setFk] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api.defaultFkCheck(props.server).then((r) => setFk((v) => v ?? r.defaultFkCheckValue))
  }, [props.server])
  const answer = async (yes: boolean) => {
    setBusy(true)
    try {
      await props.onAnswer(yes, fk === true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="container max-w-4xl">
      <Panel
        title={
          <span className="flex items-center gap-1">
            <PmaIcon name="s_really" />
            {t('Do you really want to execute the following query?')}
          </span>
        }
      >
        <PanelBody>
          <ul className="mb-3 list-disc ps-6">
            {props.where.map((w) => (
              <li key={w}>
                <code>
                  DELETE FROM `{props.table.replaceAll('`', '``')}` WHERE {w}
                  {';'}
                </code>
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              name="fk_checks"
              id="checkForeignKeyCheckbox"
              value="1"
              checked={fk === true}
              onChange={(e) => setFk(e.target.checked)}
            />
            {t('Enable foreign key checks')}
          </label>
        </PanelBody>
        <div className="flex gap-2 border-t border-border px-3 py-2">
          <Button
            id="buttonYes"
            variant="destructive"
            name="mult_btn"
            disabled={busy}
            onClick={() => void answer(true)}
          >
            {t('Yes')}
          </Button>
          <Button id="buttonNo" name="mult_btn" disabled={busy} onClick={() => void answer(false)}>
            {t('No')}
          </Button>
        </div>
      </Panel>
    </div>
  )
}
