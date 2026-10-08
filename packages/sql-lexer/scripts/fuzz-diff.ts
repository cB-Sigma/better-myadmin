// Compares the TS port with the JSON lines produced by scripts/fuzz-diff.php (see there).
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { Lexer, Parser, getAll, getClause, getTables, replaceClause } from '../src/index.ts'
const lines = readFileSync(process.argv[2]!, 'utf8').split('\n').filter(Boolean)
function decode(v: any): any {
  if (Array.isArray(v)) return v.map(decode)
  if (v && typeof v === 'object' && 'b' in v) return { b: true }
  if (v && typeof v === 'object' && 'f' in v) return v
  return v
}
function enc(v: any): any {
  if (typeof v === 'string' && /[\u0080-ÿ]/.test(v)) return v
  return v
}
function attempt(f: () => any) {
  try {
    return f()
  } catch {
    return { exception: true }
  }
}
let bad = 0
let php = 0
let n = 0
const seen = new Map<string, number>()
for (const line of lines) {
  const exp = JSON.parse(line)
  n++
  if (exp.php) {
    php++
    continue
  }
  let got: any
  try {
    const q = exp.q
    const lexer = new Lexer(q)
    const t = lexer.list.tokens
      .map((x) => `${x.type}:${x.flags}:${x.position ?? ''}:${Array.from(x.token).length}`)
      .join(',')
    const parser = new Parser(lexer.list)
    const s = parser.statements.map((st) => [st.kind, st.first, st.last, attempt(() => st.build())])
    const e = parser.errors.map((er) => [er.message, er.token?.token ?? null, er.token?.position ?? null])
    const le = lexer.errors.map((er) => [er.message, er.ch, er.pos])
    const info = getAll(q)
    const f = Object.entries(info.flags)
      .filter(([, v]) => v === true)
      .map(([k]) => k)
      .sort()
    got = { q, t, le, s, e, f, qt: info.flags.queryType, st: info.selectTables, se: info.selectExpressions }
    if (parser.statements.length > 0) {
      const s0 = parser.statements[0]!
      got.c = ['SELECT', 'FROM', 'WHERE', 'ORDER BY', 'LIMIT'].map((c) =>
        attempt(() => getClause(s0, parser.list!, c)),
      )
      got.r = attempt(() => replaceClause(s0, parser.list!, 'LIMIT 0, 25'))
      got.tb = attempt(() => getTables(s0))
    }
  } catch (err) {
    got = { q: exp.q, ts: String((err as Error).stack) }
  }
  const e2 = decode(exp)
  // undecodable byte strings: skip comparisons of those fields
  const keys = Object.keys(e2)
  const diffs = keys.filter((k) => !isDeepStrictEqual(normalize(got[k]), normalize(e2[k])))
  if (got.ts) diffs.push('ts')
  if (diffs.length) {
    bad++
    const key = diffs.join(',')
    seen.set(key, (seen.get(key) ?? 0) + 1)
    if (bad <= 15)
      console.log(
        JSON.stringify(exp.q).slice(0, 300),
        diffs,
        diffs.map((k) => [JSON.stringify(e2[k])?.slice(0, 400), JSON.stringify(got[k])?.slice(0, 400)]),
        got.ts?.slice(0, 500),
      )
  }
}
function normalize(v: any): any {
  if (Array.isArray(v)) return v.map(normalize)
  if (v && typeof v === 'object' && 'b' in v) return 'BYTES'
  if (typeof v === 'string' && /[\u0080-ÿ]/.test(v)) return v
  return v
}
console.log({ n, bad, php, kinds: Object.fromEntries(seen) })
