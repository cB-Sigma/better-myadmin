import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { defaults } from '@bettermyadmin/config'
import {
  ConfigStorage,
  LocalMetadataStore,
  type MetaConn,
  type MetaSessionState,
  Metadata,
  type MetadataSettings,
  type QueryOutcome,
  type RelationParameters,
  STORAGE_TABLE_DIRECTIVES,
  type StorageServer,
  applyUserPreferences,
  getUserFormFields,
} from '@bettermyadmin/metadata'
import { backquote } from '@bettermyadmin/sql-gen'
import type { Context } from 'hono'
import { type AppConfig, type ServerConfig, getServer } from '../config.ts'
import type { Conn } from '../db/connection.ts'
import type { AcquiredControl } from '../db/control.ts'
import type { ServerEnv } from '../routes/server.ts'

// ---------------------------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------------------------

type StorageTables = Pick<StorageServer, 'pmadb' | (typeof STORAGE_TABLE_DIRECTIVES)[number]>

interface CachedRelation {
  params: RelationParameters
  /** `$cfg['Servers'][$i]` storage directives after ZeroConf filled them. */
  tables: StorageTables
}

interface ServerRelationCache {
  /** Valid for every request: storage found (or ruled out) without looking at the current db. */
  global?: CachedRelation
  /** ZeroConf found nothing in pmadb/`phpmyadmin`: the outcome depends on the request's db. */
  byDb?: Record<string, CachedRelation>
}

interface SessionMetadata {
  state: MetaSessionState
  relation: Record<string, ServerRelationCache>
}

function sessionMetadata(c: Context<ServerEnv>): SessionMetadata {
  const session = c.get('session')
  session.metadata ??= { state: {}, relation: {} }
  return session.metadata as unknown as SessionMetadata
}

/** Forgets the cached storage discovery (after creating tables, or on logout). */
export function resetRelationCache(c: Context<ServerEnv>, serverIndex: number): void {
  delete sessionMetadata(c).relation[String(serverIndex)]
}

// ---------------------------------------------------------------------------------------------
// Local fallback store (DataDir/local-metadata.sqlite)
// ---------------------------------------------------------------------------------------------

const localStores = new Map<string, LocalMetadataStore>()

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p
}

export function localStore(cfg: AppConfig): LocalMetadataStore | null {
  if (cfg.DataDir === '') return null
  const file =
    cfg.DataDir === ':memory:' ? ':memory:' : join(resolve(expandHome(cfg.DataDir)), 'local-metadata.sqlite')
  let store = localStores.get(file)
  if (store === undefined) {
    store = new LocalMetadataStore(file)
    localStores.set(file, store)
  }
  return store
}

// ---------------------------------------------------------------------------------------------
// The control link, opened on first use
// ---------------------------------------------------------------------------------------------

class LazyControl implements MetaConn {
  #acquired: AcquiredControl | null = null
  readonly #open: () => Promise<AcquiredControl>

  constructor(open: () => Promise<AcquiredControl>) {
    this.#open = open
  }

  async get(): Promise<AcquiredControl> {
    this.#acquired ??= await this.#open()
    return this.#acquired
  }

  get opened(): AcquiredControl | null {
    return this.#acquired
  }

  get lastError(): string {
    return this.#acquired?.conn.lastError ?? ''
  }

  get lastErrno(): number {
    return this.#acquired?.conn.lastErrno ?? 0
  }

  async query(sql: string): Promise<QueryOutcome> {
    return (await this.get()).conn.query(sql)
  }

  async tryQuery(sql: string): Promise<QueryOutcome | false> {
    return (await this.get()).conn.tryQuery(sql)
  }

  async selectDb(db: string): Promise<boolean> {
    return (await this.get()).conn.selectDb(db)
  }

  async tryMultiQuery(sql: string): Promise<boolean> {
    return (await this.get()).conn.tryMultiQuery(sql)
  }

  release(): void {
    this.#acquired?.conn.release()
  }
}

// ---------------------------------------------------------------------------------------------
// Per-request facade
// ---------------------------------------------------------------------------------------------

