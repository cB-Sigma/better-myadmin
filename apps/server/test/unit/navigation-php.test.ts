import { describe, expect, it } from 'vitest'
import { pageselectorPages } from '../../src/navigation/list-navigator.ts'
import { phpSort, strcasecmp, strnatcasecmp, strnatcmpEx } from '../../src/navigation/php.ts'
import { parseShowGrants } from '../../src/navigation/privileges.ts'
import fixtures from './fixtures/navigation-php.json' with { type: 'json' }

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0)

describe('PHP string ordering used by the navigation tree (fixtures from PHP 8)', () => {
  it('strnatcasecmp / strcasecmp / strnatcmp', () => {
    const bad: string[] = []
    for (const [a, b, natCase, strCase, nat] of fixtures.pairs as Array<
      [string, string, number, number, number]
    >) {
      if (sign(strnatcasecmp(a, b)) !== sign(natCase)) bad.push(`strnatcasecmp(${a}, ${b})`)
      if (sign(strcasecmp(a, b)) !== sign(strCase)) bad.push(`strcasecmp(${a}, ${b})`)
      if (sign(strnatcmpEx(a, b, false)) !== sign(nat)) bad.push(`strnatcmp(${a}, ${b})`)
    }
    expect(bad).toEqual([])
  })

  it('sort() with SORT_REGULAR', () => {
    for (const [input, sorted] of fixtures.sorts as Array<[string[], string[]]>) {
      expect(phpSort([...input])).toEqual(sorted)
    }
  })
})

describe('Util::pageselector', () => {
  for (const s of fixtures.selectors) {
    it(`${s.rows} rows, page ${s.pageNow} of ${s.total}`, () => {
      const pages = pageselectorPages(s.rows, s.pageNow, s.total).map((p) => [p.value, p.page, p.selected])
      expect(pages).toEqual(s.pages)
    })
  }
})

describe('ShowGrants', () => {
  for (const [line, grants, dbName, tableName] of fixtures.grants as string[][]) {
    it(line as string, () => {
      expect(parseShowGrants(line as string)).toEqual({ grants, dbName, tableName })
    })
  }
})
