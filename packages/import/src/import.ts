import { type Translator, sprintf } from '@bettermyadmin/i18n'
import { php } from '@bettermyadmin/mysql-types'
import { backquote } from '@bettermyadmin/sql-gen'
import type { ImportFile } from './file.ts'
import { rtrimChars } from './strings.ts'

/** The link the plugins need (DatabaseInterface, through the request's connection). */
export interface ImportDbi {
  /** DatabaseInterface::tryQuery: row count, or false on error */
  tryQuery(sql: string): Promise<{ numRows: number; firstValue: string | null } | false>
  quoteString(s: string): string
  /** DatabaseInterface::getTables (SHOW TABLES, natural order as configured) */
  getTables(db: string): Promise<string[]>
  getColumnNames(db: string, table: string): Promise<string[]>
  fetchSingleColumn(sql: string): Promise<string[]>
  isView(db: string, table: string): Promise<boolean>
}

/** Import::runQuery, implemented by the server's runner (shared with the SQL box). */
export interface QueryRunner {
  runQuery(sql: string): Promise<void>
  /** Import::$forceExecute */
  forceExecute: boolean
  readonly hasError: boolean
  /** clears Import::$hasError (ImportShp does it after buildSql) */
  clearError(): void
  skipQueries: number
}

/** A message of Current::$message (Message::error / ::success / ::notice), as HTML. */
export interface ImportMessage {
  type: 'error' | 'success' | 'notice'
  html: string
}

/** ImportTable */
export interface ImportTable {
  tableName: string
  columns: string[]
  rows: Array<Array<string | null>>
}

export enum ColumnType {
  None = 0,
  Int = 1,
  BigInt = 2,
  Decimal = 3,
  Varchar = 4,
  Geometry = 5,
}

/** DecimalSize */
export interface DecimalSize {
  precision: number
  scale: number
}

/** AnalysedColumn */
export interface AnalysedColumn {
  type: ColumnType
  size: DecimalSize | number
  isFullyFormattedSql: boolean
}

export type ImportType = 'query' | 'table' | 'database' | 'server' | ''

/** pma: src/Import/DecimalSize.php::fromCell */
function decimalFromCell(cell: string): DecimalSize {
  const chars = Array.from(cell)
  const precision = chars.length - 1
  const dot = chars.indexOf('.')
  return { precision, scale: precision - (dot < 0 ? 0 : dot) }
}

const RANK: Record<number, number> = {
  [ColumnType.Int]: 1,
  [ColumnType.BigInt]: 2,
  [ColumnType.Decimal]: 3,
  [ColumnType.Varchar]: 4,
}
const rank = (t: ColumnType) => RANK[t] ?? 0

/** PHP (string) (float) $s for a numeric string */
function floatString(s: string): string {
  return phpFloatString(Number(s))
}

/** PHP (string) $float: precision 14, zend_gcvt formatting */
export function phpFloatString(f: number): string {
  if (Number.isNaN(f)) return 'NAN'
  if (!Number.isFinite(f)) return f > 0 ? 'INF' : '-INF'
  if (f === 0) return Object.is(f, -0) ? '-0' : '0'
  const neg = f < 0
  // 14 significant digits, trailing zeros removed
  const [m, e] = Math.abs(f).toExponential(13).split('e') as [string, string]
  const digits = m.replace('.', '').replace(/0+$/, '')
  const decpt = Number(e) + 1
  let out: string
  if (decpt < 0 ? decpt < -3 : decpt > 14) {
    // exponential: d.ddd E±x
    const exp = decpt - 1
    out = `${digits[0]}.${digits.length > 1 ? digits.slice(1) : '0'}E${exp < 0 ? '-' : '+'}${Math.abs(exp)}`
  } else if (decpt <= 0) {
    out = `0.${'0'.repeat(-decpt)}${digits}`
  } else if (digits.length <= decpt) {
    out = digits + '0'.repeat(decpt - digits.length)
  } else {
    out = `${digits.slice(0, decpt)}.${digits.slice(decpt)}`
  }
  return neg ? `-${out}` : out
}

