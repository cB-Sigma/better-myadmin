/**
 * The PHP 8.3 value semantics the advisor's expressions run on (Symfony ExpressionLanguage evaluates
 * nodes with plain PHP operators): ints (`bigint`, 64-bit with overflow to float), floats (`number`),
 * numeric strings, loose comparison (`==`, `<`…), truthiness and string conversion.
 *
 * pma: vendor/symfony/expression-language/Node/BinaryNode.php::evaluate; Zend/zend_operators.c
 * Verified against PHP output through test/fixtures/advisor.json.
 */
import { phpFloatToString } from '@bettermyadmin/i18n/php'

export type PhpValue = null | boolean | string | bigint | number | PhpValue[]

const INT_MAX = 2n ** 63n - 1n
const INT_MIN = -(2n ** 63n)

/** A PHP exception surfaced by the evaluator (`getMessage()` is `message`). */
export class PhpError extends Error {
  readonly kind: 'TypeError' | 'DivisionByZeroError' | 'ArgumentCountError' | 'SyntaxError' | 'ValueError'
  constructor(kind: PhpError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

export function typeName(v: PhpValue): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'string') return 'string'
  if (typeof v === 'bigint') return 'int'
  if (typeof v === 'number') return 'float'
  return 'array'
}

/** Warnings PHP would emit (A non-numeric value encountered); kept for tests, never thrown. */
export const warnings: string[] = []

const WS = '[ \\t\\n\\r\\v\\f]*'
const NUM = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?'
const FULL_NUMERIC = new RegExp(`^${WS}(${NUM})${WS}$`)
const LEADING_NUMERIC = new RegExp(`^${WS}(${NUM})`)

function numberFromText(text: string): bigint | number {
  if (/^[+-]?\d+$/.test(text)) {
    const b = BigInt(text)
    if (b <= INT_MAX && b >= INT_MIN) return b
    return Number(text)
  }
  return Number(text)
}

/** is_numeric_string_ex: the number of a numeric string (trailing whitespace allowed), else null. */
export function numericString(s: string): bigint | number | null {
  const m = FULL_NUMERIC.exec(s)
  return m === null ? null : numberFromText(m[1]!)
}

/** Leading-numeric strings ("12abc") give their prefix with a warning. */
function leadingNumeric(s: string): bigint | number | null {
  const m = LEADING_NUMERIC.exec(s)
  return m === null ? null : numberFromText(m[1]!)
}

export function isNumericValue(v: PhpValue): boolean {
  if (typeof v === 'bigint' || typeof v === 'number') return true
  return typeof v === 'string' && numericString(v) !== null
}

/** Operand of an arithmetic operator (zendi_try_convert_scalar_to_number) or a TypeError. */
function arith(a: PhpValue, b: PhpValue, op: string): [bigint | number, bigint | number] {
  const conv = (v: PhpValue): bigint | number | null => {
    if (v === null) return 0n
    if (typeof v === 'boolean') return v ? 1n : 0n
    if (typeof v === 'bigint' || typeof v === 'number') return v
    if (typeof v === 'string') {
      const n = numericString(v)
      if (n !== null) return n
      const l = leadingNumeric(v)
      if (l !== null) {
        warnings.push('A non-numeric value encountered')
        return l
      }
      return null
    }
    return null
  }
  const x = conv(a)
  const y = conv(b)
  if (x === null || y === null || Array.isArray(a) || Array.isArray(b)) {
    throw new PhpError('TypeError', `Unsupported operand types: ${typeName(a)} ${op} ${typeName(b)}`)
  }
  return [x, y]
}

const toFloat = (n: bigint | number) => (typeof n === 'bigint' ? Number(n) : n)

function intResult(r: bigint): bigint | number {
  return r > INT_MAX || r < INT_MIN ? Number(r) : r
}

export function add(a: PhpValue, b: PhpValue): PhpValue {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b.slice(a.length)]
  const [x, y] = arith(a, b, '+')
  return typeof x === 'bigint' && typeof y === 'bigint' ? intResult(x + y) : toFloat(x) + toFloat(y)
}

export function sub(a: PhpValue, b: PhpValue): PhpValue {
  const [x, y] = arith(a, b, '-')
  return typeof x === 'bigint' && typeof y === 'bigint' ? intResult(x - y) : toFloat(x) - toFloat(y)
}

export function mul(a: PhpValue, b: PhpValue): PhpValue {
  const [x, y] = arith(a, b, '*')
  return typeof x === 'bigint' && typeof y === 'bigint' ? intResult(x * y) : toFloat(x) * toFloat(y)
}

