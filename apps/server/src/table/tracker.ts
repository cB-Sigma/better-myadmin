import { AsyncLocalStorage } from 'node:async_hooks'
import {
  type RelationParameters,
  appendTrackingLog,
  isAnyTrackingInProgress,
  isTrackedTable,
  trackingDate,
  trackingLogComment,
  trackingVersionFor,
} from '@bettermyadmin/metadata'
import {
  AlterStatement,
  CreateStatement,
  DeleteStatement,
  DropStatement,
  Expression,
  InsertStatement,
  Parser,
  RenameStatement,
  TruncateStatement,
  UpdateStatement,
} from '@bettermyadmin/sql-lexer'
import type { Context } from 'hono'
import { getServer } from '../config.ts'
import { type Conn, setAfterQuery } from '../db/connection.ts'
import { MetaRequest } from '../metadata/service.ts'
import type { ServerEnv } from '../routes/server.ts'
import { TableReader } from './read.ts'
import { createVersion } from './tracking.ts'

/**
 * Tracker::handleQuery: every statement the user's connection runs successfully is appended to
 * the log of the table's tracked version (schema_sql for DDL, data_sql for DML), and a CREATE
 * TABLE / VIEW in a database with active tracking may start a version
 * (`tracking_version_auto_create`). Enabled for the authenticated requests (pma: the
 * Authentication middleware's Tracker::enable()), with the per-request caches of Tracker.
 *
 * pma: src/Tracking/Tracker.php::handleQuery, parseQuery
 */

interface TrackerState {
  c: Context<ServerEnv>
  meta: MetaRequest | null
  /** Tracker::$trackedDatabaseCache */
  anyTracking: Map<string, boolean>
  /** Tracker::$trackingCache */
  tracked: Map<string, boolean>
  /** the tracker's own queries are not tracked */
  busy: boolean
}

const als = new AsyncLocalStorage<TrackerState>()

/** Runs the rest of the request with the tracker enabled. */
export async function withTracker(c: Context<ServerEnv>, next: () => Promise<void>): Promise<void> {
  const st: TrackerState = { c, meta: null, anyTracking: new Map(), tracked: new Map(), busy: false }
  try {
    await als.run(st, next)
  } finally {
    st.meta?.close()
  }
}

/** The statements Tracker::parseQuery can identify (a cheap test before any storage query). */
const CANDIDATE = /\b(CREATE|ALTER|DROP|RENAME|UPDATE|INSERT|DELETE|TRUNCATE)\b/i

export interface ParsedTrackedQuery {
  type: 'DDL' | 'DML'
  identifier: string
  tablename: string
  tablenameAfterRename?: string
}

const tableOf = (e: unknown): string | null => (e instanceof Expression && e.table !== null ? e.table : null)

/** pma: Tracker::parseQuery (the statement identifier, its type and table); null when none. */
export function parseTrackedQuery(query: string): ParsedTrackedQuery | null {
  const parser = new Parser(query)
  const statement = parser.statements[0]
  if (statement === undefined) return null
  const options = statement.options?.options
  const opt = (i: number) => options?.get(i)
  const ddl = (identifier: string, tablename: string | null | undefined) =>
    tablename === null || tablename === undefined ? null : { type: 'DDL' as const, identifier, tablename }
  if (statement instanceof CreateStatement) {
    const o = opt(6)
    if (o === 'VIEW' || o === 'TABLE') return ddl(`CREATE ${o}`, statement.name?.table)
    if (o === 'DATABASE') return ddl('CREATE DATABASE', '')
    if (o === 'INDEX' || o === 'UNIQUE INDEX' || o === 'FULLTEXT INDEX' || o === 'SPATIAL INDEX') {
      const b = statement.body
      return ddl('CREATE INDEX', String((b[3]?.value === '.' ? b[4]?.value : b[2]?.value) ?? ''))
    }
    return null
  }
  if (statement instanceof AlterStatement) {
    const o = opt(3)
    if (o === 'VIEW' || o === 'TABLE') return ddl(`ALTER ${o}`, statement.table?.table)
    if (o === 'DATABASE') return ddl('ALTER DATABASE', '')
    return null
  }
  if (statement instanceof DropStatement) {
    const o = opt(1)
    if (o === 'VIEW' || o === 'TABLE') return ddl(`DROP ${o}`, tableOf(statement.fields?.[0]))
    if (o === 'DATABASE') return ddl('DROP DATABASE', '')
    if (o === 'INDEX') return ddl('DROP INDEX', statement.table?.table)
    return null
  }
  if (statement instanceof RenameStatement) {
    const r = statement.renames?.[0]
    const old = r?.old?.table
    if (old === null || old === undefined) return null
    return {
      type: 'DDL',
      identifier: 'RENAME TABLE',
      tablename: old,
      tablenameAfterRename: r?.new?.table ?? '',
    }
  }
  const dml = (identifier: string, tablename: string | null | undefined) =>
    tablename === null || tablename === undefined ? null : { type: 'DML' as const, identifier, tablename }
  if (statement instanceof UpdateStatement) return dml('UPDATE', tableOf(statement.tables?.[0]))
  if (statement instanceof InsertStatement) {
    const dest = statement.into?.dest
    return dml('INSERT', dest instanceof Expression ? dest.table : null)
  }
  if (statement instanceof DeleteStatement) return dml('DELETE', tableOf(statement.from?.[0]))
  if (statement instanceof TruncateStatement) return dml('TRUNCATE', statement.table?.table)
  return null
}

