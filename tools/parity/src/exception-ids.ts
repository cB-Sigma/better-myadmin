/**
 * Exception ids (`X<n>` intentional differences, `Q<n>` source quirks) of
 * docs/reference/parity-exceptions.md: every id is registered once, and every id written anywhere in
 * the repository (code, tests, docs, tests/parity/allowed-diffs.yaml, the maps) is registered.
 * A retired row (`| ~~X38~~ |`) keeps its id: it stays referable and is never handed out again.
 * `pnpm parity:next-id X|Q` prints the next free id (one above the highest ever registered).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from './util.ts'

export const REGISTER = 'docs/reference/parity-exceptions.md'

/** Tokens shaped like an id that are not one. */
const NOT_IDS = new Map([['X509', 'REQUIRE X509 (SQL)']])
/**
 * A deliberately unregistered id (a validator's test input) is marked with this on its line or the
 * line above.
 */
export const FAKE_ID_MARKER = 'fake exception id'

const ID = /\b([XQ])(\d+)\b/g
const ROW = /^\|\s*(?:~~)?([XQ]\d+)(?:~~)?\s*\|/

export interface RegisteredId {
  id: string
  line: number
  retired: boolean
}

/** The register's rows, in file order (duplicates included). */
export function registeredIds(text: string): RegisteredId[] {
  return text.split('\n').flatMap((l, i) => {
    const m = ROW.exec(l)
    return m === null ? [] : [{ id: m[1]!, line: i + 1, retired: l.trimStart().startsWith('| ~~') }]
  })
}

export function duplicateIds(rows: RegisteredId[]): string[] {
  const seen = new Map<string, number>()
  const out: string[] = []
  for (const r of rows) {
    const first = seen.get(r.id)
    if (first === undefined) seen.set(r.id, r.line)
    else
      out.push(
        `${REGISTER}:${r.line}: ${r.id} is already registered on line ${first} (next free: ${nextId(rows, r.id[0] as 'X' | 'Q')})`,
      )
  }
  return out
}

export function nextId(rows: RegisteredId[], kind: 'X' | 'Q'): string {
  const max = Math.max(0, ...rows.filter((r) => r.id[0] === kind).map((r) => Number(r.id.slice(1))))
  return `${kind}${max + 1}`
}

export interface SourceText {
  path: string
  text: string
}

/** Ids written in `files` that the register does not have. */
export function unknownReferences(files: SourceText[], known: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const f of files) {
    const lines = f.text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!
      if (!/[XQ]\d/.test(l) || l.includes(FAKE_ID_MARKER) || lines[i - 1]?.includes(FAKE_ID_MARKER)) continue
      for (const m of l.matchAll(ID)) {
        const id = m[0]
        if (known.has(id) || NOT_IDS.has(id)) continue
        out.push(`${f.path}:${i + 1}: ${id} is not in ${REGISTER}`)
      }
    }
  }
  return out
}

const TEXT = /\.(ts|tsx|js|mjs|cjs|yaml|yml|md|php|sh|css|html|twig)$/
/** generated from phpMyAdmin's sources, not ours to annotate */
const SKIP = [/(^|\/)node_modules\//, /\/dist\//, /^packages\/sql-lexer\/src\/contexts\/generated\//]

/** Tracked and untracked-but-not-ignored text files of the repository. */
export function repoTextFiles(root = REPO): SourceText[] {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out
    .split('\n')
    .filter((p) => TEXT.test(p) && !SKIP.some((r) => r.test(p)))
    .flatMap((p) => {
      try {
        return [{ path: p, text: readFileSync(join(root, p), 'utf8') }]
      } catch {
        return [] // deleted in the working tree
      }
    })
}

/** Both checks over the repository: duplicate registrations and unregistered references. */
export function checkExceptionIds(root = REPO): string[] {
  const rows = registeredIds(readFileSync(join(root, REGISTER), 'utf8'))
  return [...duplicateIds(rows), ...unknownReferences(repoTextFiles(root), new Set(rows.map((r) => r.id)))]
}
