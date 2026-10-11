/** PHP trim()'s default character list */
const WS = ' \t\n\r\0\x0B'

/** PHP trim($s, $chars) */
export function trimChars(s: string, chars = WS): string {
  let a = 0
  let b = s.length
  while (a < b && chars.includes(s[a] as string)) a++
  while (b > a && chars.includes(s[b - 1] as string)) b--
  return s.slice(a, b)
}

/** PHP rtrim($s, $chars) */
export function rtrimChars(s: string, chars = WS): string {
  let b = s.length
  while (b > 0 && chars.includes(s[b - 1] as string)) b--
  return s.slice(0, b)
}
