import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AnyNode } from '../src/nodes.ts'
import { configNode } from '../src/schema.ts'

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

export interface PmaDefaultsFixture {
  _meta: { commit: string }
  settings: Record<string, unknown>
  server: Record<string, unknown>
  userPrefFields: string[]
}

export function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T
}

/** Removes BetterMyAdmin-only directives (flag `bma`) from a resolved value. */
export function stripBma(value: unknown, node: AnyNode = configNode): unknown {
  if (node.kind === 'leaf' || value === null || typeof value !== 'object') return value
  const v = value as Record<string, unknown>
  if (node.kind === 'servers') {
    return Object.fromEntries(Object.entries(v).map(([k, s]) => [k, stripBma(s, node.server)]))
  }
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    const child = (node.fields as Record<string, AnyNode>)[k]
    if (child?.flags.bma) continue
    out[k] = child ? stripBma(x, child) : x
  }
  // the one default that differs on purpose: the theme (parity exception X53)
  if (node === configNode && out.ThemeDefault === 'modern') out.ThemeDefault = 'pmahomme'
  return out
}

/** Shape of PHP's json_encode output: an empty PHP array is `[]` whether list or map. */
export function phpJsonShape(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(phpJsonShape)
  if (v && typeof v === 'object') {
    const entries = Object.entries(v)
    if (entries.length === 0) return []
    return Object.fromEntries(entries.map(([k, x]) => [k, phpJsonShape(x)]))
  }
  return v
}
