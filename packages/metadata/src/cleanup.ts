import { backquote, quoteString as q } from '@bettermyadmin/sql-gen'
import type { MetaConn } from './conn.ts'
import type { RelationParameters } from './relation-parameters.ts'

/**
 * Removes what the configuration storage keeps about a dropped table or database (control link).
 * pma: src/ConfigStorage/RelationCleanup.php::table / ::database
 */
export async function relationCleanupTable(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  table: string,
): Promise<void> {
  if (conn === null) return
  const t = (database: string, name: string) => `${backquote(database)}.${backquote(name)}`
  const run = (sql: string) => conn.query(sql)
  if (rp.columnCommentsFeature !== null) {
    const f = rp.columnCommentsFeature
    await run(
      `DELETE FROM ${t(f.database, f.columnInfo)} WHERE db_name = ${q(db)} AND table_name = ${q(table)}`,
    )
  }
  if (rp.displayFeature !== null) {
    const f = rp.displayFeature
    await run(
      `DELETE FROM ${t(f.database, f.tableInfo)} WHERE db_name = ${q(db)} AND table_name = ${q(table)}`,
    )
  }
  if (rp.pdfFeature !== null) {
    const f = rp.pdfFeature
    await run(
      `DELETE FROM ${t(f.database, f.tableCoords)} WHERE db_name = ${q(db)} AND table_name = ${q(table)}`,
    )
  }
  if (rp.relationFeature !== null) {
    const f = rp.relationFeature
    await run(
      `DELETE FROM ${t(f.database, f.relation)} WHERE master_db = ${q(db)} AND master_table = ${q(table)}`,
    )
    await run(
      `DELETE FROM ${t(f.database, f.relation)} WHERE foreign_db = ${q(db)} AND foreign_table = ${q(table)}`,
    )
  }
  if (rp.uiPreferencesFeature !== null) {
    const f = rp.uiPreferencesFeature
    await run(
      `DELETE FROM ${t(f.database, f.tableUiPrefs)} WHERE db_name = ${q(db)} AND table_name = ${q(table)}`,
    )
  }
  if (rp.navigationItemsHidingFeature !== null) {
    const f = rp.navigationItemsHidingFeature
    await run(
      `DELETE FROM ${t(f.database, f.navigationHiding)} WHERE db_name = ${q(db)} AND (table_name = ${q(table)} OR (item_name = ${q(table)} AND item_type = 'table'))`,
    )
  }
}

export async function relationCleanupDatabase(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
): Promise<void> {
  if (conn === null || rp.db === null) return
  const t = (database: string, name: string) => `${backquote(database)}.${backquote(name)}`
  const del = (database: string, name: string, field = 'db_name') =>
    conn.query(`DELETE FROM ${t(database, name)} WHERE ${field} = ${q(db)}`)
  if (rp.columnCommentsFeature !== null)
    await del(rp.columnCommentsFeature.database, rp.columnCommentsFeature.columnInfo)
  if (rp.bookmarkFeature !== null)
    await del(rp.bookmarkFeature.database, rp.bookmarkFeature.bookmark, 'dbase')
  if (rp.displayFeature !== null) await del(rp.displayFeature.database, rp.displayFeature.tableInfo)
  if (rp.pdfFeature !== null) {
    await del(rp.pdfFeature.database, rp.pdfFeature.pdfPages)
    await del(rp.pdfFeature.database, rp.pdfFeature.tableCoords)
  }
  if (rp.relationFeature !== null) {
    await del(rp.relationFeature.database, rp.relationFeature.relation, 'master_db')
    await del(rp.relationFeature.database, rp.relationFeature.relation, 'foreign_db')
  }
  if (rp.uiPreferencesFeature !== null)
    await del(rp.uiPreferencesFeature.database, rp.uiPreferencesFeature.tableUiPrefs)
  if (rp.navigationItemsHidingFeature !== null) {
    await del(rp.navigationItemsHidingFeature.database, rp.navigationItemsHidingFeature.navigationHiding)
  }
  if (rp.savedQueryByExampleSearchesFeature !== null) {
    await del(
      rp.savedQueryByExampleSearchesFeature.database,
      rp.savedQueryByExampleSearchesFeature.savedSearches,
    )
  }
  if (rp.centralColumnsFeature !== null) {
    await del(rp.centralColumnsFeature.database, rp.centralColumnsFeature.centralColumns)
  }
}
