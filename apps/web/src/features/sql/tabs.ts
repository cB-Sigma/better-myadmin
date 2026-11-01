/**
 * The query tabs of the SQL page (BetterMyAdmin only, parity exception X62): a pure state store,
 * persisted per server + scope in localStorage. phpMyAdmin has one query box per page; with a single
 * tab the page is exactly that box, so a single unnamed tab is not stored at all.
 */
import { storage } from './logic'

export interface SqlTab {
  /** Stable id (the tab's DOM ids and React key). */
  id: string
  /** Number shown in the default label ("Query 2"). */
  n: number
  /** User-given name; '' = the default label. */
  title: string
  /** The query text last typed in the tab; null = never edited (the page's default query). */
  text: string | null
}

export interface TabsState {
  tabs: SqlTab[]
  active: string
  /** Next tab number. */
  next: number
}

/** localStorage key of a scope's tabs (server, db, table). */
export function tabsKey(server: number, db: string, table: string): string {
  return `bmaSqlTabs:${JSON.stringify([server, db, table])}`
}

export function initialTabs(): TabsState {
  return { tabs: [{ id: 't1', n: 1, title: '', text: null }], active: 't1', next: 2 }
}

const isTab = (v: unknown): v is SqlTab => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    o.id !== '' &&
    typeof o.n === 'number' &&
    Number.isInteger(o.n) &&
    typeof o.title === 'string' &&
    (o.text === null || typeof o.text === 'string')
  )
}

/** Parses a stored state; anything invalid gives the initial single tab. */
export function parseTabs(raw: string | null): TabsState {
  if (raw === null) return initialTabs()
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return initialTabs()
  }
  if (typeof v !== 'object' || v === null) return initialTabs()
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.tabs)) return initialTabs()
  const seen = new Set<string>()
  const tabs = o.tabs.filter((t): t is SqlTab => {
    if (!isTab(t) || seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })
  if (tabs.length === 0) return initialTabs()
  const active = typeof o.active === 'string' && seen.has(o.active) ? o.active : (tabs[0] as SqlTab).id
  const maxN = Math.max(...tabs.map((t) => t.n))
  const next = typeof o.next === 'number' && o.next > maxN ? o.next : maxN + 1
  return { tabs: tabs.map(({ id, n, title, text }) => ({ id, n, title, text })), active, next }
}

/** What is stored: null (nothing) for the single, unnamed tab — the page as phpMyAdmin has it. */
export function serializeTabs(s: TabsState): string | null {
  if (s.tabs.length === 1 && (s.tabs[0] as SqlTab).title === '') return null
  return JSON.stringify(s)
}

export function loadTabs(key: string): TabsState {
  return parseTabs(storage.get(key))
}

export function saveTabs(key: string, s: TabsState): void {
  const v = serializeTabs(s)
  if (v === null) storage.remove(key)
  else storage.set(key, v)
}

/** A new tab after the active one, which becomes active. */
export function addTab(s: TabsState, text: string | null = ''): TabsState {
  const tab: SqlTab = { id: newTabId(s), n: s.next, title: '', text }
  const at = s.tabs.findIndex((t) => t.id === s.active) + 1
  const tabs = [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)]
  return { tabs, active: tab.id, next: s.next + 1 }
}

function newTabId(s: TabsState): string {
  let n = s.next
  while (s.tabs.some((t) => t.id === `t${n}`)) n++
  return `t${n}`
}

/**
 * Closes a tab; the last one cannot be closed. Closing the active tab activates the one to its
 * right, else to its left (browser tabs).
 */
export function closeTab(s: TabsState, id: string): TabsState {
  if (s.tabs.length <= 1) return s
  const i = s.tabs.findIndex((t) => t.id === id)
  if (i < 0) return s
  const tabs = s.tabs.filter((t) => t.id !== id)
  const active = s.active === id ? (tabs[Math.min(i, tabs.length - 1)] as SqlTab).id : s.active
  return { tabs, active, next: s.next }
}

export function activateTab(s: TabsState, id: string): TabsState {
  return s.tabs.some((t) => t.id === id) && s.active !== id ? { ...s, active: id } : s
}

/** Renames a tab; blank names go back to the default label. */
export function renameTab(s: TabsState, id: string, title: string): TabsState {
  const v = title.trim().slice(0, 60)
  return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: v } : t)) }
}

export function setTabText(s: TabsState, id: string, text: string): TabsState {
  const tab = s.tabs.find((t) => t.id === id)
  if (tab === undefined || tab.text === text) return s
  return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, text } : t)) }
}

/** The tab next to the active one (Ctrl+Page Down / Up style, wrapping), for the arrow keys. */
export function neighbourTab(s: TabsState, id: string, step: 1 | -1): string {
  const i = s.tabs.findIndex((t) => t.id === id)
  const n = s.tabs.length
  return (s.tabs[(((i + step) % n) + n) % n] as SqlTab).id
}

/**
 * Ctrl+Alt+T / Ctrl+Alt+W (physical key, so the layout does not matter; AltGr, which browsers report
 * as Ctrl+Alt, types characters and is left alone).
 */
export function tabShortcut(e: {
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  code: string
  altGraph: boolean
}): 'new' | 'close' | null {
  if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey || e.altGraph) return null
  if (e.code === 'KeyT') return 'new'
  if (e.code === 'KeyW') return 'close'
  return null
}
