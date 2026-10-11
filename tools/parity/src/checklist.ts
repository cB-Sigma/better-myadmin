/**
 * Checklist items of docs/features/*.md (`- [ ]` / `- [x]` lines), their stable ids, and the
 * marker rewrite done by `pnpm parity:report`.
 *
 * Ids live in tools/parity/map/checklist-ids.json (id → file, section, text). An id is minted once,
 * from a hash of file + section + text, and then kept: an item whose text or section is edited keeps
 * its id when it can still be matched (same text elsewhere in the file, or similar text: see similarity()).
 *
 * The rewrite only touches the marker and a suffix ` <!-- parity:test --> …` that names the
 * linked test; the item text is never changed.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAP_DIR, REPO, readJson, sha1, walk, writeJson } from './util.ts'

export interface ChecklistItem {
  id: string
  /** repo-relative doc path */
  file: string
  area: string
  /** `H2 › H3 › group label` */
  section: string
  text: string
  /** 1-based line in the doc */
  line: number
  checked: boolean
  /** Reason when the item carries `<!-- parity:n/a: reason -->` (nothing to build). */
  na?: string
}

export interface ChecklistIdEntry {
  file: string
  section: string
  text: string
}

export type ChecklistIds = Record<string, ChecklistIdEntry>

export const CHECKLIST_IDS_FILE = join(MAP_DIR, 'checklist-ids.json')
export const SUFFIX_MARK = '<!-- parity:test -->'
const ITEM_RE = /^(\s*[-*] \[)([ xX])(\] )(.*)$/
const ID_RE = /\bp(\d\d)-([0-9a-f]{6,})\b/g

/** Id pattern used in test titles: `p01-3f9a2c`. */
export function idPattern(): RegExp {
  return new RegExp(ID_RE.source, 'g')
}

function stripSuffix(text: string): string {
  const i = text.indexOf(SUFFIX_MARK)
  return (i < 0 ? text : text.slice(0, i)).replace(NA_RE, '').trimEnd()
}

export interface ParsedItem {
  file: string
  area: string
  section: string
  text: string
  line: number
  checked: boolean
  na?: string
}

const NA_RE = /<!--\s*parity:n\/a:?\s*(.*?)\s*-->/

/** Every checklist item of one doc. */
export function parseChecklist(file: string, source: string): ParsedItem[] {
  const area = /(\d\d)-[^/]*\.md$/.exec(file)?.[1] ?? 'other'
  const items: ParsedItem[] = []
  let h2 = ''
  let h3 = ''
  let group = ''
  let fence = false
  const lines = source.split('\n')
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence
    if (fence) return
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h !== null) {
      const level = h[1]!.length
      if (level <= 2) {
        h2 = h[2]!.trim()
        h3 = ''
      } else h3 = h[2]!.trim()
      group = ''
      return
    }
    const m = ITEM_RE.exec(line)
    if (m !== null) {
      const na = NA_RE.exec(m[4]!)?.[1]
      items.push({
        file,
        area,
        section: [h2, h3, group].filter((s) => s !== '').join(' › '),
        text: stripSuffix(m[4]!),
        line: i + 1,
        checked: m[2] !== ' ',
        ...(na !== undefined ? { na: na === '' ? 'n/a' : na } : {}),
      })
      return
    }
    const t = line.trim()
    // a plain line introducing a run of items ("Navigation panel") is a group label
    if (t !== '' && !/^[-*|>]/.test(t) && ITEM_RE.test(lines[i + 1] ?? ''))
      group = t.replace(/[:*]+$/g, '').trim()
  })
  return items
}

export function featureDocs(repo = REPO): string[] {
  return walk(join(repo, 'docs/features'), (r) => /^\d\d-.*\.md$/.test(r)).map((r) => `docs/features/${r}`)
}

