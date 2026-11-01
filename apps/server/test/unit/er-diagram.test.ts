import { describe, expect, it } from 'vitest'
import { type ErSource, buildErDiagram } from '../../src/database/er-diagram.ts'

const src = (over: Partial<ErSource> = {}): ErSource => ({
  tables: [
    { TABLE_NAME: 't10', TABLE_TYPE: 'BASE TABLE', ENGINE: 'InnoDB', TABLE_COMMENT: 'ten' },
    { TABLE_NAME: 't2', TABLE_TYPE: 'BASE TABLE', ENGINE: 'InnoDB', TABLE_COMMENT: '' },
    { TABLE_NAME: 'v', TABLE_TYPE: 'VIEW', ENGINE: null, TABLE_COMMENT: 'VIEW' },
  ],
  columns: [
    { TABLE_NAME: 't10', COLUMN_NAME: 'id', COLUMN_TYPE: 'int(11)', IS_NULLABLE: 'NO' },
    { TABLE_NAME: 't10', COLUMN_NAME: 'a', COLUMN_TYPE: 'int(11)', IS_NULLABLE: 'YES' },
    { TABLE_NAME: 't10', COLUMN_NAME: 'b', COLUMN_TYPE: 'int(11)', IS_NULLABLE: 'YES' },
    { TABLE_NAME: 't2', COLUMN_NAME: 'x', COLUMN_TYPE: 'int(11)', IS_NULLABLE: 'NO' },
    { TABLE_NAME: 't2', COLUMN_NAME: 'y', COLUMN_TYPE: 'int(11)', IS_NULLABLE: 'NO' },
    { TABLE_NAME: 'v', COLUMN_NAME: 'id', COLUMN_TYPE: 'int(11)', IS_NULLABLE: 'NO' },
    { TABLE_NAME: 'gone', COLUMN_NAME: 'z', COLUMN_TYPE: 'int(11)', IS_NULLABLE: 'NO' },
  ],
  indexes: [
    { TABLE_NAME: 't10', INDEX_NAME: 'PRIMARY', NON_UNIQUE: '0', COLUMN_NAME: 'id' },
    { TABLE_NAME: 't10', INDEX_NAME: 'ua', NON_UNIQUE: '0', COLUMN_NAME: 'a' },
    { TABLE_NAME: 't10', INDEX_NAME: 'uab', NON_UNIQUE: '0', COLUMN_NAME: 'a' },
    { TABLE_NAME: 't10', INDEX_NAME: 'uab', NON_UNIQUE: '0', COLUMN_NAME: 'b' },
    { TABLE_NAME: 't2', INDEX_NAME: 'PRIMARY', NON_UNIQUE: '0', COLUMN_NAME: 'x' },
    { TABLE_NAME: 't2', INDEX_NAME: 'PRIMARY', NON_UNIQUE: '0', COLUMN_NAME: 'y' },
  ],
  foreignKeys: [
    {
      TABLE_NAME: 't10',
      CONSTRAINT_NAME: 'fk2',
      COLUMN_NAME: 'a',
      REFERENCED_TABLE_SCHEMA: 'd',
      REFERENCED_TABLE_NAME: 't2',
      REFERENCED_COLUMN_NAME: 'x',
    },
    {
      TABLE_NAME: 't10',
      CONSTRAINT_NAME: 'fk2',
      COLUMN_NAME: 'b',
      REFERENCED_TABLE_SCHEMA: 'd',
      REFERENCED_TABLE_NAME: 't2',
      REFERENCED_COLUMN_NAME: 'y',
    },
  ],
  internal: [],
  externalVisible: new Set(),
  ...over,
})

describe('buildErDiagram (X63)', () => {
  it('tables in natural order, views flagged, key markers from the indexes', () => {
    const r = buildErDiagram('d', src())
    expect(r.tables.map((t) => [t.name, t.view, t.comment])).toEqual([
      ['t2', false, ''],
      ['t10', false, 'ten'],
      ['v', true, ''],
    ])
    expect(r.tables[1]!.columns).toEqual([
      { name: 'id', type: 'int(11)', nullable: false, pk: true, unique: false },
      // a single-column UNIQUE index; membership of the two-column one alone would not count
      { name: 'a', type: 'int(11)', nullable: true, pk: false, unique: true },
      { name: 'b', type: 'int(11)', nullable: true, pk: false, unique: false },
    ])
    expect(r.tables[0]!.columns.map((c) => c.pk)).toEqual([true, true])
  })

  it('FOREIGN KEY columns grouped by constraint in order', () => {
    expect(buildErDiagram('d', src()).relations).toEqual([
      {
        kind: 'fk',
        name: 'fk2',
        table: 't10',
        columns: ['a', 'b'],
        refDb: 'd',
        refTable: 't2',
        refColumns: ['x', 'y'],
      },
    ])
  })

  it('internal relations: only between visible columns, not twice when a FOREIGN KEY draws them', () => {
    const rel = (
      master_table: string,
      master_field: string,
      foreign_db: string,
      foreign_table: string,
      foreign_field: string,
    ) => ({
      master_table,
      master_field,
      foreign_db,
      foreign_table,
      foreign_field,
    })
    const r = buildErDiagram(
      'd',
      src({
        internal: [
          rel('t10', 'a', 'd', 't2', 'x'), // the FOREIGN KEY's first pair
          rel('t10', 'b', 'd', 'v', 'id'),
          rel('t10', 'hidden', 'd', 't2', 'x'), // a column the user cannot see
          rel('t10', 'id', 'd', 'secret', 'id'), // a table the user cannot see
          rel('t2', 'x', 'other', 'seen', 'id'),
          rel('t2', 'y', 'other', 'unseen', 'id'),
        ],
        externalVisible: new Set(['other\u0000seen']),
      }),
    )
    expect(r.relations.filter((x) => x.kind === 'internal')).toEqual([
      {
        kind: 'internal',
        name: '',
        table: 't10',
        columns: ['b'],
        refDb: 'd',
        refTable: 'v',
        refColumns: ['id'],
      },
      {
        kind: 'internal',
        name: '',
        table: 't2',
        columns: ['x'],
        refDb: 'other',
        refTable: 'seen',
        refColumns: ['id'],
      },
    ])
  })
})
