/**
 * Index editor and index rename statements.
 *
 * pma: src/Table/Indexes.php, src/Indexes/Index.php, src/Indexes/IndexColumn.php,
 *      src/Query/Generator.php::getSqlQueryForIndexRename
 */

import { N_ } from '@bettermyadmin/i18n'
import { type ServerInfo, isCompatibleRenameIndex, php } from '@bettermyadmin/mysql-types'
import { type QuoteOptions, backquote, quoteString } from './quote.ts'

/** One row of the index editor's column table (`index[columns][names|sub_parts|collations][]`). */
export interface IndexColumnInput {
  /** '' is "-- Ignore --" */
  name: string
  /** the posted Size; '' / '0' / non-numeric mean the whole column (PHP `(int)`) */
  subPart?: string | number | null
  /** '' (None), 'A' (ASC) or 'D' (DESC); null when not posted */
  collation?: string | null
}

/** The index editor form (`index[...]`), or an index read from SHOW INDEXES. */
export interface IndexInput {
  /** Key_name */
  name: string
  /** Index_choice: PRIMARY, INDEX, UNIQUE, SPATIAL, FULLTEXT */
  choice: string
  /** Index_type: '', BTREE, HASH (others are ignored) */
  type?: string
  /** Key_block_size, PHP `(int)` cast */
  keyBlockSize?: string | number | null
  parser?: string
  /** Index_comment */
  comment?: string
  columns: readonly IndexColumnInput[]
}

export interface IndexQueryOptions {
  /** Table::isEngine('TOKUDB'): `USING` is left out for TokuDB tables */
  isTokuDb?: boolean
  quote?: QuoteOptions
}

/** A statement plus the error phpMyAdmin reports instead of running it (msgid, untranslated). */
export interface IndexQuery {
  sql: string
  /** 'The name of the primary key must be "PRIMARY"!', 'Can\'t rename index to PRIMARY!', 'No index parts defined!' */
  error: string | null
}

interface ResolvedColumn {
  name: string
  subPart: number
  collation: string | null
}

/**
 * Index::addColumns from the form: columns are keyed by name, so '' (Ignore) is skipped and a
 * repeated name replaces the earlier entry in place (PHP array key semantics).
 * pma: src/Indexes/Index.php::addColumns, ::addColumn; src/Indexes/IndexColumn.php::set
 */
function resolveColumns(columns: readonly IndexColumnInput[]): ResolvedColumn[] {
  const byKey = new Map<string, ResolvedColumn>()
  for (const c of columns) {
    // PHP array keys: numeric strings become integers ('01' stays a string)
    const key = /^(0|-?[1-9]\d*)$/.test(c.name) ? String(Number(c.name)) : c.name
    if (key === '') continue
    const sp = c.subPart
    const subPart =
      sp === undefined || sp === null ? 0 : typeof sp === 'number' ? Math.trunc(sp) : Number(php.intCast(sp))
    byKey.set(key, { name: c.name, subPart, collation: c.collation ?? null })
  }
  return [...byKey.values()]
}

/**
 * `ALTER TABLE `db`.`t` [DROP PRIMARY KEY, | DROP INDEX `old`,] ADD ... (`a`(10) ASC, `b`) ...;`
 *
 * pma: src/Table/Indexes.php::getSqlQueryForIndexCreateOrEdit
 */