/** PHP (int) "numeric string" (saturating) */
function intOf(s: string): bigint {
  const t = s.trim()
  const m = /^[+-]?\d+/.exec(t)
  let v: bigint
  if (m !== null && !/^[+-]?\d+[.eE]/.test(t)) v = BigInt(m[0])
  else {
    const f = Math.trunc(Number(t))
    if (!Number.isFinite(f)) return 0n
    v = BigInt(f)
  }
  const max = 2n ** 63n - 1n
  const min = -(2n ** 63n)
  return v > max ? max : v < min ? min : v
}

const htmlspecialchars = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

/**
 * Library that provides common import functions that are used by import plugins, with the request
 * state of ImportSettings.
 * pma: src/Import/Import.php, src/Import/ImportSettings.php
 */
export class Import {
  readonly dbi: ImportDbi
  readonly runner: QueryRunner
  readonly tr: Translator
  /** Current::$database / Current::$table */
  db: string
  table: string
  importType: ImportType
  /** ImportSettings::$importFileName (the uploaded name) */
  importFileName: string
  /** ImportSettings::$importFile: 'none' without a file (path otherwise; LDI needs a server path) */
  importFile: string
  localImportFile: string
  file: ImportFile | null
  readLimit: number
  readMultiply = 1
  finished = false
  offset = 0
  timeoutPassed = false
  charsetConversion = false
  importNotice = ''
  /** Current::$message */
  message: ImportMessage | null = null
  /** Import::$importText (text input) */
  importText = ''
  /** Messages a plugin echoes straight into the page (ImportXml on malformed input). */
  echoed: string[] = []
  #hasError = false
  /** the error is reported like a failed query (Generator::mysqlDie + back link, then exit) */
  dieMessage = false
  /** called after every chunk read (progress events) */
  onChunk: ((offset: number) => void) | null = null
  /** Request parameters (`$_REQUEST` / `$_POST`) */
  readonly request: { get(name: string): string | undefined; has(name: string): boolean }

  constructor(o: {
    dbi: ImportDbi
    runner: QueryRunner
    tr: Translator
    db: string
    table: string
    importType: ImportType
    importFileName: string
    importFile: string
    localImportFile: string
    file: ImportFile | null
    readLimit: number
    request: { get(name: string): string | undefined; has(name: string): boolean }
  }) {
    this.dbi = o.dbi
    this.runner = o.runner
    this.tr = o.tr
    this.db = o.db
    this.table = o.table
    this.importType = o.importType
    this.importFileName = o.importFileName
    this.importFile = o.importFile
    this.localImportFile = o.localImportFile
    this.file = o.file
    this.readLimit = o.readLimit
    this.request = o.request
  }

  get hasError(): boolean {
    return this.#hasError || this.runner.hasError
  }

  set hasError(v: boolean) {
    this.#hasError = v
    if (!v) this.runner.clearError()
  }

  __(s: string): string {
    return this.tr.gettext(s)
  }

  /** Message::error($msgid, $params): the parameters are escaped */
  error(msgid: string, ...params: Array<string | number>): ImportMessage {
    return {
      type: 'error',
      html: sprintf(this.__(msgid), ...params.map((p) => (typeof p === 'string' ? htmlspecialchars(p) : p))),
    }
  }

  async runQuery(sql: string): Promise<void> {
    this.readMultiply = 1
    await this.runner.runQuery(sql)
  }

  /** Import::checkTimeout: no PHP time limit runs out (max_execution_time 0) */
  checkTimeout(): boolean {
    return this.timeoutPassed
  }

  /**
   * Returns next part of imported file/buffer.
   * pma: src/Import/Import.php::getNextChunk
   */
  getNextChunk(size0 = 32768): Buffer | boolean {
    let size = size0
    // Add some progression while reading large amount of data
    if (this.readMultiply <= 8) size *= this.readMultiply
    else size *= 8
    this.readMultiply++
    // We can not read too much
    if (size > this.readLimit) size = this.readLimit
    if (this.checkTimeout()) return false
    if (this.finished) return true
    if (this.importFile === 'none') {
      // Well this is not yet supported and tested, but should return content of textarea
      const chars = Array.from(this.importText)
      if (chars.length < size) {
        this.finished = true
        return Buffer.from(this.importText, 'utf8')
      }
      const r = chars.slice(0, size).join('')
      this.offset += size
      this.importText = chars.slice(size).join('')
      return Buffer.from(r, 'utf8')
    }
    if (this.file === null) return false
    let result = this.file.read(size)
    this.finished = this.file.eof()
    this.offset += size
    this.onChunk?.(this.offset)
    if (this.charsetConversion) return result
    if (this.offset === size) result = skipByteOrderMarks(result)
    return result
  }

