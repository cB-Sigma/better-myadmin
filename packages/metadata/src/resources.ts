import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * SQL files vendored from phpMyAdmin's `resources/sql/` (unchanged from reference commit e3e877e8 through a15cd540cf).
 * pma: SQL_DIR
 */
const read = (name: string) => readFileSync(new URL(`../resources/${name}`, import.meta.url), 'utf8')

/** SQL_DIR: the directory holding create_tables.sql (shown by the storage check page). */
export function sqlDir(): string {
  return fileURLToPath(new URL('../resources/', import.meta.url))
}

let createTables: string | null = null
let upgradeColumnInfo: string | null = null

export function createTablesSql(): string {
  createTables ??= read('create_tables.sql')
  return createTables
}

export function upgradeColumnInfoSql(): string {
  upgradeColumnInfo ??= read('upgrade_column_info_4_3_0+.sql')
  return upgradeColumnInfo
}

/**
 * Default pma table names and their `CREATE TABLE` statements, with custom names substituted.
 * The statement keeps the comment block that precedes it in the file (phpMyAdmin splits the file
 * on `;` and sends each chunk as is).
 *
 * pma: src/ConfigStorage/Relation.php::getCreateTableSqlQueries
 */
export function getCreateTableSqlQueries(
  tableNameReplacements: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const query of createTablesSql().split(';')) {
    const m = /CREATE TABLE IF NOT EXISTS `(.*)` \(/.exec(query)
    if (m === null) continue
    const tableName = m[1] as string
    const repl = tableNameReplacements[tableName]
    out[tableName] = `${repl !== undefined ? query.replaceAll(tableName, repl) : query};`
  }
  return out
}
