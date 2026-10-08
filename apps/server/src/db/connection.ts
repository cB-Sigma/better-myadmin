import type { Executed } from '@bettermyadmin/contracts'
import type { Context } from '@bettermyadmin/sql-lexer'
import type { FieldPacket, PoolConnection, ResultSetHeader } from 'mysql2/promise'
import { MysqlError, isMysqlError } from '../http/errors.ts'
import { type RawField, toField } from './field-meta.ts'

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

  constructor(raw: PoolConnection, log: Executed[]) {
    this.raw = raw
    this.log = log
  }

  get threadId(): number {
    return this.raw.threadId
  }

  async query(sql: string, label: string): Promise<QueryResult> {
    const start = performance.now()
    let res: [unknown, unknown]
    try {
      // typeCast:false keeps every value as the exact bytes the server sent (docs/architecture/06 numeric fidelity)
      res = (await this.raw.query({ sql, rowsAsArray: true, typeCast: false })) as [unknown, unknown]
    } catch (e) {
      const ms = performance.now() - start
      this.log.push({ sql, ms, label })
      if (isMysqlError(e)) throw new MysqlError(e, sql)
      throw e
    }
    const ms = performance.now() - start
    this.log.push({ sql, ms, label })
    return { ...normalise(res[0], res[1]), ms }
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
