/**
 * Mapping files under tools/parity/map/: how each phpMyAdmin item is (or is not) covered by us.
 *
 * Every entry may carry one disposition:
 *   planned: M<n>        not built yet; lands in milestone M<n> (docs/architecture/13)
 *   exception: X<n>|Q<n> intentional difference registered in docs/reference/parity-exceptions.md
 *   n/a: <reason>        nothing to build (PHP-specific, removed upstream, …)
 * and, for directives read under a computed name (export plugin options `${format}_columns`,
 * transformation option lists), the files that hold the name:
 *   via: <file|dir> | [<file|dir>, …]  the directive's last path segment must occur there as a quoted
 *                        string (verified; a prefix key applies to every directive under it)
 * and, for routes, the targets that implement it:
 *   api: 'METHOD /api/…' | ['…']    Hono endpoints (method optional)
 *   ui:  '/s/:s/…' | ['…']          SPA routes
 *   later: […]                      targets still to build (an implemented route can be partial)
 * Targets are verified against the code. A route whose targets all exist is implemented; a route
 * with a missing target must say `planned` (the targets are then the intended ones) or the gate fails.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAP_DIR, REPO, readYaml } from './util.ts'

export interface Disposition {
  planned?: string
  exception?: string
  'n/a'?: string
  note?: string
}

export interface RouteMapEntry extends Disposition {
  api?: string | string[]
  ui?: string | string[]
  /** Further targets the route needs that are not built yet (not verified; shown as pending). */
  later?: string | string[]
}

export type RouteMap = Record<string, RouteMapEntry>
/** Keys: directive path, or a prefix ending in `/` or `*`. */
export type DirectiveMap = Record<string, Disposition & { via?: string | string[] }>
/** Keys: control key, template name, or template directory prefix ending in `/`. */
export type ControlMap = Record<string, Disposition>
export interface MessageMap {
  /** pma source path prefixes: a msgid all of whose uses are under such prefixes takes the disposition. */
  sources?: Record<string, Disposition>
  /** individual msgid keys (`context\u0004msgid` written as `context|msgid`). */
  msgids?: Record<string, Disposition>
}

/** Keys: item key (`js:table/structure.ts#click:…`), a script (`js:table/structure.ts`) or a prefix ending in `/` or `*`. */
export type JsMap = Record<string, Disposition>

export interface Maps {
  routes: RouteMap
  directives: DirectiveMap
  controls: ControlMap
  messages: MessageMap
  js: JsMap
}

export function loadMaps(dir = MAP_DIR): Maps {
  return {
    routes: readYaml<RouteMap>(join(dir, 'routes.yaml'), {}),
    directives: readYaml<DirectiveMap>(join(dir, 'directives.yaml'), {}),
    controls: readYaml<ControlMap>(join(dir, 'controls.yaml'), {}),
    messages: readYaml<MessageMap>(join(dir, 'messages.yaml'), {}),
    js: readYaml<JsMap>(join(dir, 'js.yaml'), {}),
  }
}

export const list = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v]

/** Ids registered in parity-exceptions.md (`X1`…, `Q1`…). */
export function loadExceptionIds(repo = REPO): Set<string> {
  const text = readFileSync(join(repo, 'docs/reference/parity-exceptions.md'), 'utf8')
  return new Set([...text.matchAll(/^\|\s*([XQ]\d+)\s*\|/gm)].map((m) => m[1]!))
}

/** Milestones from the roadmap headings (`## M1: …`). */
export function loadMilestones(repo = REPO): Set<string> {
  const text = readFileSync(join(repo, 'docs/architecture/13-roadmap-and-milestones.md'), 'utf8')
  return new Set([...text.matchAll(/^##\s+(M\d+)\b/gm)].map((m) => m[1]!))
}

/** Problems with a disposition itself (unknown exception id or milestone, conflicting keys). */
export function dispositionProblems(
  d: Disposition,
  exceptions: Set<string>,
  milestones: Set<string>,
): string[] {
  const out: string[] = []
  const set = (['planned', 'exception', 'n/a'] as const).filter((k) => d[k] !== undefined)
  if (set.includes('n/a') && set.length > 1)
    out.push(`n/a cannot be combined with ${set.filter((s) => s !== 'n/a').join(', ')}`)
  if (d.exception !== undefined) {
    for (const id of String(d.exception)
      .split(/[\s,]+/)
      .filter((s) => s !== '')) {
      if (!exceptions.has(id)) out.push(`exception ${id} is not in docs/reference/parity-exceptions.md`)
    }
  }
  if (d.planned !== undefined && !milestones.has(String(d.planned))) {
    out.push(`planned milestone ${d.planned} is not in docs/architecture/13-roadmap-and-milestones.md`)
  }
  if (d['n/a'] !== undefined && String(d['n/a']).trim() === '') out.push('n/a needs a reason')
  return out
}

/** Disposition for `key` from a prefix-capable map: exact key, then the longest matching prefix. */
export function lookup(
  map: Record<string, Disposition>,
  key: string,
  prefixes: string[] = [],
): Disposition | undefined {
  if (map[key] !== undefined) return map[key]
  let best: string | null = null
  for (const k of Object.keys(map)) {
    const isPrefix = k.endsWith('/') || k.endsWith('*')
    const p = k.endsWith('*') ? k.slice(0, -1) : k
    const hit = (isPrefix && key.startsWith(p)) || prefixes.includes(k)
    if (hit && (best === null || k.length > best.length)) best = k
  }
  return best === null ? undefined : map[best]
}
