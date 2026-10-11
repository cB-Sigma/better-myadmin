import type { ServerInfo } from '@bettermyadmin/mysql-types'
import { createServerContext } from '@bettermyadmin/sql-lexer'
import { describe, expect, it } from 'vitest'
import {
  type ChangeColumnInput,
  type IndexInput,
  type PartitioningInput,
  type ShowIndexRow,
  columnNeedsAlterTable,
  findDuplicateIndexes,
  getAddIndexSql,
  getAddKeyQuery,
  getAddPrimaryKeyStatement,
  getBrowseColumnsQuery,
  getChangeColumnsQuery,
  getChangeRevertQuery,
  getCollationBlobConversions,
  getColumnsWithIndex,
  getDistinctValuesQuery,
  getDropColumnQuery,
  getDropColumnsQuery,
  getDropIndexQuery,
  getMoveColumnsQuery,
  getPartitionMaintenanceQuery,
  getPartitioningQuery,
  getPrimaryKeyQuery,
  getQueryForPartitioningTable,
  getRemovePartitioningQuery,
  getSqlQueryForIndexCreateOrEdit,
  getSqlQueryForRename,
  indexInputFromTableIndex,
  indexesFromShowIndexes,
  looseEquals,
} from '../src/index.ts'
import { loadFixture } from './fixtures.ts'

interface PostedIndex {
  Key_name: string
  Index_choice: string
  Key_block_size: string
  Index_type: string
  Parser: string
  Index_comment: string
  columns: { names: string[]; sub_parts?: string[]; collations?: string[] }
}

interface StructureFixture {
  addIndex: { type: string; table: string; columns: string[]; sql: string }[]
  addPrimary: { table: string; column: string; hasPrimary: boolean; sql: string }[]
  partitionOps: { table: string; operation: string; partitions: string[]; sql: string }[]
  partitioning: { table: string; post: Record<string, unknown>; sql: string }[]
  rename: { server: ServerInfo; old: string; new: string; sql: string; error: string | null }[]
  indexCreateOrEdit: {
    label: string
    post: PostedIndex
    old: string | null
    tokudb: boolean
    sql: string
    error: string | null
  }[]
  fromShowIndexes: {
    label: string
    rows: ShowIndexRow[]
    indexes: Array<Record<string, unknown> & { editSql: string; name: string }>
    duplicates: [string, string][]
    columnsWithPrimaryOrUnique: Array<string | number>
    columnsWithAnyIndex: Array<string | number>
  }[]
  moveColumns: { table: string; create: string; order: string[]; sql: string | null; error: string | null }[]
  columnNeedsAlterTable: { label: string; post: Record<string, string>; needs: boolean }[]
}

const fx = loadFixture<StructureFixture>('structure.json')

/** The posted index[...] array as the typed input (Index::set + Index::addColumns). */
function indexFromPost(p: PostedIndex): IndexInput {
  return {
    name: p.Key_name,
    choice: p.Index_choice,
    type: p.Index_type,
    keyBlockSize: p.Key_block_size,
    parser: p.Parser,
    comment: p.Index_comment,
    columns: p.columns.names.map((name, i) => ({
      name,
      subPart: p.columns.sub_parts?.[i] ?? '',
      collation: p.columns.collations?.[i] ?? null,
    })),
  }
}

describe('Structure row actions and bulk buttons (golden, executed phpMyAdmin)', () => {
  it('Generator::getAddIndexSql', () => {
    for (const c of fx.addIndex) {
      expect(getAddIndexSql(c.type, c.table, c.columns)).toBe(c.sql)
      expect(getAddKeyQuery(c.type as 'INDEX', c.table, c.columns, true)).toBe(c.sql)
    }
  })

  it('Generator::getAddPrimaryKeyStatement', () => {
    for (const c of fx.addPrimary) {
      expect(getAddPrimaryKeyStatement(c.table, c.column, c.hasPrimary)).toBe(c.sql)
      expect(getAddKeyQuery('PRIMARY', c.table, [c.column, 'ignored'], c.hasPrimary)).toBe(c.sql)
    }
  })

  it('Generator::getQueryForPartitioningTable', () => {
    for (const c of fx.partitionOps) {
      expect(getQueryForPartitioningTable(c.table, c.operation, c.partitions)).toBe(c.sql)
    }
  })

  it('PartitioningController::updatePartitioning', () => {
    for (const c of fx.partitioning) {
      const p = c.post as Record<string, string> & { partitions?: Array<Record<string, string>> }
      const input: PartitioningInput = {
        partitionBy: p.partition_by ?? '',
        partitionExpr: p.partition_expr ?? '',
        partitionCount: p.partition_count ?? '',
        ...(p.partitions !== undefined
          ? {
              partitions: p.partitions.map((x) => ({
                name: x.name ?? '',
                valueType: x.value_type ?? '',
                value: x.value ?? '',
                comment: x.comment ?? '',
              })),
            }
          : {}),
      }
      expect(getPartitioningQuery(c.table, input)).toBe(c.sql)
    }
  })
})

