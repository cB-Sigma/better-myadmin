import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import type { Control, ControlKind } from './capture.ts'

/**
 * Diff of two control lists (phpMyAdmin vs BetterMyAdmin) under a mapping of intentional differences
 * (tests/ui-parity/maps/<page>.yaml). Every difference the mapping does not account for is reported.
 */

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')
export const MAPS_DIR = join(repo, 'tests/ui-parity/maps')

/** Fields compared on matched controls. */
export const FIELDS = [
  'kind',
  'label',
  'name',
  'type',
  'value',
  'options',
  'checked',
  'disabled',
  'required',
  'readonly',
  'section',
] as const
export type Field = (typeof FIELDS)[number] | 'order'

/** Picks controls. `label`/`name`/`section` match exactly, or as a regex when written `/…/flags`. */
export interface Selector {
  kind?: ControlKind
  label?: string
  name?: string
  section?: string
  /** only in this interaction step (`initial` = after load) */
  step?: string
}

export interface MapRule {
  /** phpMyAdmin control(s) */
  pma?: Selector
  /** our control(s) */
  ours?: Selector
  /** both sides (for `ignore`) */
  match?: Selector
  /** parity-exception id (docs/reference/parity-exceptions.md): required when a label differs */
  exception?: string
  /** phpMyAdmin has it, we deliberately do not */
  'n/a'?: string
  /** we add it on purpose */
  added?: string
  /** fields whose differences are accepted on the matched controls */
  ignore?: Field[]
  reason?: string
  /** set by loadMap for rules of _global.yaml (not reported as stale) */
  global?: boolean
}

/** A text substitution applied to our labels, sections and option labels before comparing. */
export interface Replace {
  ours: string
  pma: string
  exception: string
}

export interface PageMap {
  /** global only (maps/_global.yaml): substitutions such as the product name (X33) */
  replace?: Replace[]
  /** phpMyAdmin section name → ours */
  sections?: Record<string, string>
  /** sections (ours names) whose control order is not compared; `true` for all */
  ignoreOrder?: string[] | true
  rules?: MapRule[]
}

export type DiffType = 'missing' | 'extra' | 'field' | 'order'

export interface Difference {
  type: DiffType
  /** `kind "label"` of the control (pma side when both) */
  control: string
  section: string
  field?: Field
  pma?: unknown
  ours?: unknown
  message: string
}

export interface DiffResult {
  differences: Difference[]
  /** accepted by the built-in rules (not failures), shown in the report */
  notes: string[]
  /** rules that matched nothing (stale entries) and other notes */
  warnings: string[]
  /** matched pairs (for reports) */
  pairs: Array<{ pma: Control; ours: Control }>
}

// ---------------------------------------------------------------------------

function readMap(f: string): PageMap {
  if (!existsSync(f)) return {}
  return (YAML.parse(readFileSync(f, 'utf8')) as PageMap | null) ?? {}
}

/** The page's map merged with maps/_global.yaml (global rules apply to every page). */
export function loadMap(page: string, dir = MAPS_DIR): PageMap {
  const g = readMap(join(dir, '_global.yaml'))
  const m = readMap(join(dir, `${page}.yaml`))
  return {
    replace: [...(g.replace ?? []), ...(m.replace ?? [])],
    sections: { ...g.sections, ...m.sections },
    ...(m.ignoreOrder !== undefined ? { ignoreOrder: m.ignoreOrder } : {}),
    rules: [...(m.rules ?? []), ...(g.rules ?? []).map((r) => ({ ...r, global: true }))],
  }
}

/** Exception ids registered in docs/reference/parity-exceptions.md. */
export function exceptionIds(): Set<string> {
  const f = join(repo, 'docs/reference/parity-exceptions.md')
  if (!existsSync(f)) return new Set()
  return new Set([...readFileSync(f, 'utf8').matchAll(/^\|\s*([XQ]\d+)\s*\|/gm)].map((m) => m[1]!))
}

