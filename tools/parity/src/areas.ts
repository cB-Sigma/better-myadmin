import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MAP_DIR, REPO, readYaml } from './util.ts'

export interface Area {
  /** `01`…`09`, or `other`. */
  id: string
  title: string
  /** docs/features/NN-*.md, repo-relative. */
  doc: string | null
}

/** The feature areas: one per docs/features/NN-*.md, plus `other`. */
export function loadAreas(repo = REPO): Area[] {
  const dir = join(repo, 'docs/features')
  const areas: Area[] = []
  for (const name of readdirSync(dir).sort()) {
    const m = /^(\d\d)-(.+)\.md$/.exec(name)
    if (m === null) continue
    areas.push({ id: m[1]!, title: m[2]!.replace(/-/g, ' '), doc: `docs/features/${name}` })
  }
  areas.push({ id: 'other', title: 'cross-cutting / not a feature', doc: null })
  return areas
}

export interface AreaRules {
  default: string
  milestones?: Record<string, string>
  rules: Record<string, string>
}

let cached: AreaRules | null = null

export function loadAreaRules(file = join(MAP_DIR, 'areas.yaml')): AreaRules {
  if (cached !== null && file === join(MAP_DIR, 'areas.yaml')) return cached
  const r = readYaml<AreaRules>(file, { default: 'other', rules: {} })
  if (file === join(MAP_DIR, 'areas.yaml')) cached = r
  return r
}

/** Area of a phpMyAdmin source path (repo-relative to the pma root): longest matching prefix wins. */
export function areaOf(path: string, rules: AreaRules): string {
  let best = ''
  let area = rules.default
  for (const [prefix, a] of Object.entries(rules.rules)) {
    if (path.startsWith(prefix) && prefix.length > best.length) {
      best = prefix
      area = String(a)
    }
  }
  return area
}
