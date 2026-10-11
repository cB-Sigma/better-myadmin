/**
 * pnpm parity:baseline — records the current coverage in tools/parity/baseline.json, the ratchet
 * that `pnpm parity:check` compares against. Run it (and commit the result) when coverage went up,
 * or when an intentional change lowered it (say why in the commit). CI never runs it.
 */
import { baselineOf, load, saveBaseline } from '../pipeline.ts'
import { printSummary } from '../summary.ts'

if (process.env.CI !== undefined && !process.argv.includes('--force')) {
  console.error('parity:baseline must not run in CI (it would accept any regression).')
  process.exit(2)
}
const { cov } = load(null)
if (cov.problems.length > 0) {
  console.error(
    `parity:baseline: refusing, ${cov.problems.length} problem(s) — fix them first (pnpm parity:check lists them).`,
  )
  process.exit(1)
}
saveBaseline(baselineOf(cov))
printSummary(cov)
console.log('\nparity: baseline written to tools/parity/baseline.json')