/** Problems with the map itself (thrown before diffing: a bad map is a test error). */
export function validateMap(map: PageMap, known: Set<string> = exceptionIds()): string[] {
  const out: string[] = []
  for (const r of map.replace ?? []) {
    if (!known.has(r.exception)) out.push(`replace ${r.ours}: exception ${r.exception} is not registered`)
  }
  ;(map.rules ?? []).forEach((r, i) => {
    const at = `rule ${i + 1}`
    const sides = [r.pma, r.ours, r.match].filter((s) => s !== undefined).length
    if (sides === 0) out.push(`${at}: needs pma, ours or match`)
    if (r.match !== undefined && (r.pma !== undefined || r.ours !== undefined))
      out.push(`${at}: match cannot be combined with pma/ours`)
    if (r['n/a'] !== undefined && (r.ours !== undefined || r.pma === undefined))
      out.push(`${at}: n/a takes a pma selector only`)
    if (r.added !== undefined && (r.pma !== undefined || r.ours === undefined))
      out.push(`${at}: added takes an ours selector only`)
    if (
      r.exception === undefined &&
      r.reason === undefined &&
      r['n/a'] === undefined &&
      r.added === undefined
    )
      out.push(`${at}: give an exception id or a reason`)
    if (r.exception !== undefined) {
      for (const id of String(r.exception)
        .split(/[\s,]+/)
        .filter(Boolean))
        if (!known.has(id)) out.push(`${at}: exception ${id} is not in docs/reference/parity-exceptions.md`)
    }
    if (
      r.pma !== undefined &&
      r.ours !== undefined &&
      r.pma.label !== undefined &&
      r.ours.label !== undefined &&
      r.pma.label !== r.ours.label &&
      r.exception === undefined
    )
      out.push(`${at}: a label rename needs a parity-exception id`)
    for (const f of r.ignore ?? [])
      if (!(FIELDS as readonly string[]).includes(f) && f !== 'order') out.push(`${at}: unknown field ${f}`)
  })
  return out
}

const textMatch = (pattern: string | undefined, actual: string | undefined): boolean => {
  if (pattern === undefined) return true
  const m = /^\/(.*)\/([a-z]*)$/s.exec(pattern)
  if (m !== null) return new RegExp(m[1]!, m[2]).test(actual ?? '')
  return pattern === (actual ?? '')
}

export function selects(sel: Selector | undefined, c: Control, step: string, section = c.section): boolean {
  if (sel === undefined) return false
  if (sel.step !== undefined && sel.step !== step) return false
  if (sel.kind !== undefined && sel.kind !== c.kind) return false
  return textMatch(sel.label, c.label) && textMatch(sel.name, c.name) && textMatch(sel.section, section)
}

/** Links and buttons are matched with each other (a kind difference is a note, not a failure). */
const group = (c: Control) =>
  c.type === 'editor' ? 'editor' : c.kind === 'link' || c.kind === 'button' ? 'action' : c.kind

/** Identity used to match controls across the apps. */
export const identity = (c: Control) =>
  c.type === 'editor' ? 'editor' : `${group(c)}:${c.label !== '' ? c.label : `@${c.name ?? c.id ?? ''}`}`

/** Built-in tolerances: differences that do not show in the UI or are improvements. */
function builtIn(f: Field, a: unknown, b: unknown, p: Control, o: Control): string | null {
  if (f === 'kind' && group(p) === group(o))
    return `${describe(p)}: ${String(a)} in phpMyAdmin, ${String(b)} in ours`
  // element type of an action (<input type=submit> vs <button>) does not show
  if (f === 'type' && p.kind !== 'textbox') return 'skip'
  // name attributes only matter to phpMyAdmin's form posts; our forms do not post (matching still uses them)
  if (f === 'name') return 'skip'
  // form-post values of checkboxes/radios (`1` vs `on`) are not visible in a SPA
  if (f === 'value' && (p.kind === 'checkbox' || p.kind === 'radio')) return 'skip'
  if (f === 'label' && a === '' && b !== '')
    return `${describe(o)}: accessible name added (phpMyAdmin has none)`
  return null
}

function applyReplace(cs: Control[], rs: Replace[]): Control[] {
  if (rs.length === 0) return cs
  const sub = (s: string) => rs.reduce((t, r) => t.split(r.ours).join(r.pma), s)
  return cs.map((c) => ({
    ...c,
    label: sub(c.label),
    section: sub(c.section),
    ...(c.value !== undefined ? { value: sub(c.value) } : {}),
    ...(c.options !== undefined ? { options: c.options.map((o) => ({ ...o, label: sub(o.label) })) } : {}),
  }))
}
const describe = (c: Control) => `${c.kind} "${c.label !== '' ? c.label : `[name=${c.name ?? c.id ?? '?'}]`}"`

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Longest increasing subsequence (indices into `xs`) for order checks. */
function lis(xs: number[]): Set<number> {
  const n = xs.length
  const len = new Array<number>(n).fill(1)
  const prev = new Array<number>(n).fill(-1)
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i; j++)
      if (xs[j]! < xs[i]! && len[j]! + 1 > len[i]!) {
        len[i] = len[j]! + 1
        prev[i] = j
      }
  let best = -1
  for (let i = 0; i < n; i++) if (best === -1 || len[i]! > len[best]!) best = i
  const out = new Set<number>()
  for (let i = best; i !== -1; i = prev[i]!) out.add(i)
  return out
}

