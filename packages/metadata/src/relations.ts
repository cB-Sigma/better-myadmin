import { getTypeClass } from '@bettermyadmin/mysql-types'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import internalRelations from '../resources/internal-relations.json' with { type: 'json' }
import { type MetaConn, fetchValue } from './conn.ts'
import type { RelationParameters } from './relation-parameters.ts'

const q = (s: string) => quoteString(s)

export interface InternalRelation {
  foreign_db: string
  foreign_table: string
  foreign_field: string
}

/** pma: src/InternalRelations.php (generated into resources/internal-relations.json) */
export const INTERNAL_RELATIONS = internalRelations as {
  information_schema: Record<string, Record<string, InternalRelation>>
  mysql: Record<string, Record<string, InternalRelation>>
}

/**
 * Internal relations of a table (pma__relation), merged with the hard-coded relations of
 * `information_schema` / `mysql` for fields not already present.
 *
 * pma: src/ConfigStorage/Relation.php::getForeignersInternal
 */
export async function getForeignersInternal(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  table: string,
  column = '',
): Promise<Record<string, InternalRelation>> {
  const foreign: Record<string, InternalRelation> = {}
  const f = rp.relationFeature
  if (f !== null && conn !== null) {
    let relQuery = `SELECT \`master_field\`, \`foreign_db\`, \`foreign_table\`, \`foreign_field\` FROM ${backquote(f.database)}.${backquote(f.relation)} WHERE \`master_db\` = ${q(db)} AND \`master_table\` = ${q(table)}`
    if (column !== '') relQuery += ` AND \`master_field\` = ${q(column)}`
    const r = await conn.tryQuery(relQuery)
    if (r !== false) {
      for (const row of r.rows) {
        foreign[row.master_field ?? ''] = {
          foreign_db: row.foreign_db ?? '',
          foreign_table: row.foreign_table ?? '',
          foreign_field: row.foreign_field ?? '',
        }
      }
    }
  }
  const lower = db.toLowerCase()
  if (lower === 'information_schema' || lower === 'mysql') {
    const map =
      lower === 'information_schema' ? INTERNAL_RELATIONS.information_schema : INTERNAL_RELATIONS.mysql
    const rels = map[table]
    if (rels !== undefined) {
      for (const [field, rel] of Object.entries(rels)) {
        if ((column !== '' && column !== field) || foreign[field] !== undefined) continue
        foreign[field] = rel
      }
    }
  }
  return foreign
}

export interface ColumnLike {
  field: string
  type: string
  comment?: string
}

/**
 * The display column of a table: pma__table_info, then the information_schema special cases,
 * then the first CHAR-class column.
 *
 * pma: src/ConfigStorage/Relation.php::getDisplayField
 */
