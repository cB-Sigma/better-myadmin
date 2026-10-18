import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parsePhpQuery, qs, searchFlag, searchInt, stringifyPhpQuery } from './search.ts'

describe('parsePhpQuery: parse_str / $_GET', () => {
  it('keeps every value a string', () => {
    expect(parsePhpQuery('?single_table=true&pos=1&sql=null&g=1.0&j=%5B1%5D&e=')).toEqual({
      single_table: 'true',
      pos: '1',
      sql: 'null',
      g: '1.0',
      j: '[1]',
      e: '',
    })
  })

  it('a repeated plain key keeps its last value', () => {
    expect(parsePhpQuery('pos=1&pos=2')).toEqual({ pos: '2' })
  })

  it('k[] pushes, k[n] / k[x] index; nested brackets nest', () => {
    expect(parsePhpQuery('a[]=x&a[]=y&b[2]=z&b[]=w&c[k]=v&d[0][e]=1')).toEqual({
      a: ['x', 'y'],
      b: { 2: 'z', 3: 'w' },
      c: { k: 'v' },
      d: [{ e: '1' }],
    })
  })

  it('percent-encoded brackets, "+" spaces; "." and " " in a name become "_"; "a[b" is "a_b"', () => {
    expect(parsePhpQuery('f%5B%5D=a+b&x.y=1&p q=2&a[b=3')).toEqual({
      f: ['a b'],
      x_y: '1',
      p_q: '2',
      a_b: '3',
    })
  })

  it('a later scalar replaces an array and the other way round; an empty name is dropped', () => {
    expect(parsePhpQuery('k[]=1&k=2&m=1&m[]=2&=3&[]=4')).toEqual({ k: '2', m: ['2'] })
  })
})

describe('stringifyPhpQuery: in-app navigation', () => {
  it('round-trips through parsePhpQuery as the strings phpMyAdmin would read', () => {
    const s = stringifyPhpQuery({
      sql: 'SELECT 1',
      pos: 0,
      full: true,
      off: false,
      f: ['a', 'b'],
      u: undefined,
    })
    expect(s).toBe('?sql=SELECT%201&pos=0&full=1&off=0&f[]=a&f[]=b')
    expect(parsePhpQuery(s)).toEqual({ sql: 'SELECT 1', pos: '0', full: '1', off: '0', f: ['a', 'b'] })
  })

  it('maps and nested lists use indexed brackets; nothing gives ""', () => {
    expect(stringifyPhpQuery({ m: { a: '1' }, n: [{ b: 2 }] })).toBe('?m[a]=1&n[0][b]=2')
    expect(stringifyPhpQuery({})).toBe('')
  })
})

describe('the qs readers never throw and read like PHP', () => {
  const odd: unknown[] = [
    undefined,
    null,
    '',
    '0',
    '1',
    'true',
    'abc',
    '-3',
    '12abc',
    1,
    0,
    true,
    false,
    ['a'],
    {},
    { x: '1' },
    Number.NaN,
  ]

  it('(int) casts and ! empty()', () => {
    expect([
      searchInt('12abc'),
      searchInt('abc'),
      searchInt(' -3'),
      searchInt(['1']),
      searchInt(2.7),
    ]).toEqual([12, 0, -3, undefined, 2])
    expect([
      searchFlag('0'),
      searchFlag(''),
      searchFlag('false'),
      searchFlag('1'),
      searchFlag([]),
      searchFlag(['x']),
    ]).toEqual([false, false, true, true, false, true])
  })

  it('every reader accepts every odd value', () => {
    const schema = z.object({
      s: qs.str(),
      so: qs.strOr('d'),
      i: qs.int(1),
      io: qs.intOr(0, 0),
      f: qs.flag(),
      is: qs.isset(),
      l: qs.list(),
      sl: qs.strOrList(),
      e: qs.oneOf(['a', 'b']),
      eo: qs.oneOfOr(['a', 'b'], 'a'),
    })
    for (const v of odd) {
      const r = schema.safeParse({ s: v, so: v, i: v, io: v, f: v, is: v, l: v, sl: v, e: v, eo: v })
      expect(r.success).toBe(true)
    }
    expect(
      schema.parse({ s: ['x'], so: ['x'], i: '0', io: '-1', l: 'x', sl: ['x'], e: 'c', eo: 'b' }),
    ).toEqual({
      s: undefined,
      so: 'd',
      i: undefined,
      io: 0,
      f: false,
      is: false,
      l: ['x'],
      sl: ['x'],
      e: undefined,
      eo: 'b',
    })
  })
})
