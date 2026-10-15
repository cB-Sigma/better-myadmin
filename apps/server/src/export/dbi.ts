import { type ExportDbi, type ExportField, type ExportResult, decodeBytes } from '@bettermyadmin/export'
import { bitBytesToDecimalString, createFieldMetadata } from '@bettermyadmin/mysql-types'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import type { Conn } from '../db/connection.ts'
import type { RawField } from '../db/field-meta.ts'
import { MysqlError, isMysqlError } from '../http/errors.ts'
import { strnatcasecmp } from '../navigation/php.ts'

/** mysql2 field packet → FieldMetadata + protocol type (DatabaseInterface::getFieldsMeta). */
export function exportField(raw: RawField): ExportField {
  const type = raw.columnType ?? raw.type ?? -1
  const meta = createFieldMetadata({
    name: raw.name,
    orgName: raw.orgName ?? '',
    table: raw.table ?? '',
    orgTable: raw.orgTable ?? '',
    type,
    flags: typeof raw.flags === 'number' ? raw.flags : 0,
    charsetNr: raw.characterSet ?? 0,
    length: raw.columnLength ?? 0,
    decimals: raw.decimals ?? 0,
  })
  return { ...meta, type, db: raw.schema ?? raw.db ?? '' }
}

/** A raw cell as mysqli hands it to PHP: bytes, BIT as decimal text. */
export function exportCell(v: Buffer | null | undefined, f: ExportField): string | null {
  if (v === null || v === undefined) return null
  if (f.isMappedTypeBit) return bitBytesToDecimalString(v)
  return decodeBytes(v)
}

/**
 * The export's DatabaseInterface on the session's user connection; unbuffered SELECTs stream rows
 * from mysql2 (QUERY_UNBUFFERED).
 * pma: src/Dbal/DatabaseInterface.php
 */
export class ServerExportDbi implements ExportDbi {
  readonly conn: Conn
  #error = ''
  #lowerCaseNames: number | null = null
  readonly versionString: string
  readonly versionInt: number
  readonly isMariaDb: boolean
  readonly disableIS: boolean
  readonly naturalCompare: ((a: string, b: string) => number) | null
  readonly #databaseList: () => Promise<string[]>

  constructor(
    conn: Conn,
    o: { disableIS: boolean; naturalOrder: boolean; databaseList: () => Promise<string[]> },
  ) {
    this.conn = conn
    this.versionString = conn.serverInfo?.version ?? ''
    this.versionInt = conn.serverInfo?.versionInt ?? 0
    this.isMariaDb = conn.serverInfo?.isMariaDb ?? false
    this.disableIS = o.disableIS
    this.naturalCompare = o.naturalOrder ? strnatcasecmp : null
    this.#databaseList = o.databaseList
  }

  getError(): string {
    return this.#error
  }

