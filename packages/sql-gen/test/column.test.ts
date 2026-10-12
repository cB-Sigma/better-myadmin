import type { ServerInfo, ServerVendor } from '@bettermyadmin/mysql-types'
import { describe, expect, it } from 'vitest'
import {
  type ColumnDefinition,
  type IndexDefinition,
  type IndexSet,
  type PartitionDefinition,
  type PartitioningInput,
  generateAlter,
  generateFieldSpec,
  getColumnCreationQuery,
  getPartitionsDefinition,
  getTableCreationQuery,
} from '../src/index.ts'
import { loadFixture } from './fixtures.ts'

type SpecArgs = [
  string,
  string,
  string,
  string,
  string,
  string | false,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  (string | number)[] | null,
  string | null,
]
type SpecCase = [ServerVendor, number, SpecArgs, string, string?, string?]

const spec = loadFixture<{ cases: SpecCase[] }>('field-spec.json')

describe('generateFieldSpec / generateAlter (golden, executed phpMyAdmin Table)', () => {
  it('has a large matrix [p04-46d957 p04-4fd2f9 p04-969609 p04-ddf0af]', () => {
    expect(spec.cases.length).toBeGreaterThan(5000)
  })

  const byServer = new Map<string, SpecCase[]>()
  for (const c of spec.cases) byServer.set(`${c[0]} ${c[1]}`, [...(byServer.get(`${c[0]} ${c[1]}`) ?? []), c])

  for (const [server, list] of byServer) {
    it(server, () => {
      for (const [vendor, version, a, expected, oldcol, alter] of list) {
        const input = {
          name: a[0],
          type: a[1],
          length: a[2],
          attribute: a[3],
          collation: a[4],
          null: a[5],
          defaultType: a[6],
          defaultValue: a[7],
          extra: a[8],
          comment: a[9],
          virtuality: a[10],
          expression: a[11],
          moveTo: a[12],
          columnsWithIndex: a[13],
          oldColumnName: a[14],
        }
        const ctx = { server: { vendor, version } }
        expect(generateFieldSpec(input, ctx), JSON.stringify(a)).toBe(expected)
        if (oldcol !== undefined) {
          const { oldColumnName: _ignored, ...rest } = input
          expect(generateAlter(oldcol, rest, ctx), JSON.stringify(a)).toBe(alter)
        }
      }
    })
  }
})

// ---------------------------------------------------------------------------
// CreateAddField: fixtures hold the phpMyAdmin POST; this adapter maps it to the typed input
// ---------------------------------------------------------------------------
type Post = Record<string, unknown>
type PhpArray = unknown[] | Record<string, unknown> | undefined

const at = (arr: PhpArray, i: number): string | undefined => {
  if (arr === undefined) return undefined
  const v = Array.isArray(arr) ? arr[i] : arr[String(i)]
  return v === undefined || v === null ? undefined : String(v)
}

function columnsFromPost(post: Post): ColumnDefinition[] {
  const names = (post.field_name as string[] | undefined) ?? []
  return names.map((name, i) => ({
    name,
    type: at(post.field_type as PhpArray, i) ?? '',
    length: at(post.field_length as PhpArray, i) ?? '',
    attribute: at(post.field_attribute as PhpArray, i) ?? '',
    collation: at(post.field_collation as PhpArray, i) ?? '',
    null: at(post.field_null as PhpArray, i) ?? 'NO',
    defaultType: at(post.field_default_type as PhpArray, i) ?? '',
    defaultValue: at(post.field_default_value as PhpArray, i) ?? '',
    extra: at(post.field_extra as PhpArray, i) ?? '',
    comment: at(post.field_comments as PhpArray, i) ?? '',
    virtuality: at(post.field_virtuality as PhpArray, i) ?? '',
    expression: at(post.field_expression as PhpArray, i) ?? '',
  }))
}

interface PmaIndex {
  Key_name: string
  Index_comment: string
  Index_choice: string
  Key_block_size: string
  Parser: string
  Index_type: string
  columns: { col_index: string | number; size: string | number }[]
}

function indexList(json: unknown): IndexDefinition[] {
  const decoded = JSON.parse(typeof json === 'string' ? json : '[]') as PmaIndex[] | Record<string, PmaIndex>
  return Object.values(decoded).map((i) => ({
    keyName: i.Key_name,
    comment: i.Index_comment,
    choice: i.Index_choice,
    keyBlockSize: i.Key_block_size,
    parser: i.Parser,
    type: i.Index_type,
    columns: i.columns.map((c) => ({ colIndex: c.col_index, size: c.size })),
  }))
}

const indexesFromPost = (post: Post): IndexSet => ({
  primary: indexList(post.primary_indexes),
  index: indexList(post.indexes),
  unique: indexList(post.unique_indexes),
  fulltext: indexList(post.fulltext_indexes),
  spatial: indexList(post.spatial_indexes),
})

