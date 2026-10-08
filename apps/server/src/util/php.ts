/**
 * Small PHP built-ins the query pipeline relies on, with PHP's exact semantics.
 */

const WS = ' \\t\\n\\r\\v\\f'
const NUMERIC = new RegExp(`^[${WS}]*[+-]?(\\d+(\\.\\d*)?|\\.\\d+)([eE][+-]?\\d+)?[${WS}]*$`)

/** PHP 8 is_numeric() for strings (leading and trailing whitespace allowed, no hex). */
export function isNumeric(s: string): boolean {
  return NUMERIC.test(s)
}

/** PHP addslashes(): escapes ', ", \ and NUL. */
export function addslashes(s: string): string {
  return s.replace(/[\\'"\0]/g, (c) => (c === '\0' ? '\\0' : `\\${c}`))
}

/** PHP preg_quote() with '/' as delimiter. */
export function pregQuote(s: string): string {
  return s.replace(/[.\\+*?[^\]$(){}=!<>|:\-#/\0]/g, (c) => (c === '\0' ? '\\000' : `\\${c}`))
}

/**
 * Expands a preg_replace() replacement string: `\n`, `$n` and `${n}` (n = 0..99) are back references,
 * everything else is literal.
 */
export function expandPregReplacement(
  replacement: string,
  groups: ReadonlyArray<string | undefined>,
): string {
  let out = ''
  for (let i = 0; i < replacement.length; i++) {
    const c = replacement[i]!
    if (c === '\\' && i + 1 < replacement.length) {
      const m = /^\d{1,2}/.exec(replacement.slice(i + 1))
      if (m) {
        out += groups[Number(m[0])] ?? ''
        i += m[0].length
        continue
      }
      if (replacement[i + 1] === '\\') {
        out += '\\'
        i++
        continue
      }
    } else if (c === '$') {
      const braced = /^\{(\d{1,2})\}/.exec(replacement.slice(i + 1))
      if (braced) {
        out += groups[Number(braced[1])] ?? ''
        i += braced[0].length
        continue
      }
      const m = /^\d{1,2}/.exec(replacement.slice(i + 1))
      if (m) {
        out += groups[Number(m[0])] ?? ''
        i += m[0].length
        continue
      }
    }
    out += c
  }
  return out
}

/** PHP round() (half away from zero, with the pre-rounding PHP applies to the scaled value). */
export function phpRound(value: number, places = 0): number {
  if (!Number.isFinite(value)) return value
  const f = 10 ** places
  let tmp = value * f
  // pre-round to 15 significant digits so 1.005 * 100 = 100.49999999999999 rounds up like PHP
  tmp = Number(tmp.toPrecision(15))
  const r = Math.sign(tmp) * Math.round(Math.abs(tmp))
  return r / f
}

/** PHP number_format(). */
export function numberFormat(value: number, decimals = 0, decPoint = '.', thousandsSep = ','): string {
  const rounded = phpRound(value, decimals)
  const neg = rounded < 0
  const [int = '0', frac = ''] = Math.abs(rounded).toFixed(decimals).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep)
  const out = decimals > 0 ? `${grouped}${decPoint}${frac}` : grouped
  return neg && Number(out.replace(/[^\d]/g, '')) !== 0 ? `-${out}` : out
}

const SI_UNITS: Record<number, string> = {
  [-10]: 'q',
  [-9]: 'r',
  [-8]: 'y',
  [-7]: 'z',
  [-6]: 'a',
  [-5]: 'f',
  [-4]: 'p',
  [-3]: 'n',
  [-2]: 'µ',
  [-1]: 'm',
  0: '',
  1: 'k',
  2: 'M',
  3: 'G',
  4: 'T',
  5: 'P',
  6: 'E',
  7: 'Z',
  8: 'Y',
  9: 'R',
  10: 'Q',
}

/**
 * Formats a number with an SI prefix (English separators).
 * pma: src/Util.php::formatNumber
 */
export function formatNumber(
  input: number | string,
  digitsLeft = 3,
  digitsRight = 0,
  onlyDown = false,
  noTrailingZero = true,
): string {
  let value = typeof input === 'number' ? input : Number.parseFloat(input) || 0
  if (value === 0) return '0'
  const decimalSep = '.'
  const thousandsSep = ','
  if (digitsLeft === 0) {
    const formatted = numberFormat(value, digitsRight, decimalSep, thousandsSep)
    if (Number.parseFloat(formatted.replaceAll(thousandsSep, '')) === 0) {
      return `<${numberFormat(1 / 10 ** digitsRight, digitsRight, decimalSep, thousandsSep)}`
    }
    return formatted
  }
  let sign = ''
  if (value < 0) {
    sign = '-'
    value = Math.abs(value)
  }
  const dh = 10 ** digitsRight
  let d = Math.floor(Math.log10(value) / 3)
  const curDigits = Math.floor(Math.log10(value / 1000 ** d) + 1)
  if (digitsLeft > curDigits) d -= Math.floor((digitsLeft - curDigits) / 3)
  if (d < 0 && onlyDown) d = 0
  d = Math.min(Math.max(Math.trunc(d), -10), 10)
  value = phpRound(value / (1000 ** d / dh)) / dh
  const unit = SI_UNITS[d] ?? ''
  let formatted = numberFormat(value, digitsRight, decimalSep, thousandsSep)
  if (noTrailingZero && formatted.includes(decimalSep)) formatted = formatted.replace(/\.?0+$/, '')
  if (value === 0) {
    return `<${numberFormat(1 / 10 ** digitsRight, digitsRight, decimalSep, thousandsSep)}${unit === '' ? '' : ` ${unit}`}`
  }
  return sign + formatted + (unit === '' ? '' : ` ${unit}`)
}

/** PHP ucwords() with the default delimiters (space, tab, CR, LF, form feed, vertical tab). */
export function ucwords(s: string): string {
  return s.replace(/(^|[ \t\r\n\f\v])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}