describe('Index editor (golden, executed Table\\Indexes)', () => {
  it('has a matrix', () => expect(fx.indexCreateOrEdit.length).toBeGreaterThan(100))

  it('getSqlQueryForIndexCreateOrEdit', () => {
    for (const c of fx.indexCreateOrEdit) {
      const r = getSqlQueryForIndexCreateOrEdit(c.old, indexFromPost(c.post), 'd`b', 't`x', {
        isTokuDb: c.tokudb,
      })
      expect(r.sql, c.label).toBe(c.sql)
      expect(r.error, c.label).toBe(c.error)
    }
  })

  it('getSqlQueryForRename', () => {
    for (const c of fx.rename) {
      const index: IndexInput = {
        name: c.new,
        choice: c.old === 'PRIMARY' ? 'PRIMARY' : 'INDEX',
        type: 'BTREE',
        comment: 'c',
        columns: [
          { name: 'a', subPart: null, collation: 'A' },
          { name: 'b', subPart: 5, collation: 'D' },
        ],
      }
      const r = getSqlQueryForRename(c.old, index, 'db', 't', c.server)
      expect(r.sql, JSON.stringify(c)).toBe(c.sql)
      expect(r.error, JSON.stringify(c)).toBe(c.error)
    }
  })

  it('Index::getFromTable, findDuplicates, getColumnsWithIndex and the edit form round trip', () => {
    for (const c of fx.fromShowIndexes) {
      const indexes = indexesFromShowIndexes(c.rows)
      expect(
        indexes.map((i) => ({
          name: i.name,
          type: i.type,
          choice: i.choice,
          nonUnique: i.nonUnique,
          packed: i.packed,
          remarks: i.remarks,
          comment: i.comment,
          columns: i.columns,
        })),
        c.label,
      ).toEqual(c.indexes.map(({ editSql: _e, ...rest }) => rest))
      expect(findDuplicateIndexes(indexes)).toEqual(c.duplicates)
      expect(getColumnsWithIndex(indexes, ['PRIMARY', 'UNIQUE'])).toEqual(c.columnsWithPrimaryOrUnique)
      expect(getColumnsWithIndex(indexes, ['PRIMARY', 'UNIQUE', 'INDEX', 'SPATIAL', 'FULLTEXT'])).toEqual(
        c.columnsWithAnyIndex,
      )
      indexes.forEach((index, i) => {
        // the edit form shows sizes only for non-SPATIAL indexes and posts the collation letters
        const input = indexInputFromTableIndex(index)
        const posted: IndexInput = {
          ...input,
          columns: input.columns.map((col) => ({
            name: col.name,
            subPart: index.choice !== 'SPATIAL' ? (col.subPart ?? '') : '',
            collation: col.collation ?? '',
          })),
        }
        expect(
          getSqlQueryForIndexCreateOrEdit(index.name, posted, 'db', `tbl${fx.fromShowIndexes.indexOf(c)}`)
            .sql,
        ).toBe(c.indexes[i]?.editSql)
      })
    }
  })
})

describe('Move columns (golden, executed MoveColumnsController on live SHOW CREATE TABLE)', () => {
  const ctx = createServerContext(80400, false, '')
  it('generateAlterTableSql', () => {
    for (const c of fx.moveColumns) {
      const r = getMoveColumnsQuery(c.create, c.order, ctx)
      expect(r.sql, `${c.table} ${JSON.stringify(c.order)}`).toBe(c.sql)
      expect(r.error).toBe(c.error)
    }
  })
})

