import { BookmarkRepository } from './bookmarks.ts'
import type { MetaConn } from './conn.ts'
import type { MetadataDriver, NavigationHidingBackend } from './driver.ts'
import { QueryHistory, type SessionHistoryEntry } from './history.ts'
import { PmadbDriver } from './pmadb-driver.ts'
import { type RecentFavoriteTable, RecentFavoriteTables, type TableType } from './recent-favorite.ts'
import type { RelationParameters } from './relation-parameters.ts'
import { TableUiPrefs, type UiPrefs, type UiPrefsTableInfo } from './uiprefs.ts'
import { type SessionUserConfig, UserPreferences } from './userprefs.ts'

/**
 * The parts of phpMyAdmin's `$_SESSION` the metadata layer owns, per browser session. Plain JSON
 * so the server can keep it in its session store.
 */
export interface MetaSessionState {
  /** `$_SESSION['tmpval']['recentTables'][server]` */
  recentTables?: Record<string, RecentFavoriteTable[]>
  /** `$_SESSION['tmpval']['favoriteTables'][server]` */
  favoriteTables?: Record<string, RecentFavoriteTable[]>
  /** `$_SESSION['tmpval']['favorites_synced'][server]` */
  favoritesSynced?: Record<string, boolean>
  /** `$_SESSION['tmpval']['table_uiprefs'][server][db][table]` */
  tableUiPrefs?: Record<string, Record<string, Record<string, UiPrefs>>>
  /** `$_SESSION['userconfig']` (session storage of preferences) */
  userconfig?: SessionUserConfig
  /** `$_SESSION['cache']['server_N']` (applied preferences) */
  prefsCache?: Record<string, { userprefs: Record<string, unknown>; type: string; configMtime: number }>
}

export type UserFeature = 'bookmarks' | 'history' | 'recent' | 'favorite' | 'uiPrefs' | 'userConfig'

export interface MetadataSettings {
  AllowSharedBookmarks: boolean
  QueryHistoryDB: boolean
  QueryHistoryMax: number
  MaxCharactersInDisplayedSQL: number
  NumRecentTables: number
  NumFavoriteTables: number
  MaxTableUiprefs: number
  DisableIS: boolean
}

export interface MetadataOptions {
  /** The control connection; null when none could be opened (every pmadb feature is then off). */
  control: MetaConn | null
  relationParameters: RelationParameters
  /** BetterMyAdmin's SQLite fallback for the per-user tables, or null. */
  local: MetadataDriver | null
  settings: MetadataSettings
  serverIndex: number
  /** The logged-in MySQL user (`selectedServer['user']`). */
  user: string
  state: MetaSessionState
  /** `$_SESSION['sql_history']` */
  sqlHistory: SessionHistoryEntry[]
  /** DbTableExists::hasTable on the user connection. */
  tableExists: (db: string, table: string) => Promise<boolean>
}

/**
 * Entry point for features: picks, per feature, the pmadb table when phpMyAdmin would use it,
 * else the local fallback store, else the session (phpMyAdmin's own fallback).
 */
export class Metadata {
  readonly opts: MetadataOptions
  readonly pmadb: PmadbDriver | null

  constructor(opts: MetadataOptions) {
    this.opts = opts
    this.pmadb =
      opts.control === null
        ? null
        : new PmadbDriver(opts.control, opts.relationParameters, { disableIS: opts.settings.DisableIS })
  }

  get relationParameters(): RelationParameters {
    return this.opts.relationParameters
  }

  #pick<K extends UserFeature>(
    k: K,
  ): { backend: NonNullable<MetadataDriver[K]>; kind: 'pmadb' | 'local' } | null {
    const p = this.pmadb?.[k]
    if (p !== null && p !== undefined) return { backend: p as NonNullable<MetadataDriver[K]>, kind: 'pmadb' }
    const l = this.opts.local?.[k]
    if (l !== null && l !== undefined) return { backend: l as NonNullable<MetadataDriver[K]>, kind: 'local' }
    return null
  }

  /** Which store serves each per-user feature (`null` = session only / unavailable). */
  stores(): Record<UserFeature, 'pmadb' | 'local' | null> {
    const k = (x: UserFeature) => this.#pick(x)?.kind ?? null
    return {
      bookmarks: k('bookmarks'),
      history: k('history'),
      recent: k('recent'),
      favorite: k('favorite'),
      uiPrefs: k('uiPrefs'),
      userConfig: k('userConfig'),
    }
  }

  bookmarks(): BookmarkRepository {
    return new BookmarkRepository(
      this.#pick('bookmarks')?.backend ?? null,
      this.opts.settings.AllowSharedBookmarks,
    )
  }

  history(): QueryHistory {
    return new QueryHistory(this.#pick('history')?.backend ?? null, this.opts.settings, this.opts.sqlHistory)
  }

  async recentFavorite(type: TableType): Promise<RecentFavoriteTables> {
    const key = type === 'recent' ? 'recentTables' : 'favoriteTables'
    const server = String(this.opts.serverIndex)
    return RecentFavoriteTables.load({
      type,
      backend: this.#pick(type)?.backend ?? null,
      username: this.opts.user,
      max: type === 'recent' ? this.opts.settings.NumRecentTables : this.opts.settings.NumFavoriteTables,
      sessionList: this.opts.state[key]?.[server],
      tableExists: this.opts.tableExists,
    })
  }

  /** `RecentFavoriteTables::__destruct`: write the list back into the session. */
  storeRecentFavorite(list: RecentFavoriteTables): void {
    const key = list.type === 'recent' ? 'recentTables' : 'favoriteTables'
    this.opts.state[key] ??= {}
    ;(this.opts.state[key] as Record<string, RecentFavoriteTable[]>)[String(this.opts.serverIndex)] =
      list.toSession()
  }

  uiPrefs(db: string, table: string, info: UiPrefsTableInfo): TableUiPrefs {
    const server = String(this.opts.serverIndex)
    const state = this.opts.state
    return new TableUiPrefs({
      backend: this.#pick('uiPrefs')?.backend ?? null,
      username: this.opts.user,
      db,
      table,
      maxRows: this.opts.settings.MaxTableUiprefs,
      info,
      sessionSlot: {
        get: () => state.tableUiPrefs?.[server]?.[db]?.[table],
        set: (p) => {
          state.tableUiPrefs ??= {}
          state.tableUiPrefs[server] ??= {}
          const s = state.tableUiPrefs[server] as Record<string, Record<string, UiPrefs>>
          s[db] ??= {}
          ;(s[db] as Record<string, UiPrefs>)[table] = p
        },
      },
    })
  }

  userPreferences(): UserPreferences {
    const picked = this.#pick('userConfig')
    const state = this.opts.state
    const server = `server_${this.opts.serverIndex}`
    return new UserPreferences({
      backend: picked?.backend ?? null,
      kind: picked?.kind === 'local' ? 'local' : 'db',
      username: picked?.kind === 'pmadb' ? this.opts.relationParameters.user : this.opts.user,
      session: {
        get: () => state.userconfig,
        set: (v) => {
          state.userconfig = v
        },
      },
      invalidate: () => {
        if (state.prefsCache !== undefined) delete state.prefsCache[server]
      },
    })
  }

  navigationHiding(): NavigationHidingBackend | null {
    return this.pmadb?.navigationHiding ?? null
  }
}
