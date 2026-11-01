import { createHash } from 'node:crypto'
import type {
  SlowQueriesResetResponse,
  SlowQueriesResponse,
  SlowQueriesUnavailable,
  SlowQueryDetail,
  SlowQueryExplainResponse,
  SlowQueryRow,
  SlowQuerySort,
} from '@bettermyadmin/contracts'
import { quoteString } from '@bettermyadmin/sql-gen'
import { TokenType, formatSql, tokenize } from '@bettermyadmin/sql-lexer'
import { MysqlError } from '../http/errors.ts'
import type { NavDbi } from '../navigation/dbi.ts'
import { type AdminCtx, keyPairs } from './context.ts'

/**
 * Server › Status › Slow queries (BetterMyAdmin only, parity exception X65): the top statement
 * digests of performance_schema.events_statements_summary_by_digest, or mysql.slow_log grouped by
 * normalized query (the columns Monitor's slow-log analysis reads), the detail of one entry with a
 * representative statement, and EXPLAIN of that statement. Nothing but EXPLAIN is ever executed for
 * a listed query, and only when asked.
 */

const DIGEST_TABLE = 'performance_schema.events_statements_summary_by_digest'
const LIMIT = 100
/** the newest slow-log rows that are grouped (mysql.slow_log is a CSV table without indexes) */
const SLOW_LOG_ROWS = 10_000
const DENIED = /^#(1142|1044|1045|1227|1143) /

/** a picosecond timer column (string from MySQL) in ms */
const ps2ms = (v: string | null | undefined) => (v === null || v === undefined ? 0 : Number(v) / 1e9)
const num = (v: string | null | undefined) => (v === null || v === undefined ? 0 : Number(v))

// ------------------------------------------------------------------ pure helpers (unit-tested)

/**
 * A statement with its literals replaced by `?`, comments dropped, whitespace collapsed and
 * keywords upper-cased; a parenthesised list of placeholders reads `(...)` and repeated `(...)`
 * rows of a multi-row VALUES collapse into one — the slow log's queries grouped like digests.
 */
export function fingerprintQuery(sql: string): string {
  const out: string[] = []
  for (const tok of tokenize(sql)) {
    switch (tok.type) {
      case TokenType.Whitespace:
      case TokenType.Comment:
        if (out.length > 0 && out.at(-1) !== ' ') out.push(' ')
        break
      case TokenType.String:
      case TokenType.Number:
      case TokenType.Bool:
        // `-1`: the lexer keeps the sign in the number
        out.push('?')
        break
      case TokenType.Keyword:
        out.push(tok.keyword ?? tok.token.toUpperCase())
        break
      case TokenType.Delimiter:
        break
      default:
        out.push(tok.token)
    }
  }
  return out
    .join('')
    .trim()
    .replace(/\(\s*\?(\s*,\s*\?)*\s*\)/g, '(...)')
    .replace(/\(\.\.\.\)(\s*,\s*\(\.\.\.\))+/g, '(...)')
    .replace(/\s+/g, ' ')
}

export interface SlowLogEntry {
  start_time: string | null
  query_time: number
  rows_sent: number
  rows_examined: number
  db: string | null
  sql_text: string
}

