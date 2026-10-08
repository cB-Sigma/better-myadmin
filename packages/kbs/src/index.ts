/**
 * MariaDB/MySQL server-variable knowledge base (williamdes/mariadb-mysql-kbs 1.3.0, MPL-2.0, the
 * version phpMyAdmin's composer.lock pins), used for variable documentation links and types.
 *
 * The data file is ~340 KB: browsers load it lazily through `loadKbs()` (a separate chunk);
 * the server imports it the same way.
 * pma: vendor/williamdes/mariadb-mysql-kbs/src/Search.php, src/Providers/ServerVariables/MariaDbMySqlKbsProvider.php
 */

export interface KbsEntry {
  /** anchor (`null` in a few entries: no anchor, PHP isset() is false) */
  a?: string | null
  /** index into `urls` */
  u: number
  /** documentation type: 1 MySQL, 2 MariaDB, 3 Aurora MySQL */
  t: 1 | 2 | 3
}

export interface KbsVariable {
  /** dynamic */
  d?: boolean
  /** index into varTypes */
  t?: number
  a?: KbsEntry[]
}

export interface KbsData {
  vars: Record<string, KbsVariable>
  version: number
  urls: string[]
  types: Record<string, string>
  varTypes: Record<string, string>
}

export const ANY = -1
export const MYSQL = 1
export const MARIADB = 2
export const AURORA_MYSQL = 3

let cache: Promise<KbsData> | null = null

/** Loads the data once (dynamic import → its own chunk in the web build). */
export function loadKbs(): Promise<KbsData> {
  cache ??= import('./data/merged-ultraslim.json').then((m) => (m as unknown as { default: KbsData }).default)
  return cache
}

/**
 * Search::getByName — the documentation URL (+ `#anchor`) of a variable for the given
 * documentation type, or `null` (KBException in PHP).
 */
export function getByName(data: KbsData, name: string, type: number = ANY): string | null {
  const entries = data.vars[name]?.a
  if (entries === undefined) return null
  for (const e of entries) {
    const end = e.a !== undefined && e.a !== null ? `#${e.a}` : ''
    const url = data.urls[e.u]
    if (url === undefined) continue
    if (type === ANY) return url + end
    if (type === MYSQL && (e.t === MYSQL || e.t === AURORA_MYSQL)) return url + end
    if (type === MARIADB && e.t === MARIADB) return url + end
    if (type === AURORA_MYSQL && e.t === AURORA_MYSQL) return url + end
  }
  return null
}

/** Search::getVariableType — 'string' | 'boolean' | 'integer' | 'numeric' | 'enumeration' | … or null. */
export function getVariableType(data: KbsData, name: string): string | null {
  const v = data.vars[name]
  if (v?.t === undefined) return null
  return data.varTypes[String(v.t)] ?? null
}

/** Search::getVariablesWithDynamic(false) */
export function getStaticVariables(data: KbsData): string[] {
  return Object.entries(data.vars)
    .filter(([, v]) => v.d === false)
    .map(([k]) => k)
}

/** The variable documentation link phpMyAdmin shows for the connected server type. */
export function variableDocUrl(data: KbsData, name: string, isMariaDb: boolean): string | null {
  return getByName(data, name, isMariaDb ? MARIADB : MYSQL)
}