export function diffControls(
  pma: Control[],
  oursRaw: Control[],
  map: PageMap = {},
  step = 'initial',
): DiffResult {
  const ours = applyReplace(oursRaw, map.replace ?? [])
  const differences: Difference[] = []
  const warnings: string[] = []
  const notes: string[] = []
  const rules = map.rules ?? []
  const used = new Set<number>()
  const secOf = (c: Control) => map.sections?.[c.section] ?? c.section
  const pairs: Array<{ pma: Control; ours: Control; rule?: MapRule }> = []
  const pmaLeft = new Set(pma)
  const oursLeft = new Set(ours)

  // 1. explicit equivalences (rules with both sides), in order of appearance
  rules.forEach((r, i) => {
    if (r.pma === undefined || r.ours === undefined) return
    const ps = [...pmaLeft].filter((c) => selects(r.pma, c, step))
    const os = [...oursLeft].filter((c) => selects(r.ours, c, step))
    const n = Math.min(ps.length, os.length)
    for (let k = 0; k < n; k++) {
      pairs.push({ pma: ps[k]!, ours: os[k]!, rule: r })
      pmaLeft.delete(ps[k]!)
      oursLeft.delete(os[k]!)
    }
    if (n > 0) used.add(i)
  })

  // 2. same identity (links and buttons alike), within the same section first, then anywhere (a
  // moved control is a section difference). Equal counts pair in DOM order (the k-th "Drop" with the
  // k-th); otherwise controls of the exact same kind pair first.
  for (const sameSection of [true, false]) {
    const key = (c: Control, sec: string) => `${sameSection ? sec : ''}\u0000${identity(c)}`
    const ob = new Map<string, Control[]>()
    for (const c of ours)
      if (oursLeft.has(c)) ob.set(key(c, c.section), [...(ob.get(key(c, c.section)) ?? []), c])
    const pb = new Map<string, Control[]>()
    for (const c of pma)
      if (pmaLeft.has(c)) pb.set(key(c, secOf(c)), [...(pb.get(key(c, secOf(c))) ?? []), c])
    for (const [k, ps] of pb) {
      const os = ob.get(k) ?? []
      const take = (p: Control, o: Control) => {
        pairs.push({ pma: p, ours: o })
        pmaLeft.delete(p)
        oursLeft.delete(o)
        os.splice(os.indexOf(o), 1)
      }
      if (ps.length !== os.length) {
        for (const p of ps) {
          const o = os.find((x) => x.kind === p.kind)
          if (o !== undefined) take(p, o)
        }
      }
      for (const p of ps) {
        if (!pmaLeft.has(p)) continue
        const o = os[0]
        if (o !== undefined) take(p, o)
      }
    }
  }
  // 3. same kind and name (a relabelled field), else same id (phpMyAdmin's unlabelled icon links):
  // a label difference rather than missing + extra
  for (const p of [...pmaLeft]) {
    const ident = (c: Control) => c.name ?? c.id
    if (ident(p) === undefined) continue
    const o = [...oursLeft].find((c) => group(c) === group(p) && ident(c) === ident(p))
    if (o === undefined) continue
    pairs.push({ pma: p, ours: o })
    pmaLeft.delete(p)
    oursLeft.delete(o)
  }

  // 4. a control phpMyAdmin leaves unlabelled: the only unmatched one of its kind in the section
  for (const p of [...pmaLeft]) {
    if (p.label !== '') continue
    const os = [...oursLeft].filter((c) => group(c) === group(p) && c.section === secOf(p))
    const ps = [...pmaLeft].filter((c) => group(c) === group(p) && secOf(c) === secOf(p))
    if (os.length !== 1 || ps.length !== 1) continue
    pairs.push({ pma: p, ours: os[0]! })
    pmaLeft.delete(p)
    oursLeft.delete(os[0]!)
  }

  const ignored = (pair: { pma: Control; ours: Control; rule?: MapRule }, f: Field): boolean => {
    if (pair.rule?.ignore?.includes(f)) return true
    // an equivalence rule accounts for the label/kind change it names
    if (pair.rule !== undefined && (f === 'label' || f === 'kind')) return true
    return rules.some((r, i) => {
      if (r.match === undefined || !r.ignore?.includes(f)) return false
      const hit = selects(r.match, pair.pma, step, secOf(pair.pma)) || selects(r.match, pair.ours, step)
      if (hit) used.add(i)
      return hit
    })
  }

  // field differences
  for (const pair of pairs) {
    for (const f of FIELDS) {
      const a = f === 'section' ? secOf(pair.pma) : pair.pma[f]
      const b = pair.ours[f]
      if (same(a, b) || ignored(pair, f)) continue
      const tolerated = builtIn(f, a, b, pair.pma, pair.ours)
      if (tolerated !== null) {
        if (tolerated !== 'skip') notes.push(tolerated)
        continue
      }
      differences.push({
        type: 'field',
        control: describe(pair.pma),
        section: secOf(pair.pma),
        field: f,
        pma: a,
        ours: b,
        message: `${describe(pair.pma)} in "${secOf(pair.pma)}": ${f} differs (pma ${JSON.stringify(a)}, ours ${JSON.stringify(b)})`,
      })
    }
  }

  // missing / extra
  for (const p of pma) {
    if (!pmaLeft.has(p)) continue
    const i = rules.findIndex((r) => r['n/a'] !== undefined && selects(r.pma, p, step, secOf(p)))
    if (i >= 0) {
      used.add(i)
      continue
    }
    differences.push({
      type: 'missing',
      control: describe(p),
      section: secOf(p),
      pma: p,
      message: `missing: ${describe(p)} in "${secOf(p)}"${p.name !== undefined ? ` (name=${p.name})` : ''}`,
    })
  }
  for (const o of ours) {
    if (!oursLeft.has(o)) continue
    const i = rules.findIndex((r) => r.added !== undefined && selects(r.ours, o, step))
    if (i >= 0) {
      used.add(i)
      continue
    }
    differences.push({
      type: 'extra',
      control: describe(o),
      section: o.section,
      ours: o,
      message: `extra: ${describe(o)} in "${o.section}"${o.name !== undefined ? ` (name=${o.name})` : ''}`,
    })
  }

  // order within each section (sections compared by our name; pairs in a different section are
  // already reported as a section difference)
  const bySection = new Map<string, typeof pairs>()
  for (const pair of pairs) {
    if (secOf(pair.pma) !== pair.ours.section) continue
    const s = pair.ours.section
    bySection.set(s, [...(bySection.get(s) ?? []), pair])
  }
  for (const [s, ps] of bySection) {
    if (map.ignoreOrder === true || map.ignoreOrder?.includes(s)) continue
    const sorted = [...ps].sort((a, b) => a.pma.index - b.pma.index)
    const keep = lis(sorted.map((p) => p.ours.index))
    sorted.forEach((pair, i) => {
      if (keep.has(i) || ignored(pair, 'order')) return
      differences.push({
        type: 'order',
        control: describe(pair.pma),
        section: s,
        field: 'order',
        pma: pair.pma.index,
        ours: pair.ours.index,
        message: `order: ${describe(pair.pma)} in "${s}" is #${pair.pma.index + 1} in phpMyAdmin, #${pair.ours.index + 1} in ours`,
      })
    })
  }

  rules.forEach((r, i) => {
    const restricted = [r.pma, r.ours, r.match].some((s) => s?.step !== undefined && s.step !== step)
    if (!used.has(i) && !restricted && r.global !== true)
      warnings.push(`map rule ${i + 1} matched nothing in step "${step}"`)
  })
  return { differences, warnings, notes, pairs: pairs.map(({ pma: p, ours: o }) => ({ pma: p, ours: o })) }
}

