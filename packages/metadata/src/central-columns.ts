import { extractColumnSpec } from '@bettermyadmin/mysql-types'
import { backquote, quoteString as q } from '@bettermyadmin/sql-gen'
import { type MetaConn, type Row, fetchValue, firstColumn } from './conn.ts'
import type { RelationParameters } from './relation-parameters.ts'

/**
 * The central list of columns (`pma__central_columns`, control link).
 * pma: src/Database/CentralColumns.php
 */

/** The column of a table, as DatabaseInterface::getColumns gives it (a `Column`). */
export interface CentralColumnDef {
  field: string
  type: string
  collation: string | null
  isNull: boolean
  extra: string
  default: string | null
}

/** A row of the central list after CentralColumns::handleColumnExtra. */
export interface CentralColumnRow {
  db_name: string
  col_name: string
  col_type: string
  col_length: string
  col_collation: string
  col_isNull: string
  col_extra: string
  col_attribute: string
  col_default: string | null
}

const tableOf = (rp: RelationParameters) => {
  const f = rp.centralColumnsFeature
  return f === null ? null : `${backquote(f.database)}.${backquote(f.centralColumns)}`
}

/** DatabaseInterface::getError: `#errno - message` */
const errorOf = (conn: MetaConn) => `#${conn.lastErrno} - ${conn.lastError}`

const whereIn = (cols: readonly string[]) => cols.map((c) => q(c)).join(',')

/** CentralColumns::handleColumnExtra: `col_extra` holds extra and attribute, comma separated. */
function handleColumnExtra(rows: Row[]): CentralColumnRow[] {
  return rows.map((r) => {
    const vals = (r.col_extra ?? '').split(',')
    const attribute = vals.includes('BINARY')
      ? 'BINARY'
      : vals.includes('UNSIGNED')
        ? 'UNSIGNED'
        : vals.includes('UNSIGNED ZEROFILL')
          ? 'UNSIGNED ZEROFILL'
          : vals.includes('on update CURRENT_TIMESTAMP')
            ? 'on update CURRENT_TIMESTAMP'
            : ''
    return {
      db_name: r.db_name ?? '',
      col_name: r.col_name ?? '',
      col_type: r.col_type ?? '',
      col_length: r.col_length ?? '',
      col_collation: r.col_collation ?? '',
      col_isNull: r.col_isNull ?? '',
      col_extra: vals.includes('auto_increment') ? 'auto_increment' : '',
      col_attribute: attribute,
      col_default: r.col_default ?? null,
    }
  })
}

/** CentralColumns::getColumnsList ($num = 0: every column) */
export async function centralColumnsList(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  from = 0,
  num = 25,
): Promise<CentralColumnRow[]> {
  const t = tableOf(rp)
  if (conn === null || t === null) return []
  const sql =
    num === 0
      ? `SELECT * FROM ${t} WHERE db_name = ${q(db)};`
      : `SELECT * FROM ${t} WHERE db_name = ${q(db)} LIMIT ${from}, ${num};`
  const r = await conn.tryQuery(sql)
  return r === false ? [] : handleColumnExtra(r.rows)
}

/** CentralColumns::getCount */
export async function centralColumnsCount(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
): Promise<number> {
  const t = tableOf(rp)
  if (conn === null || t === null) return 0
  const v = await fetchValue(conn, `SELECT count(db_name) FROM ${t} WHERE db_name = ${q(db)};`)
  return v === false ? 0 : Number.parseInt(v ?? '0', 10) || 0
}

/**
 * CentralColumns::getColumnsCount — phpMyAdmin appends `LIMIT` without a space (`… = 'db'LIMIT 0, 25`),
 * which MySQL accepts; the count is of all columns, the LIMIT only applies to the one-row result.
 */
