import { readFileSync } from 'node:fs'
import { Context, type ContextName, type Parser, type StatementInfo } from '../src/index.ts'

export function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T
}

/** Fixture values: strings with invalid UTF-8 are `{b: hex}`, non-finite floats `{f: 'INF'}`. */
export type Encoded = string | number | boolean | null | { b: string } | { f: string } | Encoded[]

/**
 * Decodes PHP bytes the way the TS port represents them: valid UTF-8 sequences become characters,
 * stray bytes (produced by `\xNN` / octal escapes) become U+00NN.
 */
function decodeBytes(hex: string): string {
  const bytes = (hex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16))
  let out = ''
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i] as number
    const len = b >= 0xf0 && b < 0xf8 ? 4 : b >= 0xe0 ? 3 : b >= 0xc2 && b < 0xe0 ? 2 : 1
    if (len > 1 && i + len <= bytes.length && bytes.slice(i + 1, i + len).every((c) => (c & 0xc0) === 0x80)) {
      out += new TextDecoder().decode(new Uint8Array(bytes.slice(i, i + len)))
      i += len
    } else {
      out += String.fromCharCode(b)
      i++
    }
  }
  return out
}

export function decode(v: Encoded): unknown {
  if (Array.isArray(v)) return v.map(decode)
  if (v !== null && typeof v === 'object') {
    if ('b' in v) return decodeBytes(v.b)
    if ('f' in v)
      return v.f === 'INF' ? Number.POSITIVE_INFINITY : v.f === '-INF' ? Number.NEGATIVE_INFINITY : Number.NaN
  }
  return v
}

export function contextFor(name: string | null): Context {
  return new Context((name ?? Context.DEFAULT) as ContextName)
}

export interface KnownDivergence {
  fixture: string
  name: string
  aspect: string
  reason: string
}

export const knownDivergences = loadKnownDivergences()

function loadKnownDivergences(): KnownDivergence[] {
  return JSON.parse(
    readFileSync(new URL('./known-divergences.json', import.meta.url), 'utf8'),
  ) as KnownDivergence[]
}

export function isKnownDivergence(fixture: string, name: string, aspect: string): boolean {
  return knownDivergences.some(
    (d) => d.fixture === fixture && d.name === name && (d.aspect === aspect || d.aspect === '*'),
  )
}

export type Built = Encoded | { exception: string }

export interface EncodedInfo {
  statement: string | null
  flags: { queryType: string | null; true: string[] }
  selectTables: [string, string | null][]
  selectExpressions: Encoded[]
  errors: [string, Encoded, number | null, number][]
}

export function encodeErrors(errors: Parser['errors']): unknown[] {
  return errors.map((e) => [e.message, e.token?.token ?? null, e.token?.position ?? null, e.code])
}

export function decodeErrors(errors: [string, Encoded, number | null, number][]): unknown[] {
  return errors.map((e) => [e[0], decode(e[1]), e[2], e[3]])
}

export function encodeInfo(info: StatementInfo): unknown {
  const trueFlags = Object.entries(info.flags)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .sort()
  return {
    statement: info.statement?.kind ?? null,
    flags: { queryType: info.flags.queryType, true: trueFlags },
    selectTables: info.selectTables,
    selectExpressions: info.selectExpressions,
    errors: encodeErrors(info.parser.errors),
  }
}

export function decodeInfo(info: EncodedInfo): unknown {
  return {
    statement: info.statement,
    flags: { queryType: info.flags.queryType, true: [...info.flags.true].sort() },
    selectTables: info.selectTables,
    selectExpressions: info.selectExpressions.map(decode),
    errors: decodeErrors(info.errors),
  }
}
