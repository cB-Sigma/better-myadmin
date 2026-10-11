/**
 * The MariaDB/MySQL knowledge base phpMyAdmin uses for variable types and documentation links
 * (williamdes/mariadb-mysql-kbs v1.3.0, dist/merged-ultraslim.json, vendored unchanged).
 *
 * pma: vendor/williamdes/mariadb-mysql-kbs/src/Search.php (`KBSearch`),
 *      src/Providers/ServerVariables/MariaDbMySqlKbsProvider.php
 */
import data from './generated/merged-ultraslim.json' with { type: 'json' }

interface KbEntry {
  /** anchor */
  a?: string
  /** index into `urls` */
  u: number
  /** 1 MySQL, 2 MariaDB, 3 Aurora MySQL */
  t: number
}

interface KbVariable {
  /** dynamic */
  d?: boolean
  /** index into varTypes */
  t?: number
  a?: KbEntry[]
}

const KB = data as unknown as {
  vars: Record<string, KbVariable>
  urls: string[]
  varTypes: Record<string, string>
}

export const KB_ANY = -1
export const KB_MYSQL = 1
export const KB_MARIADB = 2
export const KB_AURORA_MYSQL = 3

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** Search::getVariable (case-sensitive), undefined when unknown. */
function getVariable(name: string): KbVariable | undefined {
  return hasOwn(KB.vars, name) ? KB.vars[name] : undefined
}

/**
 * MariaDbMySqlKbsProvider::getVariableType — `byte`, `integer`, `string`, `boolean`, `numeric`,
 * `enumeration`, `set`, `directory name`, `file name`, or null.
 */
export function getVariableType(name: string): string | null {
  const v = getVariable(name)
  if (v === undefined || v.t === undefined) return null
  return KB.varTypes[String(v.t)] ?? null
}

/** Search::getByName — the documentation URL of a variable for MySQL or MariaDB, or null. */
export function getDocLinkByName(name: string, type: number = KB_ANY): string | null {
  const v = getVariable(name)
  if (v?.a === undefined) return null
  for (const e of v.a) {
    const url = `${KB.urls[e.u]}${e.a !== undefined ? `#${e.a}` : ''}`
    if (type === KB_ANY) return url
    if (type === KB_MYSQL && (e.t === KB_MYSQL || e.t === KB_AURORA_MYSQL)) return url
    if (type === KB_MARIADB && e.t === KB_MARIADB) return url
    if (type === KB_AURORA_MYSQL && e.t === KB_AURORA_MYSQL) return url
  }
  return null
}

/** MariaDbMySqlKbsProvider::getStaticVariables — always empty in phpMyAdmin. */
export function getStaticVariables(): string[] {
  return []
}
