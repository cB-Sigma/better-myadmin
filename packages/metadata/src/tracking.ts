import { backquote, quoteString as q } from '@bettermyadmin/sql-gen'
import {
  AlterStatement,
  CreateStatement,
  DeleteStatement,
  DropStatement,
  Expression,
  InsertStatement,
  Parser,
  RenameStatement,
  type Token,
  TruncateStatement,
  UpdateStatement,
} from '@bettermyadmin/sql-lexer'
import { type MetaConn, type Row, fetchValue } from './conn.ts'
import type { RelationParameters } from './relation-parameters.ts'

/**
 * The `pma__tracking` repository (control link): tracking versions of tables and the logs kept
 * with them.
 * pma: src/Tracking/Tracker.php, src/Tracking/Tracking.php, src/Tracking/TrackingChecker.php
 */

type TrackingFeature = NonNullable<RelationParameters['trackingFeature']>

const table = (f: TrackingFeature) => `${backquote(f.database)}.${backquote(f.tracking)}`

/** Tracker::getLogComment: `# log Y-m-d H:i:s user\n` */
export function trackingLogComment(date: string, user: string): string {
  return `# log ${date} ${user.replace(/\s+/g, ' ')}\n`
}

/** `Y-m-d H:i:s` of the server's clock (phpMyAdmin's Clock::now()). */
export function trackingDate(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
}

/** The statements of the "Create version" form (create_tracking_version.twig), by input name. */
export const TRACKING_STATEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['alter_table', 'ALTER TABLE'],
  ['rename_table', 'RENAME TABLE'],
  ['create_table', 'CREATE TABLE'],
  ['drop_table', 'DROP TABLE'],
  ['alter_view', 'ALTER VIEW'],
  ['create_view', 'CREATE VIEW'],
  ['drop_view', 'DROP VIEW'],
  ['create_index', 'CREATE INDEX'],
  ['drop_index', 'DROP INDEX'],
  ['insert', 'INSERT'],
  ['update', 'UPDATE'],
  ['delete', 'DELETE'],
  ['truncate', 'TRUNCATE'],
]

/** Tracking::getTrackingSet: the checked statements in form order. */
export function trackingSet(checked: Iterable<string>): string {
  const on = new Set(checked)
  return TRACKING_STATEMENTS.filter(([name]) => on.has(name))
    .map(([, s]) => s)
    .join(',')
}

/** Tracking::deleteTracking */
export async function deleteTracking(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  tableName: string,
  version = '',
): Promise<boolean> {
  const f = rp.trackingFeature
  if (conn === null || f === null) return false
  let sql = `/*NOTRACK*/\nDELETE FROM ${table(f)} WHERE \`db_name\` = ${q(db)} AND \`table_name\` = ${q(tableName)}`
  if (version !== '') sql += ` AND \`version\` = ${q(version)}`
  return (await conn.tryQuery(sql)) !== false
}

/** Tracker::changeTracking (activate / deactivate one version) */
export async function changeTracking(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  tableName: string,
  version: string,
  state: 0 | 1,
): Promise<boolean> {
  const f = rp.trackingFeature
  if (conn === null || f === null) return false
  const r = await conn.tryQuery(
    `UPDATE ${table(f)} SET \`tracking_active\` = ${state} WHERE \`db_name\` = ${q(db)} AND \`table_name\` = ${q(tableName)} AND \`version\` = ${q(version)}`,
  )
  return r !== false
}

export interface NewTrackingVersion {
  db: string
  table: string
  version: string
  date: string
  snapshot: string
  schemaSql: string
  trackingSet: string
}

/** The INSERT of Tracker::createVersion, then the previous version is deactivated. */
export async function insertTrackingVersion(
  conn: MetaConn | null,
  rp: RelationParameters,
  v: NewTrackingVersion,
): Promise<boolean> {
  const f = rp.trackingFeature
  if (conn === null || f === null) return false
  await conn.query(
    `/*NOTRACK*/\nINSERT INTO ${table(f)} (db_name, table_name, version, date_created, date_updated, schema_snapshot, schema_sql, data_sql, tracking) values (${[
      v.db,
      v.table,
      v.version,
      v.date,
      v.date,
      v.snapshot,
      v.schemaSql,
      '\n',
      v.trackingSet,
    ]
      .map((x) => q(x))
      .join(', ')})`,
  )
  return changeTracking(conn, rp, v.db, v.table, String(Number.parseInt(v.version, 10) - 1), 0)
}

