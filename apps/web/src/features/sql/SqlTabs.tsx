import { cn, useConfirm } from '@bettermyadmin/ui'
import {
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { t } from '../../lib/i18n'
import {
  type SqlTab,
  type TabsState,
  activateTab,
  addTab,
  closeTab,
  loadTabs,
  neighbourTab,
  renameTab,
  saveTabs,
  setTabText,
  tabShortcut,
  tabsKey,
} from './tabs'

/** What a tab's page gets from the strip. */
export interface SqlTabContext {
  tab: SqlTab
  /** The tab shown (its results are kept mounted while hidden). */
  active: boolean
  /** More than one tab: the page is one of several (stored text wins over the page's default). */
  multi: boolean
  /** The editor takes the focus when it loads (the tab shown at load, or a new tab). */
  autoFocus: boolean
  /** The tab the URL's query (`sql`, `sig`) is for: the tab shown when it was opened. */
  fromUrl: boolean
  /** The query text changed (stored with the tab). */
  onText: (text: string) => void
  /** Registers "has the tab changes that were not run?" (asked before closing it). */
  register: (isDirty: () => boolean) => () => void
}

/** The default label: "Query 2". */
// i18n-new: BetterMyAdmin query tabs (parity exception X62)
const tabLabel = (tab: SqlTab) => (tab.title !== '' ? tab.title : t('Query %s', tab.n))

const scroller = () => document.getElementById('page_scroll')

const focusTab = (id: string) => requestAnimationFrame(() => document.getElementById(`sqltab-${id}`)?.focus())

/**
 * Query tabs of the SQL page (BetterMyAdmin only, parity exception X62): each tab is a whole query
 * box with its own results, all kept mounted (a running query keeps its tab); the inactive ones are
 * hidden. With one tab the page is phpMyAdmin's, plus a discreet "New query tab" button.
 */
export function SqlTabs({
  server,
  db,
  table,
  urlKey,
  children,
}: {
  server: number
  db: string
  table: string
  /** The URL's query: a new one goes to the tab shown, which starts again with it. */
  urlKey: string
  children: (ctx: SqlTabContext) => ReactNode
}) {
  const key = tabsKey(server, db, table)
  const [state, setState] = useState<TabsState>(() => loadTabs(key))
  const [editing, setEditing] = useState<string | null>(null)
  const confirm = useConfirm()
  const dirty = useRef(new Map<string, () => boolean>())
  const scroll = useRef(new Map<string, number>())
  // the tab shown at load and the tabs opened since take the focus once their editor loads
  const focusOnMount = useRef(new Set([state.active]))
  const stateRef = useRef(state)
  stateRef.current = state
  const multi = state.tabs.length > 1
  // the URL's query belongs to the tab shown when it came; a new one starts that tab again
  const owner = useRef({ key: urlKey, tab: state.active })
  const generation = useRef(new Map<string, number>())
  if (owner.current.key !== urlKey) {
    owner.current = { key: urlKey, tab: state.active }
    generation.current.set(state.active, (generation.current.get(state.active) ?? 0) + 1)
  }

  useEffect(() => saveTabs(key, state), [key, state])

  const rememberScroll = useCallback(() => {
    const el = scroller()
    if (el !== null) scroll.current.set(stateRef.current.active, el.scrollTop)
  }, [])

  // each tab has its own scroll position (the page scrolls in #page_scroll)
  const shown = useRef(state.active)
  useLayoutEffect(() => {
    if (shown.current === state.active) return
    shown.current = state.active
    const el = scroller()
    if (el !== null) el.scrollTop = scroll.current.get(state.active) ?? 0
  }, [state.active])

  // stable per tab, so the pages' effects do not re-run on every change of the strip
  const perTab = useRef(new Map<string, Pick<SqlTabContext, 'onText' | 'register'>>())
  const callbacks = (id: string) => {
    let c = perTab.current.get(id)
    if (c === undefined) {
      c = {
        onText: (text) => setState((s) => setTabText(s, id, text)),
        register: (isDirty) => {
          dirty.current.set(id, isDirty)
          return () => {
            if (dirty.current.get(id) === isDirty) dirty.current.delete(id)
          }
        },
      }
      perTab.current.set(id, c)
    }
    return c
  }

  const switchTo = (id: string) => {
    if (id === stateRef.current.active) return
    rememberScroll()
    setState((s) => activateTab(s, id))
  }

  const add = useCallback(() => {
    rememberScroll()
    setState((s) => {
      const n = addTab(s)
      focusOnMount.current.add(n.active)
      return n
    })
  }, [rememberScroll])

  const close = useCallback(
    async (id: string) => {
      const s = stateRef.current
      const tab = s.tabs.find((x) => x.id === id)
      if (tab === undefined || s.tabs.length < 2) return
      if (dirty.current.get(id)?.() === true) {
        const ok = await confirm({
          // i18n-new: BetterMyAdmin query tabs (parity exception X62)
          question: t('“%s” has changes that were not run. Close the tab anyway?', tabLabel(tab)),
        })
        if (!ok) return
      }
      if (id === s.active) rememberScroll()
      scroll.current.delete(id)
      setState((cur) => {
        const n = closeTab(cur, id)
        if (n.tabs.length > 1) focusTab(n.active)
        return n
      })
    },
    [confirm, rememberScroll],
  )

  // Ctrl+Alt+T / Ctrl+Alt+W, before the shortcut handler (which would arm its "T then …" chord)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const action = tabShortcut({
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        code: e.code,
        altGraph: e.getModifierState?.('AltGraph') === true,
      })
      if (action === null) return
      // not behind a dialog
      if (document.querySelector('[role="dialog"], [role="alertdialog"]') !== null) return
      e.preventDefault()
      e.stopPropagation()
      if (action === 'new') add()
      else void close(stateRef.current.active)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [add, close])

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    let to: string | null = null
    if (e.key === 'ArrowRight') to = neighbourTab(state, id, 1)
    else if (e.key === 'ArrowLeft') to = neighbourTab(state, id, -1)
    else if (e.key === 'Home') to = (state.tabs[0] as SqlTab).id
    else if (e.key === 'End') to = (state.tabs[state.tabs.length - 1] as SqlTab).id
    else if (e.key === 'F2') {
      e.preventDefault()
      setEditing(id)
      return
    } else if (e.key === 'Delete') {
      e.preventDefault()
      void close(id)
      return
    }
    if (to === null) return
    e.preventDefault()
    switchTo(to)
    focusTab(to)
  }

  const onAux = (e: MouseEvent, id: string) => {
    // middle click closes
    if (e.button !== 1) return
    e.preventDefault()
    void close(id)
  }

  const newTabButton = (
    <button
      type="button"
      id="sql_new_tab"
      className="bma-sql-newtab shrink-0 rounded-t px-2 py-0.5 text-xs text-fg-muted hover:bg-(--tab-hover-bg) hover:text-(--tab-fg)"
      // i18n-new: BetterMyAdmin query tabs (parity exception X62)
      aria-label={t('New query tab')}
      // i18n-new: BetterMyAdmin query tabs (parity exception X62)
      title={t('New query tab')}
      aria-keyshortcuts="Control+Alt+T"
      onClick={add}
    >
      <span aria-hidden="true">+</span>
      {!multi && (
        // i18n-new: BetterMyAdmin query tabs (parity exception X62)
        <span className="ms-1">{t('New tab')}</span>
      )}
    </button>
  )

  return (
    <>
      {multi ? (
        <div className="bma-sql-tabs mb-2 flex max-w-6xl items-end gap-1 border-b border-(--tab-border)">
          <div
            role="tablist"
            // i18n-new: BetterMyAdmin query tabs (parity exception X62)
            aria-label={t('Query tabs')}
            className="flex min-w-0 flex-wrap items-end gap-1"
          >
            {state.tabs.map((tab) => {
              const active = tab.id === state.active
              const label = tabLabel(tab)
              return (
                <div
                  key={tab.id}
                  role="presentation"
                  className={cn(
                    '-mb-px flex items-center rounded-t border border-(--tab-border) text-sm',
                    active
                      ? 'border-b-(--tab-active-bg) bg-(--tab-active-bg) text-(--tab-active-fg)'
                      : 'bg-(--tab-bg) text-(--tab-fg) hover:bg-(--tab-hover-bg)',
                  )}
                  onAuxClick={(e) => onAux(e, tab.id)}
                  onMouseDown={(e) => {
                    // no autoscroll on middle click
                    if (e.button === 1) e.preventDefault()
                  }}
                >
                  {editing === tab.id ? (
                    <input
                      className="input m-0.5 w-32 py-0 text-sm"
                      aria-label={t('Rename')}
                      defaultValue={tab.title !== '' ? tab.title : label}
                      // biome-ignore lint/a11y/noAutofocus: the field replaces the label being renamed
                      autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => {
                        const v = e.currentTarget.value
                        setState((s) => renameTab(s, tab.id, v === tabLabel({ ...tab, title: '' }) ? '' : v))
                        setEditing(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          e.currentTarget.blur()
                          focusTab(tab.id)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          e.stopPropagation()
                          e.currentTarget.value = tab.title !== '' ? tab.title : label
                          e.currentTarget.blur()
                          focusTab(tab.id)
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      role="tab"
                      id={`sqltab-${tab.id}`}
                      aria-selected={active}
                      aria-controls={`sqltabpanel-${tab.id}`}
                      tabIndex={active ? 0 : -1}
                      className="max-w-48 truncate py-1 ps-2.5 pe-1"
                      onClick={() => switchTo(tab.id)}
                      onDoubleClick={() => setEditing(tab.id)}
                      onKeyDown={(e) => onTabKey(e, tab.id)}
                    >
                      {label}
                    </button>
                  )}
                  <button
                    type="button"
                    className="me-1 rounded px-1 leading-none text-fg-muted hover:bg-(--tab-hover-bg) hover:text-fg"
                    // i18n-new: BetterMyAdmin query tabs (parity exception X62)
                    aria-label={t('Close %s', label)}
                    title={t('Close')}
                    tabIndex={-1}
                    onClick={() => void close(tab.id)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              )
            })}
          </div>
          {newTabButton}
        </div>
      ) : (
        <div className="bma-sql-tabs flex max-w-6xl justify-end">{newTabButton}</div>
      )}
      {state.tabs.map((tab) => {
        const active = tab.id === state.active
        const fromUrl = owner.current.tab === tab.id
        return (
          <div
            key={tab.id}
            id={`sqltabpanel-${tab.id}`}
            hidden={!active}
            {...(multi ? { role: 'tabpanel', 'aria-labelledby': `sqltab-${tab.id}` } : {})}
          >
            <Fragment key={generation.current.get(tab.id) ?? 0}>
              {children({
                tab,
                active,
                fromUrl,
                multi,
                autoFocus: focusOnMount.current.has(tab.id),
                ...callbacks(tab.id),
              })}
            </Fragment>
          </div>
        )
      })}
    </>
  )
}
