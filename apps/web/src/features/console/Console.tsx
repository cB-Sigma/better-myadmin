import type { ConsoleSettings, Executed, QueryResponse } from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n/php'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { SquareTerminal } from 'lucide-react'
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { ngettext, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { type BookmarkEntry, bookmarks as bookmarkApi, useBookmarks } from '../bookmarks/provider'
import { HighlightedSql } from '../sql/HighlightedSql'
import { SqlEditor } from '../sql/editor/SqlEditor'
import type { SqlEditorHandle } from '../sql/editor/types'
import {
  CONSOLE_DELETE_BOOKMARK_CONFIRM,
  CONSOLE_REQUERY_CONFIRM,
  DO_YOU_REALLY,
  FORM_EMPTY,
  confirmationText,
  needsConfirmation,
} from '../sql/logic'
import { sqlTabRoute } from '../sql/routes'
import { newQueryId, onQueryEvent, runQuery, scopeKey, setPendingResults } from '../sql/runner'
import '../sql/sql.css'
import { CONSOLE_TOGGLE_EVENT } from '../shell/hotkeys/useShortcuts'
import { CONSOLE_DEFAULTS, normaliseMode, saveConsoleSetting } from './config'
import { consoleHistory } from './history'

/** One entry of the message list (div.message in console/display.twig). */
export interface ConsoleMessage {
  id: string
  sql: string
  db: string
  table: string
  state: 'pending' | 'successed' | 'failed' | null
  /** history rows rendered at start */
  history: boolean
  hidden: boolean
  expanded: boolean
  /** "Queried time": H:M:S of the run, the stored timevalue or "During current session" */
  time: string
}

/** Console.isSelect */
const isSelect = (q: string) => /^SELECT\s+/i.test(q)

/** now.getHours() + ':' + now.getMinutes() + ':' + now.getSeconds() (not zero padded) */
const clock = () => {
  const d = new Date()
  return `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`
}

/** db / table of the page (CommonParams db / table). */
function useScope(server: number) {
  const { pathname } = useLocation()
  return useMemo(() => {
    const m = new RegExp(`^/s/${server}/db/([^/]+)(?:/t/([^/]+))?`).exec(pathname)
    return {
      db: m?.[1] !== undefined ? decodeURIComponent(m[1]) : '',
      table: m?.[2] !== undefined ? decodeURIComponent(m[2]) : '',
    }
  }, [pathname, server])
}

/**
 * The SQL query console docked at the bottom of every page.
 * pma: resources/templates/console/display.twig, resources/js/modules/console.ts, src/Console/Console.php
 */
export default function Console({ server }: { server: number }) {
  const remote = useQuery({ queryKey: qk.consoleConfig(server), queryFn: () => api.consoleConfig(server) })
  if (remote.data === undefined) return null
  return (
    <ConsoleDock
      server={server}
      initial={{ ...CONSOLE_DEFAULTS, ...remote.data.settings }}
      debugSql={remote.data.debugSql}
      confirm={remote.data.confirm}
    />
  )
}

function ConsoleDock({
  server,
  initial,
  debugSql,
  confirm,
}: { server: number; initial: ConsoleSettings; debugSql: boolean; confirm: boolean }) {
  const [settings, setSettings] = useState(initial)
  const mode0 = normaliseMode(initial.Mode)
  const [open, setOpen] = useState(mode0 === 'show')
  const [height, setHeight] = useState(Math.max(92, initial.Height))
  const [messages, setMessages] = useState<ConsoleMessage[]>([])
  const [card, setCard] = useState<'options' | 'bookmarks' | 'debug' | null>(null)
  const [debugLog, setDebugLog] = useState<Executed[] | null>(null)
  const [addBookmark, setAddBookmark] = useState<{
    label: string
    db: string
    sql: string
    shared: boolean
  } | null>(null)
  const scope = useScope(server)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const input = useRef<SqlEditorHandle>(null)
  const historyCount = useRef(0)
  const historyPreserveCurrent = useRef('')
  const bookmarks = useBookmarks(server)

  const set = useCallback(
    <K extends keyof ConsoleSettings>(key: K, value: ConsoleSettings[K]) => {
      setSettings((s) => ({ ...s, [key]: value }))
      void saveConsoleSetting(server, key, value)
    },
    [server],
  )

  // history rows rendered at start, hidden unless "Show query history at start"
  useEffect(() => {
    let alive = true
    void consoleHistory(server)
      .then((entries) => {
        if (!alive) return
        const rows = [...entries].reverse().map(
          (h, i): ConsoleMessage => ({
            id: `h${i}`,
            sql: h.sqlquery,
            db: h.db,
            table: h.table,
            state: null,
            history: true,
            hidden: !initial.StartHistory,
            expanded: false,
            time: h.timevalue ?? t('During current session'),
          }),
        )
        setMessages((m) => [...rows, ...m])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [server, initial.StartHistory])

  const append = useCallback(
    (m: Omit<ConsoleMessage, 'expanded' | 'time' | 'history'> & { history?: boolean }) =>
      setMessages((list) => [
        ...list,
        { history: false, expanded: settings.AlwaysExpand, time: clock(), ...m },
      ]),
    [settings.AlwaysExpand],
  )

  // queries of the page (reloadQuerywindow), hidden unless "Show current browsing query"
  useEffect(
    () =>
      onQueryEvent((e) => {
        if (e.server !== server || e.source !== 'page' || e.phase !== 'done' || e.response === undefined)
          return
        if (e.response.executed.length > 0) setDebugLog(e.response.executed)
        if (e.response.sqlQuery.length === 0) return
        append({
          id: e.id,
          sql: e.response.sqlQuery,
          db: e.response.db ?? '',
          table: e.response.table ?? '',
          state: 'successed',
          hidden: !settings.CurrentQuery,
        })
      }),
    [server, append, settings.CurrentQuery],
  )

  const show = useCallback(
    (focus = false) => {
      setOpen(true)
      set('Mode', 'show')
      if (focus) setTimeout(() => input.current?.focus(), 0)
    },
    [set],
  )
  const collapse = useCallback(() => {
    setOpen(false)
    set('Mode', 'collapse')
    setCard(null)
  }, [set])
  const openRef = useRef(open)
  openRef.current = open
  const toggle = useCallback(() => {
    if (openRef.current) {
      openRef.current = false
      collapse()
    } else {
      openRef.current = true
      show(true)
    }
  }, [collapse, show])
  const toggleRef = useRef(toggle)
  toggleRef.current = toggle

  // Console.toggle: the shell's shortcut layer (the single source of key bindings, shortcuts_handler.ts)
  // and other modules send `bma:console-toggle`; phpMyAdmin's Ctrl+K outside form fields toggles
  // twice in a row (Q45), so each toggle reads the state left by the previous one
  useEffect(() => {
    const onToggle = () => toggleRef.current()
    window.addEventListener(CONSOLE_TOGGLE_EVENT, onToggle)
    return () => window.removeEventListener(CONSOLE_TOGGLE_EVENT, onToggle)
  }, [])

  /** Console.execute */
  const execute = useCallback(
    (sql: string, opts: { db?: string; table?: string; profiling?: boolean } = {}) => {
      // requires at least one letter
      if (!/[a-z]|[A-Z]/.test(sql)) return
      if (confirm && needsConfirmation(sql) && !window.confirm(confirmationText(sql, t(DO_YOU_REALLY))))
        return
      const db = opts.db ?? scope.db
      const table = opts.table ?? scope.table
      const id = newQueryId()
      append({ id, sql, db, table, state: 'pending', hidden: false })
      input.current?.setValue('')
      historyCount.current = 0
      const update = (res: QueryResponse | null) => {
        const success = res !== null && !res.statements.some((s) => s.error !== undefined)
        setMessages((list) =>
          list.map((m) =>
            m.id !== id
              ? m
              : success && res !== null
                ? { ...m, state: 'successed', sql: res.sqlQuery, db: res.db ?? '', table: res.table ?? '' }
                : { ...m, state: 'failed' },
          ),
        )
      }
      void runQuery(
        server,
        { sql, db, table, fromQueryBox: true, ...(opts.profiling === true ? { profiling: true } : {}) },
        'console',
        id,
      )
        .then((res) => {
          update(res)
          if (res.executed.length > 0) setDebugLog(res.executed)
          // the response becomes the main panel's content
          setPendingResults(scopeKey(server, db, table), res)
          void navigate(sqlTabRoute(server, db, table) as never)
        })
        .catch(() => update(null))
      // Navigation.reload()
      void qc.invalidateQueries({ queryKey: qk.srv(server), refetchType: 'active' })
    },
    [server, scope, confirm, append, navigate, qc],
  )

  /** ConsoleMessages.getHistory: the nth last `.query` text */
  const getHistory = (nthLast: number): string | false => {
    const queries = messages.map((m) => m.sql)
    const i = queries.length - nthLast
    return i < 0 ? false : (queries[i] ?? false)
  }
  const historyNavigate = (up: boolean): boolean => {
    const ed = input.current
    if (ed === null) return false
    let nextCount: number
    let query: string | false = false
    if (up) {
      if (!ed.cursorOnFirstLine()) return false
      if (historyCount.current === 0) historyPreserveCurrent.current = ed.getValue()
      nextCount = historyCount.current + 1
      query = getHistory(nextCount)
    } else {
      if (!ed.cursorOnLastLine() || historyCount.current === 0) return false
      nextCount = historyCount.current - 1
      query = nextCount === 0 ? historyPreserveCurrent.current : getHistory(nextCount)
    }
    if (query === false) return false
    historyCount.current = nextCount
    ed.setValue(query)
    return true
  }

  const clearMessages = () =>
    // hides all but the welcome line, removes failed ones, collapses expanded ones
    setMessages((list) =>
      list.filter((m) => m.state !== 'failed').map((m) => ({ ...m, hidden: true, expanded: false })),
    )

  const run = (fn: () => void) => () => {
    fn()
    return true
  }
  const executeInput = run(() => execute(input.current?.getValue() ?? ''))
  const keys = [
    ...(settings.EnterExecutes
      ? [
          { key: 'Enter', run: executeInput },
          { key: 'Shift-Enter', run: () => false },
        ]
      : [{ key: 'Ctrl-Enter', run: executeInput }]),
    { key: 'Ctrl-l', run: run(() => input.current?.setValue('')) },
    { key: 'Ctrl-u', run: run(clearMessages) },
    { key: 'ArrowUp', run: () => historyNavigate(true) },
    { key: 'ArrowDown', run: () => historyNavigate(false) },
  ]

  // ConsoleResizer: drag the toolbar in show mode
  const onToolbarMouseDown = (e: ReactMouseEvent) => {
    if (!open || (e.target as HTMLElement).closest('button') !== null) return
    const startY = e.pageY
    const startH = height
    let h = startH
    const move = (ev: MouseEvent) => {
      if (ev.pageY < 35) return
      h = startH + (startY - ev.pageY)
      setHeight(Math.max(32, h))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      set('Height', Math.max(1, Math.round(h)))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const shownHeight = open ? Math.min(Math.max(92, height), window.innerHeight - 25) : undefined
  const tb = 'rounded px-2 py-0.5 hover:bg-nav-pointer'

  return (
    <div
      id="pma_console_container"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 print:hidden"
    >
      <div
        id="pma_console"
        className="pointer-events-auto relative border-t border-border-strong bg-bg-elevated text-sm shadow"
      >
        <div
          className={`toolbar group flex items-center gap-1 bg-bg-subtle px-2 py-1 ${open ? 'cursor-n-resize' : 'collapsed'}`}
          onMouseDown={onToolbarMouseDown}
          role="toolbar"
          aria-label={t('SQL Query Console')}
        >
          <button
            type="button"
            className={`console_switch flex items-center gap-1 ${tb}`}
            onClick={toggle}
            aria-expanded={open}
          >
            <SquareTerminal className="size-4" aria-hidden />
            <span>{t('Console')}</span>
          </button>
          <div className={`${open ? 'flex' : 'hidden group-hover:flex'} items-center gap-1`}>
            <button type="button" className={`clear ${tb}`} onClick={clearMessages}>
              {t('Clear')}
            </button>
            <button
              type="button"
              className={`history ${tb}`}
              onClick={() => {
                setMessages((list) => list.map((m) => ({ ...m, hidden: false })))
                if (!open) show()
              }}
            >
              {t('History')}
            </button>
            <button
              type="button"
              className={`options ${tb}`}
              onClick={() => {
                if (!open) show()
                setCard('options')
              }}
            >
              {t('Options')}
            </button>
            {bookmarks.enabled && (
              <button
                type="button"
                className={`bookmarks ${tb}`}
                onClick={() => {
                  if (!open) show()
                  setCard('bookmarks')
                }}
              >
                {t('Bookmarks')}
              </button>
            )}
            {debugSql && debugLog !== null && (
              <button
                type="button"
                className={`debug ${tb}`}
                onClick={() => {
                  if (!open) show()
                  setCard('debug')
                }}
              >
                {t('Debug SQL')}
              </button>
            )}
          </div>
        </div>

        {open && (
          <div className="relative overflow-hidden" style={{ height: (shownHeight ?? 92) - 30 }}>
            <div
              className={`content flex h-full flex-col ${settings.DarkTheme ? 'console_dark_theme' : ''}`}
              onClick={(e) => {
                if (e.target === e.currentTarget) input.current?.focus()
              }}
              onKeyDown={() => {}}
            >
              <div
                className="console_message_container min-h-0 flex-1 overflow-auto px-2 py-1"
                data-testid="console-messages"
              >
                <div className="message welcome text-fg-subtle">
                  {settings.EnterExecutes
                    ? t('Press Enter to execute query')
                    : t('Press Ctrl+Enter to execute query')}
                </div>
                {messages.map((m) => (
                  <MessageEntry
                    key={m.id}
                    m={m}
                    bookmarkFeature={bookmarks.enabled}
                    onToggle={(expanded) =>
                      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, expanded } : x)))
                    }
                    onRequery={() => {
                      if (window.confirm(`${t(CONSOLE_REQUERY_CONFIRM)}\n${m.sql.substring(0, 100)}`)) {
                        execute(m.sql, { db: m.db, table: m.table })
                      }
                    }}
                    onEdit={() => {
                      input.current?.setValue(m.sql)
                      input.current?.focus()
                    }}
                    onExplain={() => execute(`EXPLAIN ${m.sql}`, { db: m.db, table: m.table })}
                    onProfiling={() => execute(m.sql, { db: m.db, table: m.table, profiling: true })}
                    onBookmark={() => {
                      setAddBookmark({ label: '', db: m.db, sql: m.sql, shared: false })
                      setCard('bookmarks')
                    }}
                  />
                ))}
              </div>
              <div className="query_input border-t border-border">
                <SqlEditor
                  handleRef={input}
                  ariaLabel={t('SQL Query Console')}
                  initialValue=""
                  rows={2}
                  height={56}
                  codemirror
                  lint={null}
                  autocomplete={null}
                  keys={keys}
                  dark={settings.DarkTheme}
                  className="console_query_input rounded-none border-0"
                />
              </div>
            </div>
            {card !== null && (
              <>
                <button
                  type="button"
                  aria-label={t('Close')}
                  className="mid_layer absolute inset-0 bg-black/15"
                  onClick={() => setCard(null)}
                />
                <div className="card absolute inset-y-0 right-0 left-[6%] overflow-auto border-l border-border bg-bg-elevated">
                  {card === 'options' && <OptionsCard settings={settings} set={set} />}
                  {card === 'bookmarks' && (
                    <BookmarksCard
                      server={server}
                      list={bookmarks.bookmarks}
                      refetch={() => void bookmarks.refetch()}
                      add={addBookmark}
                      setAdd={setAddBookmark}
                      onRequery={(b) => execute(b.query, { db: b.db })}
                      onClose={() => setCard(null)}
                    />
                  )}
                  {card === 'debug' && debugLog !== null && (
                    <DebugCard log={debugLog} settings={settings} set={set} />
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function MessageEntry({
  m,
  bookmarkFeature,
  onToggle,
  onRequery,
  onEdit,
  onExplain,
  onProfiling,
  onBookmark,
}: {
  m: ConsoleMessage
  bookmarkFeature: boolean
  onToggle: (expanded: boolean) => void
  onRequery: () => void
  onEdit: () => void
  onExplain: () => void
  onProfiling: () => void
  onBookmark: () => void
}) {
  if (m.hidden) return null
  const select = isSelect(m.sql)
  const reusable = m.history || m.state === 'successed'
  const action = 'action cursor-pointer text-accent hover:underline'
  const glyph = m.state === 'pending' ? '>' : m.state === 'failed' ? '=' : '>'
  return (
    <div
      className={`message group relative border-b border-border/50 py-0.5 ${m.expanded ? 'expanded' : 'collapsed'} ${m.history ? 'history' : ''} ${m.state ?? ''} ${select ? 'select' : ''}`}
      data-msgid={m.id}
      data-state={m.state ?? 'history'}
    >
      <div
        className={`action_content flex flex-wrap gap-x-3 text-xs ${m.expanded ? '' : 'absolute bottom-full left-0 z-10 hidden rounded border border-border bg-bg-subtle px-2 group-hover:flex'}`}
      >
        {m.expanded ? (
          <button type="button" className={action} onClick={() => onToggle(false)}>
            {t('Collapse')}
          </button>
        ) : (
          <button type="button" className={action} onClick={() => onToggle(true)}>
            {t('Expand')}
          </button>
        )}
        {reusable && (
          <button type="button" className={action} onClick={onRequery}>
            {t('Requery')}
          </button>
        )}
        <button type="button" className={action} onClick={onEdit}>
          {t('Edit')}
        </button>
        {select && (
          <>
            <button type="button" className={action} onClick={onExplain}>
              {t('Explain')}
            </button>
            <button type="button" className={action} onClick={onProfiling}>
              {t('Profiling')}
            </button>
          </>
        )}
        {bookmarkFeature && reusable && (
          <button type="button" className={action} onClick={onBookmark}>
            {t('Bookmark')}
          </button>
        )}
        {m.state === 'failed' && <span className="text failed text-error">{t('Query failed')}</span>}
        {reusable && (
          <span className="text targetdb">
            {t('Database')}: <span>{m.db}</span>
          </span>
        )}
        {m.state !== 'failed' && (
          <span className="text query_time">
            {t('Queried time')}: <span>{m.time}</span>
          </span>
        )}
      </div>
      <div
        className={`flex gap-1 ${m.state === 'pending' ? 'opacity-50' : ''} ${m.state === 'failed' ? 'text-error' : ''}`}
      >
        <span aria-hidden>{glyph}</span>
        <HighlightedSql
          sql={m.sql}
          className={`query min-w-0 ${m.expanded ? 'whitespace-pre-wrap' : 'truncate whitespace-nowrap'}`}
        />
      </div>
    </div>
  )
}

function OptionsCard({
  settings,
  set,
}: {
  settings: ConsoleSettings
  set: <K extends keyof ConsoleSettings>(k: K, v: ConsoleSettings[K]) => void
}) {
  const sw = (
    key: 'AlwaysExpand' | 'StartHistory' | 'CurrentQuery' | 'EnterExecutes' | 'DarkTheme',
    label: string,
  ) => (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        role="switch"
        aria-checked={settings[key]}
        id={`consoleOptions${key}Checkbox`}
        checked={settings[key]}
        onChange={(e) => set(key, e.target.checked)}
      />
      {t(label)}
    </label>
  )
  return (
    <div id="pma_console_options">
      <div className="toolbar flex items-center gap-3 border-b border-border bg-bg-subtle px-2 py-1">
        <span className="font-semibold">{t('Options')}</span>
        <button
          type="button"
          className="default rounded px-2 hover:bg-nav-pointer"
          onClick={() => {
            // one request per changed key
            const defaults = {
              AlwaysExpand: false,
              StartHistory: false,
              CurrentQuery: true,
              EnterExecutes: false,
              DarkTheme: false,
            } as const
            for (const [k, v] of Object.entries(defaults) as Array<[keyof typeof defaults, boolean]>) {
              if (settings[k] !== v) set(k, v)
            }
          }}
        >
          {t('Restore default values')}
        </button>
      </div>
      <div className="content flex flex-col gap-1 p-3">
        {sw('AlwaysExpand', 'Always expand query messages')}
        {sw('StartHistory', 'Show query history at start')}
        {sw('CurrentQuery', 'Show current browsing query')}
        {sw(
          'EnterExecutes',
          'Execute queries on Enter and insert new line with Shift+Enter. To make this permanent, view settings.',
        )}
        {sw('DarkTheme', 'Switch to dark theme')}
      </div>
    </div>
  )
}

function BookmarksCard({
  server,
  list,
  refetch,
  add,
  setAdd,
  onRequery,
  onClose,
}: {
  server: number
  list: BookmarkEntry[]
  refetch: () => void
  add: { label: string; db: string; sql: string; shared: boolean } | null
  setAdd: (a: { label: string; db: string; sql: string; shared: boolean } | null) => void
  onRequery: (b: BookmarkEntry) => void
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const action = 'cursor-pointer text-accent hover:underline'
  return (
    <div id="pma_bookmarks" className="relative h-full">
      <div className="toolbar flex items-center gap-3 border-b border-border bg-bg-subtle px-2 py-1">
        <button type="button" className="font-semibold" onClick={onClose}>
          {t('Bookmarks')}
        </button>
        <button type="button" className="refresh rounded px-2 hover:bg-nav-pointer" onClick={refetch}>
          {t('Refresh')}
        </button>
        <button
          type="button"
          className="add rounded px-2 hover:bg-nav-pointer"
          onClick={() => setAdd({ label: '', db: '', sql: '', shared: false })}
        >
          {t('Add')}
        </button>
      </div>
      <div className="content bookmark p-2">
        <div className="message welcome">
          {list.length === 0
            ? t('No bookmarks')
            : sprintf(
                ngettext(
                  'Showing %1$d bookmark (both private and shared)',
                  'Showing %1$d bookmarks (both private and shared)',
                  list.length,
                ),
                list.length,
              )}
        </div>
        {list.map((b) => {
          const isOpen = expanded.has(b.id)
          return (
            <div
              key={b.id}
              className="message bookmark border-b border-border/50 py-1"
              data-bookmarkid={b.id}
            >
              <div className="flex flex-wrap gap-x-3 text-xs">
                <button
                  type="button"
                  className={action}
                  onClick={() =>
                    setExpanded((s) => {
                      const n = new Set(s)
                      if (isOpen) n.delete(b.id)
                      else n.add(b.id)
                      return n
                    })
                  }
                >
                  {isOpen ? t('Collapse') : t('Expand')}
                </button>
                <button type="button" className={action} onClick={() => onRequery(b)}>
                  {t('Requery')}
                </button>
                <button
                  type="button"
                  className={action}
                  onClick={() => setAdd({ label: b.label, db: b.db, sql: b.query, shared: b.shared })}
                >
                  {t('Edit')}
                </button>
                <button
                  type="button"
                  className={action}
                  onClick={async () => {
                    if (!window.confirm(`${t(CONSOLE_DELETE_BOOKMARK_CONFIRM)}\n${b.label}`)) return
                    await bookmarkApi.remove(server, b.id)
                    refetch()
                  }}
                >
                  {t('Delete')}
                </button>
                <span>
                  {t('Database')}: <span>{b.db}</span>
                </span>
                <span
                  className={b.shared ? 'bookmark_label shared text-success' : 'bookmark_label text-accent'}
                >
                  {b.label}
                </span>
              </div>
              <HighlightedSql sql={b.query} className={isOpen ? '' : 'truncate whitespace-nowrap'} />
            </div>
          )
        })}
      </div>
      {add !== null && (
        <div className="card add absolute inset-0 bg-bg-elevated">
          <div className="toolbar border-b border-border bg-bg-subtle px-2 py-1 font-semibold">
            {t('Add bookmark')}
          </div>
          <AddBookmarkForm
            server={server}
            initial={add}
            onDone={() => {
              setAdd(null)
              refetch()
            }}
          />
        </div>
      )}
    </div>
  )
}

function AddBookmarkForm({
  server,
  initial,
  onDone,
}: {
  server: number
  initial: { label: string; db: string; sql: string; shared: boolean }
  onDone: () => void
}) {
  const [label, setLabel] = useState(initial.label)
  const [db, setDb] = useState(initial.db)
  const [shared, setShared] = useState(initial.shared)
  const editor = useRef<SqlEditorHandle>(null)
  const [message, setMessage] = useState('')
  return (
    <div className="content add_bookmark flex flex-col gap-2 p-2">
      <div className="options flex flex-wrap items-center gap-3">
        <label>
          {t('Label')}:{' '}
          <input
            type="text"
            name="label"
            className="input w-40"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label>
          {t('Target database')}:{' '}
          <input
            type="text"
            name="targetdb"
            className="input w-40"
            value={db}
            onChange={(e) => setDb(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            name="shared"
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
          />
          {t('Share this bookmark')}
        </label>
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            const sql = editor.current?.getValue() ?? ''
            if (label === '' || sql === '') {
              window.alert(t(FORM_EMPTY))
              return
            }
            // "Edit" creates a new bookmark: there is no in-place update (/console/bookmark/add)
            const r = await bookmarkApi.consoleAdd(server, { label, db, sql, shared })
            setMessage(r.ok ? t('Succeeded') : t('Failed'))
            if (r.ok) onDone()
          }}
        >
          {t('OK')}
        </button>
        {message !== '' && <span>{message}</span>}
      </div>
      <SqlEditor
        handleRef={editor}
        ariaLabel={t('SQL query')}
        initialValue={initial.sql}
        rows={3}
        codemirror
        lint={null}
        autocomplete={null}
        className="bookmark_add_input"
      />
    </div>
  )
}

/**
 * Debug SQL: the statements the last request ran, grouped or not, in execution order, by time or count.
 * pma: resources/js/modules/console.ts::ConsoleDebug (backtraces are not collected)
 */
function DebugCard({
  log,
  settings,
  set,
}: {
  log: Executed[]
  settings: ConsoleSettings
  set: <K extends keyof ConsoleSettings>(k: K, v: ConsoleSettings[K]) => void
}) {
  const totalTime = log.reduce((s, e) => s + e.ms, 0) / 1000
  const groups = new Map<string, { sql: string; count: number; time: number; order: number }>()
  log.forEach((e, i) => {
    const key = settings.GroupQueries ? e.sql : `${i}`
    const g = groups.get(key)
    if (g === undefined) groups.set(key, { sql: e.sql, count: 1, time: e.ms / 1000, order: i })
    else {
      g.count++
      g.time += e.ms / 1000
    }
  })
  const rows = [...groups.values()].sort((a, b) => {
    const by =
      settings.OrderBy === 'count' && settings.GroupQueries
        ? a.count - b.count
        : settings.OrderBy === 'time'
          ? a.time - b.time
          : a.order - b.order
    return settings.Order === 'asc' ? by : -by
  })
  const b = (active: boolean) => `rounded px-2 hover:bg-nav-pointer ${active ? 'active font-semibold' : ''}`
  return (
    <div id="debug_console">
      <div className="toolbar flex flex-wrap items-center gap-2 border-b border-border bg-bg-subtle px-2 py-1">
        <span className="font-semibold">{t('Debug SQL')}</span>
        <span>{t('Order:')}</span>
        <button type="button" className={b(settings.Order === 'asc')} onClick={() => set('Order', 'asc')}>
          {t('ascending')}
        </button>
        <button type="button" className={b(settings.Order === 'desc')} onClick={() => set('Order', 'desc')}>
          {t('descending')}
        </button>
        <span>{t('Order by:')}</span>
        {settings.GroupQueries && (
          <button
            type="button"
            className={b(settings.OrderBy === 'count')}
            onClick={() => set('OrderBy', 'count')}
          >
            {t('Count')}
          </button>
        )}
        <button
          type="button"
          className={b(settings.OrderBy === 'exec')}
          onClick={() => set('OrderBy', 'exec')}
        >
          {t('Execution order')}
        </button>
        <button
          type="button"
          className={b(settings.OrderBy === 'time')}
          onClick={() => set('OrderBy', 'time')}
        >
          {t('Time taken')}
        </button>
        {settings.GroupQueries ? (
          <button
            type="button"
            className="rounded px-2 hover:bg-nav-pointer"
            onClick={() => set('GroupQueries', false)}
          >
            {t('Ungroup queries')}
          </button>
        ) : (
          <button
            type="button"
            className="rounded px-2 hover:bg-nav-pointer"
            onClick={() => set('GroupQueries', true)}
          >
            {t('Group queries')}
          </button>
        )}
      </div>
      <div className="content debug p-2">
        <div className="message welcome">
          {/* sprintf(Messages.strConsoleDebugSummary, totalUnique, totalExec, totalTime) */}
          {t('%s queries executed %s times in %s seconds.', groups.size, log.length, String(totalTime))}
        </div>
        <div className="debugLog">
          {rows.map((r) => (
            <div key={`${r.order}-${r.sql}`} className="message border-b border-border/50 py-1">
              <div className="flex gap-3 text-xs">
                {settings.GroupQueries && (
                  <span className="text count">
                    {t('Count:')} <span>{r.count}</span>
                  </span>
                )}
                <span className="text time">
                  {t('Time taken:')}{' '}
                  <span>{`${r.time.toFixed(6)}s (${totalTime > 0 ? ((r.time * 100) / totalTime).toFixed(2) : '0'}%)`}</span>
                </span>
              </div>
              <HighlightedSql sql={r.sql} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
