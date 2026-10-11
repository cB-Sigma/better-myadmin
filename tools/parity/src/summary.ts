import { COVERAGE_KINDS, type Coverage } from './coverage.ts'
import { SUMMARY_HEADER, summaryRows } from './report.ts'

/** Concise fixed-width summary table for the terminal. */
export function printSummary(cov: Coverage, extra?: Map<string, string>): void {
  const header = [...SUMMARY_HEADER, ...(extra !== undefined ? ['vs baseline'] : [])]
  const rows = summaryRows(cov).map((r, i) => [
    ...r,
    ...(extra !== undefined ? [extra.get(COVERAGE_KINDS[i]!) ?? ''] : []),
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const fmt = (r: string[]) =>
    r.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join('  ')
  console.log(`\n${fmt(header)}`)
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const r of rows) console.log(fmt(r))
}
