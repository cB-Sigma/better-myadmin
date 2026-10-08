/** Levenshtein distance (case-insensitive), iterative two-row version. */
export function levenshtein(a: string, b: string): number {
  const s = a.toLowerCase()
  const t = b.toLowerCase()
  if (s === t) return 0
  if (s.length === 0) return t.length
  if (t.length === 0) return s.length
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i)
  let cur = new Array<number>(t.length + 1).fill(0)
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[t.length] ?? 0
}

export interface Candidate {
  /** Name compared against the unknown key. */
  name: string
  /** What to show to the user (e.g. a full path). */
  display: string
}

/** Nearest candidate by edit distance; ties broken by candidate order. */
export function nearest(
  key: string,
  candidates: readonly Candidate[],
): { candidate: Candidate; distance: number } | undefined {
  let best: { candidate: Candidate; distance: number } | undefined
  for (const c of candidates) {
    const d = levenshtein(key, c.name)
    if (!best || d < best.distance) best = { candidate: c, distance: d }
  }
  return best
}

/** Whether a distance is small enough to be a plausible typo of `key`. */
export function isClose(key: string, distance: number): boolean {
  return distance <= Math.max(2, Math.floor(key.length * 0.4))
}
