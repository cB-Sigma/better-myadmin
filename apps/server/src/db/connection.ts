import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import type { Executed } from '@bettermyadmin/contracts'
import { backquote } from '@bettermyadmin/sql-gen'
import type { Context } from '@bettermyadmin/sql-lexer'
import type { FieldPacket, PoolConnection, ResultSetHeader } from 'mysql2/promise'
import { MysqlError, isMysqlError } from '../http/errors.ts'
import { type RawField, toField } from './field-meta.ts'
import { afterQuery } from './query-hook.ts'

export type RawRow = Array<Buffer | null>

export interface ResultSet {
  fields: ReturnType<typeof toField>[]
  rows: RawRow[]
}

export interface QueryResult {
  /** One entry per result set (CALL can return several). Empty for statements without a result set. */
  resultSets: ResultSet[]
  header: { affectedRows: number; insertId: string; warningStatus: number; info: string } | null
  ms: number
}

/**
 * Thin wrapper over one mysql2 connection. Every statement the server runs goes through
 * `query(sql, label)` so it is timed and logged for the Debug SQL console and parity tests.
 */
/** Facts read by postConnect (DatabaseInterface::setVersion) and the matching parser context. */
export interface ServerInfo {
  version: string
  versionInt: number
  versionComment: string
  isMariaDb: boolean
  isPercona: boolean
  sqlMode: string
  /** Context::setMode(@@sql_mode) + Context::loadClosest(MySql|MariaDb + version) */
  context: Context
  /**
   * postConnect's user errors (the session time zone or the configured collation refused): every
   * request on this connection shows them (http/user-errors.ts), as phpMyAdmin connects per request
   */
  setupErrors?: Array<{ msgid: string; args?: Array<string | number> }>
}

/**
 * Statements that leave nothing on the connection for a later request: plain reads. Anything else
 * may (`SET`, `USE`, transactions, temporary tables, locks, user variables, `LAST_INSERT_ID()`,
 * prepared statements, profiling), so the connection is not reused after it.
 */
const STATELESS =
  /^\s*(?:\/\*[\s\S]*?\*\/\s*)*(?:SELECT|SHOW|EXPLAIN|DESCRIBE|DESC|WITH|CHECK|CHECKSUM|ANALYZE|OPTIMIZE|REPAIR)\b/i
