import { CreateDefinition, CreateStatement, Parser } from '@bettermyadmin/sql-lexer'
import type { MetaConn } from './conn.ts'
import type { RelationParameters } from './relation-parameters.ts'
import { type InternalRelation, getForeignersInternal } from './relations.ts'

/** pma: vendor/phpmyadmin/sql-parser/src/Utils/ForeignKey.php */
export interface ForeignKey {
  constraint: string | null
  indexList: string[]
  refDbName: string | null
  refTableName: string | null
  refIndexList: string[]
  onUpdate: string | null
  onDelete: string | null
}

/** pma: vendor/phpmyadmin/sql-parser/src/Statements/CreateStatement.php::getForeignKeys */
export function getForeignKeys(stmt: CreateStatement): ForeignKey[] {
  const fields = stmt.fields
  if (!Array.isArray(fields) || fields.length === 0 || stmt.options === null || !stmt.options.has('TABLE')) {
    return []
  }
  const ret: ForeignKey[] = []
  for (const field of fields) {
    if (!(field instanceof CreateDefinition)) continue
    if (field.key === null || field.key.type !== 'FOREIGN KEY') continue
    const fk: ForeignKey = {
      constraint: field.name === null ? null : String(field.name),
      indexList: field.key.columns.filter((c) => c.name !== undefined).map((c) => String(c.name)),
      refDbName: null,
      refTableName: null,
      refIndexList: [],
      onUpdate: null,
      onDelete: null,
    }
    if (field.references !== null) {
      fk.refDbName = field.references.table?.database ?? null
      fk.refTableName = field.references.table?.table ?? null
      fk.refIndexList = field.references.columns
      const opts = field.references.options
      const upd = opts === null ? '' : String(opts.get('ON UPDATE'))
      if (upd !== '') fk.onUpdate = upd.replaceAll(' ', '_')
      const del = opts === null ? '' : String(opts.get('ON DELETE'))
      if (del !== '') fk.onDelete = del.replaceAll(' ', '_')
    }
    ret.push(fk)
  }
  return ret
}

/**
 * The FOREIGN KEY constraints of a table, parsed from its `SHOW CREATE TABLE` text.
 * pma: src/ConfigStorage/Relation.php::getForeignKeysData
 */
export function getForeignKeysData(showCreateTable: string): ForeignKey[] {
  if (showCreateTable === '') return []
  const stmt = new Parser(showCreateTable).statements[0]
  return stmt instanceof CreateStatement ? getForeignKeys(stmt) : []
}

export interface Foreigners {
  /** internal relations (pma__relation + the built-in system-schema maps), by column */
  data: Record<string, InternalRelation>
  /** FOREIGN KEY constraints */
  keysData: ForeignKey[]
}

/**
 * pma: src/ConfigStorage/Relation.php::getForeigners
 * @param showCreateTable `Table::showCreate()` on the user link ('' when unavailable)
 */
export async function getForeigners(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  table: string,
  column: string,
  showCreateTable: () => Promise<string>,
): Promise<Foreigners> {
  return {
    data: await getForeignersInternal(conn, rp, db, table, column),
    keysData: table === '' ? [] : getForeignKeysData(await showCreateTable()),
  }
}

export interface ForeignColumn {
  foreign_field: string | undefined
  foreign_db: string
  foreign_table: string | null
  constraint: string | null
  on_update: string
  on_delete: string
}

/** pma: Relation::getColumnFromForeignKeysData (`foreign_db` falls back to `Current::$database`) */
export function getColumnFromForeignKeysData(
  keys: readonly ForeignKey[],
  column: string,
  currentDb: string,
): ForeignColumn | false {
  for (const k of keys) {
    const i = k.indexList.indexOf(column)
    if (i === -1) continue
    return {
      foreign_field: k.refIndexList[i],
      foreign_db: k.refDbName ?? currentDb,
      foreign_table: k.refTableName,
      constraint: k.constraint,
      on_update: k.onUpdate ?? 'RESTRICT',
      on_delete: k.onDelete ?? 'RESTRICT',
    }
  }
  return false
}

/**
 * The relation of one column: the internal relation wins over a FOREIGN KEY constraint.
 * pma: Relation::searchColumnInForeigners
 */
export function searchColumnInForeigners(
  foreigners: Foreigners,
  column: string,
  currentDb: string,
): InternalRelation | ForeignColumn | false {
  const internal = foreigners.data[column]
  if (internal !== undefined) return internal
  return getColumnFromForeignKeysData(foreigners.keysData, column, currentDb)
}