  #fail(e: unknown): null {
    if (e instanceof MysqlError) {
      this.#error = `#${e.extra.errno ?? 0} - ${e.message}`
      return null
    }
    if (isMysqlError(e)) {
      this.#error = `#${e.errno ?? 0} - ${e.sqlMessage ?? e.message}`
      return null
    }
    throw e
  }

  async query(sql: string): Promise<void> {
    this.#error = ''
    await this.conn.query(sql, 'export')
  }

  async tryQuery(sql: string): Promise<boolean> {
    try {
      await this.conn.query(sql, 'export')
      this.#error = ''
      return true
    } catch (e) {
      this.#fail(e)
      return false
    }
  }

  async select(sql: string, unbuffered: boolean): Promise<ExportResult | null> {
    if (!unbuffered) {
      try {
        const r = await this.conn.query(sql, 'export')
        this.#error = ''
        const set = r.resultSets[0]
        if (set === undefined) return null
        const fields = set.fields.map((f) =>
          exportField({
            name: f.name,
            orgName: f.orgName,
            table: f.table,
            orgTable: f.orgTable,
            schema: f.db,
            columnType: f.type,
            flags: rawFlags(f),
            characterSet: f.charsetNr,
            columnLength: f.length,
            decimals: f.decimals,
          }),
        )
        const rows = set.rows.map((row) => row.map((v, i) => exportCell(v, fields[i] as ExportField)))
        return {
          fields,
          numRows: rows.length,
          rows: (async function* () {
            yield* rows
          })(),
        }
      } catch (e) {
        return this.#fail(e)
      }
    }
    return this.#stream(sql)
  }

  /** An unbuffered result: rows are read from the socket as the consumer asks for them. */
  async #stream(sql: string): Promise<ExportResult | null> {
    const start = performance.now()
    const core = (this.conn.raw as unknown as { connection: CoreConnection }).connection
    const q = core.query({ sql, rowsAsArray: true, typeCast: false })
    const queue: Array<Array<Buffer | null>> = []
    let done = false
    let draining = false
    let error: unknown = null
    let wake: (() => void) | null = null
    let fieldsResolve: ((f: RawField[] | null) => void) | null = null
    const fieldsPromise = new Promise<RawField[] | null>((r) => {
      fieldsResolve = r
    })
    const notify = () => {
      const w = wake
      wake = null
      w?.()
    }
    q.on('fields', (f: RawField[]) => fieldsResolve?.(f))
    q.on('result', (row: Array<Buffer | null>) => {
      if (draining) return
      queue.push(row)
      if (queue.length > 500) core.pause()
      notify()
    })
    q.on('error', (e: unknown) => {
      error = e
      fieldsResolve?.(null)
      notify()
    })
    q.on('end', () => {
      done = true
      fieldsResolve?.(null)
      this.conn.log.push({ sql, ms: performance.now() - start, label: 'export.data' })
      notify()
    })
    const rawFields = await fieldsPromise
    if (error !== null) {
      this.conn.log.push({ sql, ms: performance.now() - start, label: 'export.data' })
      return this.#fail(error)
    }
    this.#error = ''
    if (rawFields === null) return null
    const fields = rawFields.map((f) => exportField(f))
    const rows = (async function* () {
      try {
        for (;;) {
          if (queue.length > 0) {
            const row = queue.shift() as Array<Buffer | null>
            if (queue.length < 100) core.resume()
            yield row.map((v, i) => exportCell(v, fields[i] as ExportField))
            continue
          }
          if (error !== null) throw error
          if (done) return
          await new Promise<void>((r) => {
            wake = r
          })
        }
      } finally {
        // an abandoned result is read to its end so the connection stays usable
        draining = true
        queue.length = 0
        core.resume()
        while (!done && error === null) {
          await new Promise<void>((r) => {
            wake = r
          })
        }
      }
    })()
    return { fields, rows }
  }

  async #rows(sql: string): Promise<{ names: string[]; rows: Array<Array<string | null>> } | null> {
    try {
      const r = await this.conn.query(sql, 'export')
      this.#error = ''
      const set = r.resultSets[0]
      if (set === undefined) return { names: [], rows: [] }
      return {
        names: set.fields.map((f) => f.name),
        rows: set.rows.map((row) => row.map((v) => (v === null || v === undefined ? null : decodeBytes(v)))),
      }
    } catch (e) {
      return this.#fail(e)
    }
  }

  async fetchValue(sql: string, column: number | string = 0): Promise<string | null | false> {
    const r = await this.#rows(sql)
    if (r === null || r.rows.length === 0) return false
    const i = typeof column === 'number' ? column : r.names.indexOf(column)
    if (i < 0) return false
    const v = r.rows[0]?.[i]
    return v === undefined ? false : v
  }

  async fetchSingleColumn(sql: string): Promise<string[]> {
    const r = await this.#rows(sql)
    return r === null ? [] : r.rows.map((row) => row[0] ?? '')
  }

  async fetchResultSimple(sql: string): Promise<Array<Record<string, string | null>>> {
    const r = await this.#rows(sql)
    if (r === null) return []
    return r.rows.map((row) => Object.fromEntries(r.names.map((n, i) => [n, row[i] ?? null])))
  }

  quoteString(s: string): string {
    return quoteString(s)
  }

  async selectDb(db: string): Promise<boolean> {
    return this.conn.selectDb(db, 'export')
  }

  getDatabaseList(): Promise<string[]> {
    return this.#databaseList()
  }

  async getLowerCaseNames(): Promise<number> {
    if (this.#lowerCaseNames !== null) return this.#lowerCaseNames
    const v = Number.parseInt(String((await this.fetchValue('SELECT @@lower_case_table_names')) || '0'), 10)
    this.#lowerCaseNames = v >= 0 && v <= 2 ? v : 0
    return this.#lowerCaseNames
  }
}

interface CoreConnection {
  query(o: { sql: string; rowsAsArray: boolean; typeCast: boolean }): {
    on(ev: string, fn: (...a: never[]) => void): unknown
  }
  pause(): void
  resume(): void
}

/** The protocol flag bits back from the contract's decoded flags. */
function rawFlags(f: {
  flags: {
    notNull: boolean
    primaryKey: boolean
    uniqueKey: boolean
    multipleKey: boolean
    blob: boolean
    unsigned: boolean
    zerofill: boolean
    enum: boolean
    set: boolean
  }
}): number {
  let n = 0
  if (f.flags.notNull) n |= 1
  if (f.flags.primaryKey) n |= 2
  if (f.flags.uniqueKey) n |= 4
  if (f.flags.multipleKey) n |= 8
  if (f.flags.blob) n |= 16
  if (f.flags.unsigned) n |= 32
  if (f.flags.zerofill) n |= 64
  if (f.flags.enum) n |= 256
  if (f.flags.set) n |= 2048
  return n
}
