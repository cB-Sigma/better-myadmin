import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { RULES, type Rule, type Source, type Violation, docLink } from './rules.ts'

/** One allow-list entry: a known, accepted exception (tools/conventions/allowlist.yaml). */
export interface AllowEntry {
  rule: string
  /** exact file, or omitted for every file */
  file?: string
  /** exact symbol (component / export name, SQL head …), or omitted for any */
  symbol?: string
  reason: string
}

export interface Result {
  violations: Violation[]
  allowed: Violation[]
  /** allow-list entries that matched nothing (must be deleted: the list only shrinks) */
  stale: AllowEntry[]
}

const matches = (e: AllowEntry, v: Violation) =>
  e.rule === v.rule &&
  (e.file === undefined || e.file === v.file) &&
  (e.symbol === undefined || e.symbol === v.symbol)

export function evaluate(files: Source[], allow: AllowEntry[], rules: Rule[] = RULES): Result {
  const all = rules.flatMap((r) => r.check(files))
  const used = new Set<AllowEntry>()
  const violations: Violation[] = []
  const allowed: Violation[] = []
  for (const v of all) {
    const e = allow.find((a) => matches(a, v))
    if (e === undefined) violations.push(v)
    else {
      used.add(e)
      allowed.push(v)
    }
  }
  return { violations, allowed, stale: allow.filter((e) => !used.has(e)) }
}

/** Tracked and untracked-but-not-ignored files under the scanned roots. */
export function repoFiles(root: string): Source[] {
  const out = execFileSync(
    'git',
    ['ls-files', '-co', '--exclude-standard', '--', 'apps', 'packages', 'tests', 'tools/conventions'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return out
    .split('\n')
    .filter((p) => /\.(ts|tsx|css)$/.test(p) && !p.includes('node_modules/') && !p.includes('/dist/'))
    .flatMap((p) => {
      try {
        return [{ path: p, text: readFileSync(join(root, p), 'utf8') }]
      } catch {
        return [] // deleted in the working tree
      }
    })
}

export function loadAllowList(file: string): AllowEntry[] {
  const doc = parseYaml(readFileSync(file, 'utf8')) as { allow?: AllowEntry[] } | null
  const list = doc?.allow ?? []
  for (const e of list) {
    if (typeof e.rule !== 'string' || typeof e.reason !== 'string' || e.reason.trim() === '')
      throw new Error(`allow-list entry without rule/reason: ${JSON.stringify(e)}`)
    if (!RULES.some((r) => r.id === e.rule)) throw new Error(`allow-list entry for unknown rule ${e.rule}`)
  }
  return list
}

export function format(r: Result): string {
  const lines: string[] = []
  const byRule = new Map<string, Violation[]>()
  for (const v of r.violations) byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v])
  for (const [id, vs] of byRule) {
    const rule = RULES.find((x) => x.id === id)
    lines.push(`\n✗ ${id}: ${rule?.summary ?? ''}  (${docLink(rule?.doc ?? '')})`)
    for (const v of vs) lines.push(`    ${v.file}:${v.line}  ${v.message}`)
  }
  for (const e of r.stale)
    lines.push(
      `\n✗ stale allow-list entry (nothing matches it any more, delete it): ${e.rule} ${e.file ?? ''} ${e.symbol ?? ''}`,
    )
  return lines.join('\n')
}
