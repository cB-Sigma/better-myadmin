import { defaults, serverDefaults } from '@bettermyadmin/config'
import { arrayRead, arrayWrite, phpEmpty, phpIdentical } from '@bettermyadmin/metadata'

/** A PHP array as decoded here: a list (JS array) or a string-keyed map. */
type PhpArray = Record<string, unknown> | unknown[]

const isArr = (v: unknown): v is PhpArray => v !== null && typeof v === 'object'

/** PHP `isset($value[0])` for a decoded array. */
const hasIndex0 = (v: PhpArray): boolean => {
  const x = Array.isArray(v) ? v[0] : (v as Record<string, unknown>)['0']
  return x !== undefined && x !== null
}

/** The prefs paths stored under another key (UserPreferences::pageInit cfgUpdateReadMapping). */
export const CFG_UPDATE_READ_MAPPING: Readonly<Record<string, string>> = {
  'Server/hide_db': 'Servers/1/hide_db',
  'Server/only_db': 'Servers/1/only_db',
}

/** phpMyAdmin's defaults as `Settings::asArray()` (one default server at index 1). */
export function defaultSettingsTree(): Record<string, unknown> {
  return { ...(defaults as unknown as Record<string, unknown>), Servers: { 1: serverDefaults() } }
}

/** ConfigFile::getFlatArray: nested arrays become `a/b` paths, lists (`isset($v[0])`) are leaves. */
export function flatArray(
  array: PhpArray,
  prefix = '',
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [key, value] of Object.entries(array)) {
    if (isArr(value) && !hasIndex0(value)) flatArray(value, `${prefix}${key}/`, out)
    else out[prefix + key] = value
  }
  return out
}

/** Core::arrayRemove: unsets the path and every parent array it leaves empty. */
export function arrayRemove(path: string, array: Record<string, unknown>): void {
  const keys = path.split('/')
  const last = keys.pop() as string
  const chain: Record<string, unknown>[] = [array]
  let found = true
  for (const key of keys) {
    const next = chain[chain.length - 1]?.[key]
    if (next === undefined || next === null || typeof next !== 'object') {
      found = false
      break
    }
    chain.push(next as Record<string, unknown>)
  }
  let depth = chain.length - 1
  if (found) {
    remove(chain[depth] as Record<string, unknown>, last)
    depth--
  }
  for (; depth >= 0; depth--) {
    const child = chain[depth + 1]
    if (child !== undefined && Object.keys(child).length !== 0) break
    remove(chain[depth] as Record<string, unknown>, keys[depth] as string)
  }
}

function remove(a: Record<string, unknown> | unknown[], key: string): void {
  if (Array.isArray(a)) {
    // PHP unset() on a list leaves a map
    delete (a as unknown as Record<string, unknown>)[key]
  } else delete a[key]
}

/**
 * The in-memory configuration being edited by a preferences form (`$_SESSION['ConfigFile<server>']`
 * of phpMyAdmin, reset by every page load in UserPreferences::pageInit).
 *
 * pma: src/Config/ConfigFile.php
 */
export class ConfigFile {
  #data: Record<string, unknown> = {}
  readonly #defaults: Record<string, unknown>
  /** null in the setup script (ConfigFile::$isInSetup) */
  readonly #base: Record<string, unknown> | null
  #allowed: Set<string> | null = null
  #mapping: Record<string, string> = {}
  #persist: Set<string> = new Set()

  /**
   * `base`: the configuration without user preferences (Config::$baseSettings); null for the
   * setup script, whose `data` is the configuration being written ($_SESSION['ConfigFile<server>']).
   */
  constructor(
    base: Record<string, unknown> | null,
    defaultsTree: Record<string, unknown> = defaultSettingsTree(),
    data: Record<string, unknown> = {},
  ) {
    this.#base = base
    this.#defaults = defaultsTree
    this.#data = data
  }

  /** The stored values (what the session keeps). */
  data(): Record<string, unknown> {
    return this.#data
  }

  /** pma: ConfigFile::setPersistKeys */
  setPersistKeys(keys: readonly string[]): void {
    this.#persist = new Set(keys)
  }

