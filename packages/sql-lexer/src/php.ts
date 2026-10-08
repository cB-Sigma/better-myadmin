/**
 * Small re-implementations of PHP built-ins whose exact semantics the ported
 * sql-parser code depends on (string conversion of numbers, `empty()`,
 * `trim()`, `strtoupper()`, `stripcslashes()`...).
 */

/** PHP scalar as produced by `Token::extract()`. */
export type PhpScalar = string | number | boolean

// pma: php-src ext/standard/string.c::php_trim (default character mask " \n\r\t\v\0")
const TRIM_CHARS = ' \n\r\t\v\0'

export function trim(str: string, chars: string = TRIM_CHARS): string {
  let start = 0
  let end = str.length
  while (start < end && chars.includes(str[start] as string)) start++
  while (end > start && chars.includes(str[end - 1] as string)) end--
  return str.slice(start, end)
}

export function rtrim(str: string, chars: string = TRIM_CHARS): string {
  let end = str.length
  while (end > 0 && chars.includes(str[end - 1] as string)) end--
  return str.slice(0, end)
}

/** PHP 8 `strtoupper()`: locale-insensitive, ASCII only. */
export function strtoupper(str: string): string {
  return str.replace(/[a-z]+/g, (m) => m.toUpperCase())
}

/** PHP 8 `strtolower()`: locale-insensitive, ASCII only. */
export function strtolower(str: string): string {
  return str.replace(/[A-Z]+/g, (m) => m.toLowerCase())
}

/** PHP `strcasecmp($a, $b) === 0` (ASCII case folding). */
export function strcaseeq(a: string, b: string): boolean {
  return a.length === b.length && strtolower(a) === strtolower(b)
}

/** PHP `empty()` for the value kinds used by the parser. */
export function empty(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '' || v === '0') return true
  if (typeof v === 'number' && Number.isNaN(v)) return false
  if (Array.isArray(v)) return v.length === 0
  return false
}

