import { describe, expect, it } from 'vitest'
import { type QueryColumn, generateQuery } from './queryGenerator'

const col = (o: Partial<QueryColumn> & { table: string; column: string }): QueryColumn => ({
  tableAlias: '',
  columnAlias: '',
  show: true,
  useCriteria: false,
  ...o,
  criteria: {
    logicalOp: 'AND',
    column: o.column,
    op: '=',
    rhs: 'text',
    text: '',
    values: [],
    rhsTable: '',
    rhsColumn: '',
    ...o.criteria,
  },
})

const fks = [
  {
    TABLE_NAME: 'child',
    COLUMN_NAME: 'parent_id',
    REFERENCED_TABLE_NAME: 'parent',
    REFERENCED_COLUMN_NAME: 'id',
  },
]

describe('multi-table query generator (query_generator.ts)', () => {
  it('nothing selected', () => {
    expect(generateQuery([col({ table: '', column: '' })], [])).toBeNull()
  })

  it('joins tables through foreign keys, comma-joins the others, aliases', () => {
    const q = generateQuery(
      [
        col({ table: 'parent', column: '*' }),
        col({ table: 'child', column: 'id', columnAlias: 'cid' }),
        col({ table: 'other', column: 'x', tableAlias: 'o' }),
      ],
      fks,
    )
    expect(q).toBe(
      'SELECT `parent`.*, `child`.`id` AS `cid`, `o`.`x`\nFROM `parent` \n\tLEFT JOIN `child` ON `child`.`parent_id` = `parent`.`id`\n\t, `other` AS `o`;',
    )
  })

  it('criteria: escaping, IN de-duplication, BETWEEN, IS NULL, another column, AND/OR', () => {
    const q = generateQuery(
      [
        col({
          table: 't',
          column: 'a',
          useCriteria: true,
          criteria: { op: 'LIKE %...%', text: "o'k" } as QueryColumn['criteria'],
        }),
        col({
          table: 't',
          column: 'b',
          useCriteria: true,
          criteria: { logicalOp: 'OR', op: 'IN (...)', values: ['x', "y'", 'x'] } as QueryColumn['criteria'],
        }),
        col({
          table: 't',
          column: 'c',
          useCriteria: true,
          criteria: { op: 'BETWEEN', values: ['1', '9'] } as QueryColumn['criteria'],
        }),
        col({
          table: 't',
          column: 'd',
          useCriteria: true,
          criteria: { op: 'IS NULL' } as QueryColumn['criteria'],
        }),
        col({
          table: 't',
          column: 'e',
          useCriteria: true,
          criteria: {
            op: '=',
            rhs: 'anotherColumn',
            rhsTable: 'u',
            rhsColumn: 'f',
          } as QueryColumn['criteria'],
        }),
      ],
      [],
    )
    expect(q).toBe(
      "SELECT `t`.`a`, `t`.`b`, `t`.`c`, `t`.`d`, `t`.`e`\nFROM `t`\nWHERE `t`.`a` LIKE '%o'k%' OR `t`.`b` IN ('x','y\\'') AND `t`.`c` BETWEEN '1' AND '9' AND `t`.`d` IS NULL AND `t`.`e` = `u`.`f`;",
    )
  })
})
