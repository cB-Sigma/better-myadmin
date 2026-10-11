import type { MetaConn, RelationParameters } from '@bettermyadmin/metadata'
import type { Context } from 'hono'
import { getServer } from '../config.ts'
import { NotFoundError, ValidationError } from '../http/errors.ts'
import { withMeta } from '../metadata/service.ts'
import { tableInfo } from '../metadata/table-info.ts'
import { signSql } from '../query/signature.ts'
import type { OpsCtx, OpsMeta } from '../table/operations.ts'
import { TableReader } from '../table/read.ts'
import type { StructureFeatures } from '../table/structure-page.ts'
import type { ServerEnv } from './server.ts'

/**
 * Request helpers shared by the table-level routes (Operations, Relation view, Search, Tracking…):
 * a pooled user connection, the configuration storage of the request, the table checks
 * phpMyAdmin's controllers start with.
 */

export { parse } from '../http/validate.ts'

export const body = async (c: Context<ServerEnv>) => c.req.json().catch(() => null)

export interface ScopeOptions {
  /** the table must exist (DbTableExists::hasTable) — default true */
  table?: boolean
  /** open the configuration storage (RelationParameters + control link) — default true */
  meta?: boolean
}

/**
 * Runs `fn` with a request-scoped reader, the storage features and the session helpers.
 * pma: DbTableExists::selectDatabase / ::hasTable ("No databases selected." / "No table selected.")
 */
export async function withScope<T>(
  c: Context<ServerEnv>,
  fn: (ctx: OpsCtx) => Promise<T>,
  opts: ScopeOptions = {},
): Promise<T> {
  const { pools, cfg } = c.get('deps')
  const session = c.get('session')
  const serverIndex = c.get('serverIndex')
  const login = session.servers[String(serverIndex)]
  if (login === undefined) throw new ValidationError(c.get('tr').gettext('Invalid server index!'))
  login.cache ??= {}
  const cache = login.cache as Record<string, unknown>
  const db = c.req.param('db') ?? ''
  const table = c.req.param('t') ?? ''
  const tr = c.get('tr')
  const server = getServer(cfg, serverIndex)
  if (server === undefined) throw new ValidationError(tr.gettext('Invalid server index!'))
  const run = async (meta: OpsMeta | null) => {
    const conn = await pools.acquire(
      session.id,
      serverIndex,
      c.get('creds'),
      c.get('executed'),
      undefined,
      c.get('language').mysqlLocale,
    )
    try {
      const reader = new TableReader(conn, cache, tr)
      if (db === '' || !(await reader.selectDb(db)))
        throw new NotFoundError(tr.gettext('No databases selected.'))
      if (opts.table !== false && (table === '' || (await reader.getStatus(db, table)) === null)) {
        throw new NotFoundError(tr.gettext('No table selected.'))
      }
      const state = {
        get switchToNew() {
          return cache.pma_switch_to_new === true
        },
        set switchToNew(v: boolean | undefined) {
          cache.pma_switch_to_new = v === true
        },
      }
      return await fn({
        reader,
        cfg,
        tr,
        db,
        table,
        meta,
        sign: (sql) => signSql(sql, session.hmacSecret, cfg.blowfish_secret),
        session: state,
        server,
        user: c.get('creds').user,
        features: storageFeatures(meta?.rp ?? null),
      })
    } finally {
      conn.raw.release()
    }
  }
  if (opts.meta === false) return run(null)
  return withMeta(c, { db }, async (m) => {
    let meta: OpsMeta | null = null
    try {
      const rp = await m.relationParameters()
      meta = {
        rp,
        control: rp.db === null ? null : m.control,
        uiPrefs: async (db, table) => (await m.meta()).uiPrefs(db, table, tableInfo(m, db, table)),
      }
    } catch (e) {
      console.error('configuration storage:', e)
    }
    return run(meta)
  })
}

/** The configuration-storage features the Structure screens toggle on (RelationParameters). */
export function storageFeatures(rp: RelationParameters | null): StructureFeatures {
  const bt = rp?.browserTransformationFeature ?? null
  return {
    centralColumns: (rp?.centralColumnsFeature ?? null) !== null,
    relation: (rp?.relationFeature ?? null) !== null,
    tracking: (rp?.trackingFeature ?? null) !== null,
    browserTransformation: bt === null ? null : { database: bt.database, columnInfo: bt.columnInfo },
  }
}

export const respond = <R extends object>(c: Context<ServerEnv>, r: R) => {
  const cfg = c.get('deps').cfg
  return c.json({ ...r, executed: cfg.DBG.sql ? c.get('executed') : [] })
}
