/**
 * Configuration-storage writers used by the table-level screens (Operations, Relation view, the
 * /sql purge after DROP TABLE). Every statement goes through the control link, like phpMyAdmin's
 * `queryAsControlUser`.
 *
 * pma: src/ConfigStorage/Relation.php::renameTable/renameSingleTable,
 *      src/ConfigStorage/RelationCleanup.php::table, src/Table/TableMover.php::duplicateInfo/moveCopy,
 *      src/Table/Table.php::updateInternalRelations/updateDisplayField
 */
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import type { MetaConn } from './conn.ts'
import type { RelationParameters } from './relation-parameters.ts'
import type { InternalRelation } from './relations.ts'

const q = (s: string) => quoteString(s)
const bq = backquote

/** pma: Relation::renameSingleTable */
async function renameSingleTable(
  conn: MetaConn,
  database: string,
  table: string,
  sourceDb: string,
  targetDb: string,
  sourceTable: string,
  targetTable: string,
  dbField: string,
  tableField: string,
): Promise<void> {
  await conn.query(
    `UPDATE ${bq(database)}.${bq(table)} SET ${dbField} = ${q(targetDb)}, ${tableField} = ${q(targetTable)} WHERE ${dbField}  = ${q(sourceDb)} AND ${tableField} = ${q(sourceTable)}`,
  )
}

/** pma: Relation::renameTable */
export async function renameTableInStorage(
  conn: MetaConn | null,
  rp: RelationParameters,
  sourceDb: string,
  targetDb: string,
  sourceTable: string,
  targetTable: string,
): Promise<void> {
  if (conn === null) return
  const args = [sourceDb, targetDb, sourceTable, targetTable] as const
  if (rp.columnCommentsFeature !== null) {
    const f = rp.columnCommentsFeature
    await renameSingleTable(conn, f.database, f.columnInfo, ...args, 'db_name', 'table_name')
  }
  if (rp.displayFeature !== null) {
    const f = rp.displayFeature
    await renameSingleTable(conn, f.database, f.tableInfo, ...args, 'db_name', 'table_name')
  }
  if (rp.relationFeature !== null) {
    const f = rp.relationFeature
    await renameSingleTable(conn, f.database, f.relation, ...args, 'foreign_db', 'foreign_table')
    await renameSingleTable(conn, f.database, f.relation, ...args, 'master_db', 'master_table')
  }
  if (rp.pdfFeature !== null) {
    const f = rp.pdfFeature
    if (sourceDb === targetDb) {
      await renameSingleTable(conn, f.database, f.tableCoords, ...args, 'db_name', 'table_name')
    } else {
      await conn.query(
        `DELETE FROM ${bq(f.database)}.${bq(f.tableCoords)} WHERE db_name  = ${q(sourceDb)} AND table_name = ${q(sourceTable)}`,
      )
    }
  }
  if (rp.uiPreferencesFeature !== null) {
    const f = rp.uiPreferencesFeature
    await renameSingleTable(conn, f.database, f.tableUiPrefs, ...args, 'db_name', 'table_name')
  }
  if (rp.navigationItemsHidingFeature === null) return
  const f = rp.navigationItemsHidingFeature
  await renameSingleTable(conn, f.database, f.navigationHiding, ...args, 'db_name', 'table_name')
  await conn.query(
    `UPDATE ${bq(f.database)}.${bq(f.navigationHiding)} SET db_name = ${q(targetDb)}, item_name = ${q(targetTable)} WHERE db_name  = ${q(sourceDb)} AND item_name = ${q(sourceTable)} AND item_type = 'table'`,
  )
}

/** pma: RelationCleanup::table (the /sql `purge` after DROP TABLE) */
export async function cleanupTableInStorage(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  table: string,
): Promise<void> {
  if (conn === null) return
  const del = (database: string, t: string, where: string) =>
    conn.query(`DELETE FROM ${bq(database)}.${bq(t)} WHERE ${where}`)
  const dt = `db_name = ${q(db)} AND table_name = ${q(table)}`
  if (rp.columnCommentsFeature !== null)
    await del(rp.columnCommentsFeature.database, rp.columnCommentsFeature.columnInfo, dt)
  if (rp.displayFeature !== null) await del(rp.displayFeature.database, rp.displayFeature.tableInfo, dt)
  if (rp.pdfFeature !== null) await del(rp.pdfFeature.database, rp.pdfFeature.tableCoords, dt)
  if (rp.relationFeature !== null) {
    const f = rp.relationFeature
    await del(f.database, f.relation, `master_db = ${q(db)} AND master_table = ${q(table)}`)
    await del(f.database, f.relation, `foreign_db = ${q(db)} AND foreign_table = ${q(table)}`)
  }
  if (rp.uiPreferencesFeature !== null)
    await del(rp.uiPreferencesFeature.database, rp.uiPreferencesFeature.tableUiPrefs, dt)
  if (rp.navigationItemsHidingFeature !== null) {
    const f = rp.navigationItemsHidingFeature
    await del(
      f.database,
      f.navigationHiding,
      `db_name = ${q(db)} AND (table_name = ${q(table)} OR (item_name = ${q(table)} AND item_type = 'table'))`,
    )
  }
}

