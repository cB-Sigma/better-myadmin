/**
 * Port of vendor/phpmyadmin/sql-parser/src/Utils/BufferedQuery.php and of the
 * statement-splitting loop phpMyAdmin runs for the SQL tab and for SQL imports
 * (src/Plugins/Import/ImportSql.php::doImport + src/Import/Import.php::getNextChunk).
 *
 * BufferedQuery works on bytes in PHP; this port works on the UTF-8 bytes of
 * the query too, so every index/length matches PHP exactly.
 */
import { trim } from '../php.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const BACKSLASH = 0x5c
const QUOTE = 0x27
const DQUOTE = 0x22
const BACKTICK = 0x60
const HASH = 0x23
const DASH = 0x2d
const SLASH = 0x2f
const STAR = 0x2a
const BANG = 0x21
const NL = 0x0a

function isWs(b: number | undefined): boolean {
  // Context::isWhitespace(): ' ', "\r", "\n", "\t"
  return b === 0x20 || b === 0x0d || b === 0x0a || b === 0x09
}

class ByteBuffer {
  private buf = new Uint8Array(64)
  length = 0

  push(b: number): void {
    if (this.length === this.buf.length) {
      const n = new Uint8Array(this.buf.length * 2)
      n.set(this.buf)
      this.buf = n
    }
    this.buf[this.length++] = b
  }

  pushAll(bytes: Uint8Array): void {
    for (const b of bytes) this.push(b)
  }

  toString(): string {
    return decoder.decode(this.buf.subarray(0, this.length))
  }

  clear(): void {
    this.length = 0
  }
}

export interface BufferedQueryOptions {
  /** The default delimiter. */
  delimiter?: string
  /** Whether `DELIMITER` statements should be parsed (returned). */
  parse_delimiter?: boolean
  /** Whether the delimiter should be appended at the end of each statement. */
  add_delimiter?: boolean
}

/**
 * Buffer query utilities: extracts complete statements from a query that
 * arrives in chunks.
 *
 * Note: PHP keeps the scan position in a function-level `static $i`, shared by
 * every instance; here it is per instance (phpMyAdmin uses a single instance per
 * request, so the behaviour is the same).
 */
// pma: vendor/phpmyadmin/sql-parser/src/Utils/BufferedQuery.php::BufferedQuery
export class BufferedQuery {
  static readonly STATUS_STRING = 16
  static readonly STATUS_STRING_SINGLE_QUOTES = 17
  static readonly STATUS_STRING_DOUBLE_QUOTES = 18
  static readonly STATUS_STRING_BACKTICK = 20
  static readonly STATUS_COMMENT = 32
  static readonly STATUS_COMMENT_BASH = 33
  static readonly STATUS_COMMENT_C = 34
  static readonly STATUS_COMMENT_SQL = 36

  /** The query that is being processed (UTF-8 bytes). */
  private bytes: Uint8Array
  readonly options: Required<BufferedQueryOptions>
  delimiter = ';'
  private delimiterBytes: Uint8Array = encoder.encode(';')
  delimiterLen = 1
  /** The current status of the parser. */
  status: number | null = null
  /** The last incomplete query that was extracted (UTF-8 bytes). */
  private current = new ByteBuffer()
  /** PHP's `static $i`. */
  private i = 0

  constructor(query = '', options: BufferedQueryOptions = {}) {
    this.options = { delimiter: ';', parse_delimiter: false, add_delimiter: false, ...options }
    this.bytes = encoder.encode(query)
    this.setDelimiter(this.options.delimiter)
  }

  /** The not yet processed part of the query. */
  get query(): string {
    return decoder.decode(this.bytes)
  }

  set query(q: string) {
    this.bytes = encoder.encode(q)
  }

  /** Byte length of the remaining query (PHP `strlen($bq->query)`). */
  get queryLength(): number {
    return this.bytes.length
  }

