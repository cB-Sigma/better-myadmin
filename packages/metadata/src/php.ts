/**
 * The few PHP built-ins whose exact output ends up in pmadb rows.
 */

/** A PHP array with non-sequential keys (e.g. after `unset()`), encoded as a JSON object. */
export class PhpSparseList<T> {
  readonly entries: Array<[number, T]>
  constructor(entries: Array<[number, T]>) {
    this.entries = entries
  }
}

const HEX = '0123456789abcdef'

function encodeString(s: string): string {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    switch (c) {
      case 0x22:
        out += '\\"'
        continue
      case 0x5c:
        out += '\\\\'
        continue
      case 0x2f:
        out += '\\/'
        continue
      case 0x08:
        out += '\\b'
        continue
      case 0x0c:
        out += '\\f'
        continue
      case 0x0a:
        out += '\\n'
        continue
      case 0x0d:
        out += '\\r'
        continue
      case 0x09:
        out += '\\t'
        continue
    }
    if (c < 0x20 || c > 0x7e) {
      if (c === 0x7f) {
        out += s[i]
        continue
      }
      // UTF-16 code units, like PHP (surrogate pairs come out as two \uXXXX escapes)
      out += `\\u${HEX[(c >> 12) & 15]}${HEX[(c >> 8) & 15]}${HEX[(c >> 4) & 15]}${HEX[c & 15]}`
      continue
    }
    out += s[i]
  }
  return `${out}"`
}

function encodeNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error('json_encode: Inf and NaN cannot be JSON encoded')
  // serialize_precision = -1: shortest round-trip representation; 1.0 prints as 1.0 only with
  // JSON_PRESERVE_ZERO_FRACTION, which phpMyAdmin never passes
  return String(n)
}

/**
 * PHP `json_encode($value)` with the default flags: `/` escaped, non-ASCII as `\uXXXX`.
 * JS arrays are PHP lists; plain objects are PHP string-keyed arrays (an empty object `{}` is an
 * empty PHP array and encodes as `[]`, as in PHP); `PhpSparseList` is a list with gaps.
 *
 * pma: ext/json/json_encoder.c::php_json_encode_zval (default options)
 */
export function phpJsonEncode(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return encodeNumber(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return encodeString(value)
  if (value instanceof PhpSparseList) {
    const entries = value.entries as Array<[number, unknown]>
    const sequential = entries.every(([k], i) => k === i)
    if (sequential) return `[${entries.map(([, v]) => phpJsonEncode(v)).join(',')}]`
    return `{${entries.map(([k, v]) => `${encodeString(String(k))}:${phpJsonEncode(v)}`).join(',')}}`
  }
  if (Array.isArray(value)) return `[${value.map((v) => phpJsonEncode(v)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '[]'
    return `{${entries.map(([k, v]) => `${encodeString(k)}:${phpJsonEncode(v)}`).join(',')}}`
  }
  throw new Error(`json_encode: unsupported type ${typeof value}`)
}

/**
 * PHP `json_decode($json, true)`: `null` for invalid JSON. Objects with integer-like keys stay
 * objects here; callers that expect a list use {@link phpValues}.
 */
export function phpJsonDecode(json: string): unknown {
  try {
    return JSON.parse(json) as unknown
  } catch {
    return null
  }
}

/** `foreach ($array as $v)` over a decoded PHP array (list or map). */
export function phpValues(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (v !== null && typeof v === 'object') return Object.values(v as Record<string, unknown>)
  return []
}

/** PHP `is_array()` for a decoded JSON value. */
export function isPhpArray(v: unknown): v is unknown[] | Record<string, unknown> {
  return v !== null && typeof v === 'object'
}

/**
 * PHP `serialize($value)` for the values phpMyAdmin stores (strings, ints, bools, null, arrays).
 * JS arrays are PHP lists, plain objects are string-keyed arrays (integer-like keys become `i:`).
 * pma: ext/standard/var.c::php_var_serialize_intern
 */
export function phpSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'N;'
  if (typeof value === 'boolean') return `b:${value ? 1 : 0};`
  if (typeof value === 'number') return Number.isInteger(value) ? `i:${value};` : `d:${value};`
  if (typeof value === 'string') return `s:${new TextEncoder().encode(value).length}:"${value}";`
  const key = (k: string) => (/^(0|-?[1-9][0-9]*)$/.test(k) ? `i:${k};` : phpSerialize(k))
  if (Array.isArray(value)) {
    return `a:${value.length}:{${value.map((v, i) => `i:${i};${phpSerialize(v)}`).join('')}}`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return `a:${entries.length}:{${entries.map(([k, v]) => `${key(k)}${phpSerialize(v)}`).join('')}}`
  }
  throw new Error(`serialize: unsupported type ${typeof value}`)
}

/** `mb_strlen` for UTF-8 text: code points. */
export function mbStrlen(s: string): number {
  let n = 0
  for (const _ of s) n++
  return n
}

/** PHP `empty()`. */
export function phpEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    v === false ||
    v === '' ||
    v === '0' ||
    v === 0 ||
    (Array.isArray(v) && v.length === 0)
  )
}