export async function centralColumnsCountPage(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  from: number,
  num: number,
): Promise<number> {
  const t = tableOf(rp)
  if (conn === null || t === null) return 0
  const v = await fetchValue(
    conn,
    `SELECT COUNT(db_name) FROM ${t} WHERE db_name = ${q(db)}${num === 0 ? '' : `LIMIT ${from}, ${num}`};`,
  )
  return typeof v === 'string' ? Number.parseInt(v, 10) || 0 : -1
}

/** CentralColumns::findExistingColNames */
export async function findExistingColNames(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  cols: readonly string[],
): Promise<string[]> {
  const t = tableOf(rp)
  if (conn === null || t === null) return []
  const r = await conn.tryQuery(
    `SELECT col_name FROM ${t} WHERE db_name = ${q(db)} AND col_name IN (${whereIn(cols)});`,
  )
  return r === false ? [] : firstColumn(r)
}

/** CentralColumns::findExistingColumns */
export async function findExistingColumns(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  cols: readonly string[],
): Promise<CentralColumnRow[]> {
  const t = tableOf(rp)
  if (conn === null || t === null) return []
  const r = await conn.tryQuery(
    `SELECT * FROM ${t} WHERE db_name = ${q(db)} AND col_name IN (${whereIn(cols)});`,
  )
  return r === false ? [] : handleColumnExtra(r.rows)
}

/** CentralColumns::getInsertQuery */
function insertQuery(t: string, def: CentralColumnDef, db: string): string {
  const spec = extractColumnSpec(def.type)
  const attribute = spec.attribute.trim()
  return `INSERT INTO ${t} VALUES ( ${q(db)} ,${q(def.field)},${q(spec.type)},${q(spec.spec_in_brackets)},${q(
    def.collation ?? '',
  )},${q(def.isNull ? '1' : '0')},'${[def.extra, attribute].join(',')}',${q(def.default ?? '')});`
}

export type CentralResult =
  | { ok: true }
  | { ok: false; kind: 'storage' }
  | { ok: false; kind: 'exists'; columns: string }
  | { ok: false; kind: 'notExist'; columns: string }
  | { ok: false; kind: 'addError'; error: string }
  | { ok: false; kind: 'removeError'; columns: string; error: string }
  | { ok: false; kind: 'error'; error: string }

/**
 * CentralColumns::syncUniqueColumns: the columns of the given tables (`tables`) or the given
 * columns of `columnsOf` (`columns`) that are not yet in the list are added.
 */
export async function syncUniqueColumns(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  select:
    | { tables: string[]; getColumns: (table: string) => Promise<CentralColumnDef[]> }
    | { columns: string[]; getColumn: (column: string) => Promise<CentralColumnDef | null> },
): Promise<CentralResult> {
  const t = tableOf(rp)
  if (conn === null || t === null) return { ok: false, kind: 'storage' }
  const existing: string[] = []
  const inserts: string[] = []
  if ('tables' in select) {
    const fields = new Map<string, CentralColumnDef[]>()
    const cols: string[] = []
    for (const table of select.tables) {
      const f = await select.getColumns(table)
      fields.set(table, f)
      cols.push(...f.map((c) => c.field))
    }
    const has = await findExistingColNames(conn, rp, db, cols)
    for (const table of select.tables) {
      for (const def of fields.get(table) ?? []) {
        if (!has.includes(def.field)) {
          has.push(def.field)
          inserts.push(insertQuery(t, def, db))
        } else existing.push(`'${def.field}'`)
      }
    }
  } else {
    const has = await findExistingColNames(conn, rp, db, select.columns)
    for (const column of select.columns) {
      if (!has.includes(column)) {
        has.push(column)
        const def = await select.getColumn(column)
        if (def !== null) inserts.push(insertQuery(t, def, db))
      } else existing.push(`'${column}'`)
    }
  }
  let result: CentralResult = { ok: true }
  if (existing.length > 0) result = { ok: false, kind: 'exists', columns: [...new Set(existing)].join(',') }
  for (const sql of inserts) {
    if ((await conn.tryQuery(sql)) === false) return { ok: false, kind: 'addError', error: errorOf(conn) }
  }
  return result
}