/** A short stable id of a normalized query in a schema (the slow log has no digest column). */
export function slowLogDigest(db: string | null, text: string): string {
  return createHash('sha1')
    .update(`${db ?? ''}\0${text}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * The slow-log entries grouped by (database, normalized query): count, total / average / max query
 * time (ms), rows sent and examined, first and last start time and the newest statement as sample.
 */
export function groupSlowLog(entries: SlowLogEntry[]): SlowQueryRow[] {
  const groups = new Map<string, SlowQueryRow>()
  for (const e of entries) {
    const text = fingerprintQuery(e.sql_text)
    const db = e.db === '' ? null : e.db
    const digest = slowLogDigest(db, text)
    const ms = e.query_time * 1000
    let g = groups.get(digest)
    if (g === undefined) {
      g = {
        digest,
        schema: db,
        text,
        count: 0,
        totalMs: 0,
        avgMs: 0,
        maxMs: 0,
        rowsExamined: 0,
        rowsSent: 0,
        errors: 0,
        warnings: 0,
        firstSeen: e.start_time,
        lastSeen: e.start_time,
        sample: e.sql_text,
      }
      groups.set(digest, g)
    }
    g.count++
    g.totalMs += ms
    g.maxMs = Math.max(g.maxMs, ms)
    g.rowsExamined += e.rows_examined
    g.rowsSent += e.rows_sent
    if (e.start_time !== null) {
      if (g.firstSeen === null || e.start_time < g.firstSeen) g.firstSeen = e.start_time
      if (g.lastSeen === null || e.start_time >= g.lastSeen) {
        g.lastSeen = e.start_time
        g.sample = e.sql_text
      }
    }
  }
  for (const g of groups.values()) g.avgMs = g.count === 0 ? 0 : g.totalMs / g.count
  return [...groups.values()]
}

const SORT_KEY: Record<SlowQuerySort, (r: SlowQueryRow) => number | string> = {
  total: (r) => r.totalMs,
  count: (r) => r.count,
  avg: (r) => r.avgMs,
  max: (r) => r.maxMs,
  rowsExamined: (r) => r.rowsExamined,
  rowsSent: (r) => r.rowsSent,
  errors: (r) => r.errors,
  lastSeen: (r) => r.lastSeen ?? '',
}

export function sortRows(rows: SlowQueryRow[], sort: SlowQuerySort, order: 'asc' | 'desc'): SlowQueryRow[] {
  const key = SORT_KEY[sort]
  const dir = order === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = key(a)
    const y = key(b)
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.digest.localeCompare(b.digest)
  })
}

/** `` `a\_b` `` / `'x'` → the bare name; a `%` / unescaped `_` pattern → a RegExp */
function grantName(part: string): string | RegExp {
  const bare = part.replace(/^[`'"]|[`'"]$/g, '')
  if (bare === '*') return /^.*$/
  if (!/%|(^|[^\\])_/.test(bare)) return bare.replaceAll('\\_', '_').replaceAll('\\%', '%')
  let re = ''
  for (let i = 0; i < bare.length; i++) {
    const c = bare[i]!
    if (c === '\\' && i + 1 < bare.length) re += bare[++i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (c === '%') re += '.*'
    else if (c === '_') re += '.'
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

const nameMatches = (pattern: string | RegExp, name: string) =>
  typeof pattern === 'string' ? pattern.toLowerCase() === name.toLowerCase() : pattern.test(name)

/**
 * Whether `SHOW GRANTS` lines give `privilege` on `schema`.`table` (through `*.*`, `schema.*` or the
 * table itself; `ALL [PRIVILEGES]` counts). Roles are not followed: an unknown answer is false.
 */
export function grantsAllow(grants: string[], privilege: string, schema: string, table: string): boolean {
  const want = privilege.toUpperCase()
  for (const line of grants) {
    const m = /^GRANT\s+(.+?)\s+ON\s+(?:TABLE\s+)?(\S+?)\s+TO\s/i.exec(line)
    if (m === null) continue
    const privs = m[1]!
      .replace(/\([^)]*\)/g, '')
      .split(',')
      .map((p) => p.trim().toUpperCase())
    if (!privs.includes(want) && !privs.includes('ALL') && !privs.includes('ALL PRIVILEGES')) continue
    const target = m[2]!
    const dot = /^((?:`[^`]*`|[^.`]+))\.((?:`[^`]*`|[^.`]+))$/.exec(target)
    if (dot === null) continue
    if (nameMatches(grantName(dot[1]!), schema) && nameMatches(grantName(dot[2]!), table)) return true
  }
  return false
}

const EXPLAINABLE = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'TABLE'])

/**
 * The one statement of `sql` that EXPLAIN may run, without its trailing delimiter; null when it
 * is not a single SELECT / WITH / INSERT / UPDATE / DELETE / REPLACE / TABLE statement.
 */
export function explainableStatement(sql: string): string | null {
  const tokens = tokenize(sql)
  let first: string | null = null
  let afterDelimiter = false
  let end = sql.length
  for (const tok of tokens) {
    if (tok.type === TokenType.Whitespace || tok.type === TokenType.Comment) continue
    if (tok.type === TokenType.Delimiter) {
      if (afterDelimiter) continue
      afterDelimiter = true
      end = [...sql].slice(0, tok.position ?? sql.length).join('').length
      continue
    }
    // anything after the first delimiter is a second statement
    if (afterDelimiter) return null
    if (first === null) {
      if (tok.type !== TokenType.Keyword && tok.type !== TokenType.Symbol) return null
      first = tok.token.toUpperCase()
    }
  }
  if (first === null || !EXPLAINABLE.has(first)) return null
  return sql.slice(0, end).trim()
}

