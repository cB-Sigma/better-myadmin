import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import type { LogEntry } from './general-log.ts'

export interface AllowedDiff {
  tool: 'pma' | 'bma'
  pattern: string
  why: string
  /**
   * A write of a registered exception (docs/reference/parity-exceptions.md): BetterMyAdmin's
   * statement is phpMyAdmin's (matching `pattern`) plus exactly this suffix. Nothing is dropped.
   */
  suffix?: string
  /** With `suffix`: phpMyAdmin's next write must match this too. */
  followedBy?: string
  /** With `suffix`: the exception id (X…). */
  exception?: string
}

type Compiled = AllowedDiff & { re: RegExp }

const allowedDiffs: Compiled[] = (
  parse(readFileSync(new URL('../allowed-diffs.yaml', import.meta.url), 'utf8')) as AllowedDiff[]
).map((a) => ({ ...a, re: new RegExp(a.pattern) }))

/**
 * BetterMyAdmin's writes with each registered suffix difference mapped back to phpMyAdmin's
 * statement: position i only, when phpMyAdmin's write i matches the pattern, ours is exactly it plus
 * the suffix, and phpMyAdmin's next write matches `followedBy`.
 */
function unsuffixed(pmaWrites: string[], bmaWrites: string[], rules: Compiled[]): string[] {
  return bmaWrites.map((b, i) => {
    const p = pmaWrites[i]
    if (p === undefined) return b
    for (const r of rules) {
      if (r.suffix === undefined || b !== p + r.suffix || !r.re.test(p)) continue
      const next = pmaWrites[i + 1]
      if (r.followedBy !== undefined && (next === undefined || !new RegExp(r.followedBy).test(next))) continue
      return p
    }
    return b
  })
}

/**
 * Masks for the two connection tokens that legitimately differ between the reference phpMyAdmin
 * (reached by its compose service name, inside the docker network) and our app (reached on 127.0.0.1
 * through the published port). These are applied ONLY at the specific call sites that compare an
 * env-determined token — never blanket over a whole log — so a real difference anywhere else, and a
 * deliberately-typed host literal, stays a difference:
 *   - the configured server host (`127.0.0.1` ↔ `mysql84` / `mariadb11` / their replicas) → `%HOST%`
 *   - the connecting client's MySQL host, a Docker-assigned IP after `@` or a bare IP (CURRENT_USER
 *     host, the "this host" option) → `%CLIENTIP%`
 * Locally both sides are 127.0.0.1, so these are a near no-op there; they only align the CI topology.
 */
const SERVER_HOSTS = [
  'mysql84-replica',
  'mariadb11-replica',
  'mysql84',
  'mariadb11',
  process.env.BMA_TEST_HOST ?? '127.0.0.1',
]
const SERVER_HOST_RE = new RegExp(
  `\\b(?:${SERVER_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|')})\\b`,
  'g',
)
/** A MySQL account host that is an IP assigned by Docker (after `@`, quoted or not, or standalone). */
export const maskClientIp = (s: string): string =>
  s
    .replace(/(@'?)(\d{1,3}(?:\.\d{1,3}){3})('?)/g, '$1%CLIENTIP%$3')
    .replace(/^\d{1,3}(?:\.\d{1,3}){3}$/, '%CLIENTIP%')
/**
 * The connecting client's host everywhere it appears in the "this host" account path: the `@'ip'`
 * form (CREATE USER / GRANT / DROP) and the existence probe's ``Host` = 'ip'`` clause. Used only in
 * the opt-in maskClientHost comparison, never globally, so a Host-column IP in exported data stays.
 */
export const maskClientHostTokens = (s: string): string =>
  maskClientIp(s).replace(/(`?Host`?\s*=\s*')(\d{1,3}(?:\.\d{1,3}){3})(')/gi, '$1%CLIENTIP%$3')
/** The configured server host token (never the port, log file, position or clause order). */
export const maskServerHost = (s: string): string => s.replace(SERVER_HOST_RE, '%HOST%')
/** Both env-determined connection tokens; client IP first so an `@127.0.0.1` is an IP, not the host. */
export const maskEnv = (s: string): string => maskServerHost(maskClientIp(s))

