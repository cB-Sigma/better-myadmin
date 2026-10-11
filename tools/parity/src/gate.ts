/**
 * The parity gate (`pnpm parity:check`). Fails when
 *   (a) an item the baseline had implemented/covered is not any more (unmapped, target gone, claim broken),
 *   (b) a mapping or claim points at something that does not exist (route target, control claim,
 *       directive/control map key, checklist tick without a test),
 *   (c) the covered or implemented count of an inventory, or its coverage ratio, went down,
 *   (d) the inventories are stale: their commit differs from docs/reference/reference-commit.txt, or
 *       (when the reference checkout is available) re-extracting gives a different result,
 *   (e) a map references an exception id missing from docs/reference/parity-exceptions.md (or an
 *       unknown milestone),
 *   (f) docs/reference/pma-route-map.md is out of date (stale coverage reports only warn).
 */
import { existsSync, readFileSync } from 'node:fs'
import { COVERAGE_KINDS, COVERED, type Coverage } from './coverage.ts'
import { INVENTORY_KINDS, type Inventories, extractAll } from './inventory.ts'
import type { Baseline } from './pipeline.ts'
import { REPO, pmaHead, pmaPath, referenceCommit, rel } from './util.ts'

export interface GateResult {
  failures: string[]
  warnings: string[]
  /** per kind: "+3 implemented" etc. */
  delta: Map<string, string>
}

export function compareBaseline(cov: Coverage, base: Baseline | null): GateResult {
  const failures: string[] = []
  const warnings: string[] = []
  const delta = new Map<string, string>()
  if (base === null) {
    failures.push('no tools/parity/baseline.json: run pnpm parity:baseline and commit it')
    return { failures, warnings, delta }
  }
  for (const k of COVERAGE_KINDS) {
    const kc = cov.kinds[k]
    const b = base.kinds[k]
    if (b === undefined) {
      failures.push(`${k}: missing from baseline (run pnpm parity:baseline)`)
      continue
    }
    const status = new Map(kc.items.map((i) => [i.key, i.status]))
    const lostImpl = b.implementedKeys.filter((key) => status.get(key) !== 'implemented')
    const lostCovered = b.accountedKeys.filter((key) => {
      const s = status.get(key)
      return s === undefined || !COVERED.has(s)
    })
    for (const key of lostImpl.slice(0, 50))
      failures.push(`${k}: ${key} was implemented, now ${status.get(key) ?? 'gone from the inventory'}`)
    if (lostImpl.length > 50) failures.push(`${k}: … and ${lostImpl.length - 50} more lost implemented items`)
    for (const key of lostCovered.slice(0, 50))
      failures.push(`${k}: ${key} was covered, now ${status.get(key) ?? 'gone from the inventory'}`)
    if (lostCovered.length > 50)
      failures.push(`${k}: … and ${lostCovered.length - 50} more lost covered items`)
    const ratio = kc.total === 0 ? 0 : Math.round((10000 * kc.covered) / kc.total) / 10000
    if (kc.covered < b.covered) failures.push(`${k}: covered ${kc.covered} < baseline ${b.covered}`)
    if (kc.counts.implemented < b.implemented)
      failures.push(`${k}: implemented ${kc.counts.implemented} < baseline ${b.implemented}`)
    if (ratio < b.coverage)
      failures.push(
        `${k}: coverage ${(ratio * 100).toFixed(2)}% < baseline ${(b.coverage * 100).toFixed(2)}%`,
      )
    const dImpl = kc.counts.implemented - b.implemented
    const dCov = kc.covered - b.covered
    delta.set(
      k,
      dImpl === 0 && dCov === 0
        ? '='
        : `${dImpl >= 0 ? '+' : ''}${dImpl} impl, ${dCov >= 0 ? '+' : ''}${dCov} cov`,
    )
    if (dImpl > 0 || dCov > 0)
      warnings.push(`${k}: coverage went up — run pnpm parity:baseline to lock it in`)
  }
  if (base._meta.referenceCommit !== cov.referenceCommit) {
    warnings.push(
      `baseline was recorded for ${base._meta.referenceCommit.slice(0, 8)}, inventories are ${cov.referenceCommit.slice(0, 8)}`,
    )
  }
  return { failures, warnings, delta }
}

/** (d) staleness of the committed inventories. */
export function checkStale(
  inv: Inventories,
  opts: { reextract: boolean },
): { failures: string[]; warnings: string[] } {
  const failures: string[] = []
  const warnings: string[] = []
  const ref = referenceCommit()
  for (const k of INVENTORY_KINDS) {
    const c = inv[k]._meta.referenceCommit
    if (c !== ref)
      failures.push(
        `inventory/${k}.json was extracted from ${c.slice(0, 8)}, reference commit is ${ref.slice(0, 8)}: run pnpm parity:inventory`,
      )
    if (inv[k]._meta.count !== inv[k].items.length)
      failures.push(`inventory/${k}.json: _meta.count does not match its items (edited by hand?)`)
  }
  const pma = pmaPath()
  const head = pmaHead(pma)
  if (head === null) {
    warnings.push(`reference checkout not found at ${pma} (PMA_PATH): inventories checked by commit only`)
  } else if (head !== ref) {
    warnings.push(
      `reference checkout ${pma} is at ${head.slice(0, 8)}, not ${ref.slice(0, 8)}: re-extraction skipped`,
    )
  } else if (opts.reextract) {
    try {
      const fresh = extractAll(pma)
      for (const k of INVENTORY_KINDS) {
        if (JSON.stringify(fresh[k]) !== JSON.stringify(inv[k])) {
          failures.push(
            `inventory/${k}.json differs from a fresh extraction of ${pma}: run pnpm parity:inventory`,
          )
        }
      }
    } catch (e) {
      warnings.push(
        `re-extraction failed (${(e as Error).message.split('\n')[0]}): inventories checked by commit only`,
      )
    }
  }
  return { failures, warnings }
}

/**
 * (f) generated files up to date. pma-route-map.md is a failure (it is the route map's doc and changes
 * only with routes.yaml or the routes themselves); the coverage reports only warn, so that unrelated
 * changes (a new translated string) do not force everyone to regenerate them.
 */
export function checkGenerated(rendered: Map<string, string>): { failures: string[]; warnings: string[] } {
  const failures: string[] = []
  const warnings: string[] = []
  for (const [file, text] of rendered) {
    const cur = existsSync(file) ? readFileSync(file, 'utf8') : null
    if (cur === text) continue
    const msg = `${rel(REPO, file)} is out of date: run pnpm parity:report`
    if (file.endsWith('pma-route-map.md')) failures.push(msg)
    else warnings.push(msg)
  }
  return { failures, warnings }
}
