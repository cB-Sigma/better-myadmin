/**
 * The command palette's fuzzy matcher (BetterMyAdmin only, parity exception X61): the query's
 * characters must appear in the text in order (case-insensitive, white space in the query ignored);
 * the best placement is found by dynamic programming and scored so that matches at word starts
 * (`_`, `-`, `.`, space, camelCase, the start of the text) and runs of consecutive characters win,
 * gaps cost a little, and shorter texts beat longer ones. Pure, no DOM: unit-tested in fuzzy.test.ts.
 */

export interface FuzzyMatch {
  score: number
  /** indexes in `text` of the matched characters (for highlighting) */
  positions: number[]
}

const START_BONUS = 8
const WORD_BONUS = 6
const CAMEL_BONUS = 6
const DIGIT_BONUS = 3
const CONSECUTIVE_BONUS = 8
const GAP_PENALTY = 1
const LEADING_PENALTY = 0.3
const LEADING_PENALTY_MAX = 3
const LENGTH_PENALTY = 0.05
const EXACT_BONUS = 100
const PREFIX_BONUS = 20

const isSeparator = (c: string) => /[\s_\-./:@`$#()[\],]/.test(c)
const isLower = (c: string) => c !== c.toUpperCase() && c === c.toLowerCase()
const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase()
const isDigit = (c: string) => c >= '0' && c <= '9'

/** How much a match at `text[j]` is worth beyond the base point. */
function boundary(text: string, j: number): number {
  if (j === 0) return START_BONUS
  const prev = text[j - 1] ?? ''
  const cur = text[j] ?? ''
  if (isSeparator(prev)) return WORD_BONUS
  if (isLower(prev) && isUpper(cur)) return CAMEL_BONUS
  if (!isDigit(prev) && isDigit(cur)) return DIGIT_BONUS
  return 0
}

/** Normalises a query: white space dropped, lower case. */
export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, '').toLowerCase()
}

/** The best match of `query` in `text`, or null when its characters are not all there in order. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = normalizeQuery(query)
  if (q === '') return { score: 0, positions: [] }
  const t = text.toLowerCase()
  const n = t.length
  const m = q.length
  if (m > n) return null
  // cheap rejection before the O(m·n) table
  let k = 0
  for (let j = 0; j < n && k < m; j++) if (t[j] === q[k]) k++
  if (k < m) return null

  const bonus = new Float64Array(n)
  for (let j = 0; j < n; j++) bonus[j] = 1 + boundary(text, j)
  // score[i][j]: best score with q[i] matched at t[j]; from[i][j]: where q[i-1] was matched
  const score: Float64Array[] = []
  const from: Int32Array[] = []
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(n).fill(Number.NEGATIVE_INFINITY)
    const back = new Int32Array(n).fill(-1)
    const prev = score[i - 1]
    // best of prev[k] + GAP_PENALTY·k over k ≤ j - 2 (a gap of j - k - 1 characters)
    let runBest = Number.NEGATIVE_INFINITY
    let runIdx = -1
    for (let j = i; j < n; j++) {
      if (prev !== undefined && j >= 2) {
        const v = (prev[j - 2] ?? Number.NEGATIVE_INFINITY) + GAP_PENALTY * (j - 2)
        if (v > runBest) {
          runBest = v
          runIdx = j - 2
        }
      }
      if (t[j] !== q[i]) continue
      const b = bonus[j] ?? 1
      if (prev === undefined) {
        row[j] = b - Math.min(j * LEADING_PENALTY, LEADING_PENALTY_MAX)
        continue
      }
      const consecutive = (prev[j - 1] ?? Number.NEGATIVE_INFINITY) + CONSECUTIVE_BONUS
      const gapped = runBest - GAP_PENALTY * (j - 1)
      if (consecutive >= gapped && consecutive > Number.NEGATIVE_INFINITY) {
        row[j] = consecutive + b
        back[j] = j - 1
      } else if (gapped > Number.NEGATIVE_INFINITY) {
        row[j] = gapped + b
        back[j] = runIdx
      }
    }
    score.push(row)
    from.push(back)
  }
  const last = score[m - 1] ?? new Float64Array(0)
  let best = Number.NEGATIVE_INFINITY
  let end = -1
  for (let j = 0; j < n; j++) {
    const v = last[j] ?? Number.NEGATIVE_INFINITY
    if (v > best) {
      best = v
      end = j
    }
  }
  if (end < 0) return null
  const positions: number[] = new Array(m)
  for (let i = m - 1, j = end; i >= 0; i--) {
    positions[i] = j
    j = from[i]?.[j] ?? -1
  }
  let total = best - LENGTH_PENALTY * (n - m)
  if (t === q) total += EXACT_BONUS
  else if (t.startsWith(q)) total += PREFIX_BONUS
  return { score: total, positions }
}

export interface Ranked<T> {
  item: T
  score: number
  /** positions in the item's first text (empty when another text matched better) */
  positions: number[]
}

/** Penalty of a match on a secondary text (keywords, `db.table`) against the item's label. */
export const SECONDARY_PENALTY = 2

/**
 * The items matching `query`, best first (ties keep the input order). `texts(item)[0]` is the label
 * (its match positions are returned); further texts are keywords that match with a small penalty.
 * An empty query keeps every item in input order.
 */
export function fuzzyRank<T>(items: readonly T[], query: string, texts: (item: T) => string[]): Ranked<T>[] {
  if (normalizeQuery(query) === '') return items.map((item) => ({ item, score: 0, positions: [] }))
  const out: Array<Ranked<T> & { index: number }> = []
  items.forEach((item, index) => {
    let best: Ranked<T> | null = null
    texts(item).forEach((text, i) => {
      const r = fuzzyMatch(query, text)
      if (r === null) return
      const s = i === 0 ? r.score : r.score - SECONDARY_PENALTY
      if (best === null || s > best.score) best = { item, score: s, positions: i === 0 ? r.positions : [] }
    })
    if (best !== null) out.push({ ...(best as Ranked<T>), index })
  })
  out.sort((a, b) => b.score - a.score || a.index - b.index)
  return out.map(({ item, score, positions }) => ({ item, score, positions }))
}