export function getSqlQueryForIndexCreateOrEdit(
  oldIndexName: string | null,
  index: IndexInput,
  dbName: string,
  tableName: string,
  options: IndexQueryOptions = {},
): IndexQuery {
  let error: string | null = null
  let sql = `ALTER TABLE ${backquote(dbName)}.${backquote(tableName)}`

  if (oldIndexName !== null) {
    sql += oldIndexName === 'PRIMARY' ? ' DROP PRIMARY KEY,' : ` DROP INDEX ${backquote(oldIndexName)},`
  }

  switch (index.choice) {
    case 'PRIMARY':
      if (index.name !== '' && index.name !== 'PRIMARY') {
        error = N_('The name of the primary key must be "PRIMARY"!')
      }
      sql += ' ADD PRIMARY KEY'
      break
    case 'FULLTEXT':
    case 'UNIQUE':
    case 'INDEX':
    case 'SPATIAL':
      if (index.name === 'PRIMARY') error = N_("Can't rename index to PRIMARY!")
      sql += ` ADD ${index.choice}`
      if (index.name !== '') sql += ` ${backquote(index.name)}`
      break
    default:
      break
  }

  const fields = resolveColumns(index.columns).map((c) => {
    let f = backquote(c.name)
    if (c.subPart !== 0) f += `(${c.subPart})`
    if (c.collation === 'A') f += ' ASC'
    else if (c.collation === 'D') f += ' DESC'
    return f
  })
  if (fields.length === 0) error = N_('No index parts defined!')
  else sql += ` (${fields.join(', ')})`

  const kbs = index.keyBlockSize
  const keyBlockSize =
    kbs === undefined || kbs === null
      ? 0n
      : typeof kbs === 'number'
        ? BigInt(Math.trunc(kbs))
        : php.intCast(kbs)
  if (keyBlockSize !== 0n) sql += ` KEY_BLOCK_SIZE = ${keyBlockSize}`

  // specifying an index type is allowed only for primary, unique and index; TokuDB uses Fractal Tree
  const type = index.type ?? ''
  if (
    index.choice !== 'SPATIAL' &&
    index.choice !== 'FULLTEXT' &&
    (type === 'BTREE' || type === 'HASH') &&
    options.isTokuDb !== true
  ) {
    sql += ` USING ${type}`
  }

  const parser = index.parser ?? ''
  if (index.choice === 'FULLTEXT' && parser !== '') sql += ` WITH PARSER ${parser}`

  const comment = index.comment ?? ''
  if (comment !== '') sql += ` COMMENT ${quoteString(comment, options.quote)}`

  return { sql: `${sql};`, error }
}

/**
 * `ALTER TABLE `db`.`t` RENAME INDEX `old` TO `new`;`
 *
 * pma: src/Query/Generator.php::getSqlQueryForIndexRename
 */
export function getSqlQueryForIndexRename(
  dbName: string,
  tableName: string,
  oldIndexName: string,
  newIndexName: string,
): string {
  return `ALTER TABLE ${backquote(dbName)}.${backquote(tableName)} RENAME INDEX ${backquote(oldIndexName)} TO ${backquote(newIndexName)};`
}

/**
 * The rename dialog: RENAME INDEX where supported, otherwise drop + re-create of the index read
 * from SHOW INDEXES (`index` must carry the new name).
 *
 * pma: src/Table/Indexes.php::getSqlQueryForRename
 */
export function getSqlQueryForRename(
  oldIndexName: string,
  index: IndexInput,
  db: string,
  table: string,
  server: ServerInfo,
  options: IndexQueryOptions = {},
): IndexQuery {
  if (!isCompatibleRenameIndex(server)) {
    return getSqlQueryForIndexCreateOrEdit(oldIndexName, index, db, table, options)
  }
  let error: string | null = null
  if (oldIndexName === 'PRIMARY' && index.name !== '' && index.name !== 'PRIMARY') {
    error = N_('The name of the primary key must be "PRIMARY"!')
  }
  const name = oldIndexName === 'PRIMARY' && index.name === '' ? 'PRIMARY' : index.name
  if (name === 'PRIMARY') error = N_("Can't rename index to PRIMARY!")
  return { sql: getSqlQueryForIndexRename(db, table, oldIndexName, name), error }
}

/** A SHOW INDEXES row (the keys phpMyAdmin reads). */
export interface ShowIndexRow {
  Key_name: string
  Non_unique: string | number
  Seq_in_index: string | number
  Column_name: string | null
  Collation: string | null
  Cardinality: string | number | null
  Sub_part: string | number | null
  Packed: string | null
  Null: string | null
  Index_type: string
  Comment: string | null
  Index_comment: string | null
  Expression?: string | null
}

/** An index as phpMyAdmin's Index/IndexColumn objects see it. */
export interface TableIndex {
  name: string
  /** Index_type (BTREE/HASH/RTREE; '' for FULLTEXT/SPATIAL) */
  type: string
  choice: 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'SPATIAL' | 'FULLTEXT'
  nonUnique: boolean
  packed: string | null
  /** Comment (remarks) */
  remarks: string
  /** Index_comment */
  comment: string
  columns: Array<{
    /** the key: Column_name, or Expression + Seq_in_index */
    key: string
    name: string
    seqInIndex: number
    collation: string | null
    cardinality: number | null
    subPart: number | null
    null: string
    expression: string | null
  }>
}

