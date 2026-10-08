/**
 * The PHP 8.3 runtime pieces the formatting helpers depend on: round(), number_format(), sprintf(),
 * float-to-string conversion and numeric-string casts. Verified against PHP 8.3 output in
 * test/fixtures/format.json.
 */

const POW10 = [
  1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19,
  1e20, 1e21, 1e22,
]

/** ext/standard/math.c php_intpow10 */
function intpow10(power: number): number {
  if (power < 0 || power > 22) return 10 ** power
  return POW10[power]!
}

/** php_round_helper, PHP_ROUND_HALF_UP */
function roundHelper(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5)
}

/** php_round_get_basic */
function roundGetBasic(value: number, places: number): number {
  const f1 = intpow10(Math.abs(places))
  return places >= 0 ? value * f1 : value / f1
}

/** round($value, $places) — PHP 8.3 _php_math_round with pre-rounding. */
export function phpRound(value: number, places = 0): number {
  if (!Number.isFinite(value) || value === 0) return value
  const precisionPlaces = 14 - Math.floor(Math.log10(Math.abs(value)))
  const f1 = intpow10(Math.abs(places))
  let tmp: number
  if (precisionPlaces > places && precisionPlaces - 15 < places) {
    let usePrecision = precisionPlaces
    tmp = roundHelper(roundGetBasic(value, usePrecision))
    usePrecision = places - usePrecision
    // because places < precision_places
    tmp = tmp / intpow10(Math.abs(usePrecision))
  } else {
    tmp = places >= 0 ? value * f1 : value / f1
    if (Math.abs(tmp) >= 1e15) return value
  }
  tmp = roundHelper(tmp)
  if (Math.abs(places) < 23) {
    tmp = places > 0 ? tmp / f1 : tmp * f1
  } else {
    const s = `${tmp.toFixed(6)}e${-places}`
    const v = Number(s)
    if (!Number.isFinite(v)) return value
    tmp = v
  }
  return tmp
}

/**
 * Exact decimal expansion of a double, rounded half-even to `digits` fractional digits, like
 * PHP's printf `%.Nf` (zend_dtoa mode 3). Returns the unsigned digits string.
 */
export function toFixedExact(value: number, digits: number): string {
  const v = Math.abs(value)
  if (!Number.isFinite(v)) return v === Number.POSITIVE_INFINITY ? 'INF' : 'NAN'
  // decompose v = mantissa * 2^exp exactly
  const buf = new DataView(new ArrayBuffer(8))
  buf.setFloat64(0, v)
  const hi = buf.getUint32(0)
  const lo = buf.getUint32(4)
  const biased = (hi >>> 20) & 0x7ff
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
  let exp: number
  if (biased === 0) {
    exp = -1074
  } else {
    mant |= 1n << 52n
    exp = biased - 1075
  }
  // scaled = v * 10^digits as a rational num/den
  let num = mant * 10n ** BigInt(digits)
  let den = 1n
  if (exp >= 0) num <<= BigInt(exp)
  else den <<= BigInt(-exp)
  let q = num / den
  const r = num % den
  const twice = r * 2n
  if (twice > den || (twice === den && q % 2n === 1n)) q += 1n
  let s = q.toString()
  if (digits > 0) {
    s = s.padStart(digits + 1, '0')
    s = `${s.slice(0, -digits)}.${s.slice(-digits)}`
  }
  return s
}

/** number_format($num, $decimals, $decPoint, $thousandsSep) */
export function numberFormat(num: number, decimals = 0, decPoint = '.', thousandsSep = ','): string {
  const dec = Math.max(0, decimals)
  let d = phpRound(num, decimals)
  let negative = d < 0
  d = Math.abs(d)
  if (!Number.isFinite(d)) return negative ? '-inf' : d === Number.POSITIVE_INFINITY ? 'inf' : 'nan'
  const tmp = toFixedExact(d, dec)
  // -0.00 is printed without the sign
  if (negative && /^[0.]*$/.test(tmp)) negative = false
  const [intPart = '', fracPart] = tmp.split('.')
  let grouped = ''
  for (let i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 === 0) grouped += thousandsSep
    grouped += intPart[i]
  }
  let out = (negative ? '-' : '') + grouped
  if (dec > 0) out += decPoint + (fracPart ?? '').padEnd(dec, '0')
  return out
}