/**
 * Collapse whitespace, strip the trailing delimiter, and map per-tool database names to one name.
 * Byte-exact otherwise: the env-determined connection tokens (`maskClientIp` / `maskServerHost`) are
 * masked only at the specific call sites that need them, never here, so nothing is silently absorbed.
 */
export function normalise(sql: string, dbMap: Record<string, string> = {}): string {
  let s = sql.trim().replace(/;\s*$/, '').replace(/\s+/g, ' ')
  for (const [from, to] of Object.entries(dbMap)) s = s.replaceAll(from, to)
  return s
}

export type Kind = 'session' | 'read' | 'write'

/** Connection set-up, reads (SELECT/SHOW/EXPLAIN without INTO), everything else is a write. */
export function classify(sql: string): Kind {
  // per-connection set-up: PHP connects on every request, we keep pooled connections
  if (
    /^(SET (NAMES|lc_messages|collation_connection|`time_zone`)\b|USE |SELECT @@version, @@version_comment, @@sql_mode$)/i.test(
      sql,
    )
  ) {
    return 'session'
  }
  if (/^(SELECT|SHOW|EXPLAIN|DESCRIBE|DESC)\b/i.test(sql) && !/\bINTO\s+(OUTFILE|DUMPFILE|@)/i.test(sql)) {
    return 'read'
  }
  return 'write'
}

/**
 * Only the writes of two logs, normalised, in order (DDL suites: reads differ by design, writes
 * never may). `exclude` drops statements of one tool that are out of scope for the suite.
 */
export function compareWrites(
  pmaLog: LogEntry[],
  bmaLog: LogEntry[],
  dbMap: Record<string, string>,
  exclude: RegExp[] = [],
): { ok: boolean; pma: string[]; bma: string[] } {
  const writes = (log: LogEntry[]) =>
    log
      .map((e) => normalise(e.sql, dbMap))
      .filter((s) => classify(s) === 'write' && !exclude.some((re) => re.test(s)))
  const pma = writes(pmaLog)
  const bma = writes(bmaLog)
  return { ok: pma.length === bma.length && pma.every((s, i) => s === bma[i]), pma, bma }
}

export interface Comparison {
  ok: boolean
  pma: string[]
  bma: string[]
  problems: string[]
}

/**
 * Diff two statement logs: writes must be identical and in order, reads must be identical in order
 * after removing the allow-listed ones, session set-up must leave the same final state.
 */
