/**
 * The connection the configuration storage is read and written through: phpMyAdmin's
 * `ConnectionType::ControlUser` link (the control user, or a second link with the user's own
 * credentials when no control user is configured).
 *
 * pma: src/Dbal/DatabaseInterface.php (tryQuery / query / selectDb / tryMultiQuery / getError
 *      for ConnectionType::ControlUser)
 */

export type Row = Record<string, string | null>

export interface QueryOutcome {
  /** Column names in result order (empty for statements without a result set). */
  fields: string[]
  rows: Row[]
  affectedRows: number
}

export class MetaQueryError extends Error {
  readonly errno: number
  readonly sql: string
  constructor(message: string, errno: number, sql: string) {
    super(message)
    this.errno = errno
    this.sql = sql
  }
}

export interface MetaConn {
  /** Runs one statement; throws {@link MetaQueryError} (phpMyAdmin: `query()` dies on error). */
  query(sql: string): Promise<QueryOutcome>
  /** Runs one statement; `false` on error, the error is kept for {@link MetaConn.lastError}. */
  tryQuery(sql: string): Promise<QueryOutcome | false>
  /** COM_INIT_DB. */
  selectDb(db: string): Promise<boolean>
  /** Runs a multi-statement string, consuming every result; `false` on the first error. */
  tryMultiQuery(sql: string): Promise<boolean>
  /** Message of the last failed statement, `''` when the last statement succeeded. */
  readonly lastError: string
  readonly lastErrno: number
}

/** DatabaseInterface::fetchValue($sql, 0): first column of the first row, or false (errors too). */
export async function fetchValue(conn: MetaConn, sql: string): Promise<string | null | false> {
  const r = await conn.tryQuery(sql)
  if (r === false) return false
  const row = r.rows[0]
  const field = r.fields[0]
  if (row === undefined || field === undefined) return false
  return row[field] ?? null
}

/** DatabaseInterface::fetchSingleRow (assoc): `null` (phpMyAdmin `[]`) when there is no row or on error. */
export async function fetchSingleRow(conn: MetaConn, sql: string): Promise<Row | null> {
  const r = await conn.tryQuery(sql)
  if (r === false) return null
  return r.rows[0] ?? null
}

/** `fetchAllColumn()` of the first column. */
export function firstColumn(r: QueryOutcome): string[] {
  const f = r.fields[0]
  if (f === undefined) return []
  return r.rows.map((row) => row[f] ?? '')
}
