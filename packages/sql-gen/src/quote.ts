/**
 * Identifier and literal quoting.
 *
 * pma: src/Util.php::backquote, ::backquoteCompat
 *      src/Dbal/DatabaseInterface.php::quoteString (mysqli real_escape_string + quotes)
 *      ext/mysqlnd/mysqlnd_charset.c::mysqlnd_cset_escape_slashes / _quotes (the escaping itself)
 */

import { php } from '@bettermyadmin/mysql-types'

/**
 * Adds backquotes on both sides of an identifier and doubles the backquotes
 * inside. `''` and `'*'` are returned unchanged. Arrays are mapped (the old
 * phpMyAdmin behaviour of `backquote(array)`).
 *
 * pma: src/Util.php::backquote
 */
export function backquote(identifier: string | null | undefined): string
export function backquote(identifier: readonly (string | null | undefined)[]): string[]
export function backquote(
  identifier: string | null | undefined | readonly (string | null | undefined)[],
): string | string[] {
  if (Array.isArray(identifier)) return identifier.map((i) => backquoteCompat(i, 'NONE'))
  return backquoteCompat(identifier as string | null | undefined, 'NONE')
}

/**
 * pma: src/Util.php::backquoteCompat — `MSSQL` compatibility uses double quotes
 * escaped with a backslash; anything else uses backquotes. The `$doIt = false`
 * mode (quote only reserved words) needs the SQL keyword list and is provided
 * by the caller through `isReservedKeyword`.
 */
export function backquoteCompat(
  identifier: string | null | undefined,
  compatibility = 'MSSQL',
  doIt = true,
  isReservedKeyword?: (word: string) => boolean,
): string {
  const id = identifier ?? ''
  if (id === '' || id === '*') return id
  if (!doIt) {
    if (isReservedKeyword === undefined) {
      throw new Error('backquoteCompat(doIt=false) needs an isReservedKeyword callback')
    }
    if (!isReservedKeyword(id)) return id
  }
  if (compatibility === 'MSSQL') return `"${id.replaceAll('"', '\\"')}"`
  return `\`${id.replaceAll('`', '``')}\``
}

/** Connection options that influence string escaping. */
export interface QuoteOptions {
  /**
   * Connection character set (`SET NAMES` / `character_set_client`). Default
   * `utf8mb4`. Matters for the multibyte charsets whose trail bytes may be
   * 0x5C (`\`) or 0x27 (`'`): big5, cp932, gbk, gb18030, sjis, euckr, ujis,
   * eucjpms, gb2312. Their valid multibyte sequences are copied unescaped,
   * exactly as libmysqlclient/mysqlnd do, which is what prevents the classic
   * "0xBF27" injection. For utf8/utf8mb4/latin1/binary escaping is byte-wise.
   */
  charset?: string
  /** Server has `NO_BACKSLASH_ESCAPES` in sql_mode: quotes are doubled, backslashes kept. */
  noBackslashEscapes?: boolean
}

type MbValid = (b: Uint8Array, i: number) => number
type MbCharlen = (c: number) => number

interface CharsetInfo {
  maxLen: number
  valid: MbValid
  charlen: MbCharlen
}

/** C `char` is signed: a byte >= 0x80 passed as `unsigned int` becomes 0xFFFFFFxx */
const signedChar = (b: number): number => (b >= 0x80 ? (0xffffff00 | b) >>> 0 : b)
const at = (b: Uint8Array, i: number): number => (i < b.length ? (b[i] as number) : 0)