function storageServer(s: ServerConfig, user: string, tables?: StorageTables): StorageServer {
  const out = {
    user,
    pmadb: s.pmadb,
    MaxTableUiprefs: s.MaxTableUiprefs,
    DisableIS: s.DisableIS,
  } as StorageServer
  for (const d of STORAGE_TABLE_DIRECTIVES) out[d] = s[d]
  if (tables !== undefined) Object.assign(out, tables)
  return out
}

function snapshot(s: StorageServer): StorageTables {
  const out = { pmadb: s.pmadb } as StorageTables
  for (const d of STORAGE_TABLE_DIRECTIVES) out[d] = s[d]
  return out
}

export interface MetaRequestOptions {
  /** The request's current database (`Current::$database`, used by ZeroConf). */
  db?: string
}

/**
 * Everything a metadata route needs for one request: the storage discovery (cached per session,
 * phpMyAdmin redoes it per request), the repositories, the control link and the user link.
 */
export class MetaRequest {
  readonly c: Context<ServerEnv>
  readonly cfg: AppConfig
  readonly serverIndex: number
  readonly server: ServerConfig
  readonly user: string
  readonly currentDb: string
  readonly control: LazyControl
  #userConn: Conn | null = null
  #storage: ConfigStorage | null = null
  #meta: Metadata | null = null
  #settings: AppConfig | null = null

  constructor(c: Context<ServerEnv>, opts: MetaRequestOptions = {}) {
    this.c = c
    const { cfg, pools } = c.get('deps')
    this.cfg = cfg
    this.serverIndex = c.get('serverIndex')
    const server = getServer(cfg, this.serverIndex)
    if (server === undefined) throw new Error('unknown server')
    this.server = server
    this.user = c.get('creds').user
    this.currentDb = opts.db ?? ''
    const session = c.get('session')
    this.control = new LazyControl(() =>
      pools.control.acquire(session.id, this.serverIndex, c.get('creds'), c.get('executed')),
    )
  }

  get state(): MetaSessionState {
    return sessionMetadata(this.c).state
  }

