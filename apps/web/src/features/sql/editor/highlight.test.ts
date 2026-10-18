import { describe, expect, it } from 'vitest'
import { highlightSql } from './highlight'

const docs = (sql: string) =>
  highlightSql(sql)
    .filter((s) => s.doc !== undefined)
    .map((s) => [s.text, s.doc?.[0]])

describe('highlightSql documentation links (sql-highlight.ts)', () => {
  it('prefers three, then two, then one keyword [p09-dc4450]', () => {
    expect(docs('SHOW CREATE TABLE t')).toEqual([
      ['SHOW', 'show-create-table'],
      ['CREATE', 'show-create-table'],
      ['TABLE', 'show-create-table'],
    ])
    // FROM has no entry of its own
    expect(docs('select * from t')).toEqual([['select', 'select']])
  })

  it('links builtins (column types) [p09-dc4450]', () => {
    expect(
      docs('CREATE TABLE t (a INT, b VARCHAR(3))').filter(([t]) => t === 'INT' || t === 'VARCHAR'),
    ).toEqual([
      ['INT', 'numeric-types'],
      ['VARCHAR', 'string-types'],
    ])
  })

  it('keeps the text intact', () => {
    const sql = "SELECT 'a;b', `c` -- x\nFROM t WHERE id = 1"
    expect(
      highlightSql(sql)
        .map((s) => s.text)
        .join(''),
    ).toBe(sql)
  })
})
