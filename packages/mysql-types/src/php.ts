/**
 * Tiny emulations of the PHP built-ins phpMyAdmin relies on, so that ported
 * code produces byte-identical output. Only the behaviour phpMyAdmin depends on
 * is reproduced; each helper documents the PHP function it mirrors.
 *
 * PHP strings are byte strings. Where the distinction matters, helpers take a
 * `Uint8Array` (raw bytes) or a JS string (which stands for its UTF-8 bytes).
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

/** UTF-8 bytes of a JS string, or the bytes themselves. */
export function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? encoder.encode(value) : value
}

/** PHP `bin2hex` */
export function bin2hex(value: string | Uint8Array): string {
  const bytes = toBytes(value)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/**
 * PHP `mb_strlen($s)` with the default UTF-8 internal encoding (PHP >= 8.3):
 * the number of code points, where every ill-formed subsequence counts as one
 * character (maximal-subpart replacement, same as WHATWG TextDecoder).
 */
export function mbStrlen(value: string | Uint8Array): number {
  if (typeof value === 'string') {
    let n = 0
    for (const _ of value) n++
    return n
  }
  let n = 0
  for (const _ of decoder.decode(value)) n++
  return n
}

/** Bytes interpreted as a "binary string": one JS char per byte (latin1). */
export function bytesToBinaryString(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return s
}

const WHITESPACE = ' \t\n\r\v\f'

/**
 * PHP 8 numeric-string check (`is_numeric` on a string): optional leading
 * whitespace, optional sign, decimal digits with optional fraction and
 * exponent, optional trailing whitespace. No hex, no binary, no "inf".
 */
export function isNumericString(s: string): boolean {
  return /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(s)
}

/**
 * PHP 8 loose comparison `$string == 0` (and therefore `$string != 0`).
 * Numeric strings compare numerically, anything else compares as the string "0".
 */
export function looseEqualsZero(value: string | Uint8Array): boolean {
  const s = typeof value === 'string' ? value : bytesToBinaryString(value)
  if (isNumericString(s)) {
    // derived boolean only, the cell value itself is never converted
    return Number(s.trim()) === 0
  }
  return s === '0'
}

/** PHP 8 loose comparison between a string and an int (`$s == $n`). */
export function looseEqualsInt(s: string, n: number | bigint): boolean {
  if (isNumericString(s)) return Number(s.trim()) === Number(n)
  return s === String(n)
}

/** PHP 8 loose `in_array($needle, $haystack)` where needle is a string */
export function looseInArray(needle: string, haystack: readonly (string | number)[]): boolean {
  return haystack.some((v) => (typeof v === 'number' ? looseEqualsInt(needle, v) : v === needle))
}

/**
 * PHP 8 comparison `$s > $n` for a string and an int: numerically when the
 * string is numeric, otherwise as strings (strcmp) against the decimal form.
 */
export function looseGreaterThanInt(s: string, n: number): boolean {
  if (isNumericString(s)) return Number(s.trim()) > n
  return s > String(n)
}

/** PHP truthiness of a string (`if ($s)`, `! empty($s)`) */
export function truthy(value: string | null | undefined): boolean {
  return value !== undefined && value !== null && value !== '' && value !== '0'
}

const INT64_MAX = 9223372036854775807n
const INT64_MIN = -9223372036854775808n

/**
 * PHP `(int) $string` on 64-bit platforms: leading whitespace, optional sign,
 * leading digits (or a full float-like prefix such as "1e3"), saturating at
 * PHP_INT_MAX / PHP_INT_MIN.
 */
export function intCast(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(Math.trunc(value))
  const m = /^[ \t\n\r\v\f]*([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?)/.exec(value)
  if (m === null || m[1] === undefined) return 0n
  const num = m[1]
  if (/^[+-]?\d+$/.test(num)) {
    const b = BigInt(num)
    if (b > INT64_MAX) return INT64_MAX
    if (b < INT64_MIN) return INT64_MIN
    return b
  }
  const f = Number(num)
  if (!Number.isFinite(f) || f >= 2 ** 63) return f < 0 ? INT64_MIN : INT64_MAX
  if (f <= -(2 ** 63)) return INT64_MIN
  return BigInt(Math.trunc(f))
}

/** PHP `decbin()` for a 64-bit int (negative numbers in two's complement) */
export function decbin(value: bigint): string {
  const v = value < 0n ? value + (1n << 64n) : value
  return v.toString(2)
}

/** PHP `rtrim($s)` / `trim($s)` with the default character list " \n\r\t\v\0" */
const TRIM_CHARS = ' \n\r\t\v\0'
export function rtrim(s: string): string {
  let end = s.length
  while (end > 0 && TRIM_CHARS.includes(s[end - 1] as string)) end--
  return s.slice(0, end)
}
export function ltrim(s: string): string {
  let start = 0
  while (start < s.length && TRIM_CHARS.includes(s[start] as string)) start++
  return s.slice(start)
}
export function trim(s: string): string {
  return ltrim(rtrim(s))
}

/** PHP `strtoupper` / `strtolower` (ASCII only, byte-wise) */
export function strtoupper(s: string): string {
  return s.replace(/[a-z]+/g, (m) => m.toUpperCase())
}
export function strtolower(s: string): string {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase())
}

/**
 * PHP `htmlspecialchars($s, $flags)`. `quotes`: 'compat' (ENT_COMPAT: only
 * double quotes) or 'quotes' (ENT_QUOTES, the default: ' becomes &#039;).
 */
export function htmlspecialchars(s: string, quotes: 'compat' | 'quotes' = 'quotes'): string {
  let out = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  if (quotes === 'quotes') out = out.replace(/'/g, '&#039;')
  return out
}

/** PHP `htmlspecialchars_decode($s, ENT_QUOTES)` */
export function htmlspecialcharsDecode(s: string): string {
  return s.replace(/&(?:#(?:[xX]([0-9a-fA-F]+)|([0-9]+))|(amp|quot|lt|gt));/g, (all, hex, dec, named) => {
    if (named !== undefined) {
      return ({ amp: '&', quot: '"', lt: '<', gt: '>' } as Record<string, string>)[named as string] ?? all
    }
    const code = hex !== undefined ? Number.parseInt(hex as string, 16) : Number.parseInt(dec as string, 10)
    return code === 34 || code === 38 || code === 39 || code === 60 || code === 62
      ? String.fromCharCode(code)
      : all
  })
}

/** Index after stripping one trailing "\r\n", "\n" or "\r" (php_fgetcsv_lookup_trailing_spaces) */
function csvTrailing(s: string, start: number, end: number): number {
  if (end <= start) return end
  const last = s[end - 1]
  if (last === '\n') return end - 1 > start && s[end - 2] === '\r' ? end - 2 : end - 1
  if (last === '\r') return end - 1
  return end
}

function isCSpace(c: string | undefined): boolean {
  return c !== undefined && WHITESPACE.includes(c)
}

/**
 * PHP `str_getcsv($s, $delimiter, $enclosure, $escape)` for single-character
 * arguments, ported from php_fgetcsv (ext/standard/file.c, PHP 8.3) with the
 * "C" locale (every byte is one character). Returns `[null]` for an empty line.
 */
export function strGetCsv(
  s: string,
  delimiter = ',',
  enclosure = '"',
  escapeChar: string | null = '\\',
): (string | null)[] {
  const len = s.length
  const at = (i: number): string => (i < len ? (s[i] as string) : '\0')
  const limit = csvTrailing(s, 0, len)
  const lineEnd = limit
  const lineEndStr = s.slice(limit)
  const values: (string | null)[] = []
  let bptr = 0
  let first = true
  let incLen: number
  do {
    let temp = ''
    incLen = bptr < limit ? 1 : 0
    if (incLen === 1) {
      let tmp = bptr
      while (at(tmp) !== delimiter && isCSpace(at(tmp))) tmp++
      if (at(tmp) === enclosure && tmp < limit) bptr = tmp
    }
    if (first && bptr === lineEnd) return [null]
    first = false
    if (incLen !== 0 && at(bptr) === enclosure) {
      let state = 0
      bptr++
      let hunk = bptr
      for (;;) {
        if (incLen === 0) {
          if (state === 2) {
            temp += s.slice(hunk, bptr - 1)
            hunk = bptr
            break
          }
          if (state === 1) {
            temp += s.slice(hunk, bptr)
            hunk = bptr
          }
          if (hunk !== lineEnd) {
            temp += s.slice(hunk, bptr)
            hunk = bptr
          }
          temp += lineEndStr
          if (bptr > limit) {
            if (hunk === bptr) --hunk
            --bptr
          }
          break
        }
        if (state === 1) {
          bptr++
          state = 0
        } else if (state === 2) {
          if (at(bptr) !== enclosure) {
            temp += s.slice(hunk, bptr - 1)
            hunk = bptr
            break
          }
          temp += s.slice(hunk, bptr)
          bptr++
          hunk = bptr
          state = 0
        } else {
          if (at(bptr) === enclosure) state = 2
          else if (escapeChar !== null && at(bptr) === escapeChar) state = 1
          bptr++
        }
        incLen = bptr < limit ? 1 : 0
      }
      for (;;) {
        if (incLen === 0) break
        if (at(bptr) === delimiter) break
        bptr += incLen
        incLen = bptr < limit ? 1 : 0
      }
      temp += s.slice(hunk, bptr)
      bptr += incLen
      values.push(temp)
    } else {
      const hunk = bptr
      for (;;) {
        if (incLen === 0) break
        if (at(bptr) === delimiter) break
        bptr += incLen
        incLen = bptr < limit ? 1 : 0
      }
      temp = s.slice(hunk, bptr)
      temp = temp.slice(0, csvTrailing(temp, 0, temp.length))
      if (at(bptr) === delimiter) bptr++
      values.push(temp)
    }
  } while (incLen > 0)
  return values
}

/** PHP strtr($string, $pairs): longest keys first, no re-replacement. */
export function strtr(str: string, pairs: Record<string, string>): string {
  const keys = Object.keys(pairs)
    .filter((k) => k !== '')
    .sort((a, b) => b.length - a.length)
  if (keys.length === 0) return str
  let out = ''
  let i = 0
  outer: while (i < str.length) {
    for (const k of keys) {
      if (str.startsWith(k, i)) {
        out += pairs[k]
        i += k.length
        continue outer
      }
    }
    out += str[i]
    i++
  }
  return out
}