  /** `$bq->query .= $data` */
  append(data: string): void {
    const add = encoder.encode(data)
    const n = new Uint8Array(this.bytes.length + add.length)
    n.set(this.bytes)
    n.set(add, this.bytes.length)
    this.bytes = n
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Utils/BufferedQuery.php::setDelimiter
  setDelimiter(delimiter: string): void {
    this.delimiter = delimiter
    this.delimiterBytes = encoder.encode(delimiter)
    this.delimiterLen = this.delimiterBytes.length
  }

  private setDelimiterBytes(bytes: Uint8Array): void {
    this.delimiterBytes = bytes
    this.delimiter = decoder.decode(bytes)
    this.delimiterLen = bytes.length
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Utils/BufferedQuery.php::extract
  /**
   * Extracts a statement from the buffer.
   *
   * @param end whether the end of the buffer was reached
   * @returns the statement, `''` when more data is needed (or the statement is empty), `false` when nothing can
   *   be extracted
   */
  extract(end = false): string | false {
    const q = this.bytes

    // PHP `empty($this->query)` ("" and "0" are empty).
    if (q.length === 0 || (q.length === 1 && q[0] === 0x30)) return false

    // The length of the buffer.
    const len = q.length

    // The last index of the string that is going to be parsed.
    // There must be a few characters left in the buffer so the parser can avoid confusing some symbols that
    // may have multiple meanings. For example, if the buffer ends in `-` that may be an operator or the
    // beginning of a comment.
    // Another example if the buffer ends in `DELIMITE`. The parser is going to require a few more characters
    // because that may be a part of a keyword or a word.
    const loopLen = end ? len : len - 16

    for (; this.i < loopLen; ++this.i) {
      const i = this.i
      const c = q[i] as number

      // Handling backslash.
      //
      // Even if the next character is a special character that should be treated differently, because of the
      // preceding backslash, it will be ignored.
      if ((this.status! & BufferedQuery.STATUS_COMMENT) === 0 && c === BACKSLASH) {
        this.current.push(c)
        if (i + 1 < len) this.current.push(q[++this.i] as number)
        continue
      }

      // Handling special parses statuses.
      if (this.status === BufferedQuery.STATUS_STRING_SINGLE_QUOTES) {
        // Single-quoted strings like 'foo'.
        if (c === QUOTE) this.status = 0
        this.current.push(c)
        continue
      }

      if (this.status === BufferedQuery.STATUS_STRING_DOUBLE_QUOTES) {
        // Double-quoted strings like "bar".
        if (c === DQUOTE) this.status = 0
        this.current.push(c)
        continue
      }

      if (this.status === BufferedQuery.STATUS_STRING_BACKTICK) {
        if (c === BACKTICK) this.status = 0
        this.current.push(c)
        continue
      }

      if (
        this.status === BufferedQuery.STATUS_COMMENT_BASH ||
        this.status === BufferedQuery.STATUS_COMMENT_SQL
      ) {
        // Bash-like (#) or SQL-like (-- ) comments end in new line.
        if (c === NL) this.status = 0
        this.current.push(c)
        continue
      }

      if (this.status === BufferedQuery.STATUS_COMMENT_C) {
        // C-like comments end in */.
        if ((i === 0 ? q[len - 1] : q[i - 1]) === STAR && c === SLASH) this.status = 0 // PHP: `$str[-1]` is the last byte
        this.current.push(c)
        continue
      }

      // Checking if a string started.
      if (c === QUOTE) {
        this.status = BufferedQuery.STATUS_STRING_SINGLE_QUOTES
        this.current.push(c)
        continue
      }

      if (c === DQUOTE) {
        this.status = BufferedQuery.STATUS_STRING_DOUBLE_QUOTES
        this.current.push(c)
        continue
      }

      if (c === BACKTICK) {
        this.status = BufferedQuery.STATUS_STRING_BACKTICK
        this.current.push(c)
        continue
      }

      // Checking if a comment started.
      if (c === HASH) {
        this.status = BufferedQuery.STATUS_COMMENT_BASH
        this.current.push(c)
        continue
      }

      if (i + 2 < len) {
        if (c === DASH && q[i + 1] === DASH && isWs(q[i + 2])) {
          this.status = BufferedQuery.STATUS_COMMENT_SQL
          this.current.push(c)
          continue
        }

        if (c === SLASH && q[i + 1] === STAR && q[i + 2] !== BANG) {
          this.status = BufferedQuery.STATUS_COMMENT_C
          this.current.push(c)
          continue
        }
      }

      // Handling `DELIMITER` statement.
      //
      // The code below basically checks for
      //     `strtoupper(substr($this->query, $i, 9)) === 'DELIMITER'`
      //
      // This optimization makes the code about 3 times faster.
      //
      // `DELIMITER` is not being considered a keyword. The only context it has a special meaning is when it is
      // the beginning of a statement. This is the reason for the last condition.
      if (i + 9 < len && matchesDelimiterKeyword(q, i) && isWs(q[i + 9])) {
        // Saving the current index to be able to revert any parsing done in this block.
        const iBak = i
        this.i += 9 // Skipping `DELIMITER`.

        // Skipping whitespaces.
        while (this.i < len && isWs(q[this.i])) ++this.i

        // Parsing the delimiter.
        const delimStart = this.i
        while (this.i < len && !isWs(q[this.i])) ++this.i
        const delimiter = q.slice(delimStart, this.i)

        // Checking if the delimiter definition ended.
        if (delimiter.length > 0 && ((this.i < len && isWs(q[this.i])) || (this.i === len && end))) {
          // Saving the delimiter.
          this.setDelimiterBytes(delimiter)

          // Whether this statement should be returned or not.
          let ret = ''
          if (this.options.parse_delimiter) {
            // Appending the `DELIMITER` statement that was just found to the current statement.
            ret = trim(this.current.toString() + ' ' + decoder.decode(q.subarray(iBak, this.i)))
          }

          // Removing the statement that was just extracted from the query.
          this.bytes = q.slice(this.i)
          this.i = 0

          // Resetting the current statement.
          this.current.clear()

          return ret
        }

        // Didn't find a new delimiter, waiting for more input.
        this.i = iBak
        return false
      }

      // Checking if the current statement finished.
      if (
        c === this.delimiterBytes[0] &&
        (this.delimiterLen === 1 || startsWithAt(q, i, this.delimiterBytes))
      ) {
        // Saving the statement that just ended.
        let ret = this.current.toString()

        // If needed, adds a delimiter at the end of the statement.
        if (this.options.add_delimiter) ret += this.delimiter

        // Removing the statement that was just extracted from the query.
        this.bytes = q.slice(i + this.delimiterLen)
        this.i = 0

        // Resetting the current statement.
        this.current.clear()

        return trim(ret)
      }

      this.current.push(c)
    }

    if (end && this.i === len) {
      // If the end of the buffer was reached, the buffer is emptied and the current statement that was being
      // built is returned.
      const ret = this.current.toString()

      // Emptying the buffer.
      this.bytes = new Uint8Array(0)
      this.i = 0

      // Resetting the current statement.
      this.current.clear()

      return trim(ret)
    }

    return ''
  }
}

const DELIMITER_UPPER = [0x44, 0x45, 0x4c, 0x49, 0x4d, 0x49, 0x54, 0x45, 0x52] // DELIMITER

function matchesDelimiterKeyword(q: Uint8Array, i: number): boolean {
  for (let k = 0; k < 9; k++) {
    const b = q[i + k] as number
    const u = DELIMITER_UPPER[k] as number
    if (b !== u && b !== u + 0x20) return false
  }
  return true
}

function startsWithAt(q: Uint8Array, i: number, needle: Uint8Array): boolean {
  if (i + needle.length > q.length) return false
  for (let k = 0; k < needle.length; k++) if (q[i + k] !== needle[k]) return false
  return true
}

// ---------------------------------------------------------------------------

/**
 * PHP `preg_replace("/\r($|[^\n])/", "\n$1", $data)` as used by ImportSql: converts CR (but not CRLF) to LF.
 * PCRE's `$` also matches before a final "\n", so a trailing "\r\n" becomes "\n\n" (reproduced here).
 */
// pma: src/Plugins/Import/ImportSql.php::doImport
export function convertLoneCr(data: string): string {
  let out = ''
  const len = data.length
  for (let k = 0; k < len; k++) {
    const ch = data[k] as string
    if (ch !== '\r') {
      out += ch
      continue
    }
    const atEnd = k === len - 1
    const beforeFinalNl = k === len - 2 && data[k + 1] === '\n'
    if (atEnd || beforeFinalNl) {
      out += '\n'
      continue
    }
    const next = data[k + 1] as string
    if (next !== '\n') {
      out += '\n' + next
      k++
      continue
    }
    out += ch
  }
  return out
}

export interface SplitOptions {
  /** `sql_delimiter` form field (the "Delimiter" box of the SQL tab); default `;`. */
  delimiter?: string
  /**
   * Base chunk size (in characters) of `Import::getNextChunk()` (default 32768). phpMyAdmin multiplies it by
   * 1..8 as reads progress and caps it with the `memory_limit / 8` read limit (`readLimit`).
   */
  chunkSize?: number
  /** `ImportSettings::$readLimit` (default: unlimited). */
  readLimit?: number
}

/**
 * Splits SQL exactly like phpMyAdmin does for the SQL tab and for SQL file imports:
 * `ImportSql::doImport()` feeding `Import::getNextChunk()` chunks into a `BufferedQuery`.
 *
 * Returns the statements as handed to `Import::runQuery()` (trimmed, without delimiter). phpMyAdmin then
 * executes each one as `statement + ';'` (see {@link splitSqlQueriesToExecute}).
 */
// pma: src/Plugins/Import/ImportSql.php::doImport
export function splitSql(text: string, options: SplitOptions = {}): string[] {
  const statements: string[] = []
  const bq = new BufferedQuery()
  if (options.delimiter !== undefined) bq.setDelimiter(options.delimiter)

  const baseSize = options.chunkSize ?? 32768
  const readLimit = options.readLimit ?? Number.POSITIVE_INFINITY
  let importText = Array.from(text)
  let readMultiply = 1
  let finished = false

  // pma: src/Import/Import.php::getNextChunk
  const getNextChunk = (): string | true => {
    let size = baseSize
    if (readMultiply <= 8) size *= readMultiply
    else size *= 8
    readMultiply++
    if (size > readLimit) size = readLimit
    if (finished) return true
    if (importText.length < size) {
      finished = true
      return importText.join('')
    }
    const r = importText.slice(0, size).join('')
    importText = importText.slice(size)
    return r
  }

  for (;;) {
    // Getting the first statement, the remaining data and the last delimiter.
    const statement = bq.extract()

    // If there is no full statement, we are looking for more data.
    if (statement === false || statement === '') {
      // Importing new data.
      const newData = getNextChunk()

      // Checking if the input buffer has finished.
      if (newData === true) break

      // Convert CR (but not CRLF) to LF otherwise all queries may not get executed on some platforms.
      bq.append(convertLoneCr(newData))
      continue
    }

    // Executing the query (Import::runQuery() resets the read multiplier).
    readMultiply = 1
    statements.push(statement)
  }

  // Extracting remaining statements.
  let guard = 0
  while (bq.queryLength > 0) {
    const statement = bq.extract(true)
    if (statement === false || statement === '') {
      // phpMyAdmin loops forever when `extract(true)` keeps returning false (e.g. a trailing `DELIMITER `
      // without a delimiter); stop instead.
      if (statement === false && ++guard > 1) break
      continue
    }
    guard = 0
    readMultiply = 1
    statements.push(statement)
  }

  return statements
}

/** The queries phpMyAdmin executes for `text`: each split statement with `;` appended (`Import::runQuery`). */
// pma: src/Import/Import.php::runQuery
export function splitSqlQueriesToExecute(text: string, options: SplitOptions = {}): string[] {
  return splitSql(text, options).map((s) => s + ';')
}
