import { z } from 'zod'

/**
 * URL search parameters read the way phpMyAdmin reads `$_GET` (PHP's `parse_str`): every value is a
 * string, `k[]=a&k[]=b` / `k[0]=` / `k[x]=` build arrays and maps, a repeated plain key keeps its last
 * value, and `.` / space in a top-level name become `_`. The router uses this pair instead of
 * TanStack's JSON-typed default, which turned `?single_table=true` into a boolean, `?pos=1` into a
 * number, `?sql=null` into null and `?tbl_group=1.0` into `1`, and which did not know `k[]=`.
 *
 * The route validators then read the values with the `qs` helpers below, which accept both what
 * this parser gives (strings, arrays, maps) and the typed values of in-app navigation, and never
 * throw: a value of the wrong shape is read like PHP reads it (`(int) 'abc'` is 0, an array where
 * a string is expected is absent, `!empty('0')` is false).
 */

type Slot = Map<string, unknown>

// pma: main/php_variables.c php_register_variable_ex
function assign(root: Slot, rawKey: string, value: string): void {
  const key = rawKey.replace(/^ +/, '')
  let open = key.indexOf('[')
  let base = open === -1 ? key : key.slice(0, open)
  if (open !== -1 && key.indexOf(']', open) === -1) {
    // an unmatched first bracket is part of the name ("a[b" is "a_b")
    base = `${base}_${key.slice(open + 1)}`
    open = -1
  }
  base = base.replace(/[ .]/g, '_')
  if (base === '') return
  const path: string[] = [base]
  const pushes: boolean[] = [false]
  let i = open
  while (i !== -1 && key[i] === '[') {
    const close = key.indexOf(']', i)
    if (close === -1) break
    const idx = key.slice(i + 1, close)
    path.push(idx)
    pushes.push(idx === '')
    i = close + 1
  }
  let slot = root
  for (let d = 0; d < path.length; d++) {
    const last = d === path.length - 1
    let name = path[d] as string
    if (pushes[d] === true) name = String(nextIndex(slot))
    if (last) {
      slot.set(name, value)
      return
    }
    const cur = slot.get(name)
    if (cur instanceof Map) slot = cur
    else {
      const next: Slot = new Map()
      slot.set(name, next)
      slot = next
    }
  }
}

function nextIndex(slot: Slot): number {
  let n = 0
  for (const k of slot.keys()) if (/^(0|[1-9]\d*)$/.test(k)) n = Math.max(n, Number(k) + 1)
  return n
}

function toPlain(slot: Slot): unknown[] | Record<string, unknown> {
  const keys = [...slot.keys()]
  const values = [...slot.values()].map((v) => (v instanceof Map ? toPlain(v) : v))
  if (keys.every((k, i) => k === String(i))) return values
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]))
}

/** `parse_str($query)`: the router's `parseSearch`. */
export function parsePhpQuery(search: string): Record<string, unknown> {
  const root: Slot = new Map()
  for (const [k, v] of new URLSearchParams(search.startsWith('?') ? search.slice(1) : search))
    assign(root, k, v)
  const out: Record<string, unknown> = {}
  for (const [k, v] of root) out[k] = v instanceof Map ? toPlain(v) : v
  return out
}

const enc = (s: string) => encodeURIComponent(s)
const encKey = (s: string) => enc(s).replace(/%5B/g, '[').replace(/%5D/g, ']')

/** `http_build_query` for the values of in-app navigation: the router's `stringifySearch`. */
export function stringifyPhpQuery(search: Record<string, unknown>): string {
  const parts: string[] = []
  const add = (key: string, v: unknown): void => {
    if (v === undefined || v === null) return
    if (Array.isArray(v)) {
      const nested = v.some((x) => typeof x === 'object' && x !== null)
      v.forEach((x, i) => add(nested ? `${key}[${i}]` : `${key}[]`, x))
    } else if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) add(`${key}[${k}]`, x)
    } else if (typeof v === 'boolean') parts.push(`${encKey(key)}=${v ? '1' : '0'}`)
    else parts.push(`${encKey(key)}=${enc(String(v))}`)
  }
  for (const [k, v] of Object.entries(search)) add(k, v)
  return parts.length === 0 ? '' : `?${parts.join('&')}`
}

/** A request value as a string, or absent when it is not a scalar (pma: is_string checks). */
export function searchString(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : undefined
  if (typeof v === 'boolean') return v ? '1' : ''
  return undefined
}

/** `(int) $value`: leading digits, else 0; absent when not a scalar. */
export function searchInt(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : undefined
  const s = searchString(v)
  if (s === undefined) return undefined
  const m = /^\s*[+-]?\d+/.exec(s)
  return m === null ? 0 : Number.parseInt(m[0], 10)
}

/** `! empty($value)`: '' and '0' are false, like an empty array. */
export function searchFlag(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v !== '' && v !== '0'
  if (Array.isArray(v)) return v.length > 0
  return typeof v === 'object' && Object.keys(v).length > 0
}

/** A list of strings: an array or map's scalar values, or one scalar value. */
export function searchList(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).flatMap((x) => {
      const s = searchString(x)
      return s === undefined ? [] : [s]
    })
  }
  const s = searchString(v)
  return s === undefined ? undefined : [s]
}

/** The route validators' fields: lenient readers that never throw. */
// every helper starts from z.unknown().optional(): zod 4 makes an object key of z.unknown() required
// in the input type, and a search parameter is always optional
export const qs = {
  /** a string, absent when missing or not a scalar */
  str: () => z.unknown().optional().transform(searchString),
  /** a string with a default */
  strOr: (def: string) =>
    z
      .unknown()
      .optional()
      .transform((v) => searchString(v) ?? def),
  /** an integer (PHP cast), absent when missing; below `min` counts as missing */
  int: (min?: number) =>
    z
      .unknown()
      .optional()
      .transform((v) => {
        const n = v === undefined ? undefined : searchInt(v)
        return n === undefined || (min !== undefined && n < min) ? undefined : n
      }),
  /** an integer with a default (missing, or below `min`) */
  intOr: (def: number, min?: number) =>
    z
      .unknown()
      .optional()
      .transform((v) => {
        const n = v === undefined ? undefined : searchInt(v)
        return n === undefined || (min !== undefined && n < min) ? def : n
      }),
  /** `! empty()` */
  flag: () => z.unknown().optional().transform(searchFlag),
  /** set at all (`isset()`, the value does not matter) */
  isset: () =>
    z
      .unknown()
      .optional()
      .transform((v) => v !== undefined && v !== null),
  /** a list of strings, absent when missing */
  list: () => z.unknown().optional().transform(searchList),
  /** a string, or a list when the request sends an array (`dbname` vs `dbname[]`) */
  strOrList: () =>
    z
      .unknown()
      .optional()
      .transform((v): string | string[] | undefined =>
        typeof v === 'object' && v !== null ? searchList(v) : searchString(v),
      ),
  /** one of the given values, absent otherwise */
  oneOf: <const T extends string>(values: readonly T[]) =>
    z
      .unknown()
      .optional()
      .transform((v): T | undefined => {
        const s = searchString(v)
        return s !== undefined && (values as readonly string[]).includes(s) ? (s as T) : undefined
      }),
  /** one of the given values, `def` otherwise */
  oneOfOr: <const T extends string>(values: readonly T[], def: T) =>
    z
      .unknown()
      .optional()
      .transform((v): T => {
        const s = searchString(v)
        return s !== undefined && (values as readonly string[]).includes(s) ? (s as T) : def
      }),
}