/** TrackingChecker::getTrackedTables: the HEAD version's state of every tracked table. */
export async function trackedTables(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  const f = rp.trackingFeature
  if (conn === null || f === null) return out
  const r = await conn.tryQuery(
    `SELECT table_name, tracking_active
            FROM (
                SELECT table_name, MAX(version) version
                FROM ${table(f)} WHERE db_name = ${q(db)} AND table_name <> ''
                GROUP BY table_name
            ) filtered_tables
            JOIN ${table(f)} USING(table_name, version)`,
  )
  if (r === false) return out
  for (const row of r.rows) out.set(row.table_name ?? '', row.tracking_active === '1')
  return out
}

/** Tracking::getHtmlForDbTrackingTables: the HEAD version row of every tracked table. */
export async function headVersions(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
): Promise<Row[]> {
  const f = rp.trackingFeature
  if (conn === null || f === null) return []
  const all = await conn.query(
    ` SELECT table_name, MAX(version) as version FROM ${table(f)} WHERE db_name = ${q(db)}  GROUP BY table_name ORDER BY table_name ASC`,
  )
  const out: Row[] = []
  for (const r of all.rows) {
    const one = await conn.query(
      ` SELECT * FROM ${table(f)} WHERE \`db_name\` = ${q(db)} AND \`table_name\`  = ${q(r.table_name ?? '')} AND \`version\` = ${q(r.version ?? '')}`,
    )
    const row = one.rows[0]
    if (row !== undefined) out.push(row)
  }
  return out
}

export interface TrackingLogEntry {
  date: string
  username: string
  statement: string
}

/** rtrim()'s default characters: " \t\n\r\0\x0B" */
// biome-ignore lint/suspicious/noControlCharactersInRegex: PHP's rtrim set includes NUL and VT
const PHP_RTRIM = /[ \t\n\r\0\x0B]+$/

/** Tracking::getTrackedData: the log entries of one log column (`schema_sql` / `data_sql`). */
export function parseTrackingLog(log: string | null): TrackingLogEntry[] {
  const out: TrackingLogEntry[] = []
  for (const entry of (log ?? '').split('# log ')) {
    if (entry.trim() === '') continue
    const cps = [...entry]
    const nl = cps.indexOf('\n')
    const date = cps.slice(0, 19).join('')
    // mb_substr($e, 20, mb_strpos($e, "\n") - 20): a negative length counts from the end
    const len = (nl === -1 ? 0 : nl) - 20
    const username = (len >= 0 ? cps.slice(20, 20 + len) : cps.slice(20, cps.length + len)).join('')
    const statement = (nl === -1 ? '' : cps.slice(nl).join('')).replace(PHP_RTRIM, '')
    out.push({ date, username, statement })
  }
  return out
}

/** Tracking::getListOfVersionsOfTable: every version row of one table, newest first. */
export async function trackingVersions(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  tableName: string,
): Promise<Row[]> {
  const f = rp.trackingFeature
  if (conn === null || f === null) return []
  const r = await conn.query(
    `SELECT * FROM ${table(f)} WHERE db_name = ${q(db)} AND table_name = ${q(tableName)} ORDER BY version DESC`,
  )
  return r.rows
}

/** Tracking::changeTrackingData: rewrites one log column (`schema_sql` / `data_sql`). */
export async function changeTrackingData(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  tableName: string,
  version: string,
  column: 'schema_sql' | 'data_sql',
  entries: TrackingLogEntry[],
): Promise<boolean> {
  const f = rp.trackingFeature
  if (conn === null || f === null) return false
  const text = entries.map((d) => `# log ${d.date} ${d.username}${d.statement}\n`).join('')
  const r = await conn.tryQuery(
    `UPDATE ${table(f)} SET \`${column}\` = ${q(text)} WHERE \`db_name\` = ${q(db)} AND \`table_name\` = ${q(tableName)} AND \`version\` = ${q(version)}`,
  )
  return r !== false
}

/** Tracking::getTrackedData($db, $table, $version): the row, parsed. */
export async function getTrackedData(
  conn: MetaConn | null,
  rp: RelationParameters,
  db: string,
  tableName: string,
  version: string,
): Promise<{ ddlog: TrackingLogEntry[]; dmlog: TrackingLogEntry[]; tracking: string; snapshot: string }> {
  const f = rp.trackingFeature
  const empty = { ddlog: [], dmlog: [], tracking: '', snapshot: '' }
  if (conn === null || f === null) return empty
  let sql = `SELECT * FROM ${table(f)} WHERE \`db_name\` = ${q(db)}`
  if (tableName !== '') sql += ` AND \`table_name\` = ${q(tableName)} `
  sql += ` AND \`version\` = ${q(version)} ORDER BY \`version\` DESC LIMIT 1`
  const row = (await conn.query(sql)).rows[0]
  if (row === undefined) return empty
  return {
    ddlog: parseTrackingLog(row.schema_sql ?? null),
    dmlog: parseTrackingLog(row.data_sql ?? null),
    tracking: row.tracking ?? '',
    snapshot: row.schema_snapshot ?? '',
  }
}

