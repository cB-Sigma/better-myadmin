import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  BookmarkBackend,
  BookmarkRow,
  HistoryBackend,
  HistoryRow,
  MetadataDriver,
  RecentFavoriteBackend,
  SaveResult,
  UiPrefsBackend,
  UserConfigBackend,
} from './driver.ts'

/**
 * The per-user pmadb tables with the same shapes, plus a `server` column: one row set per
 * (server index, MySQL user). Relational metadata (relation, table_info, column_info, tracking,
 * navigationhiding, ...) is deliberately absent: it describes the database and must be shared.
 * docs/architecture/06-data-and-metadata-model.md#local-fallback-store-new
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS bookmark (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server INTEGER NOT NULL,
  dbase TEXT NOT NULL DEFAULT '',
  user TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  query TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server INTEGER NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  db TEXT NOT NULL DEFAULT '',
  "table" TEXT NOT NULL DEFAULT '',
  timevalue TEXT NOT NULL,
  sqlquery TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_username ON history (server, username, db, "table", timevalue);
CREATE TABLE IF NOT EXISTS recent (
  server INTEGER NOT NULL,
  username TEXT NOT NULL,
  tables TEXT NOT NULL,
  PRIMARY KEY (server, username)
);
CREATE TABLE IF NOT EXISTS favorite (
  server INTEGER NOT NULL,
  username TEXT NOT NULL,
  tables TEXT NOT NULL,
  PRIMARY KEY (server, username)
);
CREATE TABLE IF NOT EXISTS table_uiprefs (
  server INTEGER NOT NULL,
  username TEXT NOT NULL,
  db_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  prefs TEXT NOT NULL,
  last_update TEXT NOT NULL,
  PRIMARY KEY (server, username, db_name, table_name)
);
CREATE TABLE IF NOT EXISTS userconfig (
  server INTEGER NOT NULL,
  username TEXT NOT NULL,
  timevalue INTEGER NOT NULL,
  config_data TEXT NOT NULL,
  PRIMARY KEY (server, username)
);
CREATE TABLE IF NOT EXISTS designer_settings (
  server INTEGER NOT NULL,
  username TEXT NOT NULL,
  settings_data TEXT NOT NULL,
  PRIMARY KEY (server, username)
);
CREATE TABLE IF NOT EXISTS export_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server INTEGER NOT NULL,
  username TEXT NOT NULL,
  export_type TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_data TEXT NOT NULL,
  UNIQUE (server, username, export_type, template_name)
);
CREATE TABLE IF NOT EXISTS savedsearches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server INTEGER NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  db_name TEXT NOT NULL DEFAULT '',
  search_name TEXT NOT NULL DEFAULT '',
  search_data TEXT NOT NULL,
  UNIQUE (server, username, db_name, search_name)
);
`

const pad = (n: number) => String(n).padStart(2, '0')
/** MySQL `NOW()` text in the process time zone. */
function now(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

type SqlRow = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))

/** Opened once per process; every (server, user) pair shares the file. */
export class LocalMetadataStore {
  readonly db: DatabaseSync
  /** Monotonic clock for rows written within the same second (history purge, uiprefs eviction). */
  #seq = 0

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(SCHEMA)
  }

  driver(server: number): SqliteDriver {
    return new SqliteDriver(this, server)
  }

  nextSeq(): number {
    this.#seq += 1
    return this.#seq
  }

  close(): void {
    this.db.close()
  }
}

class SqliteBookmarks implements BookmarkBackend {
  constructor(
    readonly db: DatabaseSync,
    readonly server: number,
  ) {}

  #row(r: SqlRow): BookmarkRow {
    return { id: Number(r.id), dbase: s(r.dbase), user: s(r.user), label: s(r.label), query: s(r.query) }
  }

  async list(user: string, db: string | false, exactUserMatch: boolean): Promise<BookmarkRow[]> {
    const args: Array<string | number> = [this.server, user]
    let sql = `SELECT * FROM bookmark WHERE server = ? AND (user = ?${exactUserMatch ? '' : " OR user = ''"})`
    if (db !== false) {
      sql += ' AND dbase = ?'
      args.push(db)
    }
    sql += ' ORDER BY label ASC'
    return (this.db.prepare(sql).all(...args) as SqlRow[]).map((r) => this.#row(r))
  }

  async get(user: string | null, id: number, exactUserMatch: boolean): Promise<BookmarkRow | null> {
    const args: Array<string | number> = [this.server, id]
    let sql = 'SELECT * FROM bookmark WHERE server = ? AND id = ?'
    if (user !== null) {
      sql += ` AND (user = ?${exactUserMatch ? '' : " OR user = ''"})`
      args.push(user)
    }
    const r = this.db.prepare(`${sql} LIMIT 1`).get(...args) as SqlRow | undefined
    return r === undefined ? null : this.#row(r)
  }

  async getByLabel(user: string, db: string, label: string): Promise<BookmarkRow | null> {
    const r = this.db
      .prepare('SELECT * FROM bookmark WHERE server = ? AND label = ? AND dbase = ? AND user = ? LIMIT 1')
      .get(this.server, label, db, user) as SqlRow | undefined
    return r === undefined ? null : this.#row(r)
  }

  async insert(b: Omit<BookmarkRow, 'id'>): Promise<boolean> {
    this.db
      .prepare('INSERT INTO bookmark (server, dbase, user, query, label) VALUES (?, ?, ?, ?, ?)')
      .run(this.server, b.dbase, b.user, b.query, b.label)
    return true
  }

  async delete(id: number): Promise<boolean> {
    this.db.prepare('DELETE FROM bookmark WHERE server = ? AND id = ?').run(this.server, id)
    return true
  }
}

