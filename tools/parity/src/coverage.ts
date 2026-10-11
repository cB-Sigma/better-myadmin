/**
 * Coverage: every inventory item with its status, computed from the inventories, the maps and a
 * static scan of our code (no PHP, no database, no reference checkout needed).
 *
 * Status per item:
 *   implemented  our code has it (verified target / registry claim / directive read / msgid used / passing test)
 *   exception    intentional difference (parity-exceptions.md)
 *   n/a          nothing to build
 *   planned      not built yet, milestone recorded
 *   missing      nothing says anything about it
 *   broken       a mapping or claim points at something that does not exist (gate failure)
 *   failing      checklist only: the linked test fails
 *   untested     checklist only: a test is linked but there is no passing result
 * Covered = implemented + exception + n/a.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type AreaRules, areaOf, loadAreaRules, loadAreas } from './areas.ts'
import { type ChecklistItem, readChecklist } from './checklist.ts'
import { msgKey } from './extract/pot.ts'
import type { Inventories, InventoryKind } from './inventory.ts'
import {
  type Disposition,
  type Maps,
  dispositionProblems,
  list,
  loadExceptionIds,
  loadMilestones,
  lookup,
} from './maps.ts'
import { collectChains, directiveUses, scanMsgids, sourceFiles } from './scan/code.ts'
import { type ControlClaim, scanControlClaims, verifyClaim } from './scan/controls.ts'
import { type Endpoint, normalizePath, scanHono } from './scan/hono.ts'
import { type SpaRoute, scanTanstack } from './scan/tanstack.ts'
import { type TestCase, type TestResult, scanTests } from './tests.ts'
import { REPO } from './util.ts'

export type Status =
  | 'implemented'
  | 'exception'
  | 'n/a'
  | 'planned'
  | 'missing'
  | 'broken'
  | 'failing'
  | 'untested'
export const COVERED: ReadonlySet<Status> = new Set(['implemented', 'exception', 'n/a'])
export const STATUSES: Status[] = [
  'implemented',
  'exception',
  'n/a',
  'planned',
  'untested',
  'failing',
  'missing',
  'broken',
]

export type CoverageKind = InventoryKind | 'checklist'
export const COVERAGE_KINDS: CoverageKind[] = ['routes', 'controls', 'directives', 'messages', 'checklist']

export interface ItemCoverage {
  key: string
  area: string
  status: Status
  /** Short human label (route methods+path, control kind+label, msgid…). */
  label: string
  /** Where phpMyAdmin has it (controller, template, refs). */
  source: string
  /** What implements it, or the intended targets for planned items. */
  targets: string[]
  /** Disposition detail: milestone, exception id, n/a reason, note. */
  detail?: string
  problems: string[]
}

export interface KindCoverage {
  kind: CoverageKind
  total: number
  counts: Record<Status, number>
  covered: number
  items: ItemCoverage[]
}

export interface Coverage {
  referenceCommit: string
  kinds: Record<CoverageKind, KindCoverage>
  /** Problems not tied to an inventory item (map keys/claims that match nothing). */
  problems: string[]
  /** Informational findings (cross-checks). */
  notes: string[]
  scans: {
    endpoints: Endpoint[]
    spaRoutes: SpaRoute[]
    claims: ControlClaim[]
    tests: TestCase[]
    checklist: ChecklistItem[]
    /** msgids our code uses that phpMyAdmin does not have (see pnpm i18n:parity) */
    unknownMsgids: string[]
  }
}

export interface CoverageOptions {
  repo?: string
  /** Latest test results; when given, checklist status follows them, otherwise the doc markers. */
  results?: TestResult[] | null
}

const emptyCounts = (): Record<Status, number> =>
  Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>

function finish(kind: CoverageKind, items: ItemCoverage[]): KindCoverage {
  const counts = emptyCounts()
  for (const it of items) counts[it.status]++
  return {
    kind,
    total: items.length,
    counts,
    covered: items.filter((i) => COVERED.has(i.status)).length,
    items: items.sort((a, b) => a.key.localeCompare(b.key)),
  }
}

