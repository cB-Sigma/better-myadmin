#!/usr/bin/env tsx
/**
 * Lists phpMyAdmin commits that are not yet reflected in BetterMyAdmin, classified by feature area,
 * and checks the ledger.
 *
 *   pnpm upstream:check [--pma ../ref/pma-upstream.git] [--ref origin/master] [--fetch] [--json]
 *
 * - "pinned": the commit in docs/reference/reference-commit.txt (what the docs, fixtures and the
 *   reference instance describe).
 * - Every commit between the original pin and the current pin must have a ledger entry
 *   (tools/upstream/ledger.json) saying ported / not-applicable, with notes. `--gate` fails otherwise.
 * - Commits after the pin are reported as "pending" with their areas, files, and the sql-parser
 *   version change (from composer.lock) so the next sync knows what to port.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { type Kind, classify } from './areas.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')

export interface LedgerEntry {
  commit: string
  subject: string
  status: 'ported' | 'not-applicable'
  areas: string[]
  notes: string
}
export interface Ledger {
  /** The first reference commit the project was specified against. */
  origin: string
  entries: LedgerEntry[]
}

export interface PendingCommit {
  commit: string
  date: string
  subject: string
  kinds: Kind[]
  areas: string[]
  files: string[]
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

export function pinnedCommit(): string {
  return readFileSync(join(repo, 'docs/reference/reference-commit.txt'), 'utf8').trim().split(/\s+/)[0]!
}

export function readLedger(): Ledger {
  return JSON.parse(readFileSync(join(here, 'ledger.json'), 'utf8')) as Ledger
}

/** Non-merge commits in (from, to], oldest first, with classified files. */
export function commitsBetween(pma: string, from: string, to: string): PendingCommit[] {
  const out = git(
    pma,
    'log',
    '--no-merges',
    '--reverse',
    '--format=%H%x09%ad%x09%s',
    '--date=short',
    `${from}..${to}`,
  )
  if (out === '') return []
  return out.split('\n').map((line) => {
    const [commit = '', date = '', subject = ''] = line.split('\t')
    const files = git(pma, 'show', '--format=', '--name-only', commit).split('\n').filter(Boolean)
    const cls = files.map(classify)
    return {
      commit,
      date,
      subject,
      files,
      kinds: [...new Set(cls.map((c) => c.kind))],
      areas: [...new Set(cls.map((c) => c.area))],
    }
  })
}

/** phpmyadmin/sql-parser version locked in composer.lock at a commit. */
export function sqlParserVersion(pma: string, commit: string): string | null {
  try {
    const lock = JSON.parse(git(pma, 'show', `${commit}:composer.lock`)) as {
      packages: Array<{ name: string; version: string }>
    }
    return lock.packages.find((p) => p.name === 'phpmyadmin/sql-parser')?.version ?? null
  } catch {
    return null
  }
}

/**
 * The main checkout: `../ref` sits next to it, and a linked worktree (.claude/worktrees/…) is not
 * there, so resolve it from git's common dir (`<main>/.git`).
 */
export function mainCheckout(dir = repo): string {
  try {
    return dirname(resolve(dir, git(dir, 'rev-parse', '--git-common-dir')))
  } catch {
    return dir
  }
}

/**
 * The git checkout to read upstream history from: the blobless clone `../ref/pma-upstream.git`
 * when present (cheap to fetch, independent of the reference instance), else `../ref/pma`, both
 * next to the main checkout.
 */
function defaultPmaGit(): string {
  const main = mainCheckout()
  const clone = resolve(main, '../ref/pma-upstream.git')
  return existsSync(clone) ? clone : resolve(main, '../ref/pma')
}

function main() {
  const { values } = parseArgs({
    options: {
      pma: { type: 'string', default: defaultPmaGit() },
      ref: { type: 'string', default: 'origin/master' },
      fetch: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      gate: { type: 'boolean', default: false },
    },
  })
  const pma = resolve(values.pma)
  if (values.fetch) git(pma, 'fetch', '--quiet', 'origin')
  const pinned = pinnedCommit()
  const ledger = readLedger()

  // 1. everything between the original pin and the current pin must be in the ledger
  const reviewed = new Set(ledger.entries.map((e) => e.commit))
  const behindPin = commitsBetween(pma, ledger.origin, pinned)
  const missing = behindPin.filter((c) => !reviewed.has(c.commit))

  // 2. what is new upstream after the pin
  const pending = commitsBetween(pma, pinned, values.ref)
  const parserFrom = sqlParserVersion(pma, pinned)
  const parserTo = sqlParserVersion(pma, values.ref)

  if (values.json) {
    console.log(
      JSON.stringify(
        { pinned, ref: values.ref, missing, pending, sqlParser: { from: parserFrom, to: parserTo } },
        null,
        2,
      ),
    )
  } else {
    console.log(`pinned reference: ${pinned}`)
    console.log(`upstream ${values.ref}: ${pending.length} commit(s) after the pin`)
    if (parserFrom !== parserTo)
      console.log(`sql-parser: ${parserFrom} -> ${parserTo} (port packages/sql-lexer)`)
    const byKind = new Map<string, PendingCommit[]>()
    for (const c of pending) {
      const k = c.kinds.includes('behaviour') ? 'behaviour' : (c.kinds[0] ?? 'tooling')
      byKind.set(k, [...(byKind.get(k) ?? []), c])
    }
    for (const [k, cs] of byKind) {
      console.log(`\n${k} (${cs.length})`)
      for (const c of cs)
        console.log(`  ${c.commit.slice(0, 10)} ${c.date} ${c.subject}  [${c.areas.join(', ')}]`)
    }
    if (missing.length > 0) {
      console.log(`\nledger: ${missing.length} commit(s) behind the pin have no ledger entry:`)
      for (const c of missing) console.log(`  ${c.commit.slice(0, 10)} ${c.subject}`)
    }
  }
  if (values.gate && missing.length > 0) process.exit(1)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