class SqliteHistory implements HistoryBackend {
  constructor(
    readonly db: DatabaseSync,
    readonly server: number,
  ) {}

  async add(username: string, db: string, table: string, sqlquery: string, max: number): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO history (server, username, db, "table", timevalue, sqlquery) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(this.server, username, db, table, now(), sqlquery)
    // History::purgeHistory, by id instead of timevalue (same result without second ties)
    const cut = this.db
      .prepare('SELECT id FROM history WHERE server = ? AND username = ? ORDER BY id DESC LIMIT ?, 1')
      .get(this.server, username, max) as SqlRow | undefined
    if (cut !== undefined) {
      this.db
        .prepare('DELETE FROM history WHERE server = ? AND username = ? AND id <= ?')
        .run(this.server, username, Number(cut.id))
    }
  }

  async list(username: string): Promise<HistoryRow[]> {
    return (
      this.db
        .prepare(
          'SELECT db, "table", sqlquery, timevalue FROM history WHERE server = ? AND username = ? ORDER BY id DESC',
        )
        .all(this.server, username) as SqlRow[]
    ).map((r) => ({ db: s(r.db), table: s(r.table), sqlquery: s(r.sqlquery), timevalue: s(r.timevalue) }))
  }
}

class SqliteRecentFavorite implements RecentFavoriteBackend {
  constructor(
    readonly db: DatabaseSync,
    readonly server: number,
    readonly table: 'recent' | 'favorite',
  ) {}

  async read(username: string): Promise<string | null> {
    const r = this.db
      .prepare(`SELECT tables FROM ${this.table} WHERE server = ? AND username = ?`)
      .get(this.server, username) as SqlRow | undefined
    return r === undefined ? null : s(r.tables)
  }

  async write(username: string, json: string): Promise<SaveResult> {
    this.db
      .prepare(`REPLACE INTO ${this.table} (server, username, tables) VALUES (?, ?, ?)`)
      .run(this.server, username, json)
    return true
  }
}

class SqliteUiPrefs implements UiPrefsBackend {
  constructor(
    readonly store: LocalMetadataStore,
    readonly server: number,
  ) {}

  async read(username: string, db: string, table: string): Promise<string | null> {
    const r = this.store.db
      .prepare(
        'SELECT prefs FROM table_uiprefs WHERE server = ? AND username = ? AND db_name = ? AND table_name = ?',
      )
      .get(this.server, username, db, table) as SqlRow | undefined
    return r === undefined ? null : s(r.prefs)
  }

  async write(
    username: string,
    db: string,
    table: string,
    json: string,
    maxRows: number,
  ): Promise<SaveResult> {
    const stamp = `${now()}#${String(this.store.nextSeq()).padStart(12, '0')}`
    const d = this.store.db
    d.prepare(
      'REPLACE INTO table_uiprefs (server, username, db_name, table_name, prefs, last_update) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(this.server, username, db, table, json, stamp)
    const count = Number(
      (d.prepare('SELECT COUNT(*) AS n FROM table_uiprefs WHERE server = ?').get(this.server) as SqlRow).n,
    )
    if (count > maxRows) {
      d.prepare(
        'DELETE FROM table_uiprefs WHERE rowid IN (SELECT rowid FROM table_uiprefs WHERE server = ? ORDER BY last_update ASC LIMIT ?)',
      ).run(this.server, count - maxRows)
    }
    return true
  }
}

class SqliteUserConfig implements UserConfigBackend {
  constructor(
    readonly db: DatabaseSync,
    readonly server: number,
  ) {}

  async load(username: string): Promise<{ configData: string; ts: number } | null> {
    const r = this.db
      .prepare('SELECT config_data, timevalue FROM userconfig WHERE server = ? AND username = ?')
      .get(this.server, username) as SqlRow | undefined
    return r === undefined ? null : { configData: s(r.config_data), ts: Number(r.timevalue) }
  }

  async save(username: string, json: string): Promise<SaveResult> {
    this.db
      .prepare('REPLACE INTO userconfig (server, username, timevalue, config_data) VALUES (?, ?, ?, ?)')
      .run(this.server, username, Math.floor(Date.now() / 1000), json)
    return true
  }
}

export class SqliteDriver implements MetadataDriver {
  readonly kind = 'local' as const
  readonly bookmarks: BookmarkBackend
  readonly history: HistoryBackend
  readonly recent: RecentFavoriteBackend
  readonly favorite: RecentFavoriteBackend
  readonly uiPrefs: UiPrefsBackend
  readonly userConfig: UserConfigBackend
  readonly navigationHiding = null

  constructor(store: LocalMetadataStore, server: number) {
    this.bookmarks = new SqliteBookmarks(store.db, server)
    this.history = new SqliteHistory(store.db, server)
    this.recent = new SqliteRecentFavorite(store.db, server, 'recent')
    this.favorite = new SqliteRecentFavorite(store.db, server, 'favorite')
    this.uiPrefs = new SqliteUiPrefs(store, server)
    this.userConfig = new SqliteUserConfig(store.db, server)
  }
}