  /** pma: ConfigFile::getPersistKeysMap (in the order given) */
  getPersistKeys(): string[] {
    return [...this.#persist]
  }

  setAllowedKeys(keys: readonly string[] | null): void {
    this.#allowed = keys === null ? null : new Set(keys)
  }

  setCfgUpdateReadMapping(mapping: Record<string, string>): void {
    this.#mapping = mapping
  }

  resetConfigData(): void {
    this.#data = {}
  }

  /** pma: ConfigFile::set */
  set(path: string, value: unknown, canonicalPath: string = canonical(path)): void {
    if (this.#allowed !== null && !this.#allowed.has(canonicalPath)) return
    // a persisted path is never removed
    if (this.#persist.has(canonicalPath)) {
      arrayWrite(path, this.#data, value)
      return
    }
    const defaultValue = this.getDefault(canonicalPath)
    let remove: boolean
    if (this.#base === null) {
      // setup: remove if it has the default value or is empty
      remove = phpIdentical(value, defaultValue) || (phpEmpty(value) && phpEmpty(defaultValue))
    } else {
      // keep a value that config.inc.php changed even when it equals the default
      const instanceDefault = arrayRead(canonicalPath, this.#base)
      remove = phpIdentical(value, defaultValue) && phpIdentical(instanceDefault, defaultValue)
    }
    if (remove) {
      arrayRemove(path, this.#data)
      return
    }
    arrayWrite(path, this.#data, value)
  }

  /** pma: ConfigFile::updateWithGlobalConfig */
  updateWithGlobalConfig(cfg: Record<string, unknown>): void {
    for (const [p, value] of Object.entries(flatArray(cfg))) {
      const path = this.#mapping[p] ?? p
      this.set(path, value, path)
    }
  }

  get(path: string, fallback: unknown = null): unknown {
    return arrayRead(path, this.#data, fallback)
  }

  getDefault(canonicalPath: string, fallback: unknown = null): unknown {
    return arrayRead(canonicalPath, this.#defaults, fallback)
  }

  /** pma: ConfigFile::getValue */
  getValue(path: string, fallback: unknown = null): unknown {
    const v = arrayRead(path, this.#data)
    if (v !== null) return v
    return this.getDefault(canonical(path), fallback)
  }

  /** pma: ConfigFile::getFlatDefaultConfig */
  getFlatDefaultConfig(): Record<string, unknown> {
    return flatArray(this.#defaults)
  }

  /** pma: ConfigFile::getServerCount */
  getServerCount(): number {
    const servers = this.#data.Servers
    return servers !== null && typeof servers === 'object' ? Object.keys(servers).length : 0
  }

  /** pma: ConfigFile::getServers */
  getServers(): Record<string, Record<string, unknown>> {
    return (this.#data.Servers ?? {}) as Record<string, Record<string, unknown>>
  }

  #hasServer(id: number): boolean {
    const v = this.getServers()[String(id)]
    return v !== undefined && v !== null
  }

  /** pma: ConfigFile::getServerDSN */
  getServerDSN(id: number): string {
    if (!this.#hasServer(id)) return ''
    const path = `Servers/${id}`
    let dsn = 'mysqli://'
    if (this.getValue(`${path}/auth_type`) === 'config') {
      dsn += String(this.getValue(`${path}/user`) ?? '')
      if (!phpEmpty(this.getValue(`${path}/password`))) dsn += ':***'
      dsn += '@'
    }
    if (this.getValue(`${path}/host`) !== 'localhost') {
      dsn += String(this.getValue(`${path}/host`) ?? '')
      const port = this.getValue(`${path}/port`)
      if (!phpEmpty(port)) dsn += `:${port}`
    } else {
      dsn += String(this.getValue(`${path}/socket`) ?? '')
    }
    return dsn
  }

  /** pma: ConfigFile::getServerName */
  getServerName(id: number): string {
    if (!this.#hasServer(id)) return ''
    const verbose = this.get(`Servers/${id}/verbose`)
    if (!phpEmpty(verbose)) return String(verbose)
    const host = this.get(`Servers/${id}/host`)
    return phpEmpty(host) ? 'localhost' : String(host)
  }

  /** pma: ConfigFile::removeServer: the next servers move down one index. */
  removeServer(id: number): void {
    if (!this.#hasServer(id)) return
    const servers = this.getServers()
    const last = this.getServerCount()
    for (let i = id; i < last; i++) servers[String(i)] = servers[String(i + 1)] as Record<string, unknown>
    delete servers[String(last)]
    if (this.#data.ServerDefault === undefined || this.#data.ServerDefault !== last) return
    delete this.#data.ServerDefault
  }

  /** pma: ConfigFile::getConfig: the stored tree, mapped keys written back. */
  getConfig(): Record<string, unknown> {
    const c = structuredClone(this.#data)
    for (const [mapTo, mapFrom] of Object.entries(this.#mapping)) {
      if (arrayRead(mapTo, c) === null) continue
      arrayWrite(mapTo, c, arrayRead(mapFrom, c))
      arrayRemove(mapFrom, c)
    }
    return c
  }

  /** pma: ConfigFile::getConfigArray (mapped keys move to the end) */
  getConfigArray(): Record<string, unknown> {
    const c = flatArray(this.#data)
    for (const key of this.#persist) if (!(key in c)) c[key] = this.getDefault(canonical(key))
    for (const [mapTo, mapFrom] of Object.entries(this.#mapping)) {
      if (c[mapFrom] === undefined || c[mapFrom] === null) continue
      const v = c[mapFrom]
      delete c[mapFrom]
      delete c[mapTo]
      c[mapTo] = v
    }
    return c
  }
}

/** ConfigFile::getCanonicalPath */
export function canonical(path: string): string {
  return path.replace(/^Servers\/\d+\//, 'Servers/1/')
}
