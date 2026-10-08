/**
 * PHP string functions the navigation tree depends on, with PHP's exact semantics
 * (byte-wise, ASCII case folding as in PHP >= 8.2).
 */
import { php } from '@bettermyadmin/mysql-types'

const isDigit = (c: number) => c >= 0x30 && c <= 0x39
// C isspace(): space, \t, \n, \v, \f, \r
const isSpace = (c: number) => c === 0x20 || (c >= 0x09 && c <= 0x0d)
const toUpper = (c: number) => (c >= 0x61 && c <= 0x7a ? c - 0x20 : c)
const toLower = (c: number) => (c >= 0x41 && c <= 0x5a ? c + 0x20 : c)

/** Byte at `i`, or 0 past the end (the C code reads the terminating NUL). */
const at = (s: Uint8Array, i: number) => (i < s.length ? (s[i] as number) : 0)

/** pma relies on ext/standard/strnatcmp.c::strnatcmp_ex */
export function strnatcmpEx(aStr: string, bStr: string, caseInsensitive: boolean): number {
  const a = php.toBytes(aStr)
  const b = php.toBytes(bStr)
  const aend = a.length
  const bend = b.length
  if (aend === 0 || bend === 0) return aend === bend ? 0 : aend > bend ? 1 : -1

  let ap = 0
  let bp = 0
  let leading = true
  while (true) {
    let ca = at(a, ap)
    let cb = at(b, bp)

    // skip over leading zeros
    while (leading && ca === 0x30 && ap + 1 < aend && isDigit(at(a, ap + 1))) ca = at(a, ++ap)
    while (leading && cb === 0x30 && bp + 1 < bend && isDigit(at(b, bp + 1))) cb = at(b, ++bp)
    leading = false

    // skip consecutive whitespace
    while (isSpace(ca)) ca = at(a, ++ap)
    while (isSpace(cb)) cb = at(b, ++bp)

    // process run of digits
    if (isDigit(ca) && isDigit(cb)) {
      const fractional = ca === 0x30 || cb === 0x30
      const r = fractional ? compareLeft() : compareRight()
      if (r !== 0) return r
      if (ap === aend && bp === bend) return 0
      if (ap === aend) return -1
      if (bp === bend) return 1
      ca = at(a, ap)
      cb = at(b, bp)
    }

    if (caseInsensitive) {
      ca = toUpper(ca)
      cb = toUpper(cb)
    }
    if (ca < cb) return -1
    if (ca > cb) return 1

    ++ap
    ++bp
    if (ap >= aend && bp >= bend) return 0
    if (ap >= aend) return -1
    if (bp >= bend) return 1
  }

  function compareRight(): number {
    let bias = 0
    for (; ; ap++, bp++) {
      const aDone = ap === aend || !isDigit(at(a, ap))
      const bDone = bp === bend || !isDigit(at(b, bp))
      if (aDone && bDone) return bias
      if (aDone) return -1
      if (bDone) return 1
      const x = at(a, ap)
      const y = at(b, bp)
      if (x < y) {
        if (bias === 0) bias = -1
      } else if (x > y) {
        if (bias === 0) bias = 1
      }
    }
  }

  function compareLeft(): number {
    for (; ; ap++, bp++) {
      const aDone = ap === aend || !isDigit(at(a, ap))
      const bDone = bp === bend || !isDigit(at(b, bp))
      if (aDone && bDone) return 0
      if (aDone) return -1
      if (bDone) return 1
      const x = at(a, ap)
      const y = at(b, bp)
      if (x < y) return -1
      if (x > y) return 1
    }
  }
}

/** PHP strnatcasecmp() */
export const strnatcasecmp = (a: string, b: string) => strnatcmpEx(a, b, true)

/** PHP strcasecmp() (ASCII folding), normalised to -1/0/1. */
export function strcasecmp(aStr: string, bStr: string): number {
  const a = php.toBytes(aStr)
  const b = php.toBytes(bStr)
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = toLower(a[i] as number)
    const y = toLower(b[i] as number)
    if (x !== y) return x < y ? -1 : 1
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1
}

/** PHP strcmp() on bytes, normalised to -1/0/1. */
export function strcmp(aStr: string, bStr: string): number {
  const a = php.toBytes(aStr)
  const b = php.toBytes(bStr)
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] as number
    const y = b[i] as number
    if (x !== y) return x < y ? -1 : 1
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1
}

/** PHP 8 `$a <=> $b` for two strings (SORT_REGULAR): numeric strings compare as numbers. */
export function phpCompareStrings(a: string, b: string): number {
  if (php.isNumericString(a) && php.isNumericString(b)) {
    const x = Number(a)
    const y = Number(b)
    return x === y ? 0 : x < y ? -1 : 1
  }
  return strcmp(a, b)
}

/** PHP sort() on a list of strings (stable, SORT_REGULAR). */
export function phpSort(values: string[]): string[] {
  return values.sort(phpCompareStrings)
}

/** A PHP array key that is a canonical decimal integer string becomes an int key. */
export function isIntKey(key: string): boolean {
  if (!/^(0|-?[1-9][0-9]*)$/.test(key)) return false
  const n = BigInt(key)
  return n >= -(2n ** 63n) && n < 2n ** 63n
}

/** mb_strpos (UTF-8 code points), false when absent. */
export function mbStrpos(haystack: string, needle: string): number | false {
  const i = haystack.indexOf(needle)
  if (i < 0) return false
  return [...haystack.slice(0, i)].length
}

export function mbStrlen(s: string): number {
  return [...s].length
}

export function mbSubstr(s: string, start: number, length?: number): string {
  const cps = [...s]
  return cps.slice(start, length === undefined ? undefined : start + length).join('')
}

/** strlen() in bytes */
export function strlen(s: string): number {
  return php.toBytes(s).length
}

/** substr($s, 0, $n) in bytes, decoded back (a cut multibyte character becomes U+FFFD). */
export function substrBytes(s: string, start: number, length: number): string {
  return Buffer.from(php.toBytes(s).subarray(start, start + length)).toString('utf8')
}

/** strstr($value, $sep, true): the part before the first `sep`, or false (PHP 8: an empty needle matches at 0). */
export function strstrBefore(value: string, sep: string): string | false {
  if (sep === '') return ''
  const i = value.indexOf(sep)
  return i < 0 ? false : value.slice(0, i)
}
