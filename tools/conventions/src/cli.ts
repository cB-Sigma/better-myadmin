import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, format, loadAllowList, pruneAllowList, repoFiles } from './check.ts'
import { RULES } from './rules.ts'

/** `pnpm conventions:check` — static, no DB, no build. Exit 1 on any violation or stale allow-list entry. */
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
if (process.argv.includes('--list')) {
  for (const r of RULES) console.log(`${r.id.padEnd(28)} ${r.summary}`)
  process.exit(0)
}
const started = performance.now()
const files = repoFiles(root)
const allowFile = join(here, '..', 'allowlist.yaml')
const result = evaluate(files, loadAllowList(allowFile))
const ms = Math.round(performance.now() - started)

// `--prune`: drop the stale entries after fixing their violations (the list only shrinks)
if (process.argv.includes('--prune') && result.stale.length > 0) {
  pruneAllowList(allowFile, result.stale)
  console.log(`conventions: removed ${result.stale.length} stale allow-list entr(y/ies)`)
  result.stale = []
}

if (result.violations.length > 0 || result.stale.length > 0) {
  console.error(format(result))
  console.error(
    `\nconventions: ${result.violations.length} violation(s), ${result.stale.length} stale allow-list entr(y/ies) in ${files.length} files (${ms} ms).` +
      '\nFix them (docs/architecture/16-golden-path.md) — the allow-list (tools/conventions/allowlist.yaml) only shrinks.',
  )
  process.exit(1)
}
console.log(
  `conventions: ${RULES.length} rules, ${files.length} files, 0 violations (${result.allowed.length} allow-listed) in ${ms} ms`,
)
