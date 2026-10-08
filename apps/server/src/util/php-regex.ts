/**
 * Converts a PHP PCRE pattern with delimiters and modifiers (e.g. `'@^192\.168\.0\.[0-9]{1,}$@i'`)
 * into a JS RegExp, so config directives written for phpMyAdmin (ArbitraryServerRegexp, ...) work unchanged.
 * Returns null when the pattern is not a valid delimited regex (preg_match would return false).
 */
export function phpRegex(pattern: string): RegExp | null {
  if (pattern.length < 2) return null
  const open = pattern[0]!
  if (/[a-zA-Z0-9\\\s]/.test(open)) return null
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' }
  const close = pairs[open] ?? open
  const end = pattern.lastIndexOf(close)
  if (end <= 0) return null
  const body = pattern.slice(1, end)
  const mods = pattern.slice(end + 1)
  let flags = ''
  for (const m of mods) {
    if (m === 'i') flags += 'i'
    else if (m === 'm') flags += 'm'
    else if (m === 's') flags += 's'
    else if (m === 'u') flags += 'u'
    else if (m === 'x' || m === 'D' || m === 'U' || m === 'X' || m === 'A' || m === 'S') continue
    else return null
  }
  try {
    return new RegExp(body, flags)
  } catch {
    return null
  }
}
