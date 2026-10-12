import type { QueryRequest, QueryResponse, SimulateResponse, SqlFormResponse } from '@bettermyadmin/contracts'
import { backquote } from '@bettermyadmin/sql-gen'
import { DocLink, MessageBox, MySqlDocLink, Panel, buttonVariants, mysqlDocUrl } from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBlocker, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { Trans, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { type BookmarkEntry, bookmarks as bookmarkApi, useBookmarks } from '../bookmarks/provider'
import { takeFlash } from '../table/structure/flash'
import { type BookmarkAction, BookmarkedQuery } from './BookmarkedQuery'
import { HighlightedSql } from './HighlightedSql'
import { StatementBlock } from './Results'
import { SimulateModal } from './SimulateModal'
import { type CardAction, type CardEnv, InlineEditContext } from './SqlMessage'
import { SqlEditor } from './editor/SqlEditor'
import type { SqlEditorHandle } from './editor/types'
import {
  DO_YOU_REALLY,
  FORM_EMPTY,
  NO_PARAM,
  type SnippetType,
  autoSave,
  canSimulate,
  checkSqlQuery,
  confirmationText,
  getAutoSaved,
  insertValueText,
  rememberShowThisQuery,
  restoreShowThisQuery,
  scanParameters,
  snippetQuery,
} from './logic'
import { sqlTabRoute } from './routes'
import { newQueryId, runQuery, scopeKey, takePendingResults } from './runner'
import './sql.css'
import { usePagePrefs } from '../preferences/PageSettings.tsx'

export interface SqlPageProps {
  server: number
  db: string
  table: string
  /** `sql_query` + `show_query`: prefill without executing. */
  sql?: string | undefined
  /** With a signature the query in the URL is executed (signed /sql links: Simulate's matched rows). */
  sig?: string | undefined
}

/** Messages.strConfirmNavigation */
const CONFIRM_NAVIGATION = 'You have unsaved changes; are you sure you want to leave this page?'

/**
 * The SQL tab of the server, a database or a table.
 * pma: src/Controllers/{Server,Database,Table}/SqlController.php, src/SqlQueryForm.php,
 *      resources/templates/sql/query.twig, resources/js/sql.ts
 */
export function SqlPage(props: SqlPageProps) {
  const { server, db, table } = props
  // pma: Server|Database|Table SqlController: PageSettings::init('Sql')
  usePagePrefs(server, 'Sql')
  // the message of the action that came back here (Insert/Edit "Go back to previous page")
  const [flash] = useState(() => takeFlash())
  const form = useQuery({
    queryKey: qk.sqlForm(server, db, table, props.sql ?? ''),
    queryFn: () => api.sqlForm(server, { db, table, sqlQuery: props.sql }),
    staleTime: 0,
  })
  if (form.error instanceof ApiError) {
    return <MessageBox type="error" text={form.error.message} flush />
  }
  if (form.data === undefined) return <div className="text-sm text-fg-subtle">{t('Loading…')}</div>
  return (
    <>
      {flash.map((m, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: messages are positional
        <div key={i} className="mb-3 overflow-hidden rounded border border-border">
          <MessageBox type={m.type} text={m.text} />
          {m.sql !== undefined && m.sql !== '' && (
            <HighlightedSql sql={m.sql} className="bg-bg-inset px-3 py-2" />
          )}
        </div>
      ))}
      <SqlForm key={scopeKey(server, db, table) + (props.sql ?? '')} {...props} form={form.data} />
    </>
  )
}

function SqlForm({ server, db, table, sig, form }: SqlPageProps & { form: SqlFormResponse }) {
  const s = form.settings
  const navigate = useNavigate()
  const qc = useQueryClient()
  const editor = useRef<SqlEditorHandle>(null)
  const restored = useMemo(() => restoreShowThisQuery(db, table), [db, table])
  const initial = sig === undefined && restored.query !== null ? restored.query : form.query
  const [text, setText] = useState(initial)
  const [savedAvailable, setSavedAvailable] = useState(() => getAutoSaved(db, table) !== null)
  const [delimiter, setDelimiter] = useState(';')
  const [showQuery, setShowQuery] = useState(restored.checked)
  const [retain, setRetain] = useState(s.RetainQueryBox)
  const [rollback, setRollback] = useState(false)
  const [fkChecks, setFkChecks] = useState(form.fkChecks)
  const [parameterized, setParameterized] = useState(false)
  const [params, setParams] = useState<string[] | null>(null)
  const paramValues = useRef(new Map<string, string>())
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [formatting, setFormatting] = useState(false)
  const [boxHidden, setBoxHidden] = useState(false)
  const [toggleShown, setToggleShown] = useState(false)
  const [result, setResult] = useState<QueryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [simulate, setSimulate] = useState<SimulateResponse | null>(null)
  const [inlineOpen, setInlineOpen] = useState<string | null>(null)
  const [wantAutocomplete, setWantAutocomplete] = useState(false)
  const bookmarks = useBookmarks(server, db)
  const [bkmLabel, setBkmLabel] = useState('')
  const [bkmShared, setBkmShared] = useState(false)
  const [bkmReplace, setBkmReplace] = useState(false)

  const columnValues = form.columns.map((c) => backquote(c.field))

  // Autocomplete data: fetched once per page, on the first input (codeMirrorAutoCompleteOnInputRead)
  const autocompleteQuery = useQuery({
    queryKey: qk.autocomplete(server, db),
    queryFn: () => api.sqlAutocomplete(server, db),
    enabled: wantAutocomplete && s.CodemirrorEnable,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const autocomplete = useMemo(
    () =>
      autocompleteQuery.data !== undefined
        ? { tables: autocompleteQuery.data.tables, defaultTable: table }
        : null,
    [autocompleteQuery.data, table],
  )
  const lint = useMemo(
    () => (s.CodemirrorEnable && s.LintEnable ? { server: form.server } : null),
    [s, form.server],
  )

  // AJAX.lockPageHandler: a changed editor asks before leaving the page
  useBlocker({
    shouldBlockFn: () => editor.current?.isDirty() === true && !window.confirm(t(CONFIRM_NAVIGATION)),
    enableBeforeUnload: () => editor.current?.isDirty() === true,
  })

  const updateParameters = useCallback((enabled: boolean) => {
    // updateQueryParameters runs on the checkbox change and on editor blur
    setParams(enabled ? scanParameters(editor.current?.getValue() ?? '') : null)
  }, [])

  const confirmQuery = useCallback(
    (sql: string): boolean => {
      const check = checkSqlQuery(sql, s.Confirm)
      if (check === 'empty') {
        window.alert(t(FORM_EMPTY))
        editor.current?.focus()
        return false
      }
      if (check === 'confirm' && !window.confirm(confirmationText(sql, t(DO_YOU_REALLY)))) {
        window.focus()
        return false
      }
      return true
    },
    [s.Confirm],
  )

  const afterResponse = useCallback(
    (res: QueryResponse, fromForm: boolean) => {
      setResult(res)
      setError(null)
      if (res.ajaxReload?.reload === true) {
        if (res.ajaxReload.tableName !== undefined && table !== '') {
          void navigate(sqlTabRoute(server, db, res.ajaxReload.tableName) as never)
        } else {
          void qc.invalidateQueries({ queryKey: qk.srv(server), refetchType: 'active' })
        }
      } else if (res.reloadNavigation) {
        void qc.invalidateQueries({ queryKey: qk.srv(server), refetchType: 'active' })
      }
      setToggleShown(true)
      // the query box collapses unless "Retain query box" is checked
      if (fromForm && !retain) setBoxHidden(true)
      editor.current?.markClean()
    },
    [db, table, server, retain, navigate, qc],
  )

  const execute = useCallback(
    async (req: Omit<QueryRequest, 'fromQueryBox'> & { fromQueryBox?: boolean }, fromForm = false) => {
      const id = newQueryId()
      setRunning(id)
      setSimulate(null)
      try {
        const res = await runQuery(server, { fromQueryBox: true, grid: true, ...req }, 'page', id)
        afterResponse(res, fromForm)
        return res
      } catch (e) {
        setResult(null)
        setError(e instanceof Error ? e.message : String(e))
        return null
      } finally {
        setRunning(null)
      }
    },
    [server, afterResponse],
  )

  // signed query from the URL (Simulate's "Affected rows" link): executed like phpMyAdmin's /sql
  const ranSigned = useRef(false)
  useEffect(() => {
    if (sig === undefined || ranSigned.current) return
    ranSigned.current = true
    setBoxHidden(true)
    setToggleShown(true)
    void execute({ sql: form.query, db, table, sig })
  }, [sig, form.query, db, table, execute])

  // results produced by the console for this scope
  useEffect(() => {
    const pick = () => {
      const r = takePendingResults(scopeKey(server, db, table))
      if (r !== null) {
        setResult(r)
        setBoxHidden(true)
        setToggleShown(true)
      }
    }
    pick()
    window.addEventListener('bma:pending-results', pick)
    return () => window.removeEventListener('bma:pending-results', pick)
  }, [server, db, table])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const sql = editor.current?.getValue() ?? ''
    // "Show this query here again"
    rememberShowThisQuery(showQuery, db, table, sql)
    if (!confirmQuery(sql)) return
    setFlash(null)
    const req: Parameters<typeof execute>[0] = { sql, db, table, delimiter, fkChecks }
    if (rollback) req.rollback = true
    if (parameterized) {
      const p: Record<string, string> = {}
      for (const name of params ?? scanParameters(sql)) p[name] = paramValues.current.get(name) ?? ''
      req.params = p
    }
    // bkm_label: the server stores one bookmark for the whole text (ImportController::__invoke)
    const withBookmark = bkmLabel !== '' && bookmarks.enabled
    if (withBookmark) req.bookmark = { label: bkmLabel, shared: bkmShared, replace: bkmReplace }
    void execute(req, true).then(() => {
      if (withBookmark) void bookmarks.refetch()
    })
  }

  /** id_bookmark + action_bookmark (ImportController::__invoke) */
  const onBookmark = async (b: BookmarkEntry, action: BookmarkAction, variables: Record<number, string>) => {
    setFlash(null)
    try {
      if (action === 'view') {
        // action_bookmark=1: "Showing bookmark" and the query in the box
        const r = await bookmarkApi.show(server, b.id)
        setQuery(r.bookmark.query)
        setResult(null)
        setFlash(r.message.text)
        return
      }
      if (action === 'delete') {
        const r = await bookmarkApi.remove(server, b.id)
        setResult(null)
        setFlash(r.message !== '' ? r.message : t('The bookmark has been deleted.'))
        void bookmarks.refetch()
        return
      }
      // action_bookmark=0: the bookmark (with its variables) runs through the SQL-box pipeline
      setRunning('bookmark')
      afterResponse(await bookmarkApi.run(server, b.id, { db, table, variables }), true)
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(null)
    }
  }

  const onCardAction = (a: CardAction) => {
    if (a.type === 'edit') {
      void navigate({ ...sqlTabRoute(server, a.db, a.table), search: { sql: a.sql } } as never)
      return
    }
    const req: Parameters<typeof execute>[0] = { sql: a.sql, db: a.db, table: a.table }
    if (a.showAsPhp !== undefined) req.showAsPhp = a.showAsPhp
    if (a.profiling !== undefined) req.profiling = a.profiling
    if (a.sig !== undefined) req.sig = a.sig
    if (a.fkChecks !== undefined) req.fkChecks = a.fkChecks
    void execute(req)
  }

  const env: CardEnv = {
    server,
    versionInt: form.server.versionInt,
    confirmQuery,
    codemirror: s.CodemirrorEnable,
    onAction: onCardAction,
  }

  const setQuery = (q: string) => {
    editor.current?.setValue(q)
    editor.current?.focus()
  }

  const snippet = (type: SnippetType) => {
    const q = snippetQuery(type, table, columnValues)
    if (q !== null) setQuery(q)
  }

  const format = async (singleLine: boolean) => {
    setFormatting(true)
    try {
      const r = await api.sqlFormat(server, editor.current?.getValue() ?? '', singleLine)
      editor.current?.setValue(r.sql)
    } finally {
      setFormatting(false)
    }
  }

  const onSimulate = async () => {
    const q = editor.current?.getValue() ?? ''
    if (q.length === 0) {
      window.alert(t(FORM_EMPTY))
      editor.current?.focus()
      return
    }
    setSimulate(await api.simulate(server, { sql: q, db, delimiter }))
  }

  const btn = buttonVariants()
  const legend =
    // SqlQueryForm::init: the msgid, then ': ' and the documentation link
    form.scope === 'server' ? (
      <Trans id="Run SQL query/queries on server “%s”" args={[form.legendName]} />
    ) : form.scope === 'database' ? (
      <Trans
        id="Run SQL query/queries on database %s"
        args={[
          <Link key="db" to="/s/$server/db/$db/sql" params={{ server, db }} className="text-accent">
            {db}
          </Link>,
        ]}
      />
    ) : (
      <Trans
        id="Run SQL query/queries on table %s"
        args={[
          <Link
            key="table"
            to="/s/$server/db/$db/t/$table/sql"
            params={{ server, db, table }}
            className="text-accent"
          >
            {form.legendName}
          </Link>,
        ]}
      />
    )

  return (
    <InlineEditContext.Provider value={{ open: inlineOpen, setOpen: setInlineOpen }}>
      <form
        id="sqlqueryform"
        name="sqlform"
        onSubmit={submit}
        onKeyUp={() => setText(editor.current?.getValue() ?? '')}
        className="mb-4 max-w-6xl"
      >
        {!boxHidden && (
          <Panel
            title={
              <>
                <span>{legend}:</span>
                <MySqlDocLink url={mysqlDocUrl('SELECT', '', form.server.versionInt)} />
              </>
            }
          >
            <div className="p-3">
              <div className="flex gap-3">
                <div className="min-w-0 flex-1">
                  <SqlEditor
                    handleRef={editor}
                    id="sqlquery"
                    ariaLabel={t('SQL query')}
                    initialValue={initial}
                    rows={s.TextareaRows}
                    cols={s.TextareaCols}
                    codemirror={s.CodemirrorEnable}
                    lint={lint}
                    autocomplete={autocomplete}
                    autoSelect={s.TextareaAutoSelect}
                    onSubmit={() => submit()}
                    onChange={(v) => {
                      setText(v)
                      // Sql.autoSave on every change
                      autoSave(db, table, v)
                      if (v !== '') setSavedAvailable(true)
                      if (!wantAutocomplete && db !== '') setWantAutocomplete(true)
                    }}
                    onBlur={() => updateParameters(parameterized)}
                  />
                  <div id="querymessage" className="min-h-5 text-xs text-fg-subtle" aria-live="polite">
                    {formatting && t('Formatting SQL…')}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2" role="toolbar">
                    {form.columns.length > 0 && (
                      <div className="flex gap-1" role="group">
                        <button
                          type="button"
                          id="selectall"
                          className={btn}
                          onClick={() => snippet('selectall')}
                        >
                          SELECT *
                        </button>
                        <button type="button" id="select" className={btn} onClick={() => snippet('select')}>
                          SELECT
                        </button>
                        <button type="button" id="insert" className={btn} onClick={() => snippet('insert')}>
                          INSERT
                        </button>
                        <button type="button" id="update" className={btn} onClick={() => snippet('update')}>
                          UPDATE
                        </button>
                        <button type="button" id="delete" className={btn} onClick={() => snippet('delete')}>
                          DELETE
                        </button>
                      </div>
                    )}
                    <div className="flex gap-1" role="group">
                      <button type="button" id="clear" className={btn} onClick={() => setQuery('')}>
                        {t('Clear')}
                      </button>
                      {s.CodemirrorEnable && (
                        <>
                          <button
                            type="button"
                            id="format"
                            className={btn}
                            onClick={() => void format(false)}
                          >
                            {t('Format')}
                          </button>
                          <button
                            type="button"
                            id="formatSingleLine"
                            className={btn}
                            onClick={() => void format(true)}
                          >
                            {t('Format as a single line')}
                          </button>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      id="saved"
                      className={btn}
                      disabled={!savedAvailable}
                      onClick={() => {
                        const q = getAutoSaved(db, table)
                        if (q !== null) setQuery(q)
                      }}
                    >
                      {t('Get auto-saved query')}
                    </button>
                  </div>
                  <div className="my-3 flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      id="parameterized"
                      name="parameterized"
                      checked={parameterized}
                      onChange={(e) => {
                        setParameterized(e.target.checked)
                        updateParameters(e.target.checked)
                      }}
                    />
                    <label htmlFor="parameterized">{t('Bind parameters')}</label>
                    <DocLink page="faq" anchor="faq6-40" />
                  </div>
                  {params !== null && (
                    <div className="mb-3 flex flex-wrap gap-3 text-sm" id="parametersDiv">
                      {params.length === 0
                        ? t(NO_PARAM)
                        : params.map((p) => (
                            <span
                              key={p}
                              className="parameter flex items-center gap-1"
                              id={`paramSpan_${p.slice(1)}`}
                            >
                              <label htmlFor={`param_${p.slice(1)}`}>{p}</label>
                              <input
                                type="text"
                                className="input w-32"
                                id={`param_${p.slice(1)}`}
                                name={`parameters[${p}]`}
                                defaultValue={paramValues.current.get(p) ?? ''}
                                onChange={(e) => paramValues.current.set(p, e.target.value)}
                              />
                            </span>
                          ))}
                    </div>
                  )}
                </div>
                {form.columns.length > 0 && (
                  <div className="flex w-48 shrink-0 flex-col gap-2">
                    <label className="sr-only" htmlFor="fieldsSelect">
                      {t('Columns')}
                    </label>
                    <select
                      id="fieldsSelect"
                      name="dummy"
                      multiple
                      size={s.TextareaRows}
                      className="input resize-y"
                      value={selectedColumns}
                      onChange={(e) => setSelectedColumns([...e.target.selectedOptions].map((o) => o.value))}
                      onDoubleClick={() => editor.current?.replaceSelection(insertValueText(selectedColumns))}
                    >
                      {form.columns.map((c, i) => (
                        <option
                          key={c.field}
                          value={columnValues[i]}
                          title={c.field.length > 0 ? c.comment : undefined}
                        >
                          {c.field}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      id="insertBtn"
                      name="insert"
                      className={btn}
                      title={s.ActionLinksMode !== 'text' ? t('Insert') : undefined}
                      onClick={() => {
                        editor.current?.replaceSelection(insertValueText(selectedColumns))
                        editor.current?.focus()
                      }}
                    >
                      {s.ActionLinksMode !== 'text' ? '<<' : t('Insert')}
                    </button>
                  </div>
                )}
              </div>
              {bookmarks.enabled && (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label htmlFor="bkm_label">{t('Bookmark this SQL query:')}</label>
                  <input
                    id="bkm_label"
                    name="bkm_label"
                    className="input w-48"
                    value={bkmLabel}
                    onChange={(e) => setBkmLabel(e.target.value)}
                  />
                  {/* the two options show only once a label is typed */}
                  {bkmLabel.length > 0 && s.AllowSharedBookmarks && (
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        name="bkm_all_users"
                        value="true"
                        id="id_bkm_all_users"
                        checked={bkmShared}
                        onChange={(e) => setBkmShared(e.target.checked)}
                      />
                      {t('Let every user access this bookmark')}
                    </label>
                  )}
                  {bkmLabel.length > 0 && (
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        name="bkm_replace"
                        value="true"
                        id="id_bkm_replace"
                        checked={bkmReplace}
                        onChange={(e) => setBkmReplace(e.target.checked)}
                      />
                      {t('Replace existing bookmark of same name')}
                    </label>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-bg-subtle px-3 py-2 text-sm">
              <label className="flex items-center gap-1">
                <span>{t('Delimiter')}</span>
                <input
                  id="id_sql_delimiter"
                  name="sql_delimiter"
                  className="input w-12"
                  size={3}
                  value={delimiter}
                  onChange={(e) => setDelimiter(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  id="checkbox_show_query"
                  name="show_query"
                  checked={showQuery}
                  onChange={(e) => setShowQuery(e.target.checked)}
                />
                {t('Show this query here again')}
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  id="retain_query_box"
                  name="retain_query_box"
                  checked={retain}
                  onChange={(e) => setRetain(e.target.checked)}
                />
                {t('Retain query box')}
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  id="rollback_query"
                  name="rollback_query"
                  checked={rollback}
                  onChange={(e) => setRollback(e.target.checked)}
                />
                {t('Rollback when finished')}
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  id="fk_checks"
                  name="fk_checks"
                  checked={fkChecks}
                  onChange={(e) => setFkChecks(e.target.checked)}
                />
                {t('Enable foreign key checks')}
              </label>
              <div className="ml-auto flex items-center gap-2">
                {canSimulate(text) && (
                  <button
                    type="button"
                    id="simulate_dml"
                    className={buttonVariants({ variant: 'primary' })}
                    onClick={() => void onSimulate()}
                  >
                    {t('Simulate query')}
                  </button>
                )}
                {running !== null && (
                  <button type="button" className={btn} onClick={() => void api.cancelQuery(server, running)}>
                    {t('Cancel')}
                  </button>
                )}
                <input
                  id="button_submit_query"
                  type="submit"
                  name="SQL"
                  value={t('Go')}
                  disabled={running !== null}
                  className={buttonVariants({ variant: 'primary' })}
                />
              </div>
            </div>
          </Panel>
        )}
        {!boxHidden && bookmarks.enabled && bookmarks.bookmarks.length > 0 && (
          <BookmarkedQuery bookmarks={bookmarks.bookmarks} onGo={(b, a, v) => void onBookmark(b, a, v)} />
        )}
        {toggleShown && (
          <>
            {boxHidden && <br id="togglequerybox_spacer" />}
            <button
              type="button"
              id="togglequerybox"
              className={buttonVariants()}
              onClick={() => setBoxHidden((h) => !h)}
            >
              {boxHidden ? t('Show query box') : t('Hide query box')}
            </button>
          </>
        )}
      </form>

      <div id="sqlqueryresultsouter" className="max-w-full">
        {flash !== null && <MessageBox type="success" text={flash} />}
        {error !== null && <MessageBox type="error" text={error} />}
        {result?.statements.map((st, i) => (
          <StatementBlock key={`${i}-${st.sig}`} st={st} env={env} />
        ))}
      </div>

      {simulate !== null && (
        <SimulateModal
          data={simulate}
          versionInt={form.server.versionInt}
          onClose={() => setSimulate(null)}
          onShowRows={(sql, rowsSig) =>
            void navigate({ ...sqlTabRoute(server, db, ''), search: { sql, sig: rowsSig } } as never)
          }
        />
      )}
    </InlineEditContext.Provider>
  )
}
