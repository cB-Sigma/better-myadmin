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
  /** Signon `PMA_single_signon_cfgupdate`: server settings merged for this login (AuthenticationSignon). */
  cfgUpdate?: Record<string, unknown>
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
  /**
   * $_SESSION['browser_access_time']: per browser window (guid) the time of the user's last
   * activity, reported by the idle check (`lastSeenAt` is the 'default' entry, the last request).
   */
  browserAccess?: Record<string, number>
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
  /** Why the last page load of an http / signon server did not log in (auth/page-gate.ts). */
  authFailure?: { server: number; failure: { kind: 'http' } | { kind: 'error'; message: string } }
  /** The setup script: $_SESSION['ConfigFile<server>'], ['messages'], ['eol'] (src/setup/service.ts). */
  setup?: { config: Record<string, unknown>; messages?: unknown; eol?: 'unix' | 'win'; saved?: string }
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

/**
 * Where sessions live (`SessionStore` directive): SQLite in DataDir by default, Redis to share them
 * between several BetterMyAdmin processes. Asynchronous, so a networked store fits.
 */
export interface SessionStore {
  get(id: string): Promise<SessionData | null>
  set(session: SessionData): Promise<void>
  delete(id: string): Promise<void>
  /** Removes sessions idle for longer than `maxIdleSeconds` (Redis expires them by itself). */
  sweep(now: number, maxIdleSeconds: number): Promise<number>
  close(): Promise<void>
}

export class MemorySessionStore implements SessionStore {
  readonly #map = new Map<string, string>()

  async get(id: string): Promise<SessionData | null> {
    const raw = this.#map.get(id)
    return raw === undefined ? null : (JSON.parse(raw) as SessionData)
  }

  async set(session: SessionData): Promise<void> {
    this.#map.set(session.id, JSON.stringify(session))
  }

  async delete(id: string): Promise<void> {
    this.#map.delete(id)
  }

  async sweep(now: number, maxIdleSeconds: number): Promise<number> {
    let n = 0
    for (const [id, raw] of this.#map) {
      if ((JSON.parse(raw) as SessionData).lastSeenAt < now - maxIdleSeconds) {
        this.#map.delete(id)
        n++
      }
    }
    return n
  }

  async close(): Promise<void> {
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

  async get(id: string): Promise<SessionData | null> {
    const row = this.#db.prepare('SELECT data FROM sessions WHERE id = ?').get(id) as
      | { data: string }
      | undefined
    return row === undefined ? null : (JSON.parse(row.data) as SessionData)
  }

  async set(session: SessionData): Promise<void> {
    this.#db
      .prepare(
        `INSERT INTO sessions (id, created_at, last_seen_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, data = excluded.data`,
      )
      .run(session.id, session.createdAt, session.lastSeenAt, JSON.stringify(session))
  }

  async delete(id: string): Promise<void> {
    this.#db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }

  async sweep(now: number, maxIdleSeconds: number): Promise<number> {
    const r = this.#db.prepare('DELETE FROM sessions WHERE last_seen_at < ?').run(now - maxIdleSeconds)
    return Number(r.changes)
  }

  async close(): Promise<void> {
    this.#db.close()
  }
}

/** The subset of a node-redis client the store uses (a fake one in the unit tests). */
export interface RedisLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options: { EX: number }): Promise<unknown>
  del(key: string): Promise<unknown>
  close?(): Promise<unknown>
  quit?(): Promise<unknown>
}

/**
 * `SessionStore: 'redis'`: one key per session (`<prefix><id>`, the JSON as in SQLite), expiring
 * `ttlSeconds` after its last write, so idle sessions disappear without a sweep and several
 * processes behind a load balancer share them.
 */
export class RedisSessionStore implements SessionStore {
  readonly #client: RedisLike
  readonly #ttl: number
  readonly #prefix: string

  constructor(client: RedisLike, ttlSeconds: number, prefix = 'bettermyadmin:session:') {
    this.#client = client
    this.#ttl = Math.max(1, Math.ceil(ttlSeconds))
    this.#prefix = prefix
  }

  async get(id: string): Promise<SessionData | null> {
    const raw = await this.#client.get(this.#prefix + id)
    return raw === null ? null : (JSON.parse(raw) as SessionData)
  }

  async set(session: SessionData): Promise<void> {
    await this.#client.set(this.#prefix + session.id, JSON.stringify(session), { EX: this.#ttl })
  }

  async delete(id: string): Promise<void> {
    await this.#client.del(this.#prefix + id)
  }

  /** Redis expires idle sessions itself (the TTL is renewed by every request's write). */
  async sweep(): Promise<number> {
    return 0
  }

  async close(): Promise<void> {
    await (this.#client.close?.() ?? this.#client.quit?.())
  }
}

/**
 * Connects to `RedisUrl` (redis:// or rediss://, credentials and database in the URL) and returns
 * the store; fails with the server's error when Redis cannot be reached, so the server does not start
 * with sessions it cannot keep.
 */
export async function connectRedisStore(url: string, ttlSeconds: number): Promise<RedisSessionStore> {
  if (url === '') throw new Error('SessionStore is "redis" but RedisUrl is empty')
  const { createClient } = await import('redis')
  let ready = false
  let firstError: Error | null = null
  const client = createClient({
    url,
    socket: {
      connectTimeout: 10_000,
      // once running, reconnect with a backoff; before that, give up with the reason (a wrong password
      // or host would otherwise retry forever and the server would never start)
      reconnectStrategy: (retries: number, cause: Error) =>
        ready ? Math.min(100 * 2 ** retries, 5_000) : (firstError ?? cause),
    },
  })
  client.on('error', (e: Error) => {
    if (!ready) firstError ??= e
    else console.error(`redis: ${e.message}`)
  })
  try {
    await withTimeout(client.connect(), 15_000, 'Redis did not answer')
    await withTimeout(client.ping(), 15_000, 'Redis did not answer')
  } catch (e) {
    client.destroy()
    throw new Error(`cannot use Redis at ${redactUrl(url)}: ${(firstError ?? (e as Error)).message}`)
  }
  ready = true
  return new RedisSessionStore(client as unknown as RedisLike, ttlSeconds)
}

/** The URL without its password, for messages. */
function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.password !== '') u.password = '***'
    return u.toString()
  } catch {
    return 'RedisUrl'
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
