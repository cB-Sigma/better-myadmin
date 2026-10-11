/**
 * pnpm parity:check — the parity gate (see src/gate.ts for the rules). Static: needs neither PHP nor
 * a database. When the reference checkout (PMA_PATH) is present at the reference commit it also
 * re-extracts the inventories and compares (skip with --no-reextract).
 */
import { loadChecklistIds } from '../checklist.ts'
import { checkGenerated, checkStale, compareBaseline } from '../gate.ts'
import { load, loadBaseline, renderAll } from '../pipeline.ts'
import { printSummary } from '../summary.ts'

const l = load(null)
const failures: string[] = []
const warnings: string[] = []

failures.push(...l.cov.problems)
const stale = checkStale(l.inv, { reextract: !process.argv.includes('--no-reextract') })
failures.push(...stale.failures)
warnings.push(...stale.warnings)
const gate = compareBaseline(l.cov, loadBaseline())
failures.push(...gate.failures)
warnings.push(...gate.warnings)
const knownIds = loadChecklistIds()
const unsaved = l.cov.scans.checklist.filter((c) => !(c.id in knownIds)).length
if (unsaved > 0) warnings.push(`${unsaved} checklist item(s) have no stored id yet: run pnpm parity:report`)
const generated = checkGenerated(renderAll(l))
failures.push(...generated.failures)
warnings.push(...generated.warnings)

printSummary(l.cov, gate.delta)
if (warnings.length > 0) {
  console.log('\nwarnings:')
  for (const w of warnings) console.log(`  - ${w}`)
}
if (failures.length > 0) {
  console.log(`\nparity:check FAILED (${failures.length}):`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nparity:check passed')