const utf8Valid =
  (mb4: boolean): MbValid =>
  (b, i) => {
    const end = b.length
    if (i >= end) return 0
    const c = at(b, i)
    if (c < 0x80) return 0
    if (c < 0xc2) return 0
    if (c < 0xe0) {
      if (i + 2 > end) return 0
      return (at(b, i + 1) ^ 0x80) < 0x40 ? 2 : 0
    }
    if (c < 0xf0) {
      if (i + 3 > end) return 0
      const ok =
        (at(b, i + 1) ^ 0x80) < 0x40 && (at(b, i + 2) ^ 0x80) < 0x40 && (c >= 0xe1 || at(b, i + 1) >= 0xa0)
      return ok ? 3 : 0
    }
    if (mb4 && c < 0xf5) {
      if (i + 4 > end) return 0
      const c1 = at(b, i + 1)
      const ok =
        (c1 ^ 0x80) < 0x40 &&
        (at(b, i + 2) ^ 0x80) < 0x40 &&
        (at(b, i + 3) ^ 0x80) < 0x40 &&
        (c >= 0xf1 || c1 >= 0x90) &&
        (c <= 0xf3 || c1 <= 0x8f)
      return ok ? 4 : 0
    }
    return 0
  }

const utf8Charlen =
  (mb4: boolean): MbCharlen =>
  (c) => {
    if (c < 0x80) return 1
    if (c < 0xc2) return 0
    if (c < 0xe0) return 2
    if (c < 0xf0) return 3
    if (mb4 && c < 0xf8) return 4
    return 0
  }

const u8 = (c: number): number => c & 0xff
const inRange = (c: number, lo: number, hi: number): boolean => lo <= c && c <= hi

const big5Head = (c: number): boolean => inRange(u8(c), 0xa1, 0xf9)
const big5Tail = (c: number): boolean => inRange(u8(c), 0x40, 0x7e) || inRange(u8(c), 0xa1, 0xfe)
const cp932Head = (c: number): boolean => inRange(c, 0x81, 0x9f) || inRange(c, 0xe0, 0xfc)
const cp932Tail = (c: number): boolean => inRange(c, 0x40, 0x7e) || inRange(c, 0x80, 0xfc)
const euckrValid = (c: number): boolean => inRange(u8(c), 0xa1, 0xfe)
const eucjpms = (c: number): boolean => inRange(c & 0xff, 0xa1, 0xfe)
const eucjpmsKata = (c: number): boolean => inRange(c & 0xff, 0xa1, 0xdf)
const gb2312Head = (c: number): boolean => inRange(u8(c), 0xa1, 0xf7)
const gb2312Tail = (c: number): boolean => inRange(u8(c), 0xa1, 0xfe)
const gbkHead = (c: number): boolean => inRange(u8(c), 0x81, 0xfe)
const gbkTail = (c: number): boolean => inRange(u8(c), 0x40, 0x7e) || inRange(u8(c), 0x80, 0xfe)
const gb18030Odd = (c: number): boolean => inRange(u8(c), 0x81, 0xfe)
const gb18030Even2 = (c: number): boolean => inRange(u8(c), 0x40, 0x7e) || inRange(u8(c), 0x80, 0xfe)
const gb18030Even4 = (c: number): boolean => inRange(u8(c), 0x30, 0x39)