const intOrNull = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : typeof v === 'number' ? v : Number(php.intCast(v))

/**
 * Groups SHOW INDEXES rows into indexes, in order of first appearance.
 *
 * pma: src/Indexes/Index.php::loadIndexes, ::set, ::addColumn
 */
export function indexesFromShowIndexes(rows: readonly ShowIndexRow[]): TableIndex[] {
  const out = new Map<string, TableIndex>()
  for (const r of rows) {
    let idx = out.get(r.Key_name)
    if (idx === undefined) {
      const nonUnique = php.truthy(String(r.Non_unique))
      let type = r.Index_type
      let choice: TableIndex['choice']
      if (r.Key_name === 'PRIMARY') choice = 'PRIMARY'
      else if (type === 'FULLTEXT') {
        choice = 'FULLTEXT'
        type = ''
      } else if (type === 'SPATIAL') {
        choice = 'SPATIAL'
        type = ''
      } else choice = nonUnique ? 'INDEX' : 'UNIQUE'
      idx = {
        name: r.Key_name,
        type,
        choice,
        nonUnique,
        packed: r.Packed,
        remarks: r.Comment ?? '',
        comment: r.Index_comment ?? '',
        columns: [],
      }
      out.set(r.Key_name, idx)
    }
    const expression = r.Expression ?? null
    let key = r.Column_name ?? expression ?? ''
    if (expression !== null) key += String(r.Seq_in_index)
    if (key === '') continue
    const column = {
      key,
      name: r.Column_name ?? '',
      seqInIndex: intOrNull(r.Seq_in_index) ?? 1,
      collation: r.Collation,
      cardinality: intOrNull(r.Cardinality),
      subPart: intOrNull(r.Sub_part),
      null: r.Null ?? '',
      expression,
    }
    const at = idx.columns.findIndex((c) => c.key === key)
    if (at >= 0) idx.columns[at] = column
    else idx.columns.push(column)
  }
  return [...out.values()]
}

/** The editor input of an existing index (Table::getIndex), e.g. for the rename fallback. */
export function indexInputFromTableIndex(index: TableIndex, name = index.name): IndexInput {
  return {
    name,
    choice: index.choice,
    type: index.type,
    keyBlockSize: 0,
    parser: '',
    comment: index.comment,
    columns: index.columns.map((c) => ({ name: c.name, subPart: c.subPart, collation: c.collation })),
  }
}

/** Index::getCompareData */
function compareData(i: TableIndex): string {
  return JSON.stringify([
    i.packed,
    i.choice,
    i.columns.map((c) => [c.name, c.seqInIndex, c.collation, c.subPart, c.null]),
  ])
}

/**
 * Pairs of indexes that look equal: `[earlier, later]` names for the notice
 * "The indexes %1$s and %2$s seem to be equal and one of them could possibly be removed.".
 *
 * pma: src/Indexes/Index.php::findDuplicates
 */
export function findDuplicateIndexes(indexes: readonly TableIndex[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (indexes.length < 2) return out
  const stack = [...indexes]
  for (let whileIndex = stack.pop(); whileIndex !== undefined; whileIndex = stack.pop()) {
    for (const each of stack) {
      if (compareData(each) !== compareData(whileIndex)) continue
      out.push([each.name, whileIndex.name])
      break
    }
  }
  return out
}

/**
 * Columns of the indexes of the given kinds, in index order (keys of Index::getColumns, numeric
 * names as PHP integers).
 *
 * pma: src/Table/Table.php::getColumnsWithIndex
 */
export function getColumnsWithIndex(
  indexes: readonly TableIndex[],
  choices: ReadonlyArray<TableIndex['choice']>,
): Array<string | number> {
  const order: TableIndex['choice'][] = ['PRIMARY', 'UNIQUE', 'INDEX', 'SPATIAL', 'FULLTEXT']
  const out: Array<string | number> = []
  // Index::getFromTableByChoice walks the indexes once, testing each choice
  for (const index of indexes) {
    if (!order.includes(index.choice) || !choices.includes(index.choice)) continue
    for (const c of index.columns) out.push(/^(0|-?[1-9]\d*)$/.test(c.key) ? Number(c.key) : c.key)
  }
  return out
}