  /** The user's own connection (DbTableExists, table status, columns). */
  async userConn(): Promise<Conn> {
    if (this.#userConn === null) {
      const { pools } = this.c.get('deps')
      const session = this.c.get('session')
      this.#userConn = await pools.acquire(
        session.id,
        this.serverIndex,
        this.c.get('creds'),
        this.c.get('executed'),
      )
    }
    return this.#userConn
  }

  /** Relation::initRelationParamsCache + getRelationParameters, cached in the session. */
  async storage(): Promise<ConfigStorage> {
    if (this.#storage !== null) return this.#storage
    const all = sessionMetadata(this.c).relation
    all[String(this.serverIndex)] ??= {}
    const cache = all[String(this.serverIndex)] as ServerRelationCache
    const hit = cache.global ?? cache.byDb?.[this.currentDb]
    if (hit !== undefined) {
      this.#storage = new ConfigStorage(
        this.control,
        storageServer(this.server, this.user, hit.tables),
        hit.params,
      )
      return this.#storage
    }
    const s = storageServer(this.server, this.user)
    const storage = new ConfigStorage(this.control, s)
    // Relation::initRelationParamsCache, split to know whether the current db mattered
    await storage.fixPmaTables(s.pmadb !== '' ? s.pmadb : 'phpmyadmin', false)
    const global = s.pmadb !== ''
    if (!global) await storage.fixPmaTables(this.currentDb, false)
    const params = await storage.getRelationParameters()
    const entry: CachedRelation = { params, tables: snapshot(s) }
    if (global) cache.global = entry
    else {
      cache.byDb ??= {}
      cache.byDb[this.currentDb] = entry
    }
    this.#storage = storage
    return storage
  }

  /** Stores the storage state after a create action changed it. */
  async refreshStorage(): Promise<ConfigStorage> {
    resetRelationCache(this.c, this.serverIndex)
    this.#storage = null
    this.#meta = null
    return this.storage()
  }

  async relationParameters(): Promise<RelationParameters> {
    return (await this.storage()).getRelationParameters()
  }

  async meta(): Promise<Metadata> {
    if (this.#meta !== null) return this.#meta
    const rp = await this.relationParameters()
    const settings = await this.settings()
    const local = localStore(this.cfg)
    const session = this.c.get('session')
    session.sqlHistory ??= []
    const ms: MetadataSettings = {
      AllowSharedBookmarks: settings.AllowSharedBookmarks,
      QueryHistoryDB: settings.QueryHistoryDB,
      QueryHistoryMax: settings.QueryHistoryMax,
      MaxCharactersInDisplayedSQL: settings.MaxCharactersInDisplayedSQL,
      NumRecentTables: settings.NumRecentTables,
      NumFavoriteTables: settings.NumFavoriteTables,
      MaxTableUiprefs: this.server.MaxTableUiprefs,
      DisableIS: this.server.DisableIS,
    }
    this.#meta = new Metadata({
      control: rp.db === null ? null : this.control,
      relationParameters: rp,
      local: local?.driver(this.serverIndex) ?? null,
      settings: ms,
      serverIndex: this.serverIndex,
      user: this.user,
      state: this.state,
      sqlHistory: session.sqlHistory,
      tableExists: (db, table) => this.tableExists(db, table),
    })
    return this.#meta
  }

  /**
   * The configuration with the user's preferences applied (cached per session and server).
   * pma: src/Config/UserPreferencesHandler.php::loadUserPreferences
   */
  async settings(): Promise<AppConfig> {
    if (this.#settings !== null) return this.#settings
    const state = this.state
    const key = `server_${this.serverIndex}`
    state.prefsCache ??= {}
    let cached = state.prefsCache[key]
    if (cached === undefined) {
      // UserPreferences::load needs the storage discovery but not the settings: no recursion
      const rp = await this.relationParameters()
      const local = localStore(this.cfg)
      const m = new Metadata({
        control: rp.db === null ? null : this.control,
        relationParameters: rp,
        local: local?.driver(this.serverIndex) ?? null,
        settings: { ...this.cfg, MaxTableUiprefs: 0, DisableIS: this.server.DisableIS },
        serverIndex: this.serverIndex,
        user: this.user,
        state,
        sqlHistory: [],
        tableExists: async () => false,
      })
      const prefs = await m.userPreferences().load()
      cached = {
        userprefs: applyUserPreferences(
          prefs.config_data,
          getUserFormFields(this.cfg.UserprefsDeveloperTab),
          this.cfg.UserprefsDisallow,
        ),
        type: prefs.type,
        configMtime: 0,
      }
      state.prefsCache[key] = cached
    }
    this.#settings = mergeSettings(this.cfg, cached.userprefs)
    return this.#settings
  }

  /** DbTableExists::hasTable (user link). */
  async tableExists(db: string, table: string): Promise<boolean> {
    const conn = await this.userConn()
    try {
      await conn.query(`SELECT 1 FROM ${backquote(db)}.${backquote(table)} LIMIT 1;`, 'table.exists')
      return true
    } catch {
      return false
    }
  }

  close(): void {
    this.control.release()
    this.#userConn?.raw.release()
  }
}

/** array_replace_recursive($cfg, $prefs) for plain objects; lists are replaced key by key like PHP. */
export function mergeSettings(cfg: AppConfig, prefs: Record<string, unknown>): AppConfig {
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === null || typeof b !== 'object' || a === null || typeof a !== 'object') return b
    const out: Record<string, unknown> = Array.isArray(a) ? { ...a } : { ...(a as Record<string, unknown>) }
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = merge(out[k], v)
    return Array.isArray(a) ? Object.values(out) : out
  }
  const { Server: _server, Servers: _servers, lang: _lang, '2fa': _tfa, ...rest } = prefs
  return merge(cfg, rest) as AppConfig
}

export async function withMeta<T>(
  c: Context<ServerEnv>,
  opts: MetaRequestOptions,
  fn: (m: MetaRequest) => Promise<T>,
): Promise<T> {
  const m = new MetaRequest(c, opts)
  try {
    return await fn(m)
  } finally {
    m.close()
  }
}

/** phpMyAdmin default of a preference path (`Core::arrayRead($path, $defaultSettings)`). */
export function defaultOfPath(path: string): unknown {
  let a: unknown = defaults
  for (const k of path.split('/')) {
    if (a === null || typeof a !== 'object' || !(k in (a as object))) return null
    a = (a as Record<string, unknown>)[k]
  }
  return a
}