/** (string) $float — precision=14 (`%.14G`, zend_gcvt). */
export function phpFloatToString(v: number, precision = 14): string {
  if (Number.isNaN(v)) return 'NAN'
  if (v === Number.POSITIVE_INFINITY) return 'INF'
  if (v === Number.NEGATIVE_INFINITY) return '-INF'
  if (v === 0) return Object.is(v, -0) ? '-0' : '0'
  const [mant, expStr] = v.toExponential(precision - 1).split('e') as [string, string]
  const exp = Number(expStr)
  if (exp < -4 || exp >= precision) {
    let m = mant.includes('.') ? mant.replace(/0+$/, '').replace(/\.$/, '') : mant
    if (!m.includes('.')) m += '.0'
    return `${m}E${exp < 0 ? '-' : '+'}${Math.abs(exp)}`
  }
  const fixed = v.toFixed(Math.max(0, precision - 1 - exp))
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
}

/** (float) $string — the leading numeric prefix, 0 when none. */
export function phpFloatval(s: string): number {
  const m = /^[ \t\n\r\v\f]*([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?)/.exec(s)
  return m === null ? 0 : Number(m[1])
}

/** (int) $string */
export function phpIntval(s: string): number {
  const f = phpFloatval(s)
  return Number.isFinite(f) ? Math.trunc(f) : 0
}

export type SprintfArg = string | number | boolean | null

function toPhpString(a: SprintfArg): string {
  if (typeof a === 'string') return a
  if (typeof a === 'number')
    return Number.isInteger(a) && Math.abs(a) < 1e15 ? String(a) : phpFloatToString(a)
  if (a === true) return '1'
  return ''
}

function toPhpNumber(a: SprintfArg): number {
  if (typeof a === 'number') return a
  if (typeof a === 'string') return phpFloatval(a)
  return a === true ? 1 : 0
}

/**
 * sprintf() — ext/standard/formatted_print.c: `%[argnum$][flags][width][.precision]specifier`
 * with flags `-`, `+`, ` `, `0`, `'c`; specifiers b c d e E f F g G o s u x X %.
 * Throws like PHP 8 (ArgumentCountError / ValueError) on bad input.
 */
export function sprintf(format: string, ...args: SprintfArg[]): string {
  let out = ''
  let argIndex = 0
  let i = 0
  while (i < format.length) {
    const ch = format[i]!
    if (ch !== '%') {
      out += ch
      i++
      continue
    }
    if (format[i + 1] === '%') {
      out += '%'
      i += 2
      continue
    }
    i++
    let argnum: number | null = null
    const am = /^(\d+)\$/.exec(format.slice(i))
    if (am !== null) {
      argnum = Number(am[1]) - 1
      if (argnum < 0)
        throw new Error('Argument number specifier must be greater than zero and less than 2147483647')
      i += am[0].length
    }
    let alignLeft = false
    let alwaysSign = false
    let pad = ' '
    for (;;) {
      const f = format[i]
      if (f === '-') alignLeft = true
      else if (f === '+') alwaysSign = true
      else if (f === '0') pad = '0'
      else if (f === ' ') pad = ' '
      else if (f === "'") {
        i++
        pad = format[i] ?? ' '
      } else break
      i++
    }
    let width = 0
    const wm = /^\d+/.exec(format.slice(i))
    if (wm !== null) {
      width = Number(wm[0])
      i += wm[0].length
    }
    let precision: number | null = null
    if (format[i] === '.') {
      i++
      const pm = /^\d+/.exec(format.slice(i))
      precision = pm !== null ? Number(pm[0]) : 0
      if (pm !== null) i += pm[0].length
    }
    // length modifiers are accepted and ignored
    if (format[i] === 'l') i++
    const spec = format[i]
    i++
    if (spec === undefined) throw new Error('Missing format specifier at end of string')
    const idx = argnum ?? argIndex++
    if (idx >= args.length) throw new Error(`${idx + 2} arguments are required, ${args.length + 1} given`)
    const arg = args[idx]!
    out += formatOne(spec, arg, { alignLeft, alwaysSign, pad, width, precision })
  }
  return out
}

interface Spec {
  alignLeft: boolean
  alwaysSign: boolean
  pad: string
  width: number
  precision: number | null
}

function padStr(s: string, sp: Spec, numeric: boolean): string {
  if (s.length >= sp.width) return s
  const n = sp.width - s.length
  if (sp.alignLeft) {
    // php_sprintf_appendstring: left alignment pads with spaces unless the pad char is '0' for strings
    return s + (numeric && sp.pad === '0' ? ' ' : sp.pad).repeat(n)
  }
  if (numeric && sp.pad === '0' && (s.startsWith('-') || s.startsWith('+'))) {
    return s[0] + '0'.repeat(n) + s.slice(1)
  }
  return sp.pad.repeat(n) + s
}

function formatOne(spec: string, arg: SprintfArg, sp: Spec): string {
  switch (spec) {
    case 's': {
      let s = toPhpString(arg)
      if (sp.precision !== null) s = s.slice(0, sp.precision)
      return padStr(s, sp, false)
    }
    case 'd': {
      const n = Math.trunc(toPhpNumber(arg))
      let s = String(Number.isFinite(n) ? n : 0)
      if (sp.alwaysSign && n >= 0) s = `+${s}`
      return padStr(s, sp, true)
    }
    case 'u': {
      const n = BigInt.asUintN(64, BigInt(Math.trunc(toPhpNumber(arg))))
      return padStr(n.toString(), sp, true)
    }
    case 'f':
    case 'F': {
      const v = toPhpNumber(arg)
      const p = sp.precision ?? 6
      let s = toFixedExact(v, Math.min(p, 53))
      if (v < 0 || Object.is(v, -0)) s = `-${s}`
      else if (sp.alwaysSign) s = `+${s}`
      return padStr(s, sp, true)
    }
    case 'e':
    case 'E': {
      const v = toPhpNumber(arg)
      const p = sp.precision ?? 6
      const [m, e] = Math.abs(v).toExponential(p).split('e') as [string, string]
      let s = `${m}${spec}${Number(e) < 0 ? '-' : '+'}${Math.abs(Number(e))}`
      if (v < 0) s = `-${s}`
      else if (sp.alwaysSign) s = `+${s}`
      return padStr(s, sp, true)
    }
    case 'g':
    case 'G': {
      const v = toPhpNumber(arg)
      let s = phpFloatToString(v, sp.precision === null ? 6 : Math.max(1, sp.precision))
      if (spec === 'g') s = s.replace('E', 'e')
      if (sp.alwaysSign && v >= 0) s = `+${s}`
      return padStr(s, sp, true)
    }
    case 'x':
    case 'X':
    case 'o':
    case 'b': {
      const n = BigInt.asUintN(64, BigInt(Math.trunc(toPhpNumber(arg))))
      const radix = spec === 'o' ? 8 : spec === 'b' ? 2 : 16
      let s = n.toString(radix)
      if (spec === 'X') s = s.toUpperCase()
      return padStr(s, sp, false)
    }
    case 'c':
      return String.fromCharCode(Math.trunc(toPhpNumber(arg)) & 0xff)
    default:
      throw new Error(`Unknown format specifier "${spec}"`)
  }
}

/** htmlspecialchars($s, ENT_COMPAT) */
export function htmlspecialchars(s: string, quotes: 'compat' | 'quotes' = 'quotes'): string {
  let r = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  if (quotes === 'quotes') r = r.replace(/'/g, '&#039;')
  return r
}
