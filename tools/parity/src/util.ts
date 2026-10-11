import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const here = dirname(fileURLToPath(import.meta.url))

/** Repository root. */
export const REPO = resolve(here, '../../..')
/** tools/parity */
export const PARITY = resolve(here, '..')
export const INVENTORY_DIR = join(PARITY, 'inventory')
export const MAP_DIR = join(PARITY, 'map')
export const BASELINE_FILE = join(PARITY, 'baseline.json')
export const COVERAGE_DIR = join(REPO, 'docs/reference/coverage')
export const RESULTS_DIR = join(REPO, '.data/parity-results')

/** The phpMyAdmin checkout the inventories are extracted from. */
export function pmaPath(): string {
  return process.env.PMA_PATH ?? '/home/user/ref/pma'
}

/** The reference commit the docs describe (docs/reference/reference-commit.txt, first field). */
export function referenceCommit(): string {
  const text = readFileSync(join(REPO, 'docs/reference/reference-commit.txt'), 'utf8')
  return text.trim().split(/\s+/)[0] ?? ''
}

/** HEAD of the phpMyAdmin checkout, or null when it is not available. */
export function pmaHead(root = pmaPath()): string | null {
  if (!existsSync(join(root, 'src/Routing/Routes.php'))) return null
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

export function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

export function toPosix(p: string): string {
  return p.split(sep).join('/')
}

export function rel(from: string, to: string): string {
  return toPosix(relative(from, to))
}

/** Recursively lists files below `dir` (sorted, posix paths relative to `dir`). */
export function walk(dir: string, accept: (rel: string) => boolean, skip = SKIP_DIRS): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  const visit = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) {
        if (!skip.has(name)) visit(p)
      } else {
        const r = rel(dir, p)
        if (accept(r)) out.push(r)
      }
    }
  }
  visit(dir)
  return out
}

export const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'generated', 'coverage', '.data'])

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

export function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}

export function readYaml<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  const parsed = YAML.parse(readFileSync(file, 'utf8')) as T | null
  return parsed ?? fallback
}

export function writeText(file: string, text: string): boolean {
  mkdirSync(dirname(file), { recursive: true })
  const old = existsSync(file) ? readFileSync(file, 'utf8') : null
  if (old === text) return false
  writeFileSync(file, text)
  return true
}

/** Sorts object keys recursively-free: returns a new object with keys in `compare` order. */
export function sortedRecord<V>(rec: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {}
  for (const k of Object.keys(rec).sort()) out[k] = rec[k] as V
  return out
}

export function groupBy<T, K extends string>(items: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const it of items) {
    const k = key(it)
    const list = m.get(k)
    if (list === undefined) m.set(k, [it])
    else list.push(it)
  }
  return m
}

export function pct(n: number, d: number): string {
  if (d === 0) return '—'
  return `${((100 * n) / d).toFixed(1)}%`
}

/** Escapes a value for a markdown table cell. */
export function cell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** A markdown inline-code span that survives backticks in the content. */
export function code(s: string): string {
  const ticks = s.includes('`') ? '``' : '`'
  const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : ''
  return `${ticks}${pad}${cell(s)}${pad}${ticks}`
}
