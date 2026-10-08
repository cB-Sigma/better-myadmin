import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import type { LogEntry } from './general-log.ts'

export interface AllowedDiff {
  tool: 'pma' | 'bma'
  pattern: string
  why: string
}

const allowed = (
  parse(readFileSync(new URL('../allowed-diffs.yaml', import.meta.url), 'utf8')) as AllowedDiff[]
).map((a) => ({ ...a, re: new RegExp(a.pattern) }))

/** Collapse whitespace, strip the trailing delimiter, map per-tool database names to one name. */
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
): Comparison {
  const problems: string[] = []
  const filter = (tool: 'pma' | 'bma', log: LogEntry[]) =>
    log
      .map((e) => normalise(e.sql, dbMap))
      .filter((s) => {
        const hit = allowed.find((a) => a.tool === tool && a.re.test(s))
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
  if (!eq(of('write', pma), of('write', bma))) {
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