  /** Import::getColumnAlphaName */
  getColumnAlphaName(num0: number): string {
    let num = num0
    let colName = ''
    if (num > 26) {
      let div = Math.trunc(num / 26)
      const remain = num % 26
      // subtract 1 of divided value in case the modulus is 0
      if (remain === 0) div--
      colName = this.getColumnAlphaName(div)
      num = remain
    }
    colName += String.fromCharCode(num === 0 ? 65 + 26 - 1 : 65 + num - 1)
    return colName
  }

  /** Import::detectType */
  detectType(last: ColumnType | null, cell: string): ColumnType {
    if (cell === 'NULL') return last ?? ColumnType.None
    if (!php.isNumericString(cell)) return ColumnType.Varchar
    if (cell === floatString(cell) && cell.includes('.') && cell.split('.').length === 2)
      return ColumnType.Decimal
    const i = intOf(cell)
    if ((i < 0n ? -i : i) > 2147483647n) return ColumnType.BigInt
    if (cell !== String(i)) return ColumnType.Varchar
    return ColumnType.Int
  }

  /** Import::detectSize */
  #detectSize(
    lastSize: DecimalSize | number,
    lastType: ColumnType | null,
    cur: ColumnType,
    cell: string,
  ): DecimalSize | number {
    const currSize = Array.from(cell).length
    if (cell === 'NULL') return lastSize
    const n = (s: DecimalSize | number) => (typeof s === 'number' ? s : s.precision)
    const d = (s: DecimalSize | number): DecimalSize =>
      typeof s === 'number' ? { precision: s, scale: 0 } : s
    if (cur === ColumnType.Varchar) {
      if (lastType === ColumnType.Varchar || lastType === ColumnType.BigInt || lastType === ColumnType.Int) {
        return currSize >= n(lastSize) ? currSize : lastSize
      }
      if (lastType === ColumnType.Decimal)
        return currSize >= d(lastSize).precision ? currSize : d(lastSize).precision
      if (lastType === null || lastType === ColumnType.None) return currSize
    } else if (cur === ColumnType.Decimal) {
      if (lastType === ColumnType.Varchar) {
        const size = decimalFromCell(cell)
        return size.precision >= n(lastSize) ? size.precision : lastSize
      }
      if (lastType === ColumnType.Decimal) {
        const size = decimalFromCell(cell)
        const l = d(lastSize)
        if (size.precision > l.precision || size.scale > l.scale) {
          return { precision: Math.max(size.precision, l.precision), scale: Math.max(size.scale, l.scale) }
        }
        return lastSize
      }
      if (lastType === ColumnType.BigInt || lastType === ColumnType.Int) {
        const size = decimalFromCell(cell)
        if (size.precision >= n(lastSize)) return size
        return { precision: n(lastSize), scale: size.scale }
      }
      if (lastType === null || lastType === ColumnType.None) return decimalFromCell(cell)
    } else if (cur === ColumnType.BigInt || cur === ColumnType.Int) {
      if (lastType === ColumnType.Varchar || lastType === ColumnType.BigInt || lastType === ColumnType.Int) {
        return currSize >= n(lastSize) ? currSize : lastSize
      }
      if (lastType === ColumnType.Decimal) {
        const l = d(lastSize)
        const oldInt = l.precision - l.scale
        if (oldInt >= currSize) return lastSize
        return { precision: currSize + l.scale, scale: l.scale }
      }
      if (lastType === null || lastType === ColumnType.None) return currSize
    }
    return -1
  }

  /** Import::analyzeTable */
  analyzeTable(table: ImportTable): AnalysedColumn[] {
    const columns: AnalysedColumn[] = []
    for (let i = 0; i < table.columns.length; ++i) {
      const col: AnalysedColumn = { type: ColumnType.None, size: 0, isFullyFormattedSql: false }
      columns.push(col)
      for (const row of table.rows) {
        const cell = row[i] ?? ''
        const detected = this.detectType(col.type, cell)
        col.size = this.#detectSize(col.size, col.type, detected, cell)
        if (detected === ColumnType.None) continue
        col.type = rank(col.type) >= rank(detected) ? col.type : detected
      }
    }
    /* Check to ensure that all types are valid */
    for (const c of columns) {
      if (c.type !== ColumnType.None) continue
      c.type = ColumnType.Varchar
      c.size = 10
    }
    return columns
  }

  /**
   * Builds and executes SQL statements to create the database and tables as necessary, as well as
   * insert all the data.
   * pma: src/Import/Import.php::buildSql
   */
  async buildSql(
    dbName: string,
    tables: ImportTable[],
    analyses: AnalysedColumn[][] | null = null,
    additionalSql0: string[] | null = null,
    insertMode: 'INSERT' | 'REPLACE' | 'INSERT IGNORE' = 'INSERT',
  ): Promise<void> {
    this.importNotice = ''
    let additionalSql = additionalSql0
    /* Run the $additional_sql statements supplied by the caller plug-in */
    if (additionalSql !== null) {
      // Change CREATE statements to CREATE IF NOT EXISTS to support inserting into existing structures.
      additionalSql = additionalSql.map((s) => s.replace(/CREATE [^`]*(TABLE)/g, 'CREATE $1 IF NOT EXISTS'))
      for (const s of additionalSql) await this.runQuery(s)
    }
    if (analyses !== null) {
      /* Create SQL code to create the tables */
      for (const [i, table] of tables.entries()) {
        let sql = `CREATE TABLE IF NOT EXISTS ${backquote(dbName)}.${backquote(table.tableName)} (`
        table.columns.forEach((column, j) => {
          const a = analyses[i]?.[j] as AnalysedColumn
          let size: DecimalSize | number = a.size
          if (size === 0) size = 10
          let colType = ['NULL', 'int', 'bigint', 'decimal', 'varchar', 'geometry'][a.type] as string
          const sizeNum = typeof size === 'number' ? size : size.precision
          // Use TEXT instead of VARCHAR when the length exceeds the maximum allowed for VARCHAR
          if (colType === 'varchar' && sizeNum > 16383) colType = 'text'
          sql += `${backquote(column)} ${colType}`
          if (colType !== 'text' && a.type !== ColumnType.Geometry) {
            sql += `(${typeof size === 'number' ? size : `${size.precision},${size.scale}`})`
          }
          if (j !== table.columns.length - 1) sql += ', '
        })
        sql += ')'
        await this.runQuery(sql)
      }
    }
    /* Create the SQL statements to insert all the data; only one insert query per table */
    for (const [tableIndex, table] of tables.entries()) {
      const numCols = table.columns.length
      if (table.rows.length === 0) break
      let sql = `${insertMode} INTO ${backquote(dbName)}.${backquote(table.tableName)} (`
      sql += table.columns.map((c) => backquote(c)).join(', ')
      sql += ') VALUES '
      // trick the runQuery method into thinking it executed more than one query
      if (table.rows.length > 50) this.runner.forceExecute = true
      const lastRow = table.rows.length - 1
      table.rows.forEach((row, rowIndex) => {
        sql += '('
        for (let c = 0; c < numCols; ++c) {
          const a = analyses?.[tableIndex]?.[c]
          if (a?.isFullyFormattedSql === true) sql += row[c] ?? ''
          else {
            const value = row[c] ?? ''
            let isVarchar: boolean
            if (analyses !== null) isVarchar = a?.type === ColumnType.Varchar
            else {
              isVarchar =
                !/^0x[0-9a-f]+$/.test(value) &&
                value !== String(intOf(value)) &&
                value !== (php.isNumericString(value) ? floatString(value) : '0')
            }
            /* Don't put quotes around NULL fields */
            if (value === 'NULL') isVarchar = false
            sql += isVarchar ? this.dbi.quoteString(value) : value
          }
          if (c !== numCols - 1) sql += ', '
        }
        sql += ')'
        if (rowIndex !== lastRow) sql += ',\n '
      })
      await this.runQuery(sql)
    }
    /* Add the viewable structures from $additional_sql to $tables so they are also displayed */
    for (const s of additionalSql ?? []) {
      const m = /VIEW `[^`]+`\.`([^`]+)/.exec(s) ?? /CREATE TABLE IF NOT EXISTS `([^`]+)`/.exec(s)
      if (m === null) continue
      if (tables.some((t) => t.tableName === m[1])) continue
      tables.push({ tableName: m[1] as string, columns: [], rows: [] })
    }
    this.importNotice = await this.#successMessage(dbName, tables)
  }

  /** Import::getNextAvailableTableName */
  async getNextAvailableTableName(databaseName: string, proposed0: string): Promise<string> {
    const proposed = proposed0 === '' ? 'TABLE' : proposed0
    let name = rtrimChars(proposed)
    name = Array.from(name, (ch) => {
      const cp = ch.codePointAt(0) ?? 0
      return cp === 0 || cp > 0xffff ? '_' : ch
    }).join('')
    if (databaseName !== '') {
      const existing = await this.dbi.getTables(databaseName)
      if (!existing.includes(name)) return name
      const esc = name.replace(/[.\\+*?[^\]$(){}=!<>|:\-#/]/g, '\\$&')
      const re = new RegExp(`^${esc}_`, 'is')
      const count = existing.filter((t) => re.test(t)).length
      return `${name}_${count + 1}`
    }
    return name
  }

  /** Import::createDatabase */
  async createDatabase(dbName: string, charset: string, collation: string): Promise<void> {
    await this.runQuery(
      `CREATE DATABASE IF NOT EXISTS ${backquote(dbName)} DEFAULT CHARACTER SET ${charset} COLLATE ${collation}`,
    )
  }

  /** Import::getSuccessMessage + ::getHtmlListForAllTables (links are /route?params) */
  async #successMessage(dbName: string, tables: ImportTable[]): Promise<string> {
    const __ = (s: string) => this.__(s)
    const url = (route: string, p: Record<string, string>) =>
      `index.php?route=${route}&${new URLSearchParams(p).toString().replace(/&/g, '&amp;')}`
    let m = '<br><br>'
    m += `<strong>${__('The following structures have either been created or altered. Here you can:')}</strong><br>`
    m += `<ul><li>${__("View a structure's contents by clicking on its name.")}</li>`
    m += `<li>${__('Change any of its settings by clicking the corresponding "Options" link.')}</li>`
    m += `<li>${__('Edit structure by following the "Structure" link.')}</li>`
    m += `<br><li><a href="${url('/database/structure', { db: dbName })}" title="${sprintf(__('Go to database: %s'), htmlspecialchars(backquote(dbName)))}">${htmlspecialchars(dbName)}</a> (<a href="${url('/database/operations', { db: dbName })}" title="${sprintf(__('Edit settings for %s'), htmlspecialchars(backquote(dbName)))}">${__('Options')}</a>)</li>`
    m += '<ul>'
    for (const t of tables) {
      const p = { db: dbName, table: t.tableName }
      const name = htmlspecialchars(backquote(t.tableName))
      if (!(await this.dbi.isView(dbName, t.tableName))) {
        m += `<li><a href="${url('/sql', p)}" title="${sprintf(__('Go to table: %s'), name)}">${htmlspecialchars(t.tableName)}</a> (<a href="${url('/table/structure', p)}" title="${sprintf(__('Structure of %s'), name)}">${__('Structure')}</a>) (<a href="${url('/table/operations', p)}" title="${sprintf(__('Edit settings for %s'), name)}">${__('Options')}</a>)</li>`
      } else {
        m += `<li><a href="${url('/sql', p)}" title="${sprintf(__('Go to view: %s'), name)}">${htmlspecialchars(t.tableName)}</a></li>`
      }
    }
    return `${m}</ul></ul>`
  }
}

/** Import::skipByteOrderMarksFromContents */
export function skipByteOrderMarks(b: Buffer): Buffer {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3)
  if ((b[0] === 0xfe && b[1] === 0xff) || (b[0] === 0xff && b[1] === 0xfe)) return b.subarray(2)
  return b
}