// ------------------------------------------------------------------ privileges and settings

async function grants(dbi: NavDbi): Promise<string[]> {
  const r = await dbi.tryQuery('SHOW GRANTS', 'slowQueries.grants')
  return r === null ? [] : r.rows.map((row) => row[0] ?? '')
}

async function settings(dbi: NavDbi): Promise<Record<string, string>> {
  return (
    (await keyPairs(
      dbi,
      "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('performance_schema','log_output','slow_query_log','long_query_time','performance_schema_digests_size','max_digest_length')",
    )) ?? {}
  )
}

async function digestColumns(dbi: NavDbi): Promise<Set<string>> {
  const r = await dbi.tryQuery(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'performance_schema' AND TABLE_NAME = 'events_statements_summary_by_digest'",
    'slowQueries.columns',
  )
  return new Set((r?.rows ?? []).map((row) => (row[0] ?? '').toUpperCase()))
}

const DIGEST_ORDER: Record<SlowQuerySort, string> = {
  total: 'SUM_TIMER_WAIT',
  count: 'COUNT_STAR',
  avg: 'AVG_TIMER_WAIT',
  max: 'MAX_TIMER_WAIT',
  rowsExamined: 'SUM_ROWS_EXAMINED',
  rowsSent: 'SUM_ROWS_SENT',
  errors: 'SUM_ERRORS',
  lastSeen: 'LAST_SEEN',
}

// ------------------------------------------------------------------ list

export async function slowQueries(
  ctx: AdminCtx,
  q: { source: 'digest' | 'slowlog'; db: string; sort: SlowQuerySort; order: 'asc' | 'desc' },
): Promise<SlowQueriesResponse> {
  const { dbi } = ctx
  const vars = await settings(dbi)
  const base = {
    source: q.source,
    canReset: false,
    databases: [] as string[],
    rows: [] as SlowQueryRow[],
    total: 0,
    settings: vars,
    isMariaDb: ctx.isMariaDb,
  }
  if (q.source === 'slowlog') return { ...base, ...(await slowLogList(ctx, q, vars)) }

  const pfs = (vars.performance_schema ?? 'OFF').toUpperCase()
  if (pfs !== 'ON' && pfs !== '1') return { ...base, available: false, reasons: ['pfs-off'] }
  const reasons: SlowQueriesUnavailable[] = []
  const consumer = await dbi.tryQuery(
    "SELECT ENABLED FROM performance_schema.setup_consumers WHERE NAME = 'statements_digest'",
    'slowQueries.consumer',
  )
  if (consumer?.rows[0]?.[0] === 'NO') reasons.push('digest-consumer-off')
  const cols = await digestColumns(dbi)
  const sample = cols.has('QUERY_SAMPLE_TEXT') ? 'QUERY_SAMPLE_TEXT' : 'NULL'
  const where = `WHERE DIGEST IS NOT NULL${q.db !== '' ? ` AND SCHEMA_NAME = ${quoteString(q.db)}` : ''}`
  const r = await dbi.tryQuery(
    'SELECT SCHEMA_NAME, DIGEST, DIGEST_TEXT, COUNT_STAR, SUM_TIMER_WAIT, AVG_TIMER_WAIT, MAX_TIMER_WAIT, ' +
      'SUM_ROWS_EXAMINED, SUM_ROWS_SENT, SUM_ERRORS, SUM_WARNINGS, FIRST_SEEN, LAST_SEEN, ' +
      `${sample} AS QUERY_SAMPLE_TEXT FROM ${DIGEST_TABLE} ${where} ` +
      `ORDER BY ${DIGEST_ORDER[q.sort]} ${q.order === 'asc' ? 'ASC' : 'DESC'}, DIGEST LIMIT ${LIMIT}`,
    'slowQueries.digests',
  )
  if (r === null) {
    if (DENIED.test(dbi.lastError)) return { ...base, available: false, reasons: ['pfs-denied'] }
    throw new MysqlError({ message: dbi.lastError })
  }
  const rows = r.rows.map((raw): SlowQueryRow => {
    const row = Object.fromEntries(r.fields.map((f, i) => [f.toUpperCase(), raw[i] ?? null]))
    return {
      digest: row.DIGEST ?? '',
      schema: row.SCHEMA_NAME ?? null,
      text: row.DIGEST_TEXT ?? '',
      count: num(row.COUNT_STAR),
      totalMs: ps2ms(row.SUM_TIMER_WAIT),
      avgMs: ps2ms(row.AVG_TIMER_WAIT),
      maxMs: ps2ms(row.MAX_TIMER_WAIT),
      rowsExamined: num(row.SUM_ROWS_EXAMINED),
      rowsSent: num(row.SUM_ROWS_SENT),
      errors: num(row.SUM_ERRORS),
      warnings: num(row.SUM_WARNINGS),
      firstSeen: row.FIRST_SEEN ?? null,
      lastSeen: row.LAST_SEEN ?? null,
      sample: row.QUERY_SAMPLE_TEXT ?? null,
    }
  })
  const total = await dbi.tryQuery(`SELECT COUNT(*) FROM ${DIGEST_TABLE} ${where}`, 'slowQueries.count')
  const dbs = await dbi.tryQuery(
    `SELECT DISTINCT SCHEMA_NAME FROM ${DIGEST_TABLE} WHERE SCHEMA_NAME IS NOT NULL ORDER BY SCHEMA_NAME`,
    'slowQueries.databases',
  )
  return {
    ...base,
    available: true,
    reasons,
    canReset: grantsAllow(
      await grants(dbi),
      'DROP',
      'performance_schema',
      'events_statements_summary_by_digest',
    ),
    databases: (dbs?.rows ?? []).map((row) => row[0] ?? '').filter((d) => d !== ''),
    rows,
    total: num(total?.rows[0]?.[0]),
  }
}

