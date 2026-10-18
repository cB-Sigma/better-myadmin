import { describe, expect, it } from 'vitest'
import {
  checkExceptionIds,
  duplicateIds,
  nextId,
  registeredIds,
  unknownReferences,
} from '../src/exception-ids.ts'

// every id in this file is a fake exception id
const REGISTER_TEXT = [
  '| # | Area |',
  '|---|---|',
  '| X1 | Auth |',
  '| ~~X7~~ | Retired |',
  '| X3 | Export |',
  '| Q2 | Browse |',
  '| Q3 | Browse, also see X1 |',
].join('\n')

describe('exception ids', () => {
  const rows = registeredIds(REGISTER_TEXT)

  it('reads the register rows, retired ones included', () => {
    expect(rows.map((r) => [r.id, r.line, r.retired])).toEqual([
      ['X1', 3, false],
      ['X7', 4, true],
      ['X3', 5, false],
      ['Q2', 6, false],
      ['Q3', 7, false],
    ])
  })

  it('hands out one above the highest id ever registered', () => {
    expect(nextId(rows, 'X')).toBe('X8') // fake exception id
    expect(nextId(rows, 'Q')).toBe('Q4') // fake exception id
    expect(nextId([], 'Q')).toBe('Q1')
  })

  it('reports an id registered twice', () => {
    expect(duplicateIds(rows)).toEqual([])
    const twice = registeredIds(`${REGISTER_TEXT}\n| Q2 | Export |`)
    expect(duplicateIds(twice)).toEqual([
      // fake exception id
      'docs/reference/parity-exceptions.md:8: Q2 is already registered on line 6 (next free: Q4)',
    ])
  })

  it('reports ids written anywhere that are not registered', () => {
    const known = new Set(rows.map((r) => r.id))
    const files = [
      { path: 'a.ts', text: "// pma: X1, see Q3\nconst x = 'X7'" },
      { path: 'b.yaml', text: 'exception: X4\nnote: REQUIRE X509 SSL\nQ12' }, // fake exception id
      { path: 'c.md', text: 'skipped: X9 // fake exception id\nAX10 Q2x X2_' },
    ]
    expect(unknownReferences(files, known)).toEqual([
      // fake exception id
      'b.yaml:1: X4 is not in docs/reference/parity-exceptions.md',
      // fake exception id
      'b.yaml:3: Q12 is not in docs/reference/parity-exceptions.md',
    ])
  })

  it('the repository has no duplicate or unregistered id', () => {
    expect(checkExceptionIds()).toEqual([])
  })
})
