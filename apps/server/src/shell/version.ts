import { type ProxySettings, httpRequest } from '../util/http-request.ts'
/**
 * Version check against BetterMyAdmin's release feed (parity exception X20), with phpMyAdmin's
 * caching, release selection and version arithmetic. The feed has phpMyAdmin's shape:
 * `{"releases":[{"version","date","php_versions","mysql_versions"}]}` where `php_versions` holds
 * Node.js constraints for us. The feed URL comes from `BMA_VERSION_FEED_URL`; without one the
 * check returns no data (no outbound call), like an unreachable phpmyadmin.net.
 * pma: src/VersionInformation.php, src/Controllers/VersionCheckController.php
 */

export interface Release {
  version: string
  date: string
  runtimeVersions: string
  mysqlVersions: string
}

/** VersionInformation::versionToInt */
export function versionToInt(version: string): number {
  const dash = version.split('-')
  let suffix = dash.length > 1 ? (dash[1] ?? '') : ''
  const parts = (dash[0] ?? '').split('.')
  const num = (s: string | undefined) =>
    s !== undefined && s !== '' && Number.isFinite(Number(s)) ? Number(s) : null
  let result = 0
  const p0 = num(parts[0])
  if (p0 !== null) result += 1000000 * Math.trunc(p0)
  const p1 = num(parts[1])
  if (parts.length >= 2 && p1 !== null) result += 10000 * Math.trunc(p1)
  const p2 = num(parts[2])
  if (parts.length >= 3 && p2 !== null) result += 100 * Math.trunc(p2)
  const p3 = num(parts[3])
  if (parts.length >= 4 && p3 !== null) result += Math.trunc(p3)
  if (suffix !== '') {
    const m = suffix.match(/^(\D+)(\d+)$/)
    if (m !== null) {
      suffix = m[1]!
      result += Number(m[2])
    }
    if (suffix === 'pl') result += 60
    else if (suffix === 'rc') result += 30
    else if (suffix === 'beta') result += 20
    else if (suffix === 'alpha') result += 10
  } else {
    result += 50
  }
  return result
}

/** PHP version_compare, enough of it for release constraints (canonicalised, special forms ordered). */
export function versionCompare(a: string, b: string): number {
  const order = (s: string): number => {
    if (/^\d+$/.test(s)) return 10
    if (s.startsWith('dev')) return 0
    if (s.startsWith('alpha') || s === 'a') return 1
    if (s.startsWith('beta') || s === 'b') return 2
    if (s.startsWith('RC') || s.startsWith('rc')) return 3
    if (s === '#') return 4
    if (s.startsWith('pl') || s === 'p') return 5
    return -1
  }
  const canon = (v: string) =>
    v
      .replace(/[-_+]/g, '.')
      .replace(/([^\d.]+)/g, '.$1.')
      .split('.')
      .filter((x) => x !== '')
  const x = canon(a)
  const y = canon(b)
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) {
    const p = x[i]
    const q = y[i]
    if (p === undefined) return order(q!) === 10 ? -1 : order(q!) > 4 ? -1 : 1
    if (q === undefined) return order(p) === 10 ? 1 : order(p) > 4 ? 1 : -1
    const op = order(p)
    const oq = order(q)
    if (op === 10 && oq === 10) {
      const d = Number(p) - Number(q)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (op !== oq) {
      return op < oq ? -1 : 1
    }
  }
  return 0
}

/** VersionInformation::evaluateVersionCondition */
export function evaluateCondition(mine: string | null, condition: string): boolean {
  for (const op of ['<=', '>=', '!=', '<>', '<', '>', '=']) {
    if (!condition.startsWith(op)) continue
    if (mine === null) return false
    const c = versionCompare(mine, condition.slice(op.length))
    switch (op) {
      case '<=':
        return c <= 0
      case '>=':
        return c >= 0
      case '!=':
      case '<>':
        return c !== 0
      case '<':
        return c < 0
      case '>':
        return c > 0
      default:
        return c === 0
    }
  }
  return false
}

/** VersionInformation::getLatestCompatibleVersion */
export function latestCompatible(
  releases: Release[],
  runtimeVersion: string,
  mysqlVersion: string | null,
  singleServer: boolean,
): Release | null {
  let latest: Release | null = null
  for (const r of releases) {
    if (!r.runtimeVersions.split(',').every((c) => evaluateCondition(runtimeVersion, c))) continue
    if (singleServer && !r.mysqlVersions.split(',').every((c) => evaluateCondition(mysqlVersion, c))) continue
    if (latest !== null && !(versionCompare(latest.version, r.version) < 0)) continue
    latest = r
  }
  return latest
}

const cache = new Map<string, { at: number; body: string }>()

/** Fetches the feed, cached 6 hours (pma caches per session; the feed is the same for everyone). */
export async function getLatestVersions(
  url: string,
  now = Date.now(),
  proxy: ProxySettings = { ProxyUrl: '', ProxyUser: '', ProxyPass: '' },
): Promise<Release[] | null> {
  let body = cache.get(url)?.body
  const at = cache.get(url)?.at ?? 0
  let save = false
  if (body === undefined || now >= at + 6 * 3600 * 1000) {
    // HttpRequest::create through ProxyUrl; a status other than 200 reads as no data
    body = await httpRequest(proxy, url)
      .then((r) => (r.status === 200 ? r.body : '{}'))
      .catch(() => '{}')
    save = true
  }
  let data: unknown
  try {
    data = JSON.parse(body === '' ? '{}' : body)
  } catch {
    return null
  }
  const releases = (data as { releases?: unknown }).releases
  if (!Array.isArray(releases)) return null
  if (save) cache.set(url, { at: now, body })
  return releases.map((r: Record<string, string>) => ({
    version: String(r.version ?? ''),
    date: String(r.date ?? ''),
    runtimeVersions: String(r.node_versions ?? r.php_versions ?? ''),
    mysqlVersions: String(r.mysql_versions ?? ''),
  }))
}