export function compareLogs(
  pmaLog: LogEntry[],
  bmaLog: LogEntry[],
  dbMap: Record<string, string>,
  options: {
    /** Suite-specific accepted differences, on top of allowed-diffs.yaml. */
    extra?: AllowedDiff[]
    /** Patterns of allowed-diffs.yaml that do not apply to this suite (the statement is under test). */
    exclude?: string[]
    /**
     * Mask the connecting client's host (the CURRENT_USER / "this host" IP) on both sides, for the
     * one case where the account host IS the client's own env-determined address — on CI phpMyAdmin
     * connects from its compose-network IP and we from the docker gateway. Off by default: a host
     * that the caller typed into the form is a real value and must stay byte-exact.
     */
    maskClientHost?: boolean
  } = {},
): Comparison {
  const problems: string[] = []
  const allowed = [
    ...allowedDiffs.filter((a) => !(options.exclude ?? []).includes(a.pattern)),
    ...(options.extra ?? []).map((a) => ({ ...a, re: new RegExp(a.pattern) })),
  ]
  const norm = (sql: string) =>
    options.maskClientHost === true ? maskClientHostTokens(normalise(sql, dbMap)) : normalise(sql, dbMap)
  const filter = (tool: 'pma' | 'bma', log: LogEntry[]) =>
    log
      .map((e) => norm(e.sql))
      .filter((s) => {
        const hit = allowed.find((a) => a.tool === tool && a.suffix === undefined && a.re.test(s))
        if (hit !== undefined && classify(s) === 'write') {
          problems.push(`allowed-diffs pattern ${hit.pattern} matches a write: ${s}`)
          return true
        }
        return hit === undefined
      })
  const pma = filter('pma', pmaLog)
  const bma = filter('bma', bmaLog)
  const of = (k: Kind, xs: string[]) => xs.filter((s) => classify(s) === k)
  const sessionState = (xs: string[]) => {
    const state = new Map<string, string>()
    for (const s of of('session', xs)) {
      const m = s.match(/^(SET \S+|USE)\s/i)
      if (m) state.set(m[1]!.toUpperCase(), s)
    }
    return state
  }
  const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
  const suffixRules = allowed.filter((a) => a.tool === 'bma' && a.suffix !== undefined)
  if (!eq(of('write', pma), unsuffixed(of('write', pma), of('write', bma), suffixRules))) {
    problems.push(
      `writes differ:\n  pma: ${JSON.stringify(of('write', pma))}\n  bma: ${JSON.stringify(of('write', bma))}`,
    )
  }
  if (!eq(of('read', pma), of('read', bma))) {
    problems.push(
      `reads differ:\n  pma: ${JSON.stringify(of('read', pma))}\n  bma: ${JSON.stringify(of('read', bma))}`,
    )
  }
  const ps = sessionState(pma)
  const bs = sessionState(bma)
  for (const key of ['SET NAMES', 'SET LC_MESSAGES', 'SET COLLATION_CONNECTION']) {
    if (ps.has(key) && bs.has(key) && ps.get(key) !== bs.get(key)) {
      problems.push(`session set-up differs: ${ps.get(key)} vs ${bs.get(key)}`)
    }
  }
  return { ok: problems.length === 0, pma, bma, problems }
}

/**
 * Comparison for configuration-storage actions. Writes must be identical and in the same order.
 * Reads are compared as a multiset inclusion: every read BetterMyAdmin sends, phpMyAdmin sent
 * too (phpMyAdmin additionally re-probes the storage and reads preferences, menus and lists on
 * every request to render its pages; BetterMyAdmin caches them per session). BetterMyAdmin-only
 * reads must be listed in allowed-diffs.yaml. Timestamps are masked.
 */
export function compareMetadataLogs(
  pmaLog: LogEntry[],
  bmaLog: LogEntry[],
  dbMap: Record<string, string>,
): Comparison {
  const problems: string[] = []
  // timestamps masked; a leading comment (phpMyAdmin's `/*NOTRACK*/` tracking probes) is not part
  // of the statement kind
  const ts = (s: string) =>
    s
      .replace(/'\d{4}-\d\d-\d\d \d\d:\d\d:\d\d'/g, "'<TS>'")
      .replace(/^(\/\*[\s\S]*?\*\/\s*)+(?=SELECT\b)/i, '')
  const pma = pmaLog.map((e) => ts(normalise(e.sql, dbMap)))
  const bma = bmaLog
    .map((e) => ts(normalise(e.sql, dbMap)))
    .filter((s) => {
      const hit = allowedDiffs.find((a) => a.tool === 'bma' && a.suffix === undefined && a.re.test(s))
      if (hit !== undefined && classify(s) === 'write') {
        problems.push(`allowed-diffs pattern ${hit.pattern} matches a write: ${s}`)
        return true
      }
      return hit === undefined
    })
  const writes = (xs: string[]) => xs.filter((s) => classify(s) === 'write')
  const pw = writes(pma)
  const bw = writes(bma)
  if (pw.length !== bw.length || pw.some((x, i) => x !== bw[i])) {
    problems.push(`writes differ:\n  pma: ${JSON.stringify(pw)}\n  bma: ${JSON.stringify(bw)}`)
  }
  const pool = new Map<string, number>()
  for (const s of pma.filter((x) => classify(x) === 'read')) pool.set(s, (pool.get(s) ?? 0) + 1)
  for (const s of bma.filter((x) => classify(x) === 'read')) {
    const n = pool.get(s) ?? 0
    if (n === 0) problems.push(`read not sent by phpMyAdmin: ${s}`)
    else pool.set(s, n - 1)
  }
  return { ok: problems.length === 0, pma, bma, problems }
}