/** Report text; the same field difference on many controls (e.g. a section rename) is listed once. */
export function formatDiff(page: string, step: string, r: DiffResult): string {
  const lines: string[] = []
  if (r.differences.length === 0) lines.push(`${page} [${step}]: no differences`)
  else {
    lines.push(
      `${page} [${step}]: ${r.differences.length} unmapped difference(s) — fix them or map them in tests/ui-parity/maps/${page}.yaml`,
    )
    const groups = new Map<string, Difference[]>()
    for (const d of r.differences) {
      const k =
        d.type === 'field'
          ? `${d.field}|${JSON.stringify(d.pma)}|${JSON.stringify(d.ours)}`
          : `${d.type}|${d.message}`
      groups.set(k, [...(groups.get(k) ?? []), d])
    }
    const perType = new Map<DiffType, number>()
    for (const ds of groups.values()) {
      const d = ds[0]!
      const n = (perType.get(d.type) ?? 0) + 1
      perType.set(d.type, n)
      if (n === 41) lines.push(`  - … more ${d.type} differences (see result.json)`)
      if (n > 40) continue
      if (ds.length === 1) lines.push(`  - ${d.message}`)
      else if (d.type === 'field')
        lines.push(
          `  - ${d.field} differs on ${ds.length} controls (pma ${JSON.stringify(d.pma)}, ours ${JSON.stringify(d.ours)}): ${ds
            .slice(0, 4)
            .map((x) => x.control)
            .join(', ')}${ds.length > 4 ? ', …' : ''}`,
        )
      else lines.push(`  - ${ds.length}× ${d.message}`)
    }
  }
  const notes = [...new Set(r.notes)]
  if (notes.length > 0)
    lines.push(
      `  notes (accepted): ${notes.slice(0, 8).join('; ')}${notes.length > 8 ? `; … ${notes.length - 8} more` : ''}`,
    )
  return lines.join('\n')
}
