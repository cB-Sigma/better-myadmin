import { defaults, serverDefaults } from '@bettermyadmin/config'
import { arrayRead, arrayWrite, phpIdentical } from '@bettermyadmin/metadata'

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
  readonly #base: Record<string, unknown>
  #allowed: Set<string> | null = null
  #mapping: Record<string, string> = {}

  /** `base`: the configuration without user preferences (Config::$baseSettings) */
  constructor(base: Record<string, unknown>, defaultsTree: Record<string, unknown> = defaultSettingsTree()) {
    this.#base = base
    this.#defaults = defaultsTree
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
    const defaultValue = this.getDefault(canonicalPath)
    // keep a value that config.inc.php changed even when it equals the default
    const instanceDefault = arrayRead(canonicalPath, this.#base)
    if (phpIdentical(value, defaultValue) && phpIdentical(instanceDefault, defaultValue)) {
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

  /** pma: ConfigFile::getConfigArray (mapped keys move to the end) */
  getConfigArray(): Record<string, unknown> {
    const c = flatArray(this.#data)
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
