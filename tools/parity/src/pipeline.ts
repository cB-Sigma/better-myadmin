/**
 * Shared steps of report / check / baseline.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type ChecklistItem,
  assignIds,
  featureDocs,
  loadChecklistIds,
  parseChecklist,
  rewriteChecklist,
  saveChecklistIds,
} from './checklist.ts'
import {
  COVERAGE_KINDS,
  COVERED,
  type Coverage,
  type CoverageKind,
  computeCoverage,
  linkChecklist,
  resultFor,
} from './coverage.ts'
import { type Inventories, loadInventories } from './inventory.ts'
import { type Maps, loadMaps } from './maps.ts'
import {
  renderChecklist,
  renderControls,
  renderDirectives,
  renderJs,
  renderMessages,
  renderReadme,
  renderRouteMapDoc,
  renderRoutes,
} from './report.ts'
import { type TestCase, type TestResult, scanTests } from './tests.ts'
import { BASELINE_FILE, COVERAGE_DIR, REPO, readJson, rel, writeJson, writeText } from './util.ts'

export interface Loaded {
  inv: Inventories
  maps: Maps
  cov: Coverage
}

export function load(results: TestResult[] | null): Loaded {
  const inv = loadInventories()
  const maps = loadMaps()
  const cov = computeCoverage(inv, maps, { results })
  return { inv, maps, cov }
}

/** The generated files and their content. */
export function renderAll({ inv, maps, cov }: Loaded): Map<string, string> {
  const out = new Map<string, string>()
  out.set(join(COVERAGE_DIR, 'README.md'), renderReadme(cov, inv))
  out.set(join(COVERAGE_DIR, 'routes.md'), renderRoutes(cov))
  out.set(join(COVERAGE_DIR, 'controls.md'), renderControls(cov))
  out.set(join(COVERAGE_DIR, 'directives.md'), renderDirectives(cov))
  out.set(join(COVERAGE_DIR, 'messages.md'), renderMessages(cov, inv))
  out.set(join(COVERAGE_DIR, 'js.md'), renderJs(cov))
  out.set(join(COVERAGE_DIR, 'checklist.md'), renderChecklist(cov))
  out.set(join(REPO, 'docs/reference/pma-route-map.md'), renderRouteMapDoc(inv, maps, cov))
  return out
}

/**
 * Assigns/updates checklist ids and rewrites the doc markers from test results (or, without
 * results, keeps a tick only where a linked test still exists). Returns the changed docs.
 */
export function syncChecklist(results: TestResult[] | null): {
  changed: string[]
  minted: string[]
  removed: string[]
} {
  const parsed = featureDocs().flatMap((f) => parseChecklist(f, readFileSync(join(REPO, f), 'utf8')))
  const { items, ids, minted, removed } = assignIds(parsed, loadChecklistIds())
  saveChecklistIds(ids)
  const tests = scanTests()
  const links = linkChecklist(items, tests)
  const refs = new Map<string, string>()
  for (const it of items) {
    const linked = links.get(it.id) ?? []
    if (linked.length === 0) continue
    // a failing linked test unticks; a passing one ticks; no result at all (suite not run) keeps the marker
    const rs = results === null ? [] : linked.map((t) => evidence(resultFor(t, results)?.status))
    if (rs.includes('failed')) continue
    const passing = linked.filter((_t, i) => rs[i] === 'passed')
    if (passing.length > 0) refs.set(it.id, testRef(it, passing))
    else if (it.checked && rs.every((r) => r === undefined)) refs.set(it.id, testRef(it, linked))
  }
  const changed: string[] = []
  for (const f of featureDocs()) {
    const abs = join(REPO, f)
    const src = readFileSync(abs, 'utf8')
    const next = rewriteChecklist(src, f, items, refs)
    if (next !== src) {
      writeFileSync(abs, next)
      changed.push(f)
    }
  }
  return { changed, minted, removed }
}

/** A skipped test is no evidence either way. */
const evidence = (s: string | undefined) => (s === 'skipped' ? undefined : s)

function testRef(item: ChecklistItem, tests: TestCase[]): string {
  const t = tests[0]!
  const more = tests.length > 1 ? ` +${tests.length - 1}` : ''
  const link = rel(join(REPO, item.file, '..'), join(REPO, t.file))
  return `\`${item.id}\` [${t.file.split('/').at(-1)}:${t.line}](${link}#L${t.line})${more}`
}

export function writeReports(l: Loaded): string[] {
  const changed: string[] = []
  for (const [file, text] of renderAll(l)) if (writeText(file, text)) changed.push(rel(REPO, file))
  return changed
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

export interface BaselineKind {
  total: number
  implemented: number
  covered: number
  /** covered / total, rounded to 4 decimals */
  coverage: number
  implementedKeys: string[]
  /** keys covered without being implemented (exception, n/a) */
  accountedKeys: string[]
}

export interface Baseline {
  _meta: { generated: string; referenceCommit: string }
  kinds: Record<CoverageKind, BaselineKind>
}

export function baselineOf(cov: Coverage): Baseline {
  const kinds = {} as Record<CoverageKind, BaselineKind>
  for (const k of COVERAGE_KINDS) {
    const kc = cov.kinds[k]
    kinds[k] = {
      total: kc.total,
      implemented: kc.counts.implemented,
      covered: kc.covered,
      coverage: kc.total === 0 ? 0 : Math.round((10000 * kc.covered) / kc.total) / 10000,
      implementedKeys: kc.items.filter((i) => i.status === 'implemented').map((i) => i.key),
      accountedKeys: kc.items
        .filter((i) => COVERED.has(i.status) && i.status !== 'implemented')
        .map((i) => i.key),
    }
  }
  return {
    _meta: {
      generated: 'by `pnpm parity:baseline`; the ratchet `pnpm parity:check` compares against',
      referenceCommit: cov.referenceCommit,
    },
    kinds,
  }
}

export function loadBaseline(): Baseline | null {
  try {
    return readJson<Baseline>(BASELINE_FILE)
  } catch {
    return null
  }
}

export function saveBaseline(b: Baseline): void {
  writeJson(BASELINE_FILE, b)
}