export function div(a: PhpValue, b: PhpValue): PhpValue {
  const [x, y] = arith(a, b, '/')
  if ((typeof y === 'bigint' && y === 0n) || y === 0)
    throw new PhpError('DivisionByZeroError', 'Division by zero')
  if (typeof x === 'bigint' && typeof y === 'bigint') {
    if (x % y === 0n && !(x === INT_MIN && y === -1n)) return x / y
    return Number(x) / Number(y)
  }
  return toFloat(x) / toFloat(y)
}

/** `%`: both operands as int (zval_get_long). */
export function mod(a: PhpValue, b: PhpValue): PhpValue {
  const [x, y] = arith(a, b, '%')
  const toInt = (n: bigint | number): bigint => {
    if (typeof n === 'bigint') return n
    if (!Number.isFinite(n)) return 0n
    return BigInt.asIntN(64, BigInt(Math.trunc(n)))
  }
  const xi = toInt(x)
  const yi = toInt(y)
  if (yi === 0n) throw new PhpError('DivisionByZeroError', 'Modulo by zero')
  if (yi === -1n) return 0n
  return xi % yi
}

/** pow() */
export function pow(a: PhpValue, b: PhpValue): PhpValue {
  const [x, y] = arith(a, b, '**')
  if (typeof x === 'bigint' && typeof y === 'bigint' && y >= 0n) {
    // integer power with overflow detection
    let result = 1n
    let base = x
    let e = y
    while (e > 0n) {
      if (e & 1n) {
        result *= base
        if (result > INT_MAX || result < INT_MIN) return toFloat(x) ** toFloat(y)
      }
      e >>= 1n
      if (e > 0n) {
        base *= base
        if (base > INT_MAX * 2n || base < INT_MIN * 2n) return toFloat(x) ** toFloat(y)
      }
    }
    return result
  }
  return toFloat(x) ** toFloat(y)
}

export function negate(v: PhpValue): PhpValue {
  return mul(v, -1n)
}

/** (bool) */
export function truthy(v: PhpValue): boolean {
  if (v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'bigint') return v !== 0n
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v !== '' && v !== '0'
  return v.length > 0
}

/** (string) */
export function toPhpString(v: PhpValue): string {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? '1' : ''
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'number') return phpFloatToString(v)
  if (typeof v === 'string') return v
  warnings.push('Array to string conversion')
  return 'Array'
}

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0)

function compareNumbers(x: bigint | number, y: bigint | number): number {
  if (typeof x === 'bigint' && typeof y === 'bigint') return x < y ? -1 : x > y ? 1 : 0
  const a = toFloat(x)
  const b = toFloat(y)
  return a < b ? -1 : a > b ? 1 : 0
}

function strcmp(a: string, b: string): number {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return sign(Buffer.compare(ba, bb))
}

/** zend_compare (PHP 8 `<=>`) */
export function compare(a: PhpValue, b: PhpValue): number {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a)) return -1
    if (!Array.isArray(b)) return 1
    if (a.length !== b.length) return a.length < b.length ? -1 : 1
    for (let i = 0; i < a.length; i++) {
      const c = compare(a[i]!, b[i]!)
      if (c !== 0) return c
    }
    return 0
  }
  if (typeof a === 'boolean' || typeof b === 'boolean' || a === null || b === null) {
    if (a === null && typeof b === 'string') return b === '' ? 0 : -1
    if (b === null && typeof a === 'string') return a === '' ? 0 : 1
    return sign(Number(truthy(a)) - Number(truthy(b)))
  }
  if (typeof a === 'string' && typeof b === 'string') {
    const x = numericString(a)
    const y = numericString(b)
    if (x !== null && y !== null) return compareNumbers(x, y)
    return strcmp(a, b)
  }
  if (typeof a === 'string') {
    const x = numericString(a)
    if (x !== null) return compareNumbers(x, b as bigint | number)
    return strcmp(a, toPhpString(b))
  }
  if (typeof b === 'string') {
    const y = numericString(b)
    if (y !== null) return compareNumbers(a, y)
    return strcmp(toPhpString(a), b)
  }
  return compareNumbers(a, b)
}

/** `==` */
export function looseEquals(a: PhpValue, b: PhpValue): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    const x = numericString(a)
    const y = numericString(b)
    if (x !== null && y !== null) return compareNumbers(x, y) === 0
    return a === b
  }
  return compare(a, b) === 0
}

