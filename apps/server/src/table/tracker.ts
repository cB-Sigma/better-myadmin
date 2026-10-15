import {
  type RelationParameters,
  anyTrackingInProgress,
  appendTrackingLog,
  insertDatabaseVersion,
  isTableTracked,
  parseTrackedQuery,
  trackedVersion,
  trackingDate,
  trackingLogComment,
} from '@bettermyadmin/metadata'
import { backquote } from '@bettermyadmin/sql-gen'
import type { Context } from 'hono'
import { getServer } from '../config.ts'
import type { Conn } from '../db/connection.ts'
import { setQueryHook } from '../db/query-hook.ts'
import { MetaRequest } from '../metadata/service.ts'
import type { ServerEnv } from '../routes/server.ts'
import { TableReader } from './read.ts'
import { createVersion } from './tracking.ts'

/**
 * Tracker::handleQuery for one request: every statement that succeeds on the user or the control
 * link (DatabaseInterface::tryQuery) while the configuration storage has the tracking feature is
 * appended to the active version tracking it, as `# log <date> <user>\n<statement>` in schema_sql
 * (DDL) or data_sql (DML); with `tracking_version_auto_create`, CREATE TABLE / VIEW / DATABASE
 * start version 1. Enabled once the server is authenticated (Authentication middleware's
 * Tracker::enable), its caches (isAnyTrackingInProgress, isTracked) live for the request like
 * phpMyAdmin's static ones.
 * pma: src/Tracking/Tracker.php::handleQuery, createDatabaseVersion, src/Dbal/DatabaseInterface.php::tryQuery
 */
export class RequestTracker {
  readonly #c: Context<ServerEnv>
  #meta: MetaRequest | null = null
  #rp: RelationParameters | null = null
  /** resolving the storage: its own statements are not handled (phpMyAdmin enables the tracker after) */
  #resolving = false
  /** the storage could not be read: no tracking for this request */
  #failed = false
  /** `Current::$database` as changed by the statements (USE, CREATE / ALTER / DROP DATABASE) */
  #database: string | null = null
  /** the request's database when a route knows it before the statements run (body parameters) */
  #requestDb: string | null = null
  readonly #inProgress = new Map<string, boolean>()
  readonly #tracked = new Map<string, boolean>()

  constructor(c: Context<ServerEnv>) {
    this.#c = c
  }

