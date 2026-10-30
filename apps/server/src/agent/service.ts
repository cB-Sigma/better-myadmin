import type { Translator } from '@bettermyadmin/i18n'
import { backquote } from '@bettermyadmin/sql-gen'
import { parseAnalyze, replaceClause, splitSql } from '@bettermyadmin/sql-lexer'
import type { AppConfig, ServerConfig } from '../config.ts'
import { type Conn, type ResultSet, USER_STATEMENT } from '../db/connection.ts'
import { T } from '../db/field-meta.ts'
import { MysqlError, ValidationError } from '../http/errors.ts'
import { NavDbi } from '../navigation/dbi.ts'
import { isAppendLimitClause, isSuperUser } from '../query/pipeline.ts'
import { databaseList } from '../server-admin/databases.ts'

/**
 * The agent API's operations (docs/features/16-agent-api.md): plain JSON for programs, on the
 * request's own connection, so the MySQL user's privileges decide what each one may see and do.
 */
export interface AgentCtx {
  cfg: AppConfig
  server: ServerConfig
  serverIndex: number
  conn: Conn
  tr: Translator
}

/** A cell: text, a number kept as text (exact), null, or bytes that are not text. */
export type AgentValue = string | null | { base64: string }

const BINARY_TYPES = new Set<number>([
  T.TINY_BLOB,
  T.MEDIUM_BLOB,
  T.LONG_BLOB,
  T.BLOB,
  T.VAR_STRING,
  T.STRING,
  T.VARCHAR,
  T.BIT,
  T.GEOMETRY,
])

function cells(set: ResultSet): { columns: Array<{ name: string; type: number }>; rows: AgentValue[][] } {
  // the binary character set (63) on a string / blob type: bytes, not text
  const binary = set.fields.map((f) => f.charsetNr === 63 && BINARY_TYPES.has(f.type))
  return {
    columns: set.fields.map((f) => ({ name: f.name, type: f.type })),
    rows: set.rows.map((row) =>
      row.map((v, i) =>
        v === null || v === undefined
          ? null
          : binary[i]
            ? { base64: v.toString('base64') }
            : v.toString('utf8'),
      ),
    ),
  }
}

const rowsOf = (set: ResultSet | undefined): Array<Record<string, string | null>> =>
  set === undefined
    ? []
    : set.rows.map((row) =>
        Object.fromEntries(
          set.fields.map((f, i) => [
            f.name,
            row[i] === null || row[i] === undefined ? null : row[i]!.toString('utf8'),
          ]),
        ),
      )

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) {
    const k = key(x)
    const list = m.get(k)
    if (list === undefined) m.set(k, [x])
    else list.push(x)
  }
  return m
}

/** The databases the user may see, after only_db / hide_db (ListDatabase, as the navigation). */
export async function listDatabases(ctx: AgentCtx): Promise<string[]> {
  return databaseList({
    cfg: ctx.cfg,
    server: ctx.server,
    serverIndex: ctx.serverIndex,
    conn: ctx.conn,
    dbi: new NavDbi(ctx.conn, {}),
    tr: ctx.tr,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    versionInt: ctx.conn.serverInfo?.versionInt ?? 0,
    isMariaDb: ctx.conn.serverInfo?.isMariaDb ?? false,
  })
}

export interface AgentTable {
  name: string
  type: 'table' | 'view'
  engine: string | null
  /** the storage engine's estimate (exact for MyISAM), null for views */
  rows: string | null
  comment: string
}

/** SHOW TABLE STATUS of a database. */
export async function listTables(ctx: AgentCtx, db: string): Promise<AgentTable[]> {
  const r = await ctx.conn.query(`SHOW TABLE STATUS FROM ${backquote(db)}`, 'agent.tables')
  return rowsOf(r.resultSets[0]).map((t) => {
    const view = t.Engine === null && (t.Comment ?? '').toUpperCase() === 'VIEW'
    return {
      name: t.Name ?? '',
      type: view ? 'view' : 'table',
      engine: t.Engine ?? null,
      rows: view ? null : (t.Rows ?? null),
      comment: view ? '' : (t.Comment ?? ''),
    }
  })
}

