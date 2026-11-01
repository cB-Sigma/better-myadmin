import { describe, expect, it } from 'vitest'
import {
  isSubsequence,
  matchRank,
  parsePaletteQuery,
  subsequenceLike,
} from '../../src/server-admin/palette.ts'

/** The command palette's server-side pre-filter (parity exception X61). */
describe('command palette search helpers', () => {
  it('matches the query letters in order, case-insensitively', () => {
    expect(isSubsequence('usr', 'Users')).toBe(true)
    expect(isSubsequence('rsu', 'users')).toBe(false)
    expect(isSubsequence('', 'x')).toBe(true)
  })

  it('ranks exact, prefix, substring, subsequence', () => {
    expect(['actor', 'actor_info', 'film_actor', 'a_c_t_o_r'].map((n) => matchRank('actor', n))).toEqual([
      0, 1, 2, 3,
    ])
  })

  it('builds a LIKE pattern with the wildcards of the query escaped', () => {
    expect(subsequenceLike('Ab')).toBe('%a%b%')
    expect(subsequenceLike('a_%')).toBe('%a%\\_%\\%%')
    expect(subsequenceLike('')).toBe('%')
  })

  it('splits db.table at the first dot and drops white space', () => {
    expect(parsePaletteQuery(' sak act ')).toEqual({ db: null, table: 'sakact' })
    expect(parsePaletteQuery('sakila.act')).toEqual({ db: 'sakila', table: 'act' })
    expect(parsePaletteQuery('sakila.')).toEqual({ db: 'sakila', table: '' })
    expect(parsePaletteQuery('a.b.c')).toEqual({ db: 'a', table: 'b.c' })
  })
})