// ---------------------------------------------------------------------------------------------
// Tracker::handleQuery: the statements logged into the versions being tracked
// ---------------------------------------------------------------------------------------------

/** Tracker::parseQuery's result: the statement identifier, its kind and table. */
export interface TrackedQuery {
  type?: 'DDL' | 'DML'
  identifier?: string
  /** null: the statement names no table (phpMyAdmin then logs nothing) */
  tablename?: string | null
  tablename_after_rename?: string | null
  /** `Current::$database` as the statement changes it (USE, CREATE / ALTER / DROP DATABASE) */
  database?: string | null
}

type OptionMap = Map<number, unknown> | undefined

const tokenValue = (t: Token | undefined): string | null =>
  t === undefined || t.value === null || t.value === undefined ? null : String(t.value)

/**
 * Tracker::parseQuery: the first statement's identifier (`CREATE TABLE`, `ALTER VIEW`, `INSERT`, …),
 * DDL or DML, and the table it acts on, read from phpMyAdmin's SQL parser with its default context.
 * pma: src/Tracking/Tracker.php::parseQuery
 */
export function parseTrackedQuery(query: string): TrackedQuery {
  const parser = new Parser(query)
  const tokens = parser.list?.tokens ?? []
  const result: TrackedQuery = {}
  // Parse USE statement, need it for SQL dump imports
  if (tokenValue(tokens[0]) === 'USE') result.database = tokenValue(tokens[2])

  const statement = parser.statements[0]
  if (statement === undefined) return result
  const options: OptionMap = (statement as { options?: { options?: Map<number, unknown> } | null }).options
    ?.options
  const opt = (i: number): unknown => options?.get(i)
  const empty = options === undefined || options.size === 0

  // DDL statements
  result.type = 'DDL'
  if (statement instanceof CreateStatement) {
    if (empty || opt(6) === undefined) return result
    const o = opt(6)
    if (o === 'VIEW' || o === 'TABLE') {
      result.identifier = `CREATE ${o}`
      result.tablename = statement.name?.table ?? null
    } else if (o === 'DATABASE') {
      result.identifier = 'CREATE DATABASE'
      result.tablename = ''
      // In case of CREATE DATABASE, database field of the CreateStatement is the name of the database
      result.database = statement.name?.database ?? null
    } else if (o === 'INDEX' || o === 'UNIQUE INDEX' || o === 'FULLTEXT INDEX' || o === 'SPATIAL INDEX') {
      result.identifier = 'CREATE INDEX'
      // In case of CREATE INDEX, we have to get the table name from body of the statement
      result.tablename =
        tokenValue(statement.body[3]) === '.' ? tokenValue(statement.body[4]) : tokenValue(statement.body[2])
    }
  } else if (statement instanceof AlterStatement) {
    if (empty || opt(3) === undefined) return result
    const o = opt(3)
    if (o === 'VIEW' || o === 'TABLE') {
      result.identifier = `ALTER ${o}`
      result.tablename = statement.table?.table ?? null
    } else if (o === 'DATABASE') {
      result.identifier = 'ALTER DATABASE'
      result.tablename = ''
      result.database = statement.table?.table ?? null
    }
  } else if (statement instanceof DropStatement) {
    if (empty || opt(1) === undefined) return result
    const o = opt(1)
    const first = statement.fields?.[0]
    const firstTable = first instanceof Expression ? first.table : null
    if (o === 'VIEW' || o === 'TABLE') {
      result.identifier = `DROP ${o}`
      result.tablename = firstTable
    } else if (o === 'DATABASE') {
      result.identifier = 'DROP DATABASE'
      result.tablename = ''
      result.database = firstTable
    } else if (o === 'INDEX') {
      result.identifier = 'DROP INDEX'
      result.tablename = statement.table?.table ?? null
    }
  } else if (statement instanceof RenameStatement) {
    result.identifier = 'RENAME TABLE'
    result.tablename = statement.renames?.[0]?.old?.table ?? null
    result.tablename_after_rename = statement.renames?.[0]?.new?.table ?? null
  }
  if (result.identifier !== undefined) return result

  // DML statements
  result.type = 'DML'
  if (statement instanceof UpdateStatement) {
    const t = statement.tables?.[0]
    result.identifier = 'UPDATE'
    result.tablename = t instanceof Expression ? t.table : null
  }
  if (statement instanceof InsertStatement) {
    const dest = statement.into?.dest
    result.identifier = 'INSERT'
    result.tablename = dest instanceof Expression ? dest.table : null
  }
  if (statement instanceof DeleteStatement) {
    const t = statement.from?.[0]
    result.identifier = 'DELETE'
    result.tablename = t instanceof Expression ? t.table : null
  }
  if (statement instanceof TruncateStatement) {
    result.identifier = 'TRUNCATE'
    result.tablename = statement.table?.table ?? null
  }
  return result
}