/** pma: Tracker::handleQuery */
async function handleQuery(conn: Conn, queryIn: string): Promise<void> {
  const st = als.getStore()
  if (st === undefined || st.busy) return
  // If query is marked as untouchable, leave
  if (queryIn.startsWith('/*NOTRACK*/') || !CANDIDATE.test(queryIn)) return
  const query = queryIn.endsWith(';') ? queryIn : `${queryIn};\n`
  const dbname = conn.currentDb.replace(/^`+|`+$/g, '')
  if (dbname === '') return
  st.busy = true
  try {
    st.meta ??= new MetaRequest(st.c, { db: dbname })
    const meta = st.meta
    const rp: RelationParameters = await meta.relationParameters()
    if (rp.trackingFeature === null || rp.db === null) return
    const control = meta.control
    let any = st.anyTracking.get(dbname)
    if (any === undefined) {
      any = await isAnyTrackingInProgress(control, rp, dbname)
      st.anyTracking.set(dbname, any)
    }
    if (!any) return
    const result = parseTrackedQuery(query)
    // the table name was not found (issue #16837)
    if (result === null) return
    let version = await trackingVersionFor(control, rp, dbname, result.tablename, result.identifier)
    const cfg = st.c.get('deps').cfg
    const server = getServer(cfg, st.c.get('serverIndex'))
    if (server === undefined) return
    const user = st.c.get('creds').user
    // If version not exists and auto-creation is enabled
    if (server.tracking_version_auto_create && version === -1) {
      if (result.identifier === 'CREATE TABLE' || result.identifier === 'CREATE VIEW') {
        const cache = (st.c.get('session').servers[String(st.c.get('serverIndex'))]?.cache ?? {}) as Record<
          string,
          unknown
        >
        const reader = new TableReader(conn, cache, st.c.get('tr'))
        await createVersion(
          { reader, cfg, tr: st.c.get('tr'), server, user, control, rp },
          dbname,
          result.tablename,
          '1',
          '',
          result.identifier === 'CREATE VIEW',
        )
      }
    }
    // If version exists (pma reads it before the auto-creation)
    if (version === -1) return
    let tracked = st.tracked.get(`${dbname}\u0000${result.tablename}`)
    if (tracked === undefined) {
      tracked = await isTrackedTable(control, rp, dbname, result.tablename)
      st.tracked.set(`${dbname}\u0000${result.tablename}`, tracked)
    }
    if (!tracked) return
    const date = trackingDate()
    // Cut off `dbname`. from query
    const escaped = dbname.replace(/[.\\+*?[^\]$(){}=!<>|:\-#/]/g, '\\$&')
    const cut = query.replace(new RegExp(`\`${escaped}\`\\s?\\.`, 'g'), '')
    version = Math.trunc(version)
    await appendTrackingLog(control, rp, {
      db: dbname,
      table: result.tablename,
      version,
      identifier: result.identifier,
      saveTo: result.type === 'DDL' ? 'schema_sql' : 'data_sql',
      query: trackingLogComment(date, user) + cut,
      date,
      renamedTo: result.tablenameAfterRename,
    })
  } catch (e) {
    // the user's statement ran; a failing log write must not fail it
    console.error('tracking:', e)
  } finally {
    st.busy = false
  }
}

setAfterQuery(handleQuery)
