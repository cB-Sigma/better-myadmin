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
}

export class Conn {
  readonly raw: PoolConnection
  readonly log: Executed[]
  serverInfo: ServerInfo | null = null
  /**
   * The one file a `LOAD DATA LOCAL INFILE` may read (the uploaded import file of ImportLdi), or
   * null: the server's file request is refused like a client without local_infile.
   */
  localInfile: string | null = null

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
    const start = performance.now()
    let res: [unknown, unknown]
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
