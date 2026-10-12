import { backquote as bq, quoteString as q } from '@bettermyadmin/sql-gen'
import { type MetaConn, fetchValue } from './conn.ts'
import { phpJsonDecode, phpJsonEncode } from './php.ts'
import type { RelationParameters } from './relation-parameters.ts'

/**
 * The Designer's configuration storage (control link): pages (`pma__pdf_pages`), table positions
 * (`pma__table_coords`), the side menu settings (`pma__designer_settings`) and internal relations
 * added or removed from the canvas (`pma__relation`).
 * pma: src/Database/Designer/Common.php, src/Database/Designer.php, src/ConfigStorage/Relation.php::createPage
 */

type PdfFeature = NonNullable<RelationParameters['pdfFeature']>
const pages = (f: PdfFeature) => `${bq(f.database)}.${bq(f.pdfPages)}`
const coords = (f: PdfFeature) => `${bq(f.database)}.${bq(f.tableCoords)}`

export interface TablePosition {
  /** `db.table` */
  name: string
  dbName: string
  tableName: string
  x: string
  y: string
}

/** Common::getTablePositions (V and H are always 1 there) */
export async function designerTablePositions(
  conn: MetaConn | null,
  rp: RelationParameters,
  page: number,
): Promise<Map<string, TablePosition>> {
  const out = new Map<string, TablePosition>()
  const f = rp.pdfFeature
  if (conn === null || f === null) return out
  const r = await conn.query(`
            SELECT CONCAT_WS('.', \`db_name\`, \`table_name\`) AS \`name\`,
                \`db_name\` as \`dbName\`, \`table_name\` as \`tableName\`,
                \`x\` AS \`X\`,
                \`y\` AS \`Y\`,
                1 AS \`V\`,
                1 AS \`H\`
            FROM ${coords(f)}
            WHERE pdf_page_number = ${page}`)
  for (const row of r.rows) {
    const name = row.name ?? ''
    out.set(name, {
      name,
      dbName: row.dbName ?? '',
      tableName: row.tableName ?? '',
      x: row.X ?? '0',
      y: row.Y ?? '0',
    })
  }
  return out
}

/** Common::getPageName */
export async function designerPageName(
  conn: MetaConn | null,
  rp: RelationParameters,
  page: number,
): Promise<string | null> {
  const f = rp.pdfFeature
  if (conn === null || f === null) return null
  const v = await fetchValue(conn, `SELECT \`page_descr\` FROM ${pages(f)} WHERE \`page_nr\` = ${page}`)
  return v === false ? null : v
}

/** Common::deletePage */
export async function designerDeletePage(
  conn: MetaConn | null,
  rp: RelationParameters,
  page: number,
): Promise<boolean> {
  const f = rp.pdfFeature
  if (conn === null || f === null) return false
  await conn.query(`DELETE FROM ${coords(f)} WHERE \`pdf_page_number\` = ${page}`)
  await conn.query(`DELETE FROM ${pages(f)} WHERE \`page_nr\` = ${page}`)
  return true
}

/** Common::getDefaultPage: the page named after the database */
export async function designerDefaultPage(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
): Promise<number> {
  const f = rp.pdfFeature
  if (conn === null || f === null) return -1
  const v = await fetchValue(
    conn,
    `SELECT \`page_nr\` FROM ${pages(f)} WHERE \`db_name\` = ${q(db)} AND \`page_descr\` = ${q(db)}`,
  )
  return typeof v === 'string' ? Number.parseInt(v, 10) : -1
}

/** Common::getPageExists (any database) */
export async function designerPageExists(
  conn: MetaConn | null,
  rp: RelationParameters,
  name: string,
): Promise<boolean> {
  const f = rp.pdfFeature
  if (conn === null || f === null) return false
  const r = await conn.tryQuery(`SELECT \`page_nr\` FROM ${pages(f)} WHERE \`page_descr\` = ${q(name)}`)
  return r !== false && r.rows.length > 0
}

/** Common::getLoadingPage: the default page, else the database's first page */
export async function designerLoadingPage(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
): Promise<number> {
  const f = rp.pdfFeature
  if (conn === null || f === null) return -1
  const def = await designerDefaultPage(conn, rp, db)
  if (def !== -1) return def
  const v = await fetchValue(conn, `SELECT MIN(\`page_nr\`) FROM ${pages(f)} WHERE \`db_name\` = ${q(db)}`)
  return typeof v === 'string' ? Number.parseInt(v, 10) : -1
}

/** Relation::createPage: the new page's id (`'no description'` translated by the caller when empty) */
export async function designerCreatePage(
  conn: MetaConn | null,
  rp: RelationParameters,
  name: string,
  db: string,
): Promise<number | null> {
  const f = rp.pdfFeature
  if (conn === null || f === null) return null
  const r = await conn.tryQuery(`INSERT INTO ${pages(f)} (db_name, page_descr) VALUES (${q(db)}, ${q(name)})`)
  return r === false ? 0 : (r.insertId ?? 0)
}

export interface TableCoordinate {
  db: string
  table: string
  x: string
  y: string
  /** t_h: shown on the page */
  visible: boolean
}

