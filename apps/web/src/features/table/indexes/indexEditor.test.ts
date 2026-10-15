import { describe, expect, it } from 'vitest'
import { columnAllowed } from './IndexEditor'

/** The index editor's column lists (docs/features/04-table-level.md › Index editor). */
describe('index_form.twig column lists', () => {
  it('FULLTEXT lists char/text columns, SPATIAL the spatial types, the others every column [p04-e82c71]', () => {
    for (const type of ['char', 'varchar', 'text', 'mediumtext'])
      expect(columnAllowed('FULLTEXT', type), type).toBe(true)
    for (const type of ['int', 'blob', 'date', 'point'])
      expect(columnAllowed('FULLTEXT', type), type).toBe(false)
    for (const type of ['geometry', 'point', 'linestring', 'polygon', 'multipolygon'])
      expect(columnAllowed('SPATIAL', type), type).toBe(true)
    for (const type of ['int', 'varchar', 'blob']) expect(columnAllowed('SPATIAL', type), type).toBe(false)
    for (const choice of ['PRIMARY', 'UNIQUE', 'INDEX']) {
      for (const type of ['int', 'text', 'point']) expect(columnAllowed(choice, type)).toBe(true)
    }
  })
})