export async function getDisplayField(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  table: string,
  columns: () => Promise<ColumnLike[]>,
): Promise<string> {
  const f = rp.displayFeature
  if (f !== null && conn !== null) {
    const v = await fetchValue(
      conn,
      `SELECT \`display_field\` FROM ${backquote(f.database)}.${backquote(f.tableInfo)} WHERE \`db_name\` = ${q(db)} AND \`table_name\` = ${q(table)}`,
    )
    if (typeof v === 'string') return v
  }
  if (db === 'information_schema') {
    if (table === 'CHARACTER_SETS') return 'DESCRIPTION'
    if (table === 'TABLES') return 'TABLE_COMMENT'
  }
  for (const c of await columns()) {
    const columnType = c.type.replace(/(\(.*)|(\s\/.*)/s, '')
    if (getTypeClass(columnType) === 'CHAR') return c.field
  }
  return ''
}

/** Native column comments. pma: Relation::getComments */
export function getComments(columns: readonly ColumnLike[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of columns) if (c.comment !== undefined && c.comment !== '') out[c.field] = c.comment
  return out
}

/** pma: Relation::getDbComment */
export async function getDbComment(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
): Promise<string> {
  const f = rp.columnCommentsFeature
  if (f === null || conn === null) return ''
  const r = await conn.tryQuery(
    `SELECT \`comment\` FROM ${backquote(f.database)}.${backquote(f.columnInfo)} WHERE db_name = ${q(db)} AND table_name  = '' AND column_name = '(db_comment)'`,
  )
  if (r === false || r.rows.length === 0) return ''
  return r.rows[0]?.comment ?? ''
}

/** pma: Relation::setDbComment */
export async function setDbComment(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  comment = '',
): Promise<boolean> {
  const f = rp.columnCommentsFeature
  if (f === null || conn === null) return false
  const table = `${backquote(f.database)}.${backquote(f.columnInfo)}`
  const sql =
    comment !== ''
      ? `INSERT INTO ${table} (\`db_name\`, \`table_name\`, \`column_name\`, \`comment\`) VALUES (${q(db)}, '', '(db_comment)', ${q(comment)})  ON DUPLICATE KEY UPDATE \`comment\` = ${q(comment)}`
      : `DELETE FROM ${table} WHERE \`db_name\`     = ${q(db)}
                    AND \`table_name\`  = ''
                    AND \`column_name\` = '(db_comment)'`
  await conn.query(sql)
  return true
}

export interface MimeInfo {
  column_name: string
  mimetype: string
  transformation: string
  transformation_options: string
  input_transformation: string
  input_transformation_options: string
}

/** pma: src/Transformations.php::fixUpMime */
export function fixUpMime(value: string): string {
  const v = value.replaceAll('jpeg', 'JPEG').replaceAll('png', 'PNG')
  // ucwords: upper-case the first character of each word (delimiters: space, tab, CR, LF, FF, VT)
  const spaced = v.replace(/([0-9_]+)/g, '$1 ')
  const words = spaced.replace(
    /(^|[ \t\r\n\f\v])([^ \t\r\n\f\v])/g,
    (_, sep: string, ch: string) => sep + ch.toUpperCase(),
  )
  return words.replaceAll(' ', '')
}

/**
 * MIME types and transformations of a table's columns (pma__column_info).
 * pma: src/Transformations.php::getMime
 */
export async function getMime(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  table: string,
  strict = false,
  fullName = false,
): Promise<Record<string, MimeInfo> | null> {
  const f = rp.browserTransformationFeature
  if (f === null || conn === null) return null
  let comQry = fullName
    ? "SELECT CONCAT(`db_name`, '.', `table_name`, '.', `column_name`) AS column_name, "
    : 'SELECT `column_name`, '
  comQry += `\`mimetype\`, \`transformation\`, \`transformation_options\`, \`input_transformation\`, \`input_transformation_options\` FROM ${backquote(f.database)}.${backquote(f.columnInfo)} WHERE \`db_name\` = ${q(db)} AND \`table_name\` = ${q(table)} AND ( \`mimetype\` != ''${strict ? '' : " OR `transformation` != '' OR `transformation_options` != '' OR `input_transformation` != '' OR `input_transformation_options` != ''"})`
  const r = await conn.tryQuery(comQry)
  const out: Record<string, MimeInfo> = {}
  if (r === false) return out
  for (const row of r.rows) {
    const values: MimeInfo = {
      column_name: row.column_name ?? '',
      mimetype: fixUpMime(row.mimetype ?? ''),
      transformation: row.transformation ?? '',
      transformation_options: row.transformation_options ?? '',
      input_transformation: row.input_transformation ?? '',
      input_transformation_options: row.input_transformation_options ?? '',
    }
    // For transformation of form output/image_jpeg__inline.inc.php extract dir part.
    const dir = values.transformation.split('/')
    let subdir = ''
    if (dir.length === 2) {
      subdir = `${ucfirst(dir[0] as string)}/`
      values.transformation = dir[1] as string
    }
    values.transformation = subdir + fixUpMime(values.transformation)
    out[values.column_name] = values
  }
  return out
}

const ucfirst = (s: string) => (s === '' ? s : s[0]?.toUpperCase() + s.slice(1))