/**
 * How likely `b` is an edit of `a`: the mean of the Levenshtein ratio and the word overlap
 * coefficient (|A ∩ B| / min(|A|, |B|)), so that appending a clause keeps a high score.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])
  const wa = words(a)
  const wb = words(b)
  const common = [...wa].filter((w) => wb.has(w)).length
  const overlap = Math.min(wa.size, wb.size) === 0 ? 0 : common / Math.min(wa.size, wb.size)
  return (levenshteinRatio(a, b) + overlap) / 2
}

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1
  const m = a.length
  const n = b.length
  if (m === 0 || n === 0) return 0
  let prev = Array.from({ length: n + 1 }, (_v, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return 1 - prev[n]! / Math.max(m, n)
}

export function mintId(
  item: Pick<ParsedItem, 'file' | 'section' | 'text' | 'area'>,
  taken: Set<string>,
): string {
  const h = sha1(`${item.file}\n${item.section}\n${item.text}`)
  for (let len = 6; len <= 40; len++) {
    const id = `p${item.area === 'other' ? '00' : item.area}-${h.slice(0, len)}`
    if (!taken.has(id)) return id
  }
  throw new Error('id collision')
}

/**
 * Assigns ids to parsed items, reusing `known` ids where possible. Returns the items and the
 * updated id map (removed items dropped, edited ones updated).
 */
export function assignIds(
  parsed: ParsedItem[],
  known: ChecklistIds,
): { items: ChecklistItem[]; ids: ChecklistIds; minted: string[]; removed: string[] } {
  const result: (ChecklistItem | null)[] = parsed.map(() => null)
  const free = new Map(Object.entries(known))
  const taken = new Set(Object.keys(known))
  const assign = (i: number, id: string) => {
    result[i] = { id, ...parsed[i]! }
    free.delete(id)
  }
  // 1. exact file+section+text, 2. exact file+text
  for (const pass of [true, false]) {
    parsed.forEach((p, i) => {
      if (result[i] !== null) return
      for (const [id, e] of free) {
        if (e.file === p.file && e.text === p.text && (!pass || e.section === p.section)) {
          assign(i, id)
          return
        }
      }
    })
  }
  // 3. similar text in the same file
  parsed.forEach((p, i) => {
    if (result[i] !== null) return
    let best: string | null = null
    let score = 0.8
    for (const [id, e] of free) {
      if (e.file !== p.file) continue
      const s = similarity(e.text, p.text)
      if (s >= score) {
        score = s
        best = id
      }
    }
    if (best !== null) assign(i, best)
  })
  // 4. new ids
  const minted: string[] = []
  parsed.forEach((p, i) => {
    if (result[i] !== null) return
    const id = mintId(p, taken)
    taken.add(id)
    minted.push(id)
    assign(i, id)
  })
  const items = result as ChecklistItem[]
  const ids: ChecklistIds = {}
  for (const it of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    ids[it.id] = { file: it.file, section: it.section, text: it.text }
  }
  return { items, ids, minted, removed: [...free.keys()] }
}

export function loadChecklistIds(file = CHECKLIST_IDS_FILE): ChecklistIds {
  try {
    return readJson<ChecklistIds>(file)
  } catch {
    return {}
  }
}

export function saveChecklistIds(ids: ChecklistIds, file = CHECKLIST_IDS_FILE): void {
  writeJson(file, ids)
}

/** Parses every feature doc and assigns ids (without writing anything). */
export function readChecklist(repo = REPO, known = loadChecklistIds()) {
  const parsed = featureDocs(repo).flatMap((f) => parseChecklist(f, readFileSync(join(repo, f), 'utf8')))
  return assignIds(parsed, known)
}

/**
 * Rewrites the checklist markers of one doc: `- [x]` + suffix for items in `links`,
 * `- [ ]` without suffix for the others. Returns the new source.
 */
export function rewriteChecklist(
  source: string,
  file: string,
  items: ChecklistItem[],
  links: Map<string, string>,
) {
  const byLine = new Map(items.filter((i) => i.file === file).map((i) => [i.line, i]))
  const lines = source.split('\n')
  return lines
    .map((line, i) => {
      const item = byLine.get(i + 1)
      const m = ITEM_RE.exec(line)
      if (item === undefined || m === null || item.na !== undefined) return line
      const body = stripSuffix(m[4]!)
      const ref = links.get(item.id)
      return ref === undefined ? `${m[1]} ${m[3]}${body}` : `${m[1]}x${m[3]}${body} ${SUFFIX_MARK} ${ref}`
    })
    .join('\n')
}
