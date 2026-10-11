/**
 * Statements of the table Structure page: column/index row actions, bulk actions, browse/distinct
 * queries, partition maintenance and (re)partitioning.
 *
 * pma: src/Query/Generator.php, src/Controllers/Table/Structure/*, src/Controllers/Table/DropColumnController.php,
 *      src/Partitioning/Maintenance.php, resources/templates/table/structure/display_structure.twig,
 *      resources/templates/indexes.twig, resources/templates/table/structure/display_partitions.twig
 */

import { type PartitioningInput, getPartitionsDefinition } from './column.ts'
import { backquote } from './quote.ts'

/** Index kinds of the row actions / bulk buttons (AddKeyController::getKeyType). */
export type KeyType = 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'SPATIAL' | 'FULLTEXT'

/**
 * `ALTER TABLE `t` ADD UNIQUE(`a`, `b`);`
 *
 * pma: src/Query/Generator.php::getAddIndexSql
 */
export function getAddIndexSql(indexType: string, table: string, selectedColumns: readonly string[]): string {
  const columnsSql = selectedColumns.map((c) => backquote(c)).join(', ')
  return `ALTER TABLE ${backquote(table)} ADD ${indexType}(${columnsSql});`
}

/**
 * The "Primary" row action: only the first selected column, replacing an existing primary key.
 *
 * pma: src/Query/Generator.php::getAddPrimaryKeyStatement
 */
export function getAddPrimaryKeyStatement(table: string, column: string, hasDropPrimaryKey: boolean): string {
  if (hasDropPrimaryKey) {
    return `ALTER TABLE ${backquote(table)} DROP PRIMARY KEY, ADD PRIMARY KEY(${backquote(column)});`
  }
  return `ALTER TABLE ${backquote(table)} ADD PRIMARY KEY(${backquote(column)});`
}

/**
 * The bulk "Primary" button (all selected columns).
 *
 * pma: src/Controllers/Table/Structure/PrimaryController.php::__invoke
 */
export function getPrimaryKeyQuery(table: string, selected: readonly string[], hasPrimary: boolean): string {
  let sql = `ALTER TABLE ${backquote(table)}`
  if (hasPrimary) sql += ' DROP PRIMARY KEY,'
  sql += ' ADD PRIMARY KEY('
  selected.forEach((field, i) => {
    sql += backquote(field)
    sql += i + 1 === selected.length ? ');' : ', '
  })
  return sql
}

/**
 * The SQL a row action or bulk button sends.
 *
 * pma: src/Controllers/Table/Structure/AbstractIndexController.php::handleIndexCreation
 */
export function getAddKeyQuery(
  keyType: KeyType,
  table: string,
  selected: readonly string[],
  hasPrimaryKey: boolean,
): string {
  if (keyType === 'PRIMARY') return getAddPrimaryKeyStatement(table, selected[0] ?? '', hasPrimaryKey)
  return getAddIndexSql(keyType, table, selected)
}

/**
 * The "Drop" row action (posted to /sql).
 *
 * pma: resources/templates/table/structure/display_structure.twig (drop_column_anchor)
 */
export function getDropColumnQuery(table: string, column: string): string {
  return `ALTER TABLE ${backquote(table)} DROP ${backquote(column)};`
}

/**
 * `ALTER TABLE `t` DROP `a`, DROP `b`;` (bulk Drop, after the Yes/No page).
 *
 * pma: src/Controllers/Table/DropColumnController.php::__invoke
 */
export function getDropColumnsQuery(table: string, selected: readonly string[]): string {
  let sql = `ALTER TABLE ${backquote(table)}`
  selected.forEach((field, i) => {
    sql += ` DROP ${backquote(field)}`
    sql += i + 1 === selected.length ? ';' : ','
  })
  return sql
}

/**
 * The index "Drop" link (posted to /sql).
 *
 * pma: resources/templates/indexes.twig, table/structure/display_structure.twig
 */
export function getDropIndexQuery(table: string, indexName: string): string {
  if (indexName === 'PRIMARY') return `ALTER TABLE ${backquote(table)} DROP PRIMARY KEY;`
  return `ALTER TABLE ${backquote(table)} DROP INDEX ${backquote(indexName)};`
}

/**
 * The "Distinct values" row action. `rowsLabel` is the translated "Rows".
 *
 * pma: resources/templates/table/structure/display_structure.twig (Distinct value action)
 */
export function getDistinctValuesQuery(table: string, column: string, rowsLabel: string): string {
  return (
    `SELECT COUNT(*) AS ${backquote(rowsLabel)}, ${backquote(column)} FROM ${backquote(table)}` +
    ` GROUP BY ${backquote(column)} ORDER BY ${backquote(column)}`
  )
}

/**
 * The bulk "Browse" button.
 *
 * pma: src/Controllers/Table/Structure/BrowseController.php::displayTableBrowseForSelectedColumns
 */
export function getBrowseColumnsQuery(db: string, table: string, selected: readonly string[]): string {
  return `SELECT ${selected.map((c) => backquote(c)).join(', ')} FROM ${backquote(db)}.${backquote(table)}`
}

/** The "Propose table structure" link (MySQL < 8.0 and MariaDB only). */
export function getProcedureAnalyseQuery(table: string): string {
  return `SELECT * FROM ${backquote(table)} PROCEDURE ANALYSE()`
}

/** The "Optimize table" link of the Information card. pma: display_table_stats.twig */
export function getOptimizeTableQuery(table: string): string {
  return `OPTIMIZE TABLE ${backquote(table)}`
}

/** Per-partition actions of the Partitions card. */
export type PartitionOperation = 'ANALYZE' | 'CHECK' | 'OPTIMIZE' | 'REBUILD' | 'REPAIR' | 'TRUNCATE' | 'DROP'

/**
 * `ALTER TABLE `t` ANALYZE PARTITION `p0`;`
 *
 * pma: src/Partitioning/Maintenance.php::analyze/check/drop/optimize/rebuild/repair/truncate
 */
export function getPartitionMaintenanceQuery(
  table: string,
  operation: PartitionOperation,
  partition: string,
): string {
  return `ALTER TABLE ${backquote(table)} ${operation} PARTITION ${backquote(partition)};`
}

/**
 * The Operations tab's partition maintenance (several partitions, names unquoted; COALESCE takes a count).
 *
 * pma: src/Query/Generator.php::getQueryForPartitioningTable
 */
export function getQueryForPartitioningTable(
  table: string,
  partitionOperation: string,
  partitionNames: readonly string[],
): string {
  const sql = `ALTER TABLE ${backquote(table)} ${partitionOperation} PARTITION `
  if (partitionOperation === 'COALESCE') return sql + String(partitionNames.length)
  return `${sql + partitionNames.join(', ')};`
}

/**
 * "Edit partitioning" / "Partition table" → Save. Note the double space and no trailing `;`.
 *
 * pma: src/Controllers/Table/Structure/PartitioningController.php::updatePartitioning
 */
export function getPartitioningQuery(table: string, partitioning: PartitioningInput): string {
  return `ALTER TABLE ${backquote(table)} ${getPartitionsDefinition(partitioning)}`
}

/**
 * The "Remove partitioning" button (posted to /sql).
 *
 * pma: resources/templates/table/structure/display_partitions.twig
 */
export function getRemovePartitioningQuery(table: string): string {
  return `ALTER TABLE ${backquote(table)} REMOVE PARTITIONING`
}