/** Common::saveTablePositions: the page's coordinates are replaced by the shown tables' */
export async function designerSavePositions(
  conn: MetaConn | null,
  rp: RelationParameters,
  page: number,
  tables: readonly TableCoordinate[],
): Promise<boolean> {
  const f = rp.pdfFeature
  if (conn === null || f === null) return false
  const pageId = q(String(page))
  await conn.query(`DELETE FROM ${coords(f)} WHERE \`pdf_page_number\` = ${pageId}`)
  for (const t of tables) {
    if (!t.visible) continue
    await conn.query(
      `INSERT INTO ${coords(f)} (\`db_name\`, \`table_name\`, \`pdf_page_number\`, \`x\`, \`y\`) VALUES (${q(t.db)}, ${q(t.table)}, ${pageId}, ${q(t.x)}, ${q(t.y)})`,
    )
  }
  return true
}

/** Designer::getPageIdsAndNames, ordered by name */
export async function designerPages(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
): Promise<Array<{ id: number; name: string }>> {
  const f = rp.pdfFeature
  if (conn === null || f === null) return []
  const r = await conn.tryQuery(
    `SELECT \`page_nr\`, \`page_descr\` FROM ${pages(f)} WHERE db_name = ${q(db)} ORDER BY \`page_descr\``,
  )
  if (r === false) return []
  return r.rows.map((row) => ({ id: Number.parseInt(row.page_nr ?? '0', 10), name: row.page_descr ?? '' }))
}

/** Designer::getSideMenuParamsArray: the user's designer settings (`settings_data` JSON) */
export async function designerSettings(
  conn: MetaConn | null,
  rp: RelationParameters,
  user: string,
): Promise<Record<string, unknown>> {
  const f = rp.databaseDesignerSettingsFeature
  if (conn === null || f === null) return {}
  const r = await conn.tryQuery(
    `SELECT \`settings_data\` FROM ${bq(f.database)}.${bq(f.designerSettings)} WHERE \`username\` = ${q(user)};`,
  )
  const row = r === false ? undefined : r.rows[0]
  if (row === undefined) return {}
  const v = phpJsonDecode(row.settings_data ?? '')
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

/** Common::saveSetting: one key of the user's designer settings */
export async function designerSaveSetting(
  conn: MetaConn | null,
  rp: RelationParameters,
  user: string,
  index: string,
  value: string,
): Promise<boolean> {
  const f = rp.databaseDesignerSettingsFeature
  if (conn === null || f === null) return true
  const t = `${bq(f.database)}.${bq(f.designerSettings)}`
  const r = await conn.tryQuery(`SELECT settings_data FROM ${t} WHERE username = ${q(user)};`)
  const row = r === false ? undefined : r.rows[0]
  if (row !== undefined) {
    const decoded = phpJsonDecode(row.settings_data ?? '')
    const data: Record<string, unknown> =
      decoded !== null && typeof decoded === 'object' ? { ...(decoded as Record<string, unknown>) } : {}
    data[index] = value
    await conn.query(`UPDATE ${t} SET settings_data = ${q(phpJsonEncode(data))} WHERE username = ${q(user)};`)
  } else {
    await conn.query(
      `INSERT INTO ${t} (username, settings_data) VALUES(${q(user)}, ${q(phpJsonEncode({ [index]: value }))});`,
    )
  }
  return true
}

/** Common::addNewRelation (internal relation part); the error text, or null */
export async function designerAddInternalRelation(
  conn: MetaConn,
  rp: RelationParameters,
  r: {
    masterDb: string
    masterTable: string
    masterField: string
    foreignDb: string
    foreignTable: string
    foreignField: string
  },
): Promise<string | null> {
  const f = rp.relationFeature
  if (f === null) return 'disabled'
  const ok = await conn.tryQuery(
    `INSERT INTO ${bq(f.database)}.${bq(f.relation)}(master_db, master_table, master_field, foreign_db, foreign_table, foreign_field) values(${q(r.masterDb)}, ${q(r.masterTable)}, ${q(r.masterField)}, ${q(r.foreignDb)}, ${q(r.foreignTable)}, ${q(r.foreignField)})`,
  )
  return ok === false ? `#${conn.lastErrno} - ${conn.lastError}` : null
}

/** Common::removeRelation (internal relation part); the error text, or null */
export async function designerRemoveInternalRelation(
  conn: MetaConn,
  rp: RelationParameters,
  r: {
    masterDb: string
    masterTable: string
    masterField: string
    foreignDb: string
    foreignTable: string
    foreignField: string
  },
): Promise<string | null> {
  const f = rp.relationFeature
  if (f === null) return 'disabled'
  const ok = await conn.tryQuery(
    `DELETE FROM ${bq(f.database)}.${bq(f.relation)} WHERE master_db = ${q(r.masterDb)} AND master_table = ${q(r.masterTable)} AND master_field = ${q(r.masterField)} AND foreign_db = ${q(r.foreignDb)} AND foreign_table = ${q(r.foreignTable)} AND foreign_field = ${q(r.foreignField)}`,
  )
  return ok === false ? `#${conn.lastErrno} - ${conn.lastError}` : null
}
