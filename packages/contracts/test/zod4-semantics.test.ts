import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as C from '../src/index.ts'

/**
 * The move to zod 4 (1.0.15) keeps what the schemas accepted and produced under zod 3: a differential
 * run parsed generated inputs (empty, required fields only, every field) of all 421 exported schemas
 * with both versions, and these six schemas came out different until fixed (`.required()` keeping
 * defaults, `z.unknown()` keys optional, `.prefault({})`). fixtures/zod3-results.json holds those
 * inputs with zod 3's result (the parsed value, or the sorted paths of the issues).
 */
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/zod3-results.json', import.meta.url), 'utf8'),
) as Record<string, { input: unknown; zod3: { ok: unknown } | { err: string[] } }>
const revive = (v: unknown): unknown =>
  v === '__undef__'
    ? undefined
    : Array.isArray(v)
      ? v.map(revive)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== '__undef__')
              .map(([k, x]) => [k, revive(x)]),
          )
        : v

describe('contracts under zod 4: the zod 3 results', () => {
  for (const [key, f] of Object.entries(fixtures)) {
    it(key, () => {
      const [name] = key.split('/')
      const schema = (
        C as unknown as Record<
          string,
          {
            safeParse(v: unknown): {
              success: boolean
              data?: unknown
              error?: { issues: { path: PropertyKey[] }[] }
            }
          }
        >
      )[name as string]!
      const r = schema.safeParse(revive(f.input))
      const got = r.success
        ? { ok: JSON.parse(JSON.stringify(r.data ?? null)) }
        : { err: (r.error?.issues ?? []).map((i) => i.path.join('.')).sort() }
      expect(got).toEqual(JSON.parse(JSON.stringify(f.zod3)))
    })
  }
})
