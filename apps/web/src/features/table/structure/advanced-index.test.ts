import { describe, expect, it } from 'vitest'
import {
  type DraftIndex,
  emptyIndexLists,
  formIndexes,
  indexLabels,
  parseDataIndex,
  removeColumnFromIndex,
  setIndex,
} from './advanced-index'

const idx = (choice: DraftIndex['choice'], cols: number[], keyName = ''): DraftIndex => ({
  keyName,
  comment: '',
  choice,
  keyBlockSize: '',
  parser: '',
  type: '',
  columns: cols.map((c) => ({ colIndex: c, size: '' })),
})

describe('the create/add form indexes (indexes.ts)', () => {
  it('reads the select data-index', () => {
    expect(parseDataIndex('')).toBeNull()
    expect(parseDataIndex('UNIQUE,1')).toEqual({ choice: 'unique', arrayIndex: 1 })
    expect(parseDataIndex('bogus,0')).toBeNull()
  })

  it('composes and serialises the five buckets [p04-7f5bf8]', () => {
    let l = setIndex(emptyIndexLists(), 'primary', 0, idx('PRIMARY', [0], 'PRIMARY'))
    l = setIndex(l, 'unique', 0, idx('UNIQUE', [1, 2]))
    l = setIndex(l, 'index', 0, idx('INDEX', [3], 'i3'))
    expect(formIndexes(l).map((i) => [i.choice, i.columns.map((c) => c.colIndex)])).toEqual([
      ['PRIMARY', [0]],
      ['UNIQUE', [1, 2]],
      ['INDEX', [3]],
    ])
  })

  it('labels each indexed row with the index name or its columns [p04-1cf31a]', () => {
    let l = setIndex(emptyIndexLists(), 'unique', 0, idx('UNIQUE', [1, 2]))
    l = setIndex(l, 'index', 0, idx('INDEX', [3], 'i3'))
    const labels = indexLabels(l, ['id', 'a', 'b', 'c'])
    expect(labels.get(1)).toBe('[a, b]')
    expect(labels.get(2)).toBe('[a, b]')
    expect(labels.get(3)).toBe('i3')
    expect(labels.has(0)).toBe(false)
  })

  it('removes a column, and the index once empty', () => {
    let l = setIndex(emptyIndexLists(), 'unique', 0, idx('UNIQUE', [1, 2]))
    l = removeColumnFromIndex(l, 'unique,0', 1)
    expect(l.unique[0]?.columns.map((c) => c.colIndex)).toEqual([2])
    l = removeColumnFromIndex(l, 'unique,0', 2)
    expect(l.unique).toEqual([])
    expect(removeColumnFromIndex(l, '', 2)).toBe(l)
  })
})
