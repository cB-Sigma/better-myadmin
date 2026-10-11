import type { Profiling } from '@bettermyadmin/contracts'
import { type Gettext, englishTranslator, formatNumber } from '@bettermyadmin/i18n'
import type { Conn } from '../db/connection.ts'
import type { SessionData } from '../session/store.ts'
import { ucwords } from '../util/php.ts'

/**
 * Profiling::isSupported: `SELECT @@have_profiling`, cached per server in the session (SessionCache).
 * pma: src/Profiling.php
 */
export async function isProfilingSupported(
  conn: Conn,
  session: SessionData,
  server: number,
): Promise<boolean> {
  session.profilingSupported ??= {}
  const cached = session.profilingSupported[String(server)]
  if (cached !== undefined) return cached
  let supported = false
  try {
    const v = await conn.value('SELECT @@have_profiling', 'profiling.supported')
    // fetchValue's truthiness: 'YES' / '1' are true, '0' / '' / NULL false
    supported = v !== null && v !== '' && v !== '0'
  } catch {
    supported = false
  }
  session.profilingSupported[String(server)] = supported
  return supported
}

/**
 * Profiling::check: `profiling` posted (and supported) turns it on for the session, `profiling_form`
 * without `profiling` turns it off.
 */
export async function checkProfiling(
  requested: boolean | undefined,
  conn: Conn,
  session: SessionData,
  server: number,
): Promise<void> {
  if (requested === true && (await isProfilingSupported(conn, session, server))) session.profiling = true
  else if (requested === false) delete session.profiling
}

/** Profiling::enable */
export async function enableProfiling(conn: Conn, session: SessionData, server: number): Promise<void> {
  if (session.profiling !== true || !(await isProfilingSupported(conn, session, server))) return
  await conn.query('SET PROFILING=1;', 'profiling.enable')
}

export interface ProfileRow {
  Status: string
  Duration: string
}

/** Profiling::getInformation */
export async function getProfilingInformation(
  conn: Conn,
  session: SessionData,
  server: number,
): Promise<ProfileRow[]> {
  if (session.profiling !== true || !(await isProfilingSupported(conn, session, server))) return []
  return (await conn.rows('SHOW PROFILE;', 'profiling.show')).map((r) => ({
    Status: r.Status ?? '',
    Duration: r.Duration ?? '0',
  }))
}

/**
 * Sql::getDetailedProfilingStats, with the numbers formatted the way sql/profiling_chart.twig prints them.
 * Returns null when the total time is 0 (no chart is rendered).
 */
export function getDetailedProfilingStats(
  rows: readonly ProfileRow[],
  tr: Gettext = englishTranslator(),
): Profiling | null {
  const totalTime = rows.reduce((s, r) => s + Number.parseFloat(r.Duration), 0)
  if (totalTime === 0) return null
  const states = new Map<string, { totalTime: number; calls: number }>()
  const profile: Profiling['profile'] = []
  for (const r of rows) {
    const status = ucwords(r.Status)
    profile.push({ status, duration: formatNumber(tr, r.Duration, 3, 1), durationRaw: r.Duration })
    const s = states.get(status)
    if (s === undefined) states.set(status, { totalTime: Number.parseFloat(r.Duration), calls: 1 })
    else {
      s.calls++
      s.totalTime += Number.parseFloat(r.Duration)
    }
  }
  // arsort($states): by the array value, i.e. total_time first (then calls), descending; stable for ties
  const sorted = [...states.entries()].sort((a, b) =>
    b[1].totalTime !== a[1].totalTime ? b[1].totalTime - a[1].totalTime : b[1].calls - a[1].calls,
  )
  return {
    totalTime,
    profile,
    states: sorted.map(([state, s]) => ({
      state,
      totalTime: formatNumber(tr, s.totalTime, 3, 1),
      totalTimeRaw: s.totalTime,
      percent: formatNumber(tr, 100 * (s.totalTime / totalTime), 0, 2),
      calls: s.calls,
      average: formatNumber(tr, s.totalTime / s.calls, 3, 1),
      averageRaw: (s.totalTime / s.calls).toFixed(8),
    })),
    chart: { labels: sorted.map(([k]) => k), data: sorted.map(([, s]) => s.totalTime) },
  }
}
