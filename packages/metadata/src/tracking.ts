import { backquote, quoteString as q } from '@bettermyadmin/sql-gen'
import type { MetaConn, Row } from './conn.ts'
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