/**
 * pma: TableMover::duplicateInfo — copies rows of one storage table with some fields replaced.
 * `feature` is the storage table of the work flag (null = feature off → nothing to do).
 */
export async function duplicateInfo(
  conn: MetaConn | null,
  database: string | null,
  table: string | null,
  getFields: string[],
  whereFields: Record<string, string>,
  newFields: Record<string, string>,
): Promise<void> {
  if (conn === null || database === null || table === null) return
  const select = getFields.map((f) => bq(f))
  const where = Object.entries(whereFields).map(([k, v]) => `${bq(k)} = ${q(v)}`)
  const newParts = Object.keys(newFields).map((k) => bq(k))
  const newValues = Object.values(newFields).map((v) => q(v))
  const r = await conn.query(`
            SELECT ${select.join(', ')}
              FROM ${bq(database)}.${bq(table)}
             WHERE ${where.join(' AND ')}`)
  for (const row of r.rows) {
    const values = getFields.map((f) => q(row[f] ?? ''))
    await conn.query(
      `INSERT IGNORE INTO ${bq(database)}.${bq(table)} (${select.join(', ')}, ${newParts.join(', ')}) VALUES (${values.join(', ')}, ${newValues.join(', ')})`,
    )
  }
}

/**
 * The pmadb copies of a table copy (TableMover::moveCopy after the data, copy only):
 * column comments / MIME, display field and relations in both directions.
 */
export async function duplicateTableInfo(
  conn: MetaConn | null,
  rp: RelationParameters,
  sourceDb: string,
  sourceTable: string,
  targetDb: string,
  targetTable: string,
): Promise<void> {
  if (conn === null) return
  const cc = rp.columnCommentsFeature
  if (cc !== null) {
    const mime = rp.browserTransformationFeature !== null
    const r = await conn.query(
      `SELECT column_name, comment${mime ? ', mimetype, transformation, transformation_options' : ''} FROM ${bq(cc.database)}.${bq(cc.columnInfo)} WHERE  db_name = ${q(sourceDb)} AND  table_name = ${q(sourceTable)}`,
    )
    for (const row of r.rows) {
      await conn.query(
        `REPLACE INTO ${bq(cc.database)}.${bq(cc.columnInfo)} (db_name, table_name, column_name, comment${mime ? ', mimetype, transformation, transformation_options' : ''}) VALUES(${q(targetDb)},${q(targetTable)},${q(row.column_name ?? '')},${q(row.comment ?? '')}${mime ? `,${q(row.mimetype ?? '')},${q(row.transformation ?? '')},${q(row.transformation_options ?? '')}` : ''})`,
      )
    }
  }
  // RelationParameters::toArray: displaywork + table_info, relwork + relation
  const display = rp.displayFeature
  await duplicateInfo(
    conn,
    display === null ? null : rp.db,
    display === null ? null : display.tableInfo,
    ['display_field'],
    { db_name: sourceDb, table_name: sourceTable },
    { db_name: targetDb, table_name: targetTable },
  )
  const rel = rp.relationFeature
  await duplicateInfo(
    conn,
    rel === null ? null : rp.db,
    rel === null ? null : rel.relation,
    ['master_field', 'foreign_table', 'foreign_field'],
    { master_db: sourceDb, master_table: sourceTable },
    { master_db: targetDb, foreign_db: targetDb, master_table: targetTable },
  )
  await duplicateInfo(
    conn,
    rel === null ? null : rp.db,
    rel === null ? null : rel.relation,
    ['foreign_field', 'master_table', 'master_field'],
    { foreign_db: sourceDb, foreign_table: sourceTable },
    { master_db: targetDb, foreign_db: targetDb, foreign_table: targetTable },
  )
}

/** One row of the Relation view's internal relationships card. */
export interface InternalRelationInput {
  masterField: string
  foreignDb: string
  foreignTable: string
  foreignField: string
}

/**
 * pma: Table::updateInternalRelations — INSERT / UPDATE / DELETE per master column.
 * Returns whether anything was written.
 */
export async function updateInternalRelations(
  conn: MetaConn,
  rp: RelationParameters,
  db: string,
  table: string,
  rows: readonly InternalRelationInput[],
  existing: Record<string, InternalRelation>,
): Promise<boolean> {
  const f = rp.relationFeature
  if (f === null) return false
  const target = `${bq(f.database)}.${bq(f.relation)}`
  let updated = false
  for (const r of rows) {
    let sql: string | null = null
    const ex = existing[r.masterField]
    if (r.foreignDb !== '' && r.foreignTable !== '' && r.foreignField !== '') {
      if (ex === undefined) {
        sql = `INSERT INTO ${target}(master_db, master_table, master_field, foreign_db, foreign_table, foreign_field) values(${q(db)}, ${q(table)}, ${q(r.masterField)}, ${q(r.foreignDb)}, ${q(r.foreignTable)},${q(r.foreignField)})`
      } else if (
        ex.foreign_db !== r.foreignDb ||
        ex.foreign_table !== r.foreignTable ||
        ex.foreign_field !== r.foreignField
      ) {
        sql = `UPDATE ${target} SET foreign_db       = ${q(r.foreignDb)},  foreign_table    = ${q(r.foreignTable)},  foreign_field    = ${q(r.foreignField)}  WHERE master_db  = ${q(db)} AND master_table = ${q(table)} AND master_field = ${q(r.masterField)}`
      }
    } else if (ex !== undefined) {
      sql = `DELETE FROM ${target} WHERE master_db  = ${q(db)} AND master_table = ${q(table)} AND master_field = ${q(r.masterField)}`
    }
    if (sql === null) continue
    await conn.query(sql)
    updated = true
  }
  return updated
}

