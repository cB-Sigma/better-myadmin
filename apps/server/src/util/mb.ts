/**
 * PHP's mb_* string functions over code points without `Array.from`: a cell or statement of
 * megabytes would otherwise become an array of millions of one-character strings
 * (docs/architecture/17-large-data.md).
 */

export { mbStrlen } from '@bettermyadmin/mysql-types'

/**
 * `mb_strlen($s) > $n` without listing the characters (`Array.from` of a statement with a 50 MB
 * hex literal is an array of 100 million strings)
 */
export function mbLongerThan(s: string, n: number): boolean {
  // UTF-16 units >= code points
  if (s.length <= n) return false
  let count = 0
  for (const _ of s) if (++count > n) return true
  return false
}

/** `mb_substr($s, 0, $n)` */
export function mbSubstr(s: string, n: number): string {
  let count = 0
  let end = 0
  for (const ch of s) {
    if (count === n) break
    count++
    end += ch.length
  }
  return s.slice(0, end)
}