/** Status for an item without verified implementation, from its disposition. */
function fromDisposition(d: Disposition | undefined): { status: Status; detail?: string } {
  if (d === undefined) return { status: 'missing' }
  const note = d.note !== undefined ? ` — ${d.note}` : ''
  if (d['n/a'] !== undefined) return { status: 'n/a', detail: `n/a: ${d['n/a']}${note}` }
  if (d.exception !== undefined && d.planned === undefined)
    return { status: 'exception', detail: `${d.exception}${note}` }
  if (d.planned !== undefined)
    return {
      status: 'planned',
      detail: `${d.planned}${d.exception !== undefined ? ` (${d.exception})` : ''}${note}`,
    }
  return { status: 'missing', ...(d.note !== undefined ? { detail: d.note } : {}) }
}

// ---------------------------------------------------------------------------
// Route targets
// ---------------------------------------------------------------------------

function segMatch(pattern: string, actual: string): boolean {
  const p = normalizePath(pattern.replace(/\{([A-Za-z_][A-Za-z0-9_]*)[^}]*\}/g, ':$1')).split('/')
  const a = actual.split('/')
  if (p.at(-1) === '*') {
    if (a.length < p.length) return false
    return p.slice(0, -1).every((s, i) => s === a[i] || (s.startsWith(':') && a[i]!.startsWith(':')))
  }
  if (p.length !== a.length) return false
  return p.every((s, i) => s === a[i] || (s.startsWith(':') && a[i]!.startsWith(':')))
}

export function findApi(target: string, endpoints: Endpoint[]): Endpoint | undefined {
  const m = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.*)$/.exec(target.trim())
  const method = m?.[1]
  const path = (m?.[2] ?? target).trim()
  return endpoints.find(
    (e) => (method === undefined || e.method === method || e.method === 'ALL') && segMatch(path, e.path),
  )
}

export function findUi(target: string, routes: SpaRoute[]): SpaRoute | undefined {
  return routes.find((r) => !r.splat && !r.placeholder && segMatch(target.trim(), r.path))
}

// ---------------------------------------------------------------------------

/** Area of a directive: the feature doc that mentions it (`Name` in backticks) most. */
function directiveAreas(keys: string[], repo: string): Map<string, string> {
  const docs = loadAreas(repo).flatMap((a) =>
    a.doc === null ? [] : [{ id: a.id, text: readFileSync(join(repo, a.doc), 'utf8') }],
  )
  const out = new Map<string, string>()
  for (const key of keys) {
    const segs = key.split('/').filter((s) => s !== '*')
    const forms = new Set([key, segs.join('/'), segs.at(-1)!, segs.join('.'), segs.join('][')])
    let best = 'other'
    let bestN = 0
    for (const d of docs) {
      let n = 0
      for (const f of forms) {
        const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        n += (d.text.match(new RegExp(`[\`'\\[/]${esc}[\`'\\]]`, 'g')) ?? []).length
      }
      if (n > bestN) {
        bestN = n
        best = d.id
      }
    }
    out.set(key, best)
  }
  return out
}

