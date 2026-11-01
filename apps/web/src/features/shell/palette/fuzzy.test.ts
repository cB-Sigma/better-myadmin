import { describe, expect, it } from 'vitest'
import { fuzzyMatch, fuzzyRank, normalizeQuery } from './fuzzy.ts'
import { highlightRuns, isPaletteShortcut, paletteGroups } from './groups.ts'
import type { PaletteEntry } from './groups.ts'

const names = (q: string, xs: string[]) => fuzzyRank(xs, q, (x) => [x]).map((r) => r.item)

describe('fuzzyMatch', () => {
  it('matches the query letters in order, case-insensitively, and nothing else', () => {
    expect(fuzzyMatch('usr', 'users')).not.toBeNull()
    expect(fuzzyMatch('USR', 'users')).not.toBeNull()
    expect(fuzzyMatch('rsu', 'users')).toBeNull()
    expect(fuzzyMatch('userss', 'users')).toBeNull()
    expect(fuzzyMatch('x', '')).toBeNull()
  })

  it('ignores white space in the query; an empty query matches everything with score 0', () => {
    expect(normalizeQuery(' Sak  Act ')).toBe('sakact')
    expect(fuzzyMatch('or de', 'order_details')?.positions).toEqual([0, 1, 2, 3])
    expect(fuzzyMatch('or det', 'order_details')?.positions).toEqual([0, 1, 6, 7, 8])
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] })
  })

  it('returns the positions of the best placement (word starts, runs)', () => {
    // `od` at the word starts o(rder)_d(etails), not o + the first d of "order"
    expect(fuzzyMatch('od', 'order_details')?.positions).toEqual([0, 6])
    expect(fuzzyMatch('pi', 'film_category_picture')?.positions).toEqual([14, 15])
    // camelCase boundary
    expect(fuzzyMatch('fc', 'filmCategory')?.positions).toEqual([0, 4])
  })

  it('ranks exact, then prefix, then word-start, then scattered matches', () => {
    expect(names('actor', ['film_actor', 'actor_info', 'xactorx', 'actor', 'a_c_t_o_r'])).toEqual([
      'actor',
      'actor_info',
      'film_actor',
      'xactorx',
      'a_c_t_o_r',
    ])
  })

  it('prefers shorter names among equal matches and keeps the input order on ties', () => {
    expect(names('cust', ['customer_list', 'customer'])).toEqual(['customer', 'customer_list'])
    expect(names('x', ['ax', 'bx'])).toEqual(['ax', 'bx'])
  })

  it('matches consecutive characters over scattered ones', () => {
    expect(names('pay', ['p_a_y_ment', 'payment'])).toEqual(['payment', 'p_a_y_ment'])
  })
})

describe('fuzzyRank', () => {
  it('keeps every item in order for an empty query', () => {
    expect(names('', ['b', 'a'])).toEqual(['b', 'a'])
  })

  it('matches secondary texts (keywords) with a penalty and no highlight', () => {
    const items = [
      { label: 'Einstellungen', kw: ['Settings'] },
      { label: 'Settings', kw: [] },
      { label: 'Log out', kw: [] },
    ]
    const r = fuzzyRank(items, 'sett', (i) => [i.label, ...i.kw])
    expect(r.map((x) => x.item.label)).toEqual(['Settings', 'Einstellungen'])
    expect(r[0]?.positions).toEqual([0, 1, 2, 3])
    expect(r[1]?.positions).toEqual([])
  })
})

const entry = (
  id: string,
  group: string,
  label: string,
  extra: Partial<PaletteEntry> = {},
): PaletteEntry => ({
  id,
  group,
  label,
  run: () => {},
  ...extra,
})

describe('paletteGroups', () => {
  const entries = [
    entry('a', 'Recent', 'actor'),
    entry('b', 'Server', 'SQL'),
    entry('c', 'Server', 'Status'),
    entry('d', 'Tables', 'staff', { match: ['staff', 'sakila.staff'] }),
    entry('e', 'Tables', 'store', { match: ['store', 'sakila.store'] }),
    entry('f', 'Databases', 'sakila'),
  ]

  it('keeps the groups in order of appearance for an empty query', () => {
    expect(paletteGroups(entries, '').map((g) => [g.heading, g.rows.length])).toEqual([
      ['Recent', 1],
      ['Server', 2],
      ['Tables', 2],
      ['Databases', 1],
    ])
  })

  it('puts the group of the best match first and drops the groups without a match', () => {
    const g = paletteGroups(entries, 'sta')
    expect(g.map((x) => x.heading)).toEqual(['Tables', 'Server'])
    expect(g[0]?.rows.map((r) => r.entry.id)).toEqual(['d'])
    expect(g[1]?.rows.map((r) => r.entry.id)).toEqual(['c'])
  })

  it('matches `db.table` through the extra match text', () => {
    const g = paletteGroups(entries, 'sak.sto')
    expect(g[0]?.rows.map((r) => r.entry.id)).toEqual(['e'])
  })

  it('caps a group with `limits`', () => {
    expect(paletteGroups(entries, '', { Tables: 1 }).find((g) => g.heading === 'Tables')?.rows).toHaveLength(
      1,
    )
  })
})

describe('highlightRuns', () => {
  it('splits a label into matched and unmatched runs', () => {
    expect(highlightRuns('actor', [0, 1, 4])).toEqual([
      { text: 'ac', hit: true },
      { text: 'to', hit: false },
      { text: 'r', hit: true },
    ])
    expect(highlightRuns('ab', [])).toEqual([{ text: 'ab', hit: false }])
  })
})

describe('isPaletteShortcut', () => {
  const k = (o: Partial<Parameters<typeof isPaletteShortcut>[0]>) => ({
    key: 'P',
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    ...o,
  })
  it('is Ctrl+Shift+P or Cmd+Shift+P, never Ctrl+K or a plain P', () => {
    expect(isPaletteShortcut(k({ ctrlKey: true }))).toBe(true)
    expect(isPaletteShortcut(k({ metaKey: true }))).toBe(true)
    // another keyboard layout: the physical key
    expect(isPaletteShortcut(k({ ctrlKey: true, key: 'π', code: 'KeyP' }))).toBe(true)
    expect(isPaletteShortcut(k({}))).toBe(false)
    expect(isPaletteShortcut(k({ ctrlKey: true, shiftKey: false }))).toBe(false)
    expect(isPaletteShortcut(k({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(isPaletteShortcut(k({ ctrlKey: true, key: 'k', code: 'KeyK' }))).toBe(false)
  })
})
