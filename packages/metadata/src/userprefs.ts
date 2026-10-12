import type { UserConfigBackend } from './driver.ts'
import { isPhpArray, phpJsonDecode, phpJsonEncode } from './php.ts'

export type ConfigData = Record<string, unknown>
export type StorageType = 'db' | 'local' | 'session'

export interface LoadedPrefs {
  config_data: ConfigData
  mtime: number
  /** `db` = pmadb, `local` = BetterMyAdmin's SQLite fallback, `session` = this session only. */
  type: StorageType
}

export interface PrefsMessage {
  type: 'error'
  text: string
  detail?: string
  /** the storage database could not be accessed (an extra line) */
  inaccessible?: true
}

/** `$_SESSION['userconfig']` */
export interface SessionUserConfig {
  db: ConfigData
  ts: number
}

/**
 * Storage of user preferences: pmadb (`userconfig`), the local store, or the session.
 *
 * pma: src/Config/UserPreferences.php
 */
export class UserPreferences {
  readonly backend: UserConfigBackend | null
  readonly kind: StorageType
  readonly username: string | null
  readonly session: { get(): SessionUserConfig | undefined; set(v: SessionUserConfig): void }
  readonly now: () => number
  /** Invalidates the per-server applied-prefs cache (`$_SESSION['cache']['server_N']['userprefs']`). */
  readonly invalidate: () => void

  constructor(opts: {
    backend: UserConfigBackend | null
    kind: 'db' | 'local'
    /** RelationParameters::$user (pmadb) or the logged-in user (local store) */
    username: string | null
    session: { get(): SessionUserConfig | undefined; set(v: SessionUserConfig): void }
    invalidate?: () => void
    now?: () => number
  }) {
    this.backend = opts.backend
    this.kind = opts.backend === null ? 'session' : opts.kind
    this.username = opts.username
    this.session = opts.session
    this.invalidate = opts.invalidate ?? (() => {})
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000))
  }

  /** pma: UserPreferences::load */
  async load(): Promise<LoadedPrefs> {
    if (this.backend === null || this.username === null) {
      let s = this.session.get()
      if (s === undefined) {
        s = { db: {}, ts: this.now() }
        this.session.set(s)
      }
      return {
        config_data: isPhpArray(s.db) ? toMap(s.db) : {},
        mtime: Number.isInteger(s.ts) ? s.ts : this.now(),
        type: 'session',
      }
    }
    const row = await this.backend.load(this.username)
    if (row === null) return { config_data: {}, mtime: this.now(), type: this.kind }
    const data = phpJsonDecode(row.configData)
    return {
      config_data: isPhpArray(data) ? toMap(data) : {},
      mtime: Number.isFinite(row.ts) ? row.ts : this.now(),
      type: this.kind,
    }
  }

  /**
   * Saves the whole preference map. A save without `2fa` keeps the stored `2fa` block (page
   * settings and form saves must never drop two-factor configuration).
   *
   * pma: UserPreferences::save
   */
  async save(configArray: ConfigData): Promise<true | PrefsMessage> {
    const data = { ...configArray }
    if (data['2fa'] === undefined || data['2fa'] === null) {
      const existing = await this.load()
      const tfa = existing.config_data['2fa']
      if (tfa !== undefined && tfa !== null) data['2fa'] = tfa
    }
    if (this.backend === null || this.username === null) {
      this.session.set({ db: data, ts: this.now() })
      this.invalidate()
      return true
    }
    const json = phpJsonEncode(data)
    this.invalidate()
    const r = await this.backend.save(this.username, json)
    if (r === true) return true
    return {
      type: 'error',
      text: r.error,
      ...(r.detail !== undefined ? { detail: r.detail } : {}),
      ...(r.inaccessible === true ? { inaccessible: true as const } : {}),
    }
  }

  /**
   * Updates one option; removes it when it equals the default.
   * pma: UserPreferences::persistOption
   */
  async persistOption(path: string, value: unknown, defaultValue: unknown): Promise<true | PrefsMessage> {
    const prefs = await this.load()
    if (phpIdentical(value, defaultValue)) {
      if (prefs.config_data[path] === undefined || prefs.config_data[path] === null) return true
      delete prefs.config_data[path]
    } else {
      prefs.config_data[path] = value
    }
    return this.save(prefs.config_data)
  }
}

function toMap(v: unknown[] | Record<string, unknown>): ConfigData {
  return Array.isArray(v) ? Object.fromEntries(v.map((x, i) => [String(i), x])) : { ...v }
}

/** PHP `===` for decoded JSON / config values. */
export function phpIdentical(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Filters stored preferences to the user-form fields (+ the custom-handled keys) minus
 * `UserprefsDisallow`, expanding `a/b` paths into nested objects.
 *
 * pma: UserPreferences::apply (+ Core::arrayWrite)
 */
export function applyUserPreferences(
  configData: ConfigData,
  userFormFields: readonly string[],
  disallow: readonly string[],
): Record<string, unknown> {
  const exclude = new Set(disallow)
  const allow = new Set([
    ...userFormFields,
    'ThemeDefault',
    'lang',
    'Server/hide_db',
    'Server/only_db',
    '2fa',
  ])
  const cfg: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(configData)) {
    if (!allow.has(path) || exclude.has(path)) continue
    arrayWrite(path, cfg, value)
  }
  return cfg
}

/** pma: src/Core.php::arrayWrite */
export function arrayWrite(path: string, array: Record<string, unknown>, value: unknown): void {
  const keys = path.split('/')
  const last = keys.pop() as string
  let a: Record<string, unknown> = array
  for (const key of keys) {
    const next = a[key]
    if (next === undefined || next === null || typeof next !== 'object') a[key] = {}
    a = a[key] as Record<string, unknown>
  }
  a[last] = value
}

/** pma: src/Core.php::arrayRead */
export function arrayRead(path: string, array: unknown, fallback: unknown = null): unknown {
  let a: unknown = array
  for (const key of path.split('/')) {
    if (a === null || typeof a !== 'object' || !(key in (a as object))) return fallback
    a = (a as Record<string, unknown>)[key]
  }
  return a
}
