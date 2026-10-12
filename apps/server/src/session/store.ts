import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Per-server login inside one browser session. */
export interface ServerLogin {
  user: string
  /** SecretBox ciphertext of JSON {password, host?, port?}. */
  credEnc: string
  twoFactorOk: boolean
  /** Arbitrary server host/port when AllowArbitraryServer was used. */
  host?: string
  port?: number
  /** DefaultConnectionCollation chosen on the home page (session-level user preference). */
  collation?: string
  /** SessionCache equivalent for this server: is_superuser, binary_logs, menu-levels-*, … (pma: Utils/SessionCache.php) */
  cache?: Record<string, unknown>
}

export interface SessionData {
  id: string
  createdAt: number
  lastSeenAt: number
  csrfToken: string
  /** Per-session HMAC secret for signed SQL (pma: $_SESSION[' HMAC_secret ']). */
  hmacSecret: string
  currentServer: number
  servers: Record<string, ServerLogin>
  /** Set when logins were dropped for inactivity; cleared on the next login. */
  expired?: boolean
  /** Debug SQL entries of the last request when DBG.sql is on. */
  debugSql?: Array<{ sql: string; ms: number; label?: string }>
  /** Query history kept in the session when QueryHistoryDB is off (pma: $_SESSION['sql_history']). */
  sqlHistory?: Array<{ db: string; table: string; sqlquery: string }>
  /** $_SESSION['profiling']: the Profiling switch is on. */
  profiling?: boolean
  /** SessionCache 'profiling_supported' per server index. */
  profilingSupported?: Record<string, boolean>
  /** Configuration-storage state owned by src/metadata/service.ts (pma: parts of $_SESSION). */
  metadata?: Record<string, unknown>
  /** $_SESSION['partial_logout']: shown once on the home page */
  partialLogout?: boolean
  /** $_SESSION['tmpval']['query'][md5]: per-query grid state of the last 10 queries (src/browse/view-state.ts). */
  gridQueries?: Record<string, Record<string, unknown>>
  /** SendErrorReports persisted by "Automatically send report next time" (until the prefs layer stores it). */
  sendErrorReports?: 'ask' | 'always' | 'never'
  /** `2fa_application_key` and the WebAuthn options of the two-factor backends (src/preferences/two-factor.ts) */
  twoFactor?: { applicationKey?: string; webauthnCreation?: string; webauthnRequest?: string }
  /** $_SESSION['userprefs_autoload']: the localStorage import offer was answered or used */
  userprefsAutoload?: boolean
  /** $_SESSION['tmpval']['aliases']: the last export's rename-dialog aliases (Back link repopulation). */
  exportAliases?: Record<string, unknown>
}

export interface SessionStore {
  get(id: string): SessionData | null
  set(session: SessionData): void
  delete(id: string): void
  /** Removes sessions idle for longer than `maxIdleSeconds`. */
  sweep(now: number, maxIdleSeconds: number): number
  close(): void
}

export class MemorySessionStore implements SessionStore {
  readonly #map = new Map<string, string>()

  get(id: string): SessionData | null {
    const raw = this.#map.get(id)
    return raw === undefined ? null : (JSON.parse(raw) as SessionData)
  }

  set(session: SessionData): void {
    this.#map.set(session.id, JSON.stringify(session))
  }

  delete(id: string): void {
    this.#map.delete(id)
  }

  sweep(now: number, maxIdleSeconds: number): number {
    let n = 0
    for (const [id, raw] of this.#map) {
      if ((JSON.parse(raw) as SessionData).lastSeenAt < now - maxIdleSeconds) {
        this.#map.delete(id)
        n++
      }
    }
    return n
  }

  close(): void {
    this.#map.clear()
  }
}

/** Default store: one SQLite file in DataDir (docs/architecture/06-data-and-metadata-model.md#sessions). */
export class SqliteSessionStore implements SessionStore {
  readonly #db: DatabaseSync

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.#db = new DatabaseSync(file)
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_last_seen ON sessions (last_seen_at);
    `)
  }

  get(id: string): SessionData | null {
    const row = this.#db.prepare('SELECT data FROM sessions WHERE id = ?').get(id) as
      | { data: string }
      | undefined
    return row === undefined ? null : (JSON.parse(row.data) as SessionData)
  }

  set(session: SessionData): void {
    this.#db
      .prepare(
        `INSERT INTO sessions (id, created_at, last_seen_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, data = excluded.data`,
      )
      .run(session.id, session.createdAt, session.lastSeenAt, JSON.stringify(session))
  }

  delete(id: string): void {
    this.#db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }

  sweep(now: number, maxIdleSeconds: number): number {
    const r = this.#db.prepare('DELETE FROM sessions WHERE last_seen_at < ?').run(now - maxIdleSeconds)
    return Number(r.changes)
  }

  close(): void {
    this.#db.close()
  }
}
