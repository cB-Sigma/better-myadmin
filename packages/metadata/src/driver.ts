/**
 * One interface, two drivers: the per-user metadata the repositories need, stored either in the
 * phpMyAdmin configuration storage (`PmadbDriver`, exactly phpMyAdmin's SQL on the control
 * connection) or in BetterMyAdmin's local SQLite fallback (`SqliteDriver`, keyed by server index
 * and MySQL user). docs/architecture/06-data-and-metadata-model.md#local-fallback-store-new
 */

export interface BookmarkRow {
  id: number
  dbase: string
  user: string
  label: string
  query: string
}

export interface HistoryRow {
  db: string
  table: string
  sqlquery: string
  timevalue: string
}

export type SaveResult = true | { error: string; detail?: string }

export interface BookmarkBackend {
  /** BookmarkRepository::getList */
  list(user: string, db: string | false, exactUserMatch: boolean): Promise<BookmarkRow[]>
  /** BookmarkRepository::get */
  get(user: string | null, id: number, exactUserMatch: boolean): Promise<BookmarkRow | null>
  /** BookmarkRepository::getByLabel */
  getByLabel(user: string, db: string, label: string): Promise<BookmarkRow | null>
  /** Bookmark::save */
  insert(b: Omit<BookmarkRow, 'id'>): Promise<boolean>
  /** Bookmark::delete */
  delete(id: number): Promise<boolean>
}

export interface HistoryBackend {
  /** History::setHistory (INSERT) followed by History::purgeHistory */
  add(username: string, db: string, table: string, sqlquery: string, max: number): Promise<void>
  /** History::getHistory (newest first) */
  list(username: string): Promise<HistoryRow[]>
}

export interface RecentFavoriteBackend {
  /** RecentFavoriteTables::getFromDb — the stored JSON text, null when there is none */
  read(username: string): Promise<string | null>
  /** RecentFavoriteTables::saveToDb */
  write(username: string, json: string): Promise<SaveResult>
}

export interface UiPrefsBackend {
  /** Table::getUiPrefsFromDb — the stored JSON text */
  read(username: string, db: string, table: string): Promise<string | null>
  /** Table::saveUiPrefsToDb (REPLACE + trim to MaxTableUiprefs) */
  write(username: string, db: string, table: string, json: string, maxRows: number): Promise<SaveResult>
}

export interface UserConfigBackend {
  /** UserPreferences::load (db branch) */
  load(username: string): Promise<{ configData: string; ts: number } | null>
  /** UserPreferences::save (db branch) */
  save(username: string, json: string): Promise<SaveResult>
}

export interface NavigationHidingBackend {
  hide(username: string, itemName: string, itemType: string, dbName: string): Promise<void>
  unhide(username: string, itemName: string, itemType: string, dbName: string): Promise<void>
  /** Navigation::getHiddenItems: item_type → names, for one database */
  hiddenItems(username: string, db: string): Promise<Record<string, string[]>>
  /** NodeDatabase::getHiddenItems */
  hiddenOfType(username: string, type: string, db: string): Promise<string[]>
  /** Node::getNavigationHidingData */
  hiddenCounts(username: string): Promise<Record<string, number>>
}

/** What one driver offers; `null` when that feature is not available through it. */
export interface MetadataDriver {
  readonly kind: 'pmadb' | 'local'
  readonly bookmarks: BookmarkBackend | null
  readonly history: HistoryBackend | null
  readonly recent: RecentFavoriteBackend | null
  readonly favorite: RecentFavoriteBackend | null
  readonly uiPrefs: UiPrefsBackend | null
  readonly userConfig: UserConfigBackend | null
  readonly navigationHiding: NavigationHidingBackend | null
}