/** pma: Table::updateDisplayField */
export async function updateDisplayField(
  conn: MetaConn,
  rp: RelationParameters,
  db: string,
  table: string,
  displayField: string,
): Promise<void> {
  const f = rp.displayFeature
  if (f === null) return
  const target = `${bq(f.database)}.${bq(f.tableInfo)}`
  await conn.query(
    displayField === ''
      ? `DELETE FROM ${target} WHERE db_name  = ${q(db)} AND table_name = ${q(table)}`
      : `REPLACE INTO ${target}(db_name, table_name, display_field) VALUES(${q(db)},${q(table)},${q(displayField)})`,
  )
}

/** pma: Relation::renameField (a renamed column in table_info.display_field and both relation ends) */
export async function renameField(
  conn: MetaConn,
  rp: RelationParameters,
  db: string,
  table: string,
  field: string,
  newName: string,
): Promise<void> {
  const d = rp.displayFeature
  if (d !== null) {
    await conn.query(
      `UPDATE ${bq(d.database)}.${bq(d.tableInfo)}   SET display_field = ${q(newName)} WHERE db_name       = ${q(db)}   AND table_name    = ${q(table)}   AND display_field = ${q(field)}`,
    )
  }
  const r = rp.relationFeature
  if (r === null) return
  const target = `${bq(r.database)}.${bq(r.relation)}`
  await conn.query(
    `UPDATE ${target}   SET master_field = ${q(newName)} WHERE master_db    = ${q(db)}   AND master_table = ${q(table)}   AND master_field = ${q(field)}`,
  )
  await conn.query(
    `UPDATE ${target}   SET foreign_field = ${q(newName)} WHERE foreign_db    = ${q(db)}   AND foreign_table = ${q(table)}   AND foreign_field = ${q(field)}`,
  )
}

export interface MimeInput {
  mimetype: string
  transformation: string
  transformationOptions: string
  inputTransformation: string
  inputTransformationOptions: string
}

/**
 * pma: Transformations::setMime — the column's row of column_info is updated, inserted, or deleted
 * (no value left and no comment), through the control link.
 */
export async function setMime(
  conn: MetaConn,
  rp: RelationParameters,
  db: string,
  table: string,
  key: string,
  mime: MimeInput,
  forcedelete = false,
): Promise<boolean> {
  const f = rp.browserTransformationFeature
  if (f === null) return false
  const target = `${bq(f.database)}.${bq(f.columnInfo)}`
  // lowercase mimetype & transformation
  const mimetype = mime.mimetype.toLowerCase()
  const transformation = mime.transformation.toLowerCase()
  const {
    transformationOptions: opts,
    inputTransformation: input,
    inputTransformationOptions: inputOpts,
  } = mime
  const hasValue = mimetype !== '' || transformation !== '' || opts !== '' || input !== '' || inputOpts !== ''
  const test = await conn.query(
    `
             SELECT \`mimetype\`,
                    \`comment\`
               FROM ${target}
              WHERE \`db_name\`     = ${q(db)}
                AND \`table_name\`  = ${q(table)}
                AND \`column_name\` = ${q(key)}`,
  )
  const where = `
                WHERE \`db_name\`     = ${q(db)}
                  AND \`table_name\`  = ${q(table)}
                  AND \`column_name\` = ${q(key)}`
  let sql: string | null = null
  const row = test.rows[0]
  if (row !== undefined) {
    const comment = row.comment ?? null
    if (!forcedelete && (hasValue || (comment !== null && comment !== ''))) {
      sql = `UPDATE ${target} SET \`mimetype\` = ${q(mimetype)}, \`transformation\` = ${q(transformation)}, \`transformation_options\` = ${q(opts)}, \`input_transformation\` = ${q(input)}, \`input_transformation_options\` = ${q(inputOpts)}${where}`
    } else {
      sql = `DELETE FROM ${target}${where}`
    }
  } else if (hasValue) {
    sql = `INSERT INTO ${target} (db_name, table_name, column_name, mimetype, transformation, transformation_options, input_transformation, input_transformation_options)  VALUES(${q(db)},${q(table)},${q(key)},${q(mimetype)},${q(transformation)},${q(opts)},${q(input)},${q(inputOpts)})`
  }
  if (sql === null) return false
  return (await conn.tryQuery(sql)) !== false
}