const USER_VARIABLE =
  /@[A-Za-z0-9_$.`'"]|\bINTO\b|\bFOR\s+UPDATE\b|\bLOCK\s+IN\s+SHARE\s+MODE\b|\bGET_LOCK\s*\(/i

/** True when `sql` (not one of the connection set-up statements) may change the session state. */
export function changesSessionState(sql: string, label: string): boolean {
  if (label.startsWith('connect.')) return false
  return !STATELESS.test(sql) || USER_VARIABLE.test(sql.replace(/@@/g, ''))
}

/** The label of the statements typed by the user (SQL tab, console): the ones a cancel may kill. */
export const USER_STATEMENT = 'query.user'

export class Conn {
  readonly raw: PoolConnection
  readonly log: Executed[]
  serverInfo: ServerInfo | null = null
  /**
   * The session state may differ from a fresh connection's: phpMyAdmin connects per request, so the
   * pool closes such a connection on release instead of handing it to the next request.
   */
  dirty = false
  /**
   * The one file a `LOAD DATA LOCAL INFILE` may read (the uploaded import file of ImportLdi), or
   * null: the server's file request is refused like a client without local_infile.
   */
  localInfile: string | null = null
  /** The label of the statement in flight (null when idle): a cancel kills only the user's statement. */
  activeLabel: string | null = null
  /**
   * A cancel that came before the user's statement started (the pipeline's own statements were
   * running): that statement is not sent and fails like a killed query.
   */
  cancelled = false

  constructor(raw: PoolConnection, log: Executed[]) {
    this.raw = raw
    this.log = log
  }

  get threadId(): number {
    return this.raw.threadId
  }

  /**
   * DatabaseInterface::selectDb (mysqli::select_db): `USE db` without the tryQuery hook
   * (Tracker::handleQuery would read it as a USE statement of the request).
   */
  async selectDb(db: string, label: string): Promise<boolean> {
    try {
      await this.query(`USE ${backquote(db)}`, label, false)
      return true
    } catch {
      return false
    }
  }

  async query(sql: string, label: string, hook = true): Promise<QueryResult> {
    if (label === USER_STATEMENT && this.cancelled) {
      this.cancelled = false
      this.log.push({ sql, ms: 0, label })
      throw new MysqlError(
        { errno: 1317, sqlState: '70100', message: 'Query execution was interrupted' },
        sql,
      )
    }

    if (!this.dirty && changesSessionState(sql, label)) this.dirty = true
    const start = performance.now()
    let res: [unknown, unknown]
    this.activeLabel = label
    try {
      // typeCast:false keeps every value as the exact bytes the server sent (docs/architecture/06 numeric fidelity)
      res = (await this.raw.query({
        sql,
        rowsAsArray: true,
        typeCast: false,
        infileStreamFactory: (path: string) => localFile(path, this.localInfile),
      })) as [unknown, unknown]
    } catch (e) {
      const ms = performance.now() - start
      this.log.push({ sql, ms, label })
      if (isMysqlError(e)) throw new MysqlError(e, sql)
      throw e
    } finally {
      this.activeLabel = null
    }
    const ms = performance.now() - start
    const out = normalise(res[0], res[1])
    this.log.push({ sql, ms, label, ...(out.header !== null ? { warnings: out.header.warningStatus } : {}) })
    if (hook) await afterQuery(this.log, sql, this)
    return { ...out, ms }
  }

  /** Convenience for internal queries: rows as utf8 strings keyed by column name. */
  async rows(sql: string, label: string): Promise<Array<Record<string, string | null>>> {
    const r = await this.query(sql, label)
    const set = r.resultSets[0]
    if (set === undefined) return []
    return set.rows.map((row) => {
      const o: Record<string, string | null> = {}
      set.fields.forEach((f, i) => {
        const v = row[i]
        o[f.name] = v === null || v === undefined ? null : v.toString('utf8')
      })
      return o
    })
  }

  async value(sql: string, label: string): Promise<string | null> {
    const r = await this.query(sql, label)
    const v = r.resultSets[0]?.rows[0]?.[0]
    return v === null || v === undefined ? null : v.toString('utf8')
  }

  /**
   * A server-side prepared statement (DatabaseInterface::executeQuery: the general log records it
   * as Prepare/Execute, not Query). Rows as strings keyed by column name.
   */
  async execute(
    sql: string,
    params: Array<string | number | null>,
    label: string,
  ): Promise<Array<Record<string, string | null>>> {
    // the statement stays prepared on the connection (phpMyAdmin's closes with its connection)
    this.dirty = true
    const start = performance.now()
    try {
      const [rows] = await this.raw.execute({ sql, values: params })
      const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []
      return list.map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [
            k,
            v === null || v === undefined ? null : Buffer.isBuffer(v) ? v.toString('utf8') : String(v),
          ]),
        ),
      )
    } catch (e) {
      if (isMysqlError(e)) throw new MysqlError(e, sql)
      throw e
    } finally {
      this.log.push({ sql, ms: performance.now() - start, label })
    }
  }
}

/** mysql2's LOCAL INFILE stream: only the import file in hand, any other request fails. */
function localFile(path: string, allowed: string | null): Readable {
  if (allowed !== null && path === allowed) return createReadStream(path)
  // the server sees an aborted transfer and answers with its own error
  return new Readable({
    read() {
      this.destroy(new Error('LOAD DATA LOCAL INFILE file request rejected due to restrictions on access.'))
    },
  })
}

function isHeader(x: unknown): x is ResultSetHeader {
  return typeof x === 'object' && x !== null && !Array.isArray(x) && 'affectedRows' in x
}

function toHeader(h: ResultSetHeader): QueryResult['header'] {
  return {
    affectedRows: h.affectedRows,
    insertId: String(h.insertId),
    warningStatus: h.warningStatus,
    info: h.info ?? '',
  }
}

/** mysql2 returns either rows+fields, a header, or (CALL) arrays of both. */
function normalise(rows: unknown, fields: unknown): Omit<QueryResult, 'ms'> {
  if (isHeader(rows)) return { resultSets: [], header: toHeader(rows) }
  const fieldList = fields as Array<FieldPacket[] | FieldPacket | undefined> | undefined
  // multi result: rows = [rows1, rows2, ..., header], fields = [fields1, fields2, ..., undefined]
  if (
    Array.isArray(rows) &&
    Array.isArray(fieldList) &&
    fieldList.length > 0 &&
    Array.isArray(fieldList[0])
  ) {
    const sets: ResultSet[] = []
    let header: QueryResult['header'] = null
    rows.forEach((r, i) => {
      const fs = fieldList[i]
      if (isHeader(r)) header = toHeader(r)
      else if (Array.isArray(fs))
        sets.push({ fields: fs.map((f) => toField(f as unknown as RawField)), rows: r as RawRow[] })
    })
    return { resultSets: sets, header }
  }
  return {
    resultSets: [
      {
        fields: ((fieldList ?? []) as FieldPacket[]).map((f) => toField(f as unknown as RawField)),
        rows: rows as RawRow[],
      },
    ],
    header: null,
  }
}
