import type { ExportEnvironment } from '@bettermyadmin/export'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import { Context as SqlContext } from '@bettermyadmin/sql-lexer'
import type { Context } from 'hono'
import { type AppConfig, type ServerConfig, getServer } from '../config.ts'
import type { Conn } from '../db/connection.ts'
import { ValidationError } from '../http/errors.ts'
import { MetaRequest } from '../metadata/service.ts'
import { NavDbi } from '../navigation/dbi.ts'
import type { ServerEnv } from '../routes/server.ts'
import type { AdminCtx } from '../server-admin/context.ts'
import { databaseList } from '../server-admin/databases.ts'
import { APP_VERSION } from '../shell/scope.ts'
import { ServerExportDbi } from './dbi.ts'
import { exportRelation } from './relation.ts'

/** The tool named in the dump headers (phpMyAdmin names itself, its version and site). */
export const EXPORT_TOOL = {
  name: 'BetterMyAdmin',
  version: APP_VERSION,
  url: 'https://github.com/bettermyadmin/bettermyadmin',
  runtime: process.version,
  runtimeLabel: 'Node.js Version:',
}

/** PHP's date.timezone for localisedDate: the server process time zone. */
export const PROCESS_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

/** One export/import request's connections and settings (released by `close`). */
export interface ExportSession {
  env: ExportEnvironment
  conn: Conn
  cfg: AppConfig
  settings: AppConfig
  server: ServerConfig
  meta: MetaRequest
  admin: AdminCtx
  user: string
  close(): Promise<void>
}

/** Opens the user link + configuration storage for an export (kept for the whole stream). */
export async function openExportSession(c: Context<ServerEnv>, db = ''): Promise<ExportSession> {
  const { cfg, pools } = c.get('deps')
  const session = c.get('session')
  const serverIndex = c.get('serverIndex')
  const server = getServer(cfg, serverIndex)
  const login = session.servers[String(serverIndex)]
  if (server === undefined || login === undefined) throw new ValidationError('Invalid server index!')
  login.cache ??= {}
  const conn = await pools.acquire(
    session.id,
    serverIndex,
    c.get('creds'),
    c.get('executed'),
    undefined,
    c.get('language').mysqlLocale,
  )
  const meta = new MetaRequest(c, { db })
  // phpMyAdmin connects per request; the pooled link gets the session settings the dump changes back
  const saved = await conn.rows(
    'SELECT @@session.sql_mode AS m, @@session.sql_quote_show_create AS q, @@session.time_zone AS z, DATABASE() AS d',
    'export.session',
  )
  const restore = saved[0]
  // phpMyAdmin's fresh link has no default database until the dump selects one, which shows in
  // SHOW CREATE VIEW (names qualified with their database); information_schema has no user views
  if (restore?.d !== null && restore?.d !== undefined)
    await conn.selectDb('information_schema', 'export.session')
  const close = async () => {
    meta.close()
    try {
      await conn.query('UNLOCK TABLES', 'export.restore')
      if (restore !== undefined) {
        await conn.query(
          `SET SESSION sql_mode = ${quoteString(restore.m ?? '')}, SQL_QUOTE_SHOW_CREATE = ${restore.q === '0' ? 0 : 1}, time_zone = ${quoteString(restore.z ?? 'SYSTEM')}`,
          'export.restore',
        )
        if (restore.d !== null && restore.d !== undefined) {
          await conn.query(`USE ${backquote(restore.d)}`, 'export.restore')
        }
      }
    } catch {
      // the link is released anyway
    }
    conn.raw.release()
  }
  try {
    const settings = await meta.settings()
    const rp = await meta.relationParameters()
    const admin: AdminCtx = {
      cfg,
      server,
      serverIndex,
      conn,
      dbi: new NavDbi(conn, login.cache),
      tr: c.get('tr'),
      timeZone: PROCESS_TIME_ZONE,
      versionInt: conn.serverInfo?.versionInt ?? 0,
      isMariaDb: conn.serverInfo?.isMariaDb ?? false,
    }
    const dbi = new ServerExportDbi(conn, {
      disableIS: server.DisableIS,
      naturalOrder: cfg.NaturalOrder,
      databaseList: () => databaseList(admin),
    })
    const httpHost = c.req.header('host') ?? ''
    const env: ExportEnvironment = {
      dbi,
      relation: exportRelation(rp, rp.db === null ? null : meta.control, conn),
      tr: c.get('tr'),
      config: {
        Export: settings.Export as unknown as Record<string, unknown>,
        ZipDump: settings.ZipDump,
        GZipDump: settings.GZipDump,
        CompressOnFly: settings.CompressOnFly,
        SaveDir: settings.SaveDir,
        RecodingEngine: settings.RecodingEngine,
        AvailableCharsets: settings.AvailableCharsets,
      },
      host: String(server.host),
      port: String(server.port ?? ''),
      tool: EXPORT_TOOL,
      timeZone: PROCESS_TIME_ZONE,
      parserContext: conn.serverInfo?.context ?? new SqlContext(),
      verbose: server.verbose,
      httpHost,
      // Encoding::canConvertKanji()
      canConvertKanji: c.get('language').code === 'ja',
    }
    return { env, conn, cfg, settings, server, meta, admin, user: c.get('creds').user, close }
  } catch (e) {
    await close()
    throw e
  }
}

export { userDir } from '../util/secure-path.ts'