  /** `Current::$database`: the request's `db` parameter, then what the statements changed it to. */
  currentDatabase(): string {
    if (this.#database !== null) return this.#database
    if (this.#requestDb !== null) return this.#requestDb
    // `…/databases/<db>/…`: also before the route's own parameters are known (middleware)
    // (POST …/databases/drop is the server's Drop databases action)
    const path = this.#c.req.path
    const m = /\/databases\/([^/]+)/.exec(path)
    if (m !== null && !(this.#c.req.method === 'POST' && path.endsWith('/databases/drop'))) {
      try {
        return decodeURIComponent(m[1] ?? '')
      } catch {
        return m[1] ?? ''
      }
    }
    return this.#c.req.query('db') ?? ''
  }

  async setRequestDatabase(db: string): Promise<void> {
    this.#requestDb = db
    await this.prime()
  }

  /**
   * The isAnyTrackingInProgress probe phpMyAdmin's first statement after Tracker::enable sends
   * (its per-request preference read on the control link): BetterMyAdmin keeps those reads in the
   * session, so the probe is sent when the tracker starts, before the route's statements.
   */
  async prime(): Promise<void> {
    const dbname = this.currentDatabase().replace(/^`+|`+$/g, '')
    if (dbname === '' || this.#inProgress.has(dbname)) return
    const rp = await this.#relation()
    if (rp === null || rp.trackingFeature === null || this.#meta === null) return
    this.#inProgress.set(dbname, await anyTrackingInProgress(this.#meta.control, rp, dbname))
  }

  /** Tracker::isActive: enabled and the storage has the tracking feature. */
  async #relation(): Promise<RelationParameters | null> {
    if (this.#rp !== null) return this.#rp
    if (this.#resolving || this.#failed) return null
    this.#resolving = true
    try {
      this.#meta = new MetaRequest(this.#c, { db: this.currentDatabase() })
      this.#rp = await this.#meta.relationParameters()
    } catch {
      this.#failed = true
      return null
    } finally {
      this.#resolving = false
    }
    return this.#rp
  }

  /** pma: Tracker::handleQuery */
  async handle(sql: string, userConn: Conn | null): Promise<void> {
    // If query is marked as untouchable, leave
    if (sql.startsWith('/*NOTRACK*/')) return
    let query = sql.endsWith(';') ? sql : `${sql};\n`
    // Get database name; it can be empty
    const dbname = this.currentDatabase().replace(/^`+|`+$/g, '')
    if (dbname === '') return
    const rp = await this.#relation()
    if (rp === null || rp.trackingFeature === null || this.#meta === null) return
    const control = this.#meta.control
    // Tracker::changeTracking clears the database's cache before its UPDATE (activation changes)
    const changed = changedTrackingDb(sql, rp)
    if (changed !== null) this.#inProgress.delete(changed)
    let inProgress = this.#inProgress.get(dbname)
    if (inProgress === undefined) {
      inProgress = await anyTrackingInProgress(control, rp, dbname)
      this.#inProgress.set(dbname, inProgress)
    }
    if (!inProgress) return

    // Get some information about query
    const result = parseTrackedQuery(query)
    if (result.database !== undefined) this.#database = result.database ?? ''
    // If we found a valid statement; the table name may be missing (issue #16837)
    if (result.identifier === undefined) return
    if (result.tablename === undefined || result.tablename === null) return
    const tablename = result.tablename

    const version = await trackedVersion(control, rp, dbname, tablename, result.identifier)
    const server = getServer(this.#c.get('deps').cfg, this.#c.get('serverIndex'))
    if (server === undefined) return
    const user = this.#c.get('creds').user

    // If version not exists and auto-creation is enabled
    if (server.tracking_version_auto_create && version === -1) {
      if (result.identifier === 'CREATE TABLE' || result.identifier === 'CREATE VIEW') {
        const conn = userConn ?? (await this.#meta.userConn())
        await createVersion(
          {
            reader: new TableReader(conn, {}, this.#c.get('tr')),
            cfg: this.#c.get('deps').cfg,
            tr: this.#c.get('tr'),
            server,
            user,
            control,
            rp,
          },
          dbname,
          tablename,
          '1',
          '',
          result.identifier === 'CREATE VIEW',
        )
      } else if (result.identifier === 'CREATE DATABASE') {
        await this.#createDatabaseVersion(dbname, '1', query, rp, user, server.tracking_add_drop_database)
      }
    }

    // If version exists
    if (version === -1) return
    if (!(await this.#isTracked(dbname, tablename, rp))) return

    const saveTo = result.type === 'DDL' ? 'schema_sql' : result.type === 'DML' ? 'data_sql' : ''
    const date = trackingDate()
    // Cut off `dbname`. from query
    const esc = dbname.replace(/[.\\+*?[^\]$(){}=!<>|:\-#/]/g, '\\$&')
    query = query.replace(new RegExp(`\`${esc}\`\\s?\\.`, 'g'), '')
    // Add log information
    query = trackingLogComment(date, user) + query
    await appendTrackingLog(control, rp, {
      saveTo,
      entry: query,
      date,
      identifier: result.identifier,
      db: dbname,
      table: tablename,
      version,
      renamedTo: result.tablename_after_rename ?? null,
    })
  }

  /** pma: Tracker::isTracked (cached for the request) */
  async #isTracked(db: string, table: string, rp: RelationParameters): Promise<boolean> {
    const key = `${db}\u0000${table}`
    const hit = this.#tracked.get(key)
    if (hit !== undefined) return hit
    if (this.#meta === null) return false
    const r = await isTableTracked(this.#meta.control, rp, db, table)
    this.#tracked.set(key, r)
    return r
  }

  /** pma: Tracker::createDatabaseVersion (its default statement set) */
  async #createDatabaseVersion(
    db: string,
    version: string,
    query: string,
    rp: RelationParameters,
    user: string,
    addDrop: boolean,
  ): Promise<void> {
    if (this.#meta === null) return
    const date = trackingDate()
    const log = trackingLogComment(date, user)
    let createSql = ''
    if (addDrop) createSql += `${log}DROP DATABASE IF EXISTS ${backquote(db)};\n`
    createSql += log + query
    await insertDatabaseVersion(this.#meta.control, rp, {
      db,
      version,
      date,
      schemaSql: createSql,
      trackingSet: 'CREATE DATABASE,ALTER DATABASE,DROP DATABASE',
    })
  }

  close(): void {
    this.#meta?.close()
    this.#meta = null
  }
}

/** The database of Tracker::changeTracking's `UPDATE … SET tracking_active = n WHERE db_name = '…'`. */
function changedTrackingDb(sql: string, rp: RelationParameters): string | null {
  const f = rp.trackingFeature
  if (f === null) return null
  const head = `UPDATE ${backquote(f.database)}.${backquote(f.tracking)} SET \`tracking_active\` = `
  if (!sql.startsWith(head)) return null
  const m = /^\d+ WHERE `db_name` = '((?:[^'\\]|\\.)*)'/.exec(sql.slice(head.length))
  return m === null
    ? null
    : (m[1] ?? '').replace(/\\(.)/g, (_, ch: string) =>
        ch === '0' ? '\0' : ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 'Z' ? '\x1a' : ch,
      )
}

const trackers = new WeakMap<object, RequestTracker>()

/**
 * Tracker::enable for an authenticated server request: the hook on the request's statements.
 * Returns the function that ends it (the request's links are released).
 */
export async function enableTracker(c: Context<ServerEnv>): Promise<() => void> {
  const log = c.get('executed')
  if (trackers.has(log)) return () => {}
  const tracker = new RequestTracker(c)
  trackers.set(log, tracker)
  setQueryHook(log, (sql, conn) => tracker.handle(sql, conn))
  try {
    await tracker.prime()
  } catch (e) {
    console.error(e)
  }
  return () => {
    setQueryHook(log, null)
    trackers.delete(log)
    tracker.close()
  }
}

/** The request's database for the tracker when it comes in the body (the SQL box, import, browse). */
export async function setTrackedDatabase(c: Context<ServerEnv>, db: string): Promise<void> {
  try {
    await trackers.get(c.get('executed'))?.setRequestDatabase(db)
  } catch (e) {
    console.error(e)
  }
}