const CHARSETS: Record<string, CharsetInfo> = {
  utf8mb4: { maxLen: 4, valid: utf8Valid(true), charlen: utf8Charlen(true) },
  utf8mb3: { maxLen: 3, valid: utf8Valid(false), charlen: utf8Charlen(false) },
  utf8: { maxLen: 3, valid: utf8Valid(false), charlen: utf8Charlen(false) },
  big5: {
    maxLen: 2,
    valid: (b, i) => (big5Head(at(b, i)) && b.length - i > 1 && big5Tail(at(b, i + 1)) ? 2 : 0),
    charlen: (c) => (big5Head(c) ? 2 : 1),
  },
  cp932: {
    maxLen: 2,
    valid: (b, i) => (cp932Head(at(b, i)) && b.length - i > 1 && cp932Tail(at(b, i + 1)) ? 2 : 0),
    charlen: (c) => (cp932Head(u8(c)) ? 2 : 1),
  },
  sjis: {
    maxLen: 2,
    valid: (b, i) => (cp932Head(at(b, i)) && b.length - i > 1 && cp932Tail(at(b, i + 1)) ? 2 : 0),
    charlen: (c) => (cp932Head(u8(c)) ? 2 : 1),
  },
  euckr: {
    maxLen: 2,
    valid: (b, i) => {
      if (b.length - i <= 1) return 0
      if (at(b, i) < 0x80) return 0
      return euckrValid(at(b, i + 1)) ? 2 : 0
    },
    charlen: (c) => (euckrValid(c) ? 2 : 1),
  },
  eucjpms: {
    maxLen: 3,
    valid: (b, i) => {
      const c = at(b, i)
      const left = b.length - i
      if (c < 0x80) return 0
      if (eucjpms(c) && left > 1 && eucjpms(at(b, i + 1))) return 2
      if ((c & 0xff) === 0x8e && left > 1 && eucjpmsKata(at(b, i + 1))) return 2
      if ((c & 0xff) === 0x8f && left > 2 && eucjpms(at(b, i + 1)) && eucjpms(at(b, i + 2))) return 3
      return 0
    },
    charlen: (c) => (eucjpms(c) || (c & 0xff) === 0x8e ? 2 : (c & 0xff) === 0x8f ? 3 : 1),
  },
  ujis: {
    maxLen: 3,
    valid: (b, i) => {
      const c = at(b, i)
      const left = b.length - i
      if (c < 0x80) return 0
      if (eucjpms(c) && eucjpms(at(b, i + 1))) return 2
      if ((c & 0xff) === 0x8e && eucjpmsKata(at(b, i + 1))) return 2
      if ((c & 0xff) === 0x8f && left > 2 && eucjpms(at(b, i + 1)) && eucjpms(at(b, i + 2))) return 3
      return 0
    },
    charlen: (c) => (eucjpms(c) ? 2 : (c & 0xff) === 0x8e ? 2 : (c & 0xff) === 0x8f ? 3 : 1),
  },
  gb2312: {
    maxLen: 2,
    valid: (b, i) => (gb2312Head(at(b, i)) && b.length - i > 1 && gb2312Tail(at(b, i + 1)) ? 2 : 0),
    charlen: (c) => (gb2312Head(c) ? 2 : 1),
  },
  gbk: {
    maxLen: 2,
    valid: (b, i) => (gbkHead(at(b, i)) && b.length - i > 1 && gbkTail(at(b, i + 1)) ? 2 : 0),
    charlen: (c) => (gbkHead(c) ? 2 : 1),
  },
  gb18030: {
    maxLen: 4,
    valid: (b, i) => {
      const left = b.length - i
      if (left <= 1 || !gb18030Odd(at(b, i))) return 0
      if (gb18030Even2(at(b, i + 1))) return 2
      if (left > 3 && gb18030Even4(at(b, i + 1)) && gb18030Odd(at(b, i + 2)) && gb18030Even4(at(b, i + 3)))
        return 4
      return 0
    },
    charlen: (c) => {
      if (c <= 0xff) return gb18030Odd(c) ? 0 : 1
      if (c > 0xffff || !gb18030Odd((c >> 8) & 0xff)) return 0
      if (gb18030Even2(c & 0xff)) return 2
      if (gb18030Even4(c & 0xff)) return 4
      return 0
    },
  },
}

/** Charsets whose escaping differs from the plain byte-wise algorithm */
export const MULTIBYTE_ESCAPE_CHARSETS: readonly string[] = Object.keys(CHARSETS)

function charsetInfo(charset: string): CharsetInfo | null {
  return CHARSETS[charset.toLowerCase()] ?? null
}

/**
 * Escapes a string the way `mysqli::real_escape_string` does for the
 * connection charset (backslash-escapes NUL, \n, \r, \, ', ", Ctrl-Z; with
 * NO_BACKSLASH_ESCAPES only doubles single quotes). Returns the same type it
 * was given: a JS string is treated as its UTF-8 bytes.
 *
 * The bytes of a JS string are its UTF-8 encoding, so a non-UTF-8 connection
 * charset (gbk, sjis...) is only meaningful with `Uint8Array` input already
 * encoded in that charset.
 */
