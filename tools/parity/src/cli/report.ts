/**
 * pnpm parity:report [--run[=suite,…]] — computes coverage and writes the reports.
 *
 *   --run           run the Vitest unit project with its JSON reporter first
 *   --run=all       run every suite (vitest-unit, vitest-int, vitest-parity, playwright-e2e;
 *                   int/parity/e2e need MySQL and the reference phpMyAdmin; apps/web is built first)
 *   --run=a,b       run those suites
 * Without --run it reads the latest saved results under .data/parity-results/.
 *
 * Writes docs/reference/coverage/*.md and docs/reference/pma-route-map.md, assigns checklist ids
 * (tools/parity/map/checklist-ids.json) and rewrites the checklist markers in docs/features/*.md.
 */
import { load, syncChecklist, writeReports } from '../pipeline.ts'
import { printSummary } from '../summary.ts'
import { SUITES, loadResults, runSuites } from '../tests.ts'

const runArg = process.argv.find((a) => a === '--run' || a.startsWith('--run='))
if (runArg !== undefined) {
  const v = runArg.includes('=') ? runArg.slice(runArg.indexOf('=') + 1) : 'vitest-unit'
  const ids =
    v === 'all' ? SUITES.map((s) => s.id) : v.split(',').map((s) => (s.includes('-') ? s : `vitest-${s}`))
  const status = runSuites(ids)
  for (const [id, code] of Object.entries(status)) {
    if (code !== 0) console.warn(`parity: ${id} exited with ${code} (results still used where written)`)
  }
}

const { results, loaded } = loadResults()
const res = loaded.length > 0 ? results : null
console.log(
  res === null
    ? 'parity: no saved test results (.data/parity-results/); checklist status follows the doc markers'
    : `parity: test results from ${loaded.join(', ')} (${results.length} tests)`,
)

const sync = syncChecklist(res)
if (sync.minted.length > 0) console.log(`parity: ${sync.minted.length} new checklist id(s)`)
if (sync.removed.length > 0)
  console.log(
    `parity: ${sync.removed.length} checklist id(s) no longer in the docs: ${sync.removed.join(', ')}`,
  )
const l = load(res)
const changed = [...sync.changed, ...writeReports(l)]
printSummary(l.cov)
console.log(changed.length === 0 ? '\nparity: reports up to date' : `\nparity: wrote ${changed.join(', ')}`)
