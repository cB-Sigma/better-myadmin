import { fuzzyRank, normalizeQuery } from './fuzzy.ts'
import type { PaletteCommand } from './registry.ts'

/** A palette row: a command, optionally with the texts it is matched against (default: label + keywords). */
export interface PaletteEntry extends PaletteCommand {
  /** texts matched against the query; the first is highlighted (default `[label, ...keywords]`) */
  match?: string[] | undefined
}

export interface PaletteRow {
  entry: PaletteEntry
  /** matched character positions in the label */
  positions: number[]
}

export interface PaletteGroup {
  heading: string
  rows: PaletteRow[]
}

/**
 * Ranks the entries against the query and groups them under their headings. With an empty query
 * every entry is kept, groups in order of first appearance; with a query only the matching entries
 * are kept, best first, and the group holding the best match comes first (so the highlighted first
 * row is the best match). `limits` caps a group's rows (e.g. the server's tables).
 */
export function paletteGroups(
  entries: readonly PaletteEntry[],
  query: string,
  limits: Readonly<Record<string, number>> = {},
): PaletteGroup[] {
  const ranked = fuzzyRank(entries, query, (e) => e.match ?? [e.label, ...(e.keywords ?? [])])
  const groups = new Map<string, { group: PaletteGroup; best: number; first: number }>()
  const firstSeen = new Map<string, number>()
  entries.forEach((e, i) => {
    if (!firstSeen.has(e.group)) firstSeen.set(e.group, i)
  })
  for (const r of ranked) {
    const heading = r.item.group
    let g = groups.get(heading)
    if (g === undefined) {
      g = { group: { heading, rows: [] }, best: r.score, first: firstSeen.get(heading) ?? 0 }
      groups.set(heading, g)
    }
    const limit = limits[heading]
    if (limit !== undefined && g.group.rows.length >= limit) continue
    g.group.rows.push({ entry: r.item, positions: r.positions })
  }
  const list = [...groups.values()]
  if (normalizeQuery(query) === '') list.sort((a, b) => a.first - b.first)
  else list.sort((a, b) => b.best - a.best || a.first - b.first)
  return list.map((g) => g.group)
}

/** Splits a label into runs for highlighting the matched characters. */
export function highlightRuns(
  label: string,
  positions: readonly number[],
): Array<{ text: string; hit: boolean }> {
  const hits = new Set(positions)
  const runs: Array<{ text: string; hit: boolean }> = []
  for (let i = 0; i < label.length; i++) {
    const hit = hits.has(i)
    const last = runs[runs.length - 1]
    if (last !== undefined && last.hit === hit) last.text += label[i]
    else runs.push({ text: label[i] ?? '', hit })
  }
  return runs
}

/** The palette's own shortcut: Ctrl+Shift+P, or Cmd+Shift+P on macOS (Ctrl+K belongs to the console). */
export function isPaletteShortcut(e: {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}): boolean {
  return (
    e.shiftKey && !e.altKey && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'p' || e.code === 'KeyP')
  )
}