/** Tracker::isAnyTrackingInProgress: one active version in the database. */
export async function anyTrackingInProgress(
  conn: MetaConn,
  rp: RelationParameters,
  db: string,
): Promise<boolean> {
  const f = rp.trackingFeature
  if (f === null) return false
  const r = await conn.query(
    `/*NOTRACK*/ SELECT 1 FROM ${table(f)} WHERE tracking_active = 1 AND db_name = ${q(db)} LIMIT 1`,
  )
  return r.rows.length > 0
}

/** Tracker::isTracked: the newest version of the table is active. */
export async function isTableTracked(
  conn: MetaConn,
  rp: RelationParameters,
  db: string,
  tableName: string,
): Promise<boolean> {
  const f = rp.trackingFeature
  if (f === null) return false
  const v = await fetchValue(
    conn,
    `SELECT tracking_active FROM ${table(f)} WHERE db_name = ${q(db)} AND table_name = ${q(tableName)} ORDER BY version DESC LIMIT 1`,
  )
  return Number.parseInt(String(v === false || v === null ? 0 : v), 10) === 1
}

/** Tracker::getVersion: the newest version tracking `statement` (-1 when none). */
export async function trackedVersion(
  conn: MetaConn,
  rp: RelationParameters,
  db: string,
  tableName: string,
  statement: string | null = null,
): Promise<number> {
  const f = rp.trackingFeature
  if (f === null) return -1
  let sql = `SELECT MAX(version) FROM ${table(f)} WHERE \`db_name\` = ${q(db)} AND \`table_name\` = ${q(tableName)}`
  if (statement !== null && statement !== '') sql += ` AND FIND_IN_SET('${statement}',tracking) > 0`
  const r = await conn.tryQuery(sql)
  if (r === false) return -1
  const field = r.fields[0]
  const v = field === undefined ? undefined : r.rows[0]?.[field]
  return v === null || v === undefined ? -1 : Number.parseInt(v, 10) || 0
}

/** The INSERT of Tracker::createDatabaseVersion (no table, no snapshot). */
export async function insertDatabaseVersion(
  conn: MetaConn,
  rp: RelationParameters,
  v: { db: string; version: string; date: string; schemaSql: string; trackingSet: string },
): Promise<boolean> {
  const f = rp.trackingFeature
  if (f === null) return false
  await conn.query(
    `/*NOTRACK*/\nINSERT INTO ${table(f)} (db_name, table_name, version, date_created, date_updated, schema_snapshot, schema_sql, data_sql, tracking) values (${[
      v.db,
      '',
      v.version,
      v.date,
      v.date,
      '',
      v.schemaSql,
      '\n',
      v.trackingSet,
    ]
      .map((x) => q(x))
      .join(', ')})`,
  )
  return true
}

/** The UPDATE of Tracker::handleQuery: one log entry appended to `schema_sql` / `data_sql`. */
export async function appendTrackingLog(
  conn: MetaConn,
  rp: RelationParameters,
  e: {
    saveTo: 'schema_sql' | 'data_sql' | ''
    entry: string
    date: string
    identifier: string
    db: string
    table: string
    version: number
    renamedTo?: string | null
  },
): Promise<void> {
  const f = rp.trackingFeature
  if (f === null) return
  const col = backquote(e.saveTo)
  let sql = `/*NOTRACK*/\nUPDATE ${table(f)} SET ${col} = CONCAT(${col}, ${q(`\n${e.entry}`)}), \`date_updated\` = ${q(e.date)}`
  // If table was renamed we have to change the tablename attribute in pma_tracking too
  if (e.identifier === 'RENAME TABLE') sql += `, \`table_name\` = ${q(e.renamedTo ?? '')} `
  sql += ` WHERE FIND_IN_SET('${e.identifier}',tracking) > 0 AND \`db_name\` = ${q(e.db)}  AND \`table_name\` = ${q(e.table)}  AND \`version\` = ${q(String(e.version))} `
  await conn.query(sql)
}
