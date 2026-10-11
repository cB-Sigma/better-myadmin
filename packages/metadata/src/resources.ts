import { readFileSync } from 'node:fs'

/**
 * SQL files vendored from phpMyAdmin's `resources/sql/` (unchanged, reference commit e3e877e8).
 * pma: SQL_DIR
 */
const read = (name: string) => readFileSync(new URL(`../resources/${name}`, import.meta.url), 'utf8')

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