/** The newest SLOW_LOG_ROWS rows of mysql.slow_log (the columns Monitor's slow-log analysis reads). */
async function readSlowLog(dbi: NavDbi): Promise<SlowLogEntry[] | null> {
  const r = await dbi.tryQuery(
    'SELECT start_time, ' +
      'TIME_TO_SEC(query_time) + MICROSECOND(query_time) / 1000000 AS query_time, ' +
      'rows_sent, rows_examined, db, sql_text ' +
      `FROM \`mysql\`.\`slow_log\` ORDER BY start_time DESC LIMIT ${SLOW_LOG_ROWS}`,
    'slowQueries.slowLog',
  )
  if (r === null) return null
  return r.rows.map((row) => ({
    start_time: row[0] ?? null,
    query_time: num(row[1]),
    rows_sent: num(row[2]),
    rows_examined: num(row[3]),
    db: row[4] ?? null,
    sql_text: row[5] ?? '',
  }))
}

async function slowLogList(
  ctx: AdminCtx,
  q: { db: string; sort: SlowQuerySort; order: 'asc' | 'desc' },
  vars: Record<string, string>,
): Promise<Pick<SlowQueriesResponse, 'available' | 'reasons' | 'databases' | 'rows' | 'total'>> {
  const reasons: SlowQueriesUnavailable[] = []
  if (!(vars.log_output ?? '').toUpperCase().split(',').includes('TABLE')) reasons.push('log-not-table')
  if ((vars.slow_query_log ?? 'OFF').toUpperCase() !== 'ON' && vars.slow_query_log !== '1')
    reasons.push('slow-log-off')
  const entries = await readSlowLog(ctx.dbi)
  if (entries === null) {
    if (DENIED.test(ctx.dbi.lastError))
      return { available: false, reasons: [...reasons, 'slow-log-denied'], databases: [], rows: [], total: 0 }
    throw new MysqlError({ message: ctx.dbi.lastError })
  }
  const groups = groupSlowLog(entries)
  const databases = [...new Set(groups.map((g) => g.schema).filter((d): d is string => d !== null))].sort()
  const shown = q.db === '' ? groups : groups.filter((g) => g.schema === q.db)
  return {
    available: true,
    reasons,
    databases,
    rows: sortRows(shown, q.sort, q.order).slice(0, LIMIT),
    total: shown.length,
  }
}

// ------------------------------------------------------------------ detail

const format = (sql: string) => {
  try {
    return formatSql(sql)
  } catch {
    return sql
  }
}

