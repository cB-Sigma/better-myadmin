/**
 * PHP strings are byte strings; the export plugins concatenate cell bytes (possibly not valid UTF-8,
 * e.g. a BLOB dumped without hex) with UTF-8 text. Here every value is a JS string in which each
 * byte of an ill-formed UTF-8 sequence is kept as the lone surrogate U+DC80+byte ("surrogateescape"),
 * so values round-trip to the exact bytes MySQL sent while text functions keep working on characters.
 */
import { isUtf8 } from 'node:buffer'

/** Raw cell bytes → string (valid UTF-8 decoded, every other byte escaped as U+DC80+byte). */
export function decodeBytes(buf: Uint8Array): string {
  if (isUtf8(buf)) return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString('utf8')
  let out = ''
  let i = 0
  const n = buf.length
  while (i < n) {
    const b = buf[i] as number
    let len = 0
    if (b < 0x80) len = 1
    else if (b >= 0xc2 && b <= 0xdf) len = 2
    else if (b >= 0xe0 && b <= 0xef) len = 3
    else if (b >= 0xf0 && b <= 0xf4) len = 4
    if (len > 1 && i + len <= n && isUtf8(buf.subarray(i, i + len))) {
      out += Buffer.from(buf.subarray(i, i + len)).toString('utf8')
      i += len
      continue
    }
    out += len === 1 ? String.fromCharCode(b) : String.fromCharCode(0xdc00 + b)
    i++
  }
  return out
}

/** The bytes a string stands for (UTF-8, escaped bytes restored). */
export function encodeBytes(s: string): Buffer {
  // fast path: no lone surrogates of the escape range
  if (!/[\udc80-\udcff]/.test(s)) return Buffer.from(s, 'utf8')
  const parts: Buffer[] = []
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xdc80 && c <= 0xdcff) {
      // a real low surrogate preceded by a high one is part of a valid pair
      const prev = i > 0 ? s.charCodeAt(i - 1) : 0
      if (prev >= 0xd800 && prev <= 0xdbff) continue
      if (i > start) parts.push(Buffer.from(s.slice(start, i), 'utf8'))
      parts.push(Buffer.from([c - 0xdc00]))
      start = i + 1
    }
  }
  if (start < s.length) parts.push(Buffer.from(s.slice(start), 'utf8'))
  return Buffer.concat(parts)
}

/** PHP bin2hex() */
export function bin2hex(s: string): string {
  return encodeBytes(s).toString('hex')
}

/** PHP strlen(): byte length */
export function strlen(s: string): number {
  return encodeBytes(s).length
}

/** PHP mb_strlen() (UTF-8): characters, an escaped byte counts as one */
export function mbStrlen(s: string): number {
  let n = 0
  for (const _ of s) n++
  return n
}

/** PHP htmlspecialchars($s, ENT_COMPAT) */
export function htmlspecialcharsCompat(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** PHP htmlspecialchars($s) (ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML401 since PHP 8.1) */
export function htmlspecialchars(s: string): string {
  return htmlspecialcharsCompat(s).replace(/'/g, '&#039;')
}

/** PHP is_numeric() on a string */
export function isNumeric(s: string): boolean {
  return /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(s)
}

/** PHP empty() on a string */
export const emptyStr = (s: string | null | undefined): boolean =>
  s === null || s === undefined || s === '' || s === '0'
