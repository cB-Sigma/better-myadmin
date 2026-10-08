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

/** PHP ucwords() with the default delimiters (space, tab, CR, LF, form feed, vertical tab). */
export function ucwords(s: string): string {
  return s.replace(/(^|[ \t\r\n\f\v])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}