/**
 * CentralColumns::deleteColumnsFromList: every column of the given tables, or the given columns.
 */
export async function deleteColumnsFromList(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  select: { tables: string[]; getColumnNames: (table: string) => Promise<string[]> } | { columns: string[] },
): Promise<CentralResult> {
  const t = tableOf(rp)
  if (conn === null || t === null) return { ok: false, kind: 'storage' }
  const notExist: string[] = []
  let cols: string[]
  if ('tables' in select) {
    cols = []
    const fields = new Map<string, string[]>()
    for (const table of select.tables) {
      const f = await select.getColumnNames(table)
      fields.set(table, f)
      cols.push(...f)
    }
    const has = await findExistingColNames(conn, rp, db, cols)
    for (const table of select.tables) {
      for (const c of fields.get(table) ?? []) if (!has.includes(c)) notExist.push(`'${c}'`)
    }
  } else {
    cols = select.columns
    const has = await findExistingColNames(conn, rp, db, cols)
    for (const c of cols) if (!has.includes(c)) notExist.push(`'${c}'`)
  }
  let result: CentralResult = { ok: true }
  if (notExist.length > 0) result = { ok: false, kind: 'notExist', columns: [...new Set(notExist)].join(',') }
  const list = whereIn(cols)
  if (
    (await conn.tryQuery(`DELETE FROM ${t} WHERE db_name = ${q(db)} AND col_name IN (${list});`)) === false
  ) {
    return { ok: false, kind: 'removeError', columns: list, error: errorOf(conn) }
  }
  return result
}

/**
 * CentralColumns::updateOneColumn: INSERT when `origColName` is '' (a new column), else UPDATE.
 * phpMyAdmin concatenates the boolean `col_isNull` into the UPDATE, so NOT NULL gives
 * `col_isNull = ,` and the update fails with a syntax error; kept as is.
 */
export async function updateOneColumn(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  v: {
    origColName: string
    colName: string
    colType: string
    colAttribute: string
    colLength: string
    colIsNull: boolean
    collation: string
    colExtra: string
    colDefault: string
  },
): Promise<CentralResult> {
  const t = tableOf(rp)
  if (conn === null || t === null) return { ok: false, kind: 'storage' }
  const sql =
    v.origColName === ''
      ? insertQuery(
          t,
          {
            field: v.colName,
            type: v.colType + (v.colLength !== '' ? `(${v.colLength})` : ''),
            collation: v.collation,
            isNull: v.colIsNull,
            extra: v.colExtra,
            default: v.colDefault,
          },
          db,
        )
      : `UPDATE ${t} SET col_type = ${q(v.colType)}, col_name = ${q(v.colName)}, col_length = ${q(
          v.colLength,
        )}, col_isNull = ${v.colIsNull ? '1' : ''}, col_collation = ${q(v.collation)}, col_extra = '${[
          v.colExtra,
          v.colAttribute,
        ].join(
          ',',
        )}', col_default = ${q(v.colDefault)} WHERE db_name = ${q(db)} AND col_name = ${q(v.origColName)}`
  if ((await conn.tryQuery(sql)) === false) return { ok: false, kind: 'error', error: errorOf(conn) }
  return { ok: true }
}

/** CentralColumns::getListRaw: the list without the columns `tableColumns` already has. */
export async function centralColumnsListRaw(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  tableColumns: string[] | null,
): Promise<CentralColumnRow[]> {
  const t = tableOf(rp)
  if (conn === null || t === null) return []
  let sql = `SELECT * FROM ${t} WHERE db_name = ${q(db)}`
  if (tableColumns !== null && tableColumns.length > 0)
    sql += ` AND col_name NOT IN (${whereIn(tableColumns)})`
  const r = await conn.tryQuery(`${sql};`)
  return r === false ? [] : handleColumnExtra(r.rows)
}