/** `===` */
export function strictEquals(a: PhpValue, b: PhpValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => strictEquals(v, b[i]!))
  }
  if (typeof a !== typeof b) return false
  return a === b
}

/** `in_array($needle, $haystack, true)` */
export function inArrayStrict(needle: PhpValue, haystack: PhpValue): boolean {
  if (!Array.isArray(haystack)) {
    throw new PhpError(
      'TypeError',
      `in_array(): Argument #2 ($haystack) must be of type array, ${typeName(haystack)} given`,
    )
  }
  return haystack.some((v) => strictEquals(v, needle))
}

/** stripcslashes() */
export function stripcslashes(str: string): string {
  let out = ''
  for (let i = 0; i < str.length; i++) {
    const c = str[i]!
    if (c !== '\\' || i + 1 >= str.length) {
      out += c
      continue
    }
    const n = str[++i]!
    const simple: Record<string, string> = {
      n: '\n',
      r: '\r',
      a: '\x07',
      t: '\t',
      v: '\v',
      b: '\b',
      f: '\f',
      '\\': '\\',
    }
    if (simple[n] !== undefined) {
      out += simple[n]
    } else if (n === 'x' && /[0-9a-fA-F]/.test(str[i + 1] ?? '')) {
      let hex = str[++i]!
      if (/[0-9a-fA-F]/.test(str[i + 1] ?? '')) hex += str[++i]
      out += String.fromCharCode(Number.parseInt(hex, 16))
    } else if (/[0-7]/.test(n)) {
      let oct = n
      while (oct.length < 3 && /[0-7]/.test(str[i + 1] ?? '')) oct += str[++i]
      out += String.fromCharCode(Number.parseInt(oct, 8) & 0xff)
    } else {
      out += n
    }
  }
  return out
}

/** levenshtein() (byte based, like PHP; the names compared are ASCII). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
    }
    prev = cur
  }
  return prev[b.length]!
}

/**
 * Converts a PCRE pattern with delimiters (`/source/i`) to a JS RegExp; null when the pattern is
 * not expressible (preg_match then warns and returns false).
 */
export function pcreToRegExp(pattern: string): RegExp | null {
  const delim = pattern[0]
  if (delim === undefined || /[a-zA-Z0-9\\\s]/.test(delim)) return null
  const close = ({ '(': ')', '[': ']', '{': '}', '<': '>' } as Record<string, string>)[delim] ?? delim
  const end = pattern.lastIndexOf(close)
  if (end <= 0) return null
  const body = pattern.slice(1, end)
  const mods = pattern.slice(end + 1)
  let flags = ''
  for (const m of mods) {
    if (m === 'i' || m === 'm' || m === 's') flags += m
    else if (m === 'u') flags += 'u'
    else if (m !== 'U' && m !== 'x' && m !== 'D' && m !== 'A') return null
  }
  try {
    return new RegExp(body, flags)
  } catch {
    return null
  }
}

/** substr() */
export function substr(s: string, start: number, length: number | null = null): string {
  const len = s.length
  let st = start
  if (st < 0) st = Math.max(len + st, 0)
  if (st > len) return ''
  let l = length === null ? len - st : length
  if (l < 0) l = Math.max(len - st + l, 0)
  return s.slice(st, st + l)
}

/** round($num) — PHP_ROUND_HALF_UP with PHP's pre-rounding. */
export { phpRound } from '@bettermyadmin/i18n/php'

/** (int) of a float, as zend_dval_to_lval (out of range → 0 in PHP 8 on 64-bit for NaN/Inf, modular otherwise). */
export function floatToInt(n: number): bigint {
  if (!Number.isFinite(n)) return 0n
  return BigInt.asIntN(64, BigInt(Math.trunc(n)))
}

/** (int) $string */
export function stringToInt(s: string): bigint {
  const m = LEADING_NUMERIC.exec(s)
  if (m === null) return 0n
  const n = numberFromText(m[1]!)
  if (typeof n === 'bigint') return n
  if (/^[+-]?\d+$/.test(m[1]!)) {
    // integer text out of int64 range saturates
    return m[1]!.startsWith('-') ? INT_MIN : INT_MAX
  }
  return floatToInt(n)
}

/** var_export-ish rendering used only in test diagnostics. */
export function debugValue(v: PhpValue): string {
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'bigint') return `${v}`
  if (typeof v === 'number') return `${phpFloatToString(v)}f`
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}` : x))
}