describe('Change columns', () => {
  const toInput = (p: Record<string, string>): ChangeColumnInput => ({
    orig: p.field_orig ?? '',
    name: p.field_name ?? '',
    type: p.field_type ?? '',
    length: p.field_length ?? '',
    attribute: p.field_attribute ?? '',
    collation: p.field_collation ?? null,
    null: p.field_null ?? null,
    defaultType: p.field_default_type ?? '',
    defaultValue: p.field_default_value ?? '',
    extra: p.field_extra ?? null,
    comments: p.field_comments ?? '',
    virtuality: p.field_virtuality ?? null,
    moveTo: p.field_move_to ?? '',
    origValues: {
      type: p.field_type_orig ?? '',
      length: p.field_length_orig ?? '',
      defaultValue: p.field_default_value_orig ?? '',
      defaultType: p.field_default_type_orig ?? '',
      collation: p.field_collation_orig ?? '',
      attribute: p.field_attribute_orig ?? '',
      null: p.field_null_orig ?? '',
      extra: p.field_extra_orig ?? '',
      comments: p.field_comments_orig ?? '',
      virtuality: p.field_virtuality_orig ?? '',
      expression: '',
    },
  })

  it('SaveController::columnNeedsAlterTable (golden)', () => {
    for (const c of fx.columnNeedsAlterTable)
      expect(columnNeedsAlterTable(toInput(c.post)), c.label).toBe(c.needs)
  })

  it('looseEquals follows PHP 8', () => {
    expect(looseEquals('1', '01')).toBe(true)
    expect(looseEquals('1e1', '10')).toBe(true)
    expect(looseEquals(null, '')).toBe(true)
    expect(looseEquals(null, '0')).toBe(false)
    expect(looseEquals('abc', 'ABC')).toBe(false)
  })

  const server = { vendor: 'mysql', version: 80400 } as const
  const base: ChangeColumnInput = {
    orig: 'name',
    name: 'title',
    type: 'VARCHAR',
    length: '50',
    attribute: '',
    collation: 'utf8mb4_bin',
    null: 'YES',
    defaultType: 'NULL',
    defaultValue: '',
    comments: '',
    virtuality: '',
    expression: '',
    moveTo: '',
    origValues: {
      type: 'VARCHAR',
      length: '20',
      defaultValue: '',
      defaultType: 'NULL',
      collation: 'utf8mb4_0900_ai_ci',
      attribute: '',
      null: 'YES',
      extra: '',
      comments: '',
      virtuality: '',
      expression: '',
    },
  }

  it('builds the ALTER, the BLOB conversion and the revert', () => {
    const q = getChangeColumnsQuery(
      { table: 't', columns: [base], columnsWithPrimaryOrUnique: ['id'], onlineTransaction: true },
      { server },
    )
    expect(q.sql).toBe(
      'ALTER TABLE `t` CHANGE `name` `title` VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL, ALGORITHM=INPLACE, LOCK=NONE;',
    )
    expect(getCollationBlobConversions('t', [base], [])).toEqual([
      { index: 0, sql: 'ALTER TABLE `t` CHANGE `name` `name` BLOB;' },
    ])
    expect(getCollationBlobConversions('t', [base], ['name'])).toEqual([])
    expect(getChangeRevertQuery('t', [base], new Set([0]), { server })).toBe(
      'ALTER TABLE `t` CHANGE `name` `title` VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL;',
    )
    expect(
      getChangeColumnsQuery(
        {
          table: 't',
          columns: [{ ...base, name: 'name', length: '20', collation: 'utf8mb4_0900_ai_ci' }],
          columnsWithPrimaryOrUnique: [],
        },
        { server },
      ).sql,
    ).toBeNull()
  })

  it('MEDIUMTEXT/LONGTEXT convert to the matching BLOB, virtual columns keep the expression', () => {
    const v = {
      ...base,
      virtuality: 'VIRTUAL',
      expression: 'CONCAT(a)',
      origValues: { ...base.origValues, type: 'LONGTEXT' },
    }
    expect(getCollationBlobConversions('t', [v], [])[0]?.sql).toBe(
      'ALTER TABLE `t` CHANGE `name` `name` LONGBLOB AS (CONCAT(a)) VIRTUAL;',
    )
  })
})

describe('literal statements of the Structure templates', () => {
  it('row and index drop, distinct values, browse, partitions', () => {
    expect(getDropColumnQuery('my`t', 'c`1')).toBe('ALTER TABLE `my``t` DROP `c``1`;')
    expect(getDropColumnsQuery('t', ['a'])).toBe('ALTER TABLE `t` DROP `a`;')
    expect(getDropColumnsQuery('t', ['a', 'b'])).toBe('ALTER TABLE `t` DROP `a`, DROP `b`;')
    expect(getDropIndexQuery('t', 'PRIMARY')).toBe('ALTER TABLE `t` DROP PRIMARY KEY;')
    expect(getDropIndexQuery('t', 'k`1')).toBe('ALTER TABLE `t` DROP INDEX `k``1`;')
    expect(getPrimaryKeyQuery('t', ['a', 'b'], true)).toBe(
      'ALTER TABLE `t` DROP PRIMARY KEY, ADD PRIMARY KEY(`a`, `b`);',
    )
    expect(getPrimaryKeyQuery('t', ['a'], false)).toBe('ALTER TABLE `t` ADD PRIMARY KEY(`a`);')
    expect(getDistinctValuesQuery('t', 'c', 'Rows')).toBe(
      'SELECT COUNT(*) AS `Rows`, `c` FROM `t` GROUP BY `c` ORDER BY `c`',
    )
    expect(getBrowseColumnsQuery('d', 't', ['a', 'b'])).toBe('SELECT `a`, `b` FROM `d`.`t`')
    expect(getPartitionMaintenanceQuery('t', 'ANALYZE', 'p`0')).toBe(
      'ALTER TABLE `t` ANALYZE PARTITION `p``0`;',
    )
    expect(getRemovePartitioningQuery('t')).toBe('ALTER TABLE `t` REMOVE PARTITIONING')
  })
})