export function escapeString(value: string, options?: QuoteOptions): string
export function escapeString(value: Uint8Array, options?: QuoteOptions): Uint8Array
export function escapeString(value: string | Uint8Array, options: QuoteOptions = {}): string | Uint8Array {
  const cs = charsetInfo(options.charset ?? 'utf8mb4')
  // fast path: valid UTF-8 JS strings with a utf8 connection are escaped character-wise
  if (typeof value === 'string' && (cs === null || cs === CHARSETS.utf8mb4 || cs === CHARSETS.utf8mb3)) {
    if (options.noBackslashEscapes) return value.replaceAll("'", "''")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: NUL and Ctrl-Z are exactly what MySQL escapes
    return value.replace(/[\0\n\r\\'"\x1a]/g, (c) => ESCAPES[c] as string)
  }
  const bytes = php.toBytes(value)
  const out = escapeBytes(bytes, cs, options.noBackslashEscapes === true)
  return typeof value === 'string' ? new TextDecoder().decode(out) : out
}

const ESCAPES: Record<string, string> = {
  '\0': '\\0',
  '\n': '\\n',
  '\r': '\\r',
  '\\': '\\\\',
  "'": "\\'",
  '"': '\\"',
  '\x1a': '\\Z',
}

function escapeBytes(bytes: Uint8Array, cs: CharsetInfo | null, noBackslash: boolean): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < bytes.length; i++) {
    if (cs !== null && cs.maxLen > 1) {
      const len = cs.valid(bytes, i)
      if (len > 0) {
        for (let k = 0; k < len; k++) out.push(bytes[i + k] as number)
        i += len - 1
        continue
      }
    }
    const c = bytes[i] as number
    if (noBackslash) {
      if (c === 0x27) out.push(0x27, 0x27)
      else out.push(c)
      continue
    }
    let esc = 0
    if (cs !== null && cs.maxLen > 1 && cs.charlen(signedChar(c)) > 1) {
      esc = c
    } else {
      switch (c) {
        case 0:
          esc = 0x30 // '0'
          break
        case 0x0a:
          esc = 0x6e // 'n'
          break
        case 0x0d:
          esc = 0x72 // 'r'
          break
        case 0x5c:
        case 0x27:
        case 0x22:
          esc = c
          break
        case 0x1a:
          esc = 0x5a // 'Z'
          break
      }
    }
    if (esc !== 0) out.push(0x5c, esc)
    else out.push(c)
  }
  return Uint8Array.from(out)
}

/**
 * `'...'` string literal, escaped for the connection.
 * pma: src/Dbal/DatabaseInterface.php::quoteString
 */
export function quoteString(value: string, options?: QuoteOptions): string
export function quoteString(value: Uint8Array, options?: QuoteOptions): Uint8Array
export function quoteString(value: string | Uint8Array, options: QuoteOptions = {}): string | Uint8Array {
  if (typeof value === 'string') return `'${escapeString(value, options)}'`
  const escaped = escapeString(value, options)
  const out = new Uint8Array(escaped.length + 2)
  out[0] = 0x27
  out.set(escaped, 1)
  out[out.length - 1] = 0x27
  return out
}

/** `0x...` hexadecimal literal of raw bytes (`'0x'` + bin2hex). An empty value gives `0x`. */
export function hexLiteral(value: string | Uint8Array): string {
  return `0x${php.bin2hex(value)}`
}

/** `b'0101'` BIT literal; any character other than 0/1 becomes 0 (InsertEdit / generateFieldSpec rule). */
export function bitLiteral(bits: string): string {
  return `b'${bits.replace(/[^01]/g, '0')}'`
}

/** The SQL NULL literal */
export const NULL = 'NULL'

/**
 * Escapes the LIKE wildcards `_`, `%` and the backslash.
 * pma: src/Dbal/DatabaseInterface.php::escapeMysqlWildcards
 */
export function escapeMysqlWildcards(value: string): string {
  return value.replace(/[\\_%]/g, (c) => `\\${c}`)
}
