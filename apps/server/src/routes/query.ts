import {
  CancelRequest,
  type CancelResponse,
  QueryRequest,
  type QueryResponse,
  SimulateRequest,
  type SimulateResponse,
} from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import { ValidationError } from '../http/errors.ts'
import { parseJson } from '../http/validate.ts'
import { afterSqlBox } from '../metadata/hooks.ts'
import { type SqlBoxResult, runSqlBox } from '../query/pipeline.ts'
import { checkSqlSignature } from '../query/signature.ts'
import { simulateDml } from '../query/simulate.ts'
import type { ServerEnv } from './server.ts'
import { withConn } from './sql.ts'

export const queryRoutes = new Hono<ServerEnv>()

/** Connections running a query, by `${sessionId}\0${server}\0${queryId}` (for KILL QUERY). */
const running = new Map<string, number>()

/** POST /api/servers/:s/query — the SQL tab (pma: /import with sql_query) */
queryRoutes.post('/', async (c) => {
  const { cfg, pools } = c.get('deps')
  const req = await parseJson(c, QueryRequest)
  if (req.sql.trim() === '') throw new ValidationError(c.get('tr').gettext('Missing value in the form!'))
  const session = c.get('session')
  // A query that came from a URL runs only with a valid signature (Core::checkSqlQuerySignature);
  // phpMyAdmin then ignores the unsigned sql_query and reports the missing parameter.
  if (
    req.sig !== undefined &&
    !checkSqlSignature(req.sql, req.sig, session.hmacSecret, cfg.blowfish_secret)
  ) {
    throw new ValidationError(`${c.get('tr').gettext('Missing parameter:')} sql_query`)
  }
  const executed = c.get('executed')
  const server = c.get('serverIndex')
  const conn = await pools.acquire(
    session.id,
    server,
    c.get('creds'),
    executed,
    undefined,
    c.get('language').mysqlLocale,
  )
  const runKey = req.queryId !== undefined ? `${session.id}\u0000${server}\u0000${req.queryId}` : null
  if (runKey !== null) running.set(runKey, conn.threadId)
  let discard = false
  let r: SqlBoxResult | null = null
  try {
    r = await runSqlBox(
      {
        sql: req.sql,
        db: req.db ?? '',
        table: req.table ?? '',
        pos: req.pos,
        maxRows: req.maxRows ?? cfg.MaxRows,
        delimiter: req.delimiter,
        fkChecks: req.fkChecks,
        rollback: req.rollback,
        params: req.params,
        showAsPhp: req.showAsPhp,
        profiling: req.profiling,
      },
      { cfg, conn, hmacSecret: session.hmacSecret, executed, session, server, tr: c.get('tr') },
    )
    discard = r.discardConnection
    const body: QueryResponse = {
      statements: r.statements,
      executed: cfg.DBG.sql ? executed : [],
      db: r.db === '' ? null : r.db,
      table: r.table === '' ? null : r.table,
      reloadNavigation: r.reloadNavigation,
      // reloadQuerywindow.sql_query (the console's "current query")
      sqlQuery: Array.from(r.sqlQuery).length < cfg.MaxCharactersInDisplayedSQL ? r.sqlQuery : '',
    }
    if (r.ajaxReload !== undefined) body.ajaxReload = r.ajaxReload
    return c.json(body)
  } finally {
    if (runKey !== null) running.delete(runKey)
    // like PHP's connection close: a transaction left open or a changed session setting is discarded
    if (discard) conn.raw.destroy()
    else conn.raw.release()
    if (r !== null) {
      // StatementHistory + RecentTableHandling middlewares (pma: src/Application.php)
      await afterSqlBox(c, {
        db: req.db ?? '',
        table: req.table ?? '',
        current: { db: r.db, table: r.table, sqlQuery: r.sqlQuery },
        noHistory: req.noHistory === true,
        bookmark:
          req.bookmark !== undefined && r.bookmarkable === true
            ? { ...req.bookmark, sql: req.sql }
            : undefined,
      })
    }
  }
})

/**
 * POST /api/servers/:s/query/simulate — "Simulate query".
 * pma: src/Controllers/Import/SimulateDmlController.php
 */
queryRoutes.post('/simulate', async (c) => {
  const { cfg } = c.get('deps')
  const req = await parseJson(c, SimulateRequest)
  const session = c.get('session')
  const body: SimulateResponse = await withConn(c, (conn) =>
    simulateDml(req.sql, req.delimiter, req.db ?? '', conn, conn.serverInfo?.context, {
      hmacSecret: session.hmacSecret,
      blowfishSecret: cfg.blowfish_secret,
      tr: c.get('tr'),
    }),
  )
  return c.json(body)
})

/** POST /api/servers/:s/query/cancel — KILL QUERY on the connection running `queryId`. */
queryRoutes.post('/cancel', async (c) => {
  const { pools } = c.get('deps')
  const req = await parseJson(c, CancelRequest)
  const session = c.get('session')
  const server = c.get('serverIndex')
  const threadId = running.get(`${session.id}\u0000${server}\u0000${req.queryId}`)
  if (threadId !== undefined) await pools.killQuery(session.id, server, threadId, c.get('creds'))
  const body: CancelResponse = { killed: threadId !== undefined }
  return c.json(body)
})