type PmaPartition = Record<string, string | PmaPartition[]>
function partitionFromPost(p: PmaPartition): PartitionDefinition {
  const s = (k: string): string | undefined => (typeof p[k] === 'string' ? (p[k] as string) : undefined)
  const def: PartitionDefinition = { name: s('name') ?? '' }
  const assign = (key: keyof PartitionDefinition, v: string | undefined) => {
    if (v !== undefined) (def as unknown as Record<string, string>)[key] = v
  }
  assign('valueType', s('value_type'))
  assign('value', s('value'))
  assign('engine', s('engine'))
  assign('comment', s('comment'))
  assign('dataDirectory', s('data_directory'))
  assign('indexDirectory', s('index_directory'))
  assign('maxRows', s('max_rows'))
  assign('minRows', s('min_rows'))
  assign('tablespace', s('tablespace'))
  assign('nodeGroup', s('node_group'))
  if (Array.isArray(p.subpartitions)) def.subpartitions = p.subpartitions.map(partitionFromPost)
  return def
}

function partitioningFromPost(post: Post): PartitioningInput {
  const out: PartitioningInput = {}
  const s = (k: string) => (typeof post[k] === 'string' ? (post[k] as string) : undefined)
  const set = (k: keyof PartitioningInput, v: string | undefined) => {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  set('partitionBy', s('partition_by'))
  set('partitionExpr', s('partition_expr'))
  set('partitionCount', s('partition_count'))
  set('subpartitionBy', s('subpartition_by'))
  set('subpartitionExpr', s('subpartition_expr'))
  set('subpartitionCount', s('subpartition_count'))
  if (Array.isArray(post.partitions))
    out.partitions = (post.partitions as PmaPartition[]).map(partitionFromPost)
  return out
}

interface CreateFixture {
  phpunitExpected: { partitions: string[]; create: string[]; alter: string[] }
  partitions: { label: string; post: Post; sql: string }[]
  create: {
    label: string
    server: ServerInfo
    db: string
    table: string
    post: Post
    storageEngines: string[]
    sql: string
  }[]
  alter: { label: string; server: ServerInfo; table: string; post: Post; sql: string }[]
}

const caf = loadFixture<CreateFixture>('create-add-field.json')

describe('CreateAddField (golden, executed phpMyAdmin)', () => {
  it('fixtures agree with the PHPUnit expectations', () => {
    caf.phpunitExpected.partitions.forEach((e, i) => expect(caf.partitions[i]?.sql).toBe(e))
    caf.phpunitExpected.create.forEach((e, i) => expect(caf.create[i]?.sql).toBe(e))
    caf.phpunitExpected.alter.forEach((e, i) => expect(caf.alter[i]?.sql).toBe(e))
  })

  it('getPartitionsDefinition', () => {
    for (const c of caf.partitions)
      expect(getPartitionsDefinition(partitioningFromPost(c.post)), c.label).toBe(c.sql)
  })

  it('getTableCreationQuery', () => {
    for (const c of caf.create) {
      const p = c.post
      const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : undefined)
      const input = {
        db: c.db,
        table: c.table,
        columns: columnsFromPost(p),
        indexes: indexesFromPost(p),
        partitioning: partitioningFromPost(p),
        ...(str('tbl_storage_engine') !== undefined
          ? { storageEngine: str('tbl_storage_engine') as string }
          : {}),
        ...(str('tbl_collation') !== undefined ? { collation: str('tbl_collation') as string } : {}),
        ...(str('connection') !== undefined ? { connection: str('connection') as string } : {}),
        ...(str('comment') !== undefined ? { comment: str('comment') as string } : {}),
      }
      expect(
        getTableCreationQuery(input, { server: c.server, storageEngines: c.storageEngines }),
        c.label,
      ).toBe(c.sql)
    }
  })

  it('getColumnCreationQuery', () => {
    for (const c of caf.alter) {
      const p = c.post
      const input = {
        table: c.table,
        columns: columnsFromPost(p),
        indexes: indexesFromPost(p),
        position: {
          where: typeof p.field_where === 'string' ? p.field_where : '',
          ...(typeof p.after_field === 'string' ? { afterField: p.after_field } : {}),
        },
        onlineTransaction: 'online_transaction' in p,
      }
      expect(getColumnCreationQuery(input, { server: c.server }), c.label).toBe(c.sql)
    }
  })
})

describe('column builders, typed API', () => {
  const ctx = { server: { vendor: 'mysql', version: 80400 } as const }
  it('builds a readable CREATE TABLE', () => {
    expect(
      getTableCreationQuery(
        {
          db: 'shop',
          table: 'orders',
          columns: [
            { name: 'id', type: 'INT', extra: 'AUTO_INCREMENT', defaultType: 'NONE' },
            {
              name: 'note',
              type: 'VARCHAR',
              length: '50',
              null: 'YES',
              defaultType: 'NULL',
              collation: 'utf8mb4_bin',
            },
          ],
          indexes: { primary: [{ choice: 'PRIMARY', columns: [{ colIndex: 0 }] }] },
          storageEngine: 'InnoDB',
          collation: 'utf8mb4_general_ci',
          comment: "Bob's",
        },
        ctx,
      ),
    ).toBe(
      "CREATE TABLE `shop`.`orders` (`id` INT NOT NULL AUTO_INCREMENT , `note` VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL , PRIMARY KEY (`id`)) ENGINE = InnoDB CHARSET=utf8mb4 COLLATE utf8mb4_general_ci COMMENT = 'Bob\\'s';",
    )
  })
})
