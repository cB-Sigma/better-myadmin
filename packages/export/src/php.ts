/**
 * PHP built-ins the export plugins depend on, reproduced byte for byte.
 */

/** A PHP value as the plugins build it: strings, numbers, null, lists and ordered maps. */
export type PhpValue = string | number | boolean | null | PhpValue[] | Map<string, PhpValue>

const hex4 = (n: number) => n.toString(16).padStart(4, '0')

function jsonString(s: string, unicode: boolean): string | false {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    // lone surrogates: ill-formed UTF-8 (escaped bytes) make json_encode fail
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1)
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false
      if (unicode) out += s.slice(i, i + 2)
      else out += `\\u${hex4(c)}\\u${hex4(d)}`
      i++
      continue
    }
    if (c >= 0xdc00 && c <= 0xdfff) return false
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
    if (c < 0x20) out += `\\u${hex4(c)}`
    else if (c < 0x80) out += s[i]
    else if (!unicode || c === 0x2028 || c === 0x2029) out += `\\u${hex4(c)}`
    else out += s[i]
  }
  return `${out}"`
}

/** PHP's float to JSON (serialize_precision -1: shortest round-trip). */
function jsonNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n)
  const s = String(n)
  return s.includes('e') ? s.replace('e+', 'e+') : s.includes('.') ? s : `${s}.0`
}

/**
 * json_encode($value, flags) with JSON_PRETTY_PRINT and JSON_UNESCAPED_UNICODE; false on
 * invalid UTF-8 like PHP.
 */
export function jsonEncode(value: PhpValue, o: { pretty?: boolean; unicode?: boolean } = {}): string | false {
  const pretty = o.pretty ?? false
  const unicode = o.unicode ?? false
  const enc = (v: PhpValue, depth: number): string | false => {
    if (v === null) return 'null'
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'number') return jsonNumber(v)
    if (typeof v === 'string') return jsonString(v, unicode)
    const nl = pretty ? '\n' : ''
    const ind = pretty ? '    '.repeat(depth + 1) : ''
    const end = pretty ? '    '.repeat(depth) : ''
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]'
      const parts: string[] = []
      for (const x of v) {
        const e = enc(x, depth + 1)
        if (e === false) return false
        parts.push(ind + e)
      }
      return `[${nl}${parts.join(`,${nl}`)}${nl}${end}]`
    }
    // a PHP array with keys 0..n-1 in order is a list
    const keys = [...v.keys()]
    if (keys.every((k, i) => k === String(i))) return enc([...v.values()], depth)
    if (keys.length === 0) return '[]'
    const parts: string[] = []
    for (const [k, x] of v) {
      const ek = jsonString(k, unicode)
      const e = enc(x, depth + 1)
      if (ek === false || e === false) return false
      parts.push(`${ind}${ek}${pretty ? ': ' : ':'}${e}`)
    }
    return `{${nl}${parts.join(`,${nl}`)}${nl}${end}}`
  }
  return enc(value, 0)
}

/** PHP array key normalisation: decimal integer strings become int keys (same text). */
export function phpMap(entries: Array<[string, PhpValue]>): Map<string, PhpValue> {
  const m = new Map<string, PhpValue>()
  for (const [k, v] of entries) m.set(k, v)
  return m
}

/** PHP var_export() of a scalar (strings single-quoted with \\ and \' escaped). */
export function varExport(v: string | null | number): string {
  if (v === null) return 'NULL'
  if (typeof v === 'number') return String(v)
  return `'${v.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

/**
 * PHP var_export() of any value: lists and maps as `array (\n  key => value,\n)`, nested arrays
 * on their own line, `true`/`false`/`NULL`.
 */
export function varExportValue(v: PhpValue, level = 1): string {
  if (v === null) return 'NULL'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number' || typeof v === 'string') return varExport(v)
  const entries: Array<[string | number, PhpValue]> = Array.isArray(v)
    ? v.map((x, i) => [i, x])
    : [...v].map(([k, x]) => [/^(0|-?[1-9]\d*)$/.test(k) ? Number(k) : k, x])
  const pad = '  '.repeat(level - 1)
  let out = `${level > 1 ? `\n${pad}` : ''}array (\n`
  for (const [k, x] of entries) {
    out += `${pad}  ${typeof k === 'number' ? k : varExport(k)} => ${varExportValue(x, level + 1)},\n`
  }
  return `${out}${pad})`
}
