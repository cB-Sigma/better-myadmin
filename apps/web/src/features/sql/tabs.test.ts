import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activateTab,
  addTab,
  closeTab,
  initialTabs,
  loadTabs,
  neighbourTab,
  parseTabs,
  renameTab,
  saveTabs,
  serializeTabs,
  setTabText,
  tabShortcut,
  tabsKey,
} from './tabs'

/** Query tabs of the SQL page (parity exception X62). */
describe('query tab store', () => {
  it('starts with one unnamed tab, which is not stored', () => {
    const s = initialTabs()
    expect(s.tabs).toHaveLength(1)
    expect(s.active).toBe('t1')
    expect(serializeTabs(s)).toBeNull()
    expect(serializeTabs(setTabText(s, 't1', 'SELECT 1'))).toBeNull()
  })

  it('adds a tab after the active one and activates it', () => {
    let s = addTab(initialTabs())
    expect(s.tabs.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(s.active).toBe('t2')
    expect(s.tabs[1]).toMatchObject({ n: 2, title: '', text: '' })
    s = activateTab(s, 't1')
    s = addTab(s)
    expect(s.tabs.map((t) => t.n)).toEqual([1, 3, 2])
    expect(s.active).toBe('t3')
  })

  it('closes a tab: the one to the right becomes active, else the left one; never the last tab', () => {
    let s = addTab(addTab(initialTabs())) // t1 t2 t3, t3 active
    s = activateTab(s, 't2')
    s = closeTab(s, 't2')
    expect(s.tabs.map((t) => t.id)).toEqual(['t1', 't3'])
    expect(s.active).toBe('t3')
    s = closeTab(s, 't3')
    expect(s.active).toBe('t1')
    expect(closeTab(s, 't1')).toBe(s)
    // closing an inactive tab keeps the active one
    s = addTab(s)
    expect(closeTab(s, 't1').active).toBe(s.active)
    // numbers keep counting up
    expect(addTab(closeTab(s, 't1')).tabs.at(-1)?.n).toBe(5)
  })

  it('renames (trimmed, blank = default label) and keeps texts', () => {
    let s = addTab(initialTabs())
    s = renameTab(s, 't2', '  Report ')
    expect(s.tabs[1]?.title).toBe('Report')
    expect(renameTab(s, 't2', '   ').tabs[1]?.title).toBe('')
    expect(renameTab(s, 't2', 'x'.repeat(100)).tabs[1]?.title).toHaveLength(60)
    s = setTabText(s, 't2', 'SELECT 2')
    expect(s.tabs[1]?.text).toBe('SELECT 2')
    expect(setTabText(s, 't2', 'SELECT 2')).toBe(s)
    expect(setTabText(s, 'nope', 'x')).toBe(s)
  })

  it('a single named tab is stored', () => {
    expect(serializeTabs(renameTab(initialTabs(), 't1', 'Mine'))).not.toBeNull()
  })

  it('round-trips through JSON and rejects broken data', () => {
    let s = addTab(addTab(initialTabs()))
    s = renameTab(setTabText(s, 't2', 'SELECT 2'), 't3', 'Three')
    s = activateTab(s, 't2')
    expect(parseTabs(serializeTabs(s))).toEqual(s)
    expect(parseTabs(null)).toEqual(initialTabs())
    expect(parseTabs('{')).toEqual(initialTabs())
    expect(parseTabs('[]')).toEqual(initialTabs())
    expect(parseTabs('{"tabs":[]}')).toEqual(initialTabs())
    // invalid and duplicate tabs are dropped, an unknown active falls back to the first, next is fixed
    const p = parseTabs(
      JSON.stringify({
        tabs: [
          { id: 'a', n: 4, title: '', text: null },
          { id: 'a', n: 5, title: '', text: null },
          { id: 'b', n: 'x', title: '', text: null },
          { id: 'c', n: 7, title: 'C', text: 'q', extra: 1 },
        ],
        active: 'zz',
        next: 2,
      }),
    )
    expect(p).toEqual({
      tabs: [
        { id: 'a', n: 4, title: '', text: null },
        { id: 'c', n: 7, title: 'C', text: 'q' },
      ],
      active: 'a',
      next: 8,
    })
    // a new id never collides with a stored one
    const q = addTab(
      parseTabs(JSON.stringify({ tabs: [{ id: 't3', n: 1, title: '', text: null }], next: 3 })),
    )
    expect(new Set(q.tabs.map((t) => t.id)).size).toBe(2)
  })

  it('neighbours wrap around', () => {
    const s = addTab(addTab(initialTabs()))
    expect(neighbourTab(s, 't1', 1)).toBe('t2')
    expect(neighbourTab(s, 't3', 1)).toBe('t1')
    expect(neighbourTab(s, 't1', -1)).toBe('t3')
  })

  it('keys are per server and scope', () => {
    expect(tabsKey(1, 'db', '')).not.toBe(tabsKey(2, 'db', ''))
    expect(tabsKey(1, 'a.b', '')).not.toBe(tabsKey(1, 'a', 'b'))
  })
})

describe('Ctrl+Alt+T / Ctrl+Alt+W', () => {
  const k = { ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, altGraph: false }
  it.each([
    [{ ...k, code: 'KeyT' }, 'new'],
    [{ ...k, code: 'KeyW' }, 'close'],
    [{ ...k, code: 'KeyC' }, null],
    [{ ...k, code: 'KeyT', shiftKey: true }, null],
    [{ ...k, code: 'KeyT', altKey: false }, null],
    [{ ...k, code: 'KeyT', ctrlKey: false }, null],
    // AltGr types a character
    [{ ...k, code: 'KeyT', altGraph: true }, null],
  ])('%o → %s', (e, want) => {
    expect(tabShortcut(e)).toBe(want)
  })
})

describe('persistence', () => {
  const data = new Map<string, string>()
  beforeEach(() => {
    data.clear()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, v: string) => data.set(key, v),
        removeItem: (key: string) => data.delete(key),
      },
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saves several tabs and removes the entry when one unnamed tab is left', () => {
    const key = tabsKey(1, 'db', 't')
    const s = setTabText(addTab(initialTabs()), 't2', 'SELECT 2')
    saveTabs(key, s)
    expect(data.has(key)).toBe(true)
    expect(loadTabs(key)).toEqual(s)
    saveTabs(key, closeTab(s, 't2'))
    expect(data.has(key)).toBe(false)
    expect(loadTabs(key)).toEqual(initialTabs())
  })

  it('degrades to one tab when the storage throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('denied')
        },
        removeItem: () => {
          throw new Error('denied')
        },
      },
    })
    const key = tabsKey(1, '', '')
    expect(() => saveTabs(key, addTab(initialTabs()))).not.toThrow()
    expect(() => saveTabs(key, initialTabs())).not.toThrow()
    expect(loadTabs(key)).toEqual(initialTabs())
  })
})