/** PHP's `(string) $float` (uses the `precision` ini setting, default 14, i.e. `%.14G`). */
export function phpFloatToString(f: number): string {
  if (Number.isNaN(f)) return 'NAN'
  if (f === Number.POSITIVE_INFINITY) return 'INF'
  if (f === Number.NEGATIVE_INFINITY) return '-INF'
  if (f === 0) return Object.is(f, -0) ? '-0' : '0'
  const precision = 14
  const [mant, e] = f.toExponential(precision - 1).split('e') as [string, string]
  const exponent = Number.parseInt(e, 10)
  const negative = mant.startsWith('-')
  // significant digits without trailing zeros
  const digits = mant.replace('-', '').replace('.', '').replace(/0+$/, '') || '0'
  const sign = negative ? '-' : ''
  if (exponent < -4 || exponent >= precision) {
    const frac = digits.slice(1)
    return `${sign}${digits[0]}.${frac === '' ? '0' : frac}E${exponent < 0 ? '-' : '+'}${Math.abs(exponent)}`
  }
  if (exponent < 0) {
    return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`
  }
  const intPart = digits.slice(0, exponent + 1).padEnd(exponent + 1, '0')
  const fracPart = digits.slice(exponent + 1)
  return `${sign}${intPart}${fracPart === '' ? '' : '.' + fracPart}`
}

/**
 * PHP string conversion of a token value (`(string) $value`, or `.=`).
 *
 * JavaScript has a single number type, so PHP ints and floats cannot be told
 * apart: safe integers are printed like PHP ints, anything else like PHP floats.
 * (This only differs from PHP for integral float literals >= 1e15, e.g. `1e20`.)
 */
export function phpString(v: PhpScalar | null | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? '1' : ''
  if (Number.isSafeInteger(v)) return String(v)
  if (v === 2 ** 63) return '9223372036854775807' // PHP_INT_MAX saturated by `(int)`
  if (v === -(2 ** 63)) return '-9223372036854775808'
  return phpFloatToString(v)
}

const PHP_INT_MAX = 9223372036854775807n
const PHP_INT_MIN = -9223372036854775808n

/** PHP `(int) $string` for strings made of an optional sign and digits. */
export function phpIntval(str: string): number {
  const m = /^[ \t\n\r\v\f]*([+-]?\d+)/.exec(str)
  if (!m) return 0
  let n = BigInt(m[1] as string)
  if (n > PHP_INT_MAX) n = PHP_INT_MAX
  if (n < PHP_INT_MIN) n = PHP_INT_MIN
  return Number(n)
}

/** PHP `(float) $string` (strtod on the leading numeric part). */
export function phpFloatval(str: string): number {
  const m = /^[ \t\n\r\v\f]*([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?)/.exec(str)
  if (!m) return 0
  return Number(m[1])
}

/** PHP `hexdec()`: ignores non-hex characters; returns a float when exceeding PHP_INT_MAX. */
export function hexdec(str: string): number {
  const digits = str.replace(/[^0-9a-fA-F]/g, '')
  if (digits === '') return 0
  return Number(BigInt('0x' + digits))
}

function isOctal(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '7'
}

function isHex(c: string | undefined): boolean {
  return c !== undefined && /^[0-9a-fA-F]$/.test(c)
}

/**
 * PHP `stripcslashes()`.
 *
 * Escapes producing raw bytes (`\xNN`, `\NNN`) yield the code point U+00NN.
 */
// pma: php-src ext/standard/string.c::php_stripcslashes
export function stripcslashes(str: string): string {
  let out = ''
  const len = str.length
  for (let i = 0; i < len; i++) {
    const c = str[i] as string
    if (c === '\\' && i + 1 < len) {
      i++
      const n = str[i] as string
      switch (n) {
        case 'n':
          out += '\n'
          break
        case 'r':
          out += '\r'
          break
        case 'a':
          out += '\x07'
          break
        case 't':
          out += '\t'
          break
        case 'v':
          out += '\v'
          break
        case 'b':
          out += '\b'
          break
        case 'f':
          out += '\f'
          break
        case '\\':
          out += '\\'
          break
        default: {
          if (n === 'x' && isHex(str[i + 1])) {
            let hex = str[++i] as string
            if (isHex(str[i + 1])) hex += str[++i] as string
            out += String.fromCharCode(Number.parseInt(hex, 16))
            break
          }
          let oct = ''
          while (i < len && isOctal(str[i]) && oct.length < 3) {
            oct += str[i]
            i++
          }
          if (oct !== '') {
            out += String.fromCharCode(Number.parseInt(oct, 8) & 0xff)
            i--
          } else {
            out += n
          }
        }
      }
    } else {
      out += c
    }
  }
  return out
}

/** `in_array($needle, $haystack)` with loose comparison for the string/number mixes used here. */
export function inArrayLoose(needle: unknown, haystack: readonly unknown[]): boolean {
  for (const h of haystack) {
    if (looseEquals(needle, h)) return true
  }
  return false
}

/** PHP 8 `==` for scalars (strings, numbers, booleans, null). */
export function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined)
    return b === null || b === undefined || b === false || b === '' || b === 0
  if (b === null || b === undefined) return looseEquals(b, a)
  if (typeof a === 'boolean' || typeof b === 'boolean') return phpBool(a) === phpBool(b)
  if (typeof a === 'number' && typeof b === 'number') return a === b
  if (typeof a === 'number' && typeof b === 'string')
    return isNumericString(b) ? a === Number(b) : String(a) === b
  if (typeof a === 'string' && typeof b === 'number') return looseEquals(b, a)
  if (typeof a === 'string' && typeof b === 'string') {
    if (isNumericString(a) && isNumericString(b)) return Number(a) === Number(b)
    return false
  }
  return false
}

function phpBool(v: unknown): boolean {
  return !empty(v)
}

function isNumericString(s: string): boolean {
  return /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(s)
}

/** Number of bytes of the UTF-8 encoding of `str` (PHP `strlen`). */
export function utf8Length(str: string): number {
  let n = 0
  for (const ch of str) {
    const cp = ch.codePointAt(0) as number
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
  }
  return n
}

/**
 * PHP string conversion used by concatenation (`.`) on mixed values:
 * `null` becomes `''`, objects use their `toString()` (PHP `__toString`).
 */
export function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return phpString(v)
  return String(v)
}