/** A table's columns, indexes and CREATE statement. */
export async function describeTable(ctx: AgentCtx, db: string, table: string) {
  const name = `${backquote(db)}.${backquote(table)}`
  const columns = rowsOf(
    (await ctx.conn.query(`SHOW FULL COLUMNS FROM ${name}`, 'agent.columns')).resultSets[0],
  )
  const indexes = rowsOf((await ctx.conn.query(`SHOW INDEX FROM ${name}`, 'agent.indexes')).resultSets[0])
  const create = (await ctx.conn.query(`SHOW CREATE TABLE ${name}`, 'agent.create')).resultSets[0]
  const createRow = create?.rows[0]
  return {
    database: db,
    table,
    columns: columns.map((c) => ({
      name: c.Field ?? '',
      type: c.Type ?? '',
      nullable: c.Null === 'YES',
      key: c.Key ?? '',
      default: c.Default ?? null,
      extra: c.Extra ?? '',
      collation: c.Collation ?? null,
      comment: c.Comment ?? '',
    })),
    indexes: [...groupBy(indexes, (i) => i.Key_name ?? '')].map(([key, parts]) => ({
      name: key,
      unique: parts[0]?.Non_unique === '0',
      type: parts[0]?.Index_type ?? '',
      columns: parts
        .sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index))
        .map((p) => p.Column_name ?? p.Expression ?? ''),
    })),
    create: createRow?.[1]?.toString('utf8') ?? '',
  }
}

export interface AgentStatement {
  sql: string
  /** the result set: its columns and rows (at most maxRows; `truncated` when there were more) */
  columns?: Array<{ name: string; type: number }>
  rows?: AgentValue[][]
  truncated?: boolean
  affectedRows?: number
  insertId?: string
  warnings?: number
  error?: { errno: number; sqlState: string; message: string }
  ms: number
}

export const AGENT_MAX_ROWS = 10_000

/**
 * Runs SQL as the SQL box does (split on the delimiter, `USE db` first, a SELECT without LIMIT gets
 * one), stopping at the first error. Each statement runs with the user's privileges; DROP DATABASE
 * follows AllowUserDropDatabase like the SQL box.
 */
export async function runAgentQuery(
  ctx: AgentCtx,
  input: { sql: string; db?: string | undefined; maxRows?: number | undefined },
): Promise<{ statements: AgentStatement[] }> {
  const maxRows = Math.min(Math.max(1, Math.floor(input.maxRows ?? ctx.cfg.MaxRows)), AGENT_MAX_ROWS)
  const queries = splitSql(input.sql)
  if (queries.length === 0) throw new ValidationError('No SQL query given.')
  if (input.db !== undefined && input.db !== '' && !(await ctx.conn.selectDb(input.db, 'agent.use')))
    throw new ValidationError(`Unknown database: ${input.db}`)
  const opts = ctx.conn.serverInfo?.context !== undefined ? { context: ctx.conn.serverInfo.context } : {}
  const out: AgentStatement[] = []
  for (const q of queries) {
    const [info] = parseAnalyze(q, input.db ?? '', true, opts)
    if (!ctx.cfg.AllowUserDropDatabase && info.flags.dropDatabase && !(await isSuperUser(ctx.conn))) {
      out.push({
        sql: q,
        ms: 0,
        error: { errno: 0, sqlState: '', message: '"DROP DATABASE" statements are disabled.' },
      })
      break
    }
    // one row more than asked tells whether there were more
    const limited =
      isAppendLimitClause(info, maxRows) && info.statement !== null && info.parser.list !== null
        ? replaceClause(info.statement, info.parser.list, `LIMIT ${maxRows + 1}`)
        : q
    try {
      const r = await ctx.conn.query(limited, USER_STATEMENT)
      const st: AgentStatement = { sql: q, ms: Math.round(r.ms * 1000) / 1000 }
      const set = r.resultSets[0]
      if (set !== undefined) {
        const c = cells(set)
        st.columns = c.columns
        st.truncated = c.rows.length > maxRows
        st.rows = c.rows.slice(0, maxRows)
      }
      if (r.header !== null) {
        st.affectedRows = r.header.affectedRows
        if (r.header.insertId !== '0') st.insertId = r.header.insertId
        st.warnings = r.header.warningStatus
      }
      out.push(st)
    } catch (e) {
      if (!(e instanceof MysqlError)) throw e
      out.push({
        sql: q,
        ms: 0,
        error: {
          errno: Number(e.extra.errno ?? 0),
          sqlState: String(e.extra.sqlstate ?? ''),
          message: e.message,
        },
      })
      break
    }
  }
  return { statements: out }
}

/** EXPLAIN of one statement (the server's tabular plan). */
export async function explain(ctx: AgentCtx, input: { sql: string; db?: string | undefined }) {
  const [q] = splitSql(input.sql)
  if (q === undefined) throw new ValidationError('No SQL query given.')
  return (
    await runAgentQuery(ctx, { sql: `EXPLAIN ${q}`, ...(input.db !== undefined ? { db: input.db } : {}) })
  ).statements[0]!
}