export function computeCoverage(inv: Inventories, maps: Maps, opts: CoverageOptions = {}): Coverage {
  const repo = opts.repo ?? REPO
  const rules: AreaRules = loadAreaRules()
  const exceptions = loadExceptionIds(repo)
  const milestones = loadMilestones(repo)
  const problems: string[] = []
  const notes: string[] = []
  const dispProblems = (d: Disposition | undefined) =>
    d === undefined ? [] : dispositionProblems(d, exceptions, milestones)

  const endpoints = scanHono(join(repo, 'apps/server/src'), repo)
  const spaRoutes = scanTanstack(join(repo, 'apps/web/src/routes'))

  // --- routes --------------------------------------------------------------------------------
  const routeItems: ItemCoverage[] = inv.routes.items.map((r) => {
    const entry = maps.routes[r.key]
    const api = list(entry?.api)
    const ui = list(entry?.ui)
    const found: string[] = []
    const absent: string[] = []
    for (const t of api) {
      const e = findApi(t, endpoints)
      if (e === undefined) absent.push(`API ${t}`)
      else found.push(`API ${e.method} ${e.path} (${e.file}:${e.line})`)
    }
    for (const t of ui) {
      const s = findUi(t, spaRoutes)
      if (s === undefined) absent.push(`UI ${t}`)
      else found.push(`UI ${s.path} (${s.file})`)
    }
    const item: ItemCoverage = {
      key: r.key,
      area: areaOf(r.file, rules),
      status: 'missing',
      label: `${r.methods.join(', ')} ${r.path}`,
      source: r.controller,
      targets: [...api.map((t) => `API ${t}`), ...ui.map((t) => `UI ${t}`)],
      problems: dispProblems(entry),
    }
    const hasTargets = api.length + ui.length > 0
    if (hasTargets && absent.length === 0) {
      item.status = entry?.exception !== undefined ? 'exception' : 'implemented'
      item.targets = found
      const later = list(entry?.later)
      const d = [entry?.exception, later.length > 0 ? `later: ${later.join(', ')}` : undefined, entry?.note]
        .filter((x) => x !== undefined)
        .join(' — ')
      if (d !== '') item.detail = d
    } else {
      const { status, detail } = fromDisposition(entry)
      item.status = status
      if (detail !== undefined) item.detail = detail
      if (hasTargets && entry?.planned === undefined && entry?.['n/a'] === undefined) {
        item.status = 'broken'
        item.problems.push(
          `mapped to missing target(s): ${absent.join('; ')} (add planned: M<n> if not built yet)`,
        )
      }
    }
    if (item.problems.length > 0 && item.status !== 'broken') item.status = 'broken'
    return item
  })
  for (const k of Object.keys(maps.routes)) {
    if (!inv.routes.items.some((r) => r.key === k))
      problems.push(`routes.yaml: ${k} is not a phpMyAdmin route`)
  }

  // --- controls ------------------------------------------------------------------------------
  const claims = scanControlClaims(join(repo, 'apps/web/src'), repo)
  const controlByKey = new Map(inv.controls.items.map((c) => [c.key, c]))
  const claimsByKey = new Map<string, ControlClaim[]>()
  for (const c of claims) {
    if (!controlByKey.has(c.key)) {
      problems.push(
        `${c.at}:${c.line}: claims ${c.key}, which is not a phpMyAdmin control (see tools/parity/inventory/controls.json)`,
      )
      continue
    }
    claimsByKey.set(c.key, [...(claimsByKey.get(c.key) ?? []), c])
  }
  const controlItems: ItemCoverage[] = inv.controls.items.map((c) => {
    const d = lookup(maps.controls, c.key, [c.template])
    const item: ItemCoverage = {
      key: c.key,
      area: areaOf(c.file, rules),
      status: 'missing',
      label: `${c.kind}${c.type !== undefined && c.type !== c.kind ? `[${c.type}]` : ''} ${c.local}${c.label !== undefined && !c.local.includes(c.label) ? ` “${c.label}”` : ''}`,
      source: `${c.template}:${c.line}`,
      targets: [],
      problems: dispProblems(d),
    }
    const cl = claimsByKey.get(c.key) ?? []
    if (cl.length > 0) {
      const errors = cl.map((x) => ({ x, err: verifyClaim(x, c, repo) }))
      const ok = errors.filter((e) => e.err === null)
      item.targets = cl.map((x) => `${x.file} (${x.via === 'registry' ? x.at : 'data-pma'})`)
      if (ok.length > 0) item.status = 'implemented'
      else {
        item.status = 'broken'
        item.problems.push(...errors.map((e) => `${e.x.at}:${e.x.line}: ${e.err}`))
      }
    } else {
      const { status, detail } = fromDisposition(d)
      item.status = status
      if (detail !== undefined) item.detail = detail
    }
    if (item.problems.length > 0) item.status = 'broken'
    return item
  })
  for (const k of Object.keys(maps.controls)) {
    const matches = inv.controls.items.some(
      (c) =>
        c.key === k ||
        c.template === k ||
        ((k.endsWith('/') || k.endsWith('*')) && c.key.startsWith(k.replace(/\*$/, ''))),
    )
    if (!matches) problems.push(`controls.yaml: ${k} matches no phpMyAdmin control or template`)
  }

  // --- directives ----------------------------------------------------------------------------
  const files = sourceFiles(repo).filter((f) => !f.file.startsWith('packages/config/'))
  const chains = collectChains(files)
  const pmaDirectives = inv.directives.items.filter((d) => !d.bma)
  const dirAreas = directiveAreas(
    pmaDirectives.map((d) => d.key),
    repo,
  )
  const directiveItems: ItemCoverage[] = pmaDirectives.map((dir) => {
    const d = lookup(maps.directives, dir.key)
    const uses = directiveUses(dir.key, chains)
    const item: ItemCoverage = {
      key: dir.key,
      area: dirAreas.get(dir.key) ?? 'other',
      status: 'missing',
      label: `${dir.key}${dir.source === 'pma-only' ? ' (not in packages/config schema)' : ''}`,
      source: dir.source === 'pma-only' ? 'phpMyAdmin Settings only' : `packages/config (${dir.type})`,
      targets: uses.slice(0, 5).map((u) => `${u.file}:${u.line}`),
      problems: dispProblems(d),
    }
    if (uses.length > 0) {
      item.status = 'implemented'
      if (d?.exception !== undefined) item.detail = String(d.exception)
    } else {
      const { status, detail } = fromDisposition(d)
      item.status = status
      if (detail !== undefined) item.detail = detail
    }
    if (item.problems.length > 0) item.status = 'broken'
    return item
  })
  for (const k of Object.keys(maps.directives)) {
    const p = k.replace(/\*$/, '')
    const matches = pmaDirectives.some(
      (d) => d.key === k || ((k.endsWith('/') || k.endsWith('*')) && d.key.startsWith(p)),
    )
    if (!matches) problems.push(`directives.yaml: ${k} matches no phpMyAdmin directive`)
  }
  for (const dir of inv.directives.items) {
    if (dir.source === 'pma-only')
      notes.push(`directive ${dir.key} is in phpMyAdmin's Settings but not in packages/config`)
    else if (!dir.inPma && !dir.bma)
      notes.push(
        `directive ${dir.key} is in packages/config (not flagged bma) but not in phpMyAdmin's Settings dump`,
      )
  }

  // --- messages ------------------------------------------------------------------------------
  const msgUses = scanMsgids(sourceFiles(repo), repo)
  const used = new Map<string, string[]>()
  for (const u of msgUses) used.set(u.key, [...(used.get(u.key) ?? []), `${u.file}:${u.line}`])
  const msgMap = maps.messages
  const knownKeys = new Set(inv.messages.items.map((m) => m.key))
  const messageItems: ItemCoverage[] = inv.messages.items.map((m) => {
    const files = effectiveFiles(m.refs)
    const areaCount = new Map<string, number>()
    for (const f of files) {
      const a = areaOf(f, rules)
      areaCount.set(a, (areaCount.get(a) ?? 0) + (a === 'other' ? 0.5 : 1))
    }
    const area =
      [...areaCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'other'
    const mapKey = m.context === null ? m.msgid : `${m.context}|${m.msgid}`
    let d = msgMap.msgids?.[mapKey]
    if (d === undefined && msgMap.sources !== undefined && files.length > 0) {
      const ds = files.map((f) => lookup(msgMap.sources ?? {}, f))
      if (ds.every((x) => x !== undefined)) d = ds[0]
    }
    const uses = used.get(m.key) ?? []
    const item: ItemCoverage = {
      key: m.key,
      area,
      status: 'missing',
      label: m.context === null ? m.msgid : `${m.msgid} (${m.context})`,
      source: files.slice(0, 3).join(', ') + (files.length > 3 ? ` +${files.length - 3}` : ''),
      targets: uses.slice(0, 3),
      problems: dispProblems(d),
    }
    if (uses.length > 0) item.status = 'implemented'
    else {
      const { status, detail } = fromDisposition(d)
      item.status = status
      if (detail !== undefined) item.detail = detail
    }
    if (item.problems.length > 0) item.status = 'broken'
    return item
  })
  for (const k of Object.keys(msgMap.msgids ?? {})) {
    const key = k.includes('|') ? msgKey(k.slice(k.indexOf('|') + 1), k.slice(0, k.indexOf('|'))) : k
    if (!knownKeys.has(key) && !knownKeys.has(k))
      problems.push(`messages.yaml: msgid ${JSON.stringify(k)} is not in phpMyAdmin`)
  }
  const unknownMsgids = [...used.keys()].filter((k) => !knownKeys.has(k)).sort()

  // --- checklist -----------------------------------------------------------------------------
  const tests = scanTests(repo)
  const { items: checklist } = readChecklist(repo)
  const links = linkChecklist(checklist, tests)
  const results = opts.results ?? null
  const checklistItems: ItemCoverage[] = checklist.map((c) => {
    const linked = links.get(c.id) ?? []
    const item: ItemCoverage = {
      key: c.id,
      area: c.area,
      status: 'missing',
      label: c.text,
      source: `${c.file}:${c.line}`,
      targets: linked.map((t) => `${t.file}:${t.line} › ${t.fullTitle}`),
      problems: [],
    }
    if (c.na !== undefined) {
      item.status = 'n/a'
      item.detail = c.na
    } else if (linked.length === 0) {
      if (c.checked) {
        item.status = 'broken'
        item.problems.push(
          `${c.file}:${c.line} is ticked but no test links to it (title must contain ${c.id} or the item text)`,
        )
      }
    } else if (results !== null) {
      // a skipped test is no evidence either way
      const rs = linked
        .map((t) => resultFor(t, results))
        .map((r) => (r?.status === 'skipped' ? undefined : r))
      if (rs.some((r) => r?.status === 'failed')) item.status = 'failing'
      else if (rs.some((r) => r?.status === 'passed')) item.status = 'implemented'
      // no result for any linked test (its suite was not run): the doc marker stands
      else if (rs.every((r) => r === undefined) && c.checked) item.status = 'implemented'
      else item.status = 'untested'
    } else {
      item.status = c.checked ? 'implemented' : 'untested'
    }
    return item
  })

  // problems attached to items are global problems too
  const all = [routeItems, controlItems, directiveItems, messageItems, checklistItems]
  for (const items of all)
    for (const it of items) for (const p of it.problems) problems.push(`${it.key}: ${p}`)

  return {
    referenceCommit: inv.routes._meta.referenceCommit,
    kinds: {
      routes: finish('routes', routeItems),
      controls: finish('controls', controlItems),
      directives: finish('directives', directiveItems),
      messages: finish('messages', messageItems),
      checklist: finish('checklist', checklistItems),
    },
    problems,
    notes,
    scans: { endpoints, spaRoutes, claims, tests, checklist, unknownMsgids },
  }
}

const JS_MESSAGES = 'src/Controllers/JavaScriptMessagesController.php'

/**
 * Source files that really use a msgid: JavaScriptMessagesController only relays strings to the JS
 * code (window.Messages), so when a JS file uses the message the controller is not counted.
 */
export function effectiveFiles(refs: string[]): string[] {
  const files = [...new Set(refs.map((r) => r.replace(/:\d+$/, '')))]
  const real = files.filter((f) => f !== JS_MESSAGES)
  return real.length > 0 ? real : files
}

const stripMd = (s: string) => s.replace(/`/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()

/** Tests linked to each checklist item: full title contains the id or the item's exact text. */
export function linkChecklist(items: ChecklistItem[], tests: TestCase[]): Map<string, TestCase[]> {
  const out = new Map<string, TestCase[]>()
  const titles = tests.map((t) => ({ t, raw: t.fullTitle, plain: stripMd(t.fullTitle) }))
  for (const it of items) {
    const text = it.text.trim()
    const plain = stripMd(text)
    const hits = titles
      .filter(
        ({ raw, plain: p }) =>
          new RegExp(`\\b${it.id}\\b`).test(raw) ||
          (text.length >= 12 && (raw.includes(text) || p.includes(plain))),
      )
      .map(({ t }) => t)
    if (hits.length > 0) out.set(it.id, hits)
  }
  return out
}

/** Result of a statically found test; titles with `${…}` substitutions match any concrete title. */
export function resultFor(t: TestCase, results: TestResult[]): TestResult | undefined {
  const same = results.filter((r) => r.file === t.file)
  const exact = same.find((r) => r.fullTitle === t.fullTitle)
  if (exact !== undefined || !t.fullTitle.includes('…')) return exact
  const re = new RegExp(
    `^${t.fullTitle
      .split('…')
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  )
  const matching = same.filter((r) => re.test(r.fullTitle))
  if (matching.length === 0) return undefined
  return matching.find((r) => r.status === 'failed') ?? matching[0]
}