export async function slowQueryDetail(
  ctx: AdminCtx,
  q: { source: 'digest' | 'slowlog'; digest: string; db: string },
): Promise<SlowQueryDetail | null> {
  const { dbi } = ctx
  if (q.source === 'slowlog') {
    const entries = await readSlowLog(dbi)
    const g = groupSlowLog(entries ?? []).find((x) => x.digest === q.digest)
    if (g === undefined) return null
    return {
      text: g.text,
      formatted: format(g.text),
      sample: g.sample,
      sampleSource: g.sample === null ? null : 'slowlog',
      explainable: g.sample !== null && explainableStatement(g.sample) !== null,
      schema: g.schema,
    }
  }
  const cols = await digestColumns(dbi)
  const schemaCond = q.db === '' ? 'SCHEMA_NAME IS NULL' : `SCHEMA_NAME = ${quoteString(q.db)}`
  const r = await dbi.fetchResultSimple(
    `SELECT DIGEST_TEXT, SCHEMA_NAME, ${cols.has('QUERY_SAMPLE_TEXT') ? 'QUERY_SAMPLE_TEXT' : 'NULL'} AS SAMPLE ` +
      `FROM ${DIGEST_TABLE} WHERE DIGEST = ${quoteString(q.digest)} AND ${schemaCond} LIMIT 1`,
  )
  const row = r[0]
  if (row === undefined) return null
  let sample: string | null = row.SAMPLE ?? null
  let sampleSource: SlowQueryDetail['sampleSource'] = sample === null || sample === '' ? null : 'summary'
  if (sampleSource === null) {
    sample = null
    // the statement history keeps recent statements with their digest (history_long is off by default)
    for (const table of ['history_long', 'history'] as const) {
      const h = await dbi.tryQuery(
        `SELECT SQL_TEXT FROM performance_schema.events_statements_${table} ` +
          `WHERE DIGEST = ${quoteString(q.digest)} AND SQL_TEXT IS NOT NULL ORDER BY TIMER_START DESC LIMIT 1`,
        'slowQueries.sample',
      )
      const text = h?.rows[0]?.[0]
      if (text !== undefined && text !== null && text !== '') {
        sample = text
        sampleSource = table
        break
      }
    }
  }
  const text = row.DIGEST_TEXT ?? ''
  return {
    text,
    formatted: format(text),
    sample,
    sampleSource,
    explainable: sample !== null && explainableStatement(sample) !== null,
    schema: row.SCHEMA_NAME ?? null,
  }
}

// ------------------------------------------------------------------ actions

/** EXPLAIN of one explainable statement, in `db` (run on a connection of its own). */
export async function explainSlowQuery(
  ctx: AdminCtx,
  db: string,
  query: string,
): Promise<SlowQueryExplainResponse> {
  const stmt = explainableStatement(query)
  if (stmt === null)
    return {
      sql: '',
      columns: [],
      rows: [],
      // i18n-new: Status › Slow queries (parity exception X65)
      error: ctx.tr.gettext(
        'Only a single SELECT, INSERT, UPDATE, DELETE, REPLACE or TABLE statement can be explained.',
      ),
    }
  const sql = `EXPLAIN ${stmt}`
  if (db !== '') {
    try {
      await ctx.conn.selectDb(db, 'slowQueries.selectDb')
    } catch (e) {
      if (!(e instanceof MysqlError)) throw e
      return { sql, columns: [], rows: [], error: `#${e.extra.errno ?? 0} - ${e.message}` }
    }
  }
  const r = await ctx.dbi.tryQuery(sql, 'slowQueries.explain')
  if (r === null) return { sql, columns: [], rows: [], error: ctx.dbi.lastError }
  return { sql, columns: r.fields, rows: r.rows, error: null }
}

/** TRUNCATE of the digest summary (performance_schema's way to reset the statistics). */
export async function resetDigests(ctx: AdminCtx): Promise<SlowQueriesResetResponse> {
  try {
    await ctx.conn.query(`TRUNCATE TABLE ${DIGEST_TABLE}`, 'slowQueries.reset')
  } catch (e) {
    if (!(e instanceof MysqlError)) throw e
    return { message: { type: 'error', text: `#${e.extra.errno ?? 0} - ${e.message}` } }
  }
  // i18n-new: Status › Slow queries (parity exception X65)
  return { message: { type: 'success', text: ctx.tr.gettext('The statement statistics have been reset.') } }
}
