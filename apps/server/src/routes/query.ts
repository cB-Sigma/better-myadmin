import { QueryRequest, type QueryResponse } from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import { ValidationError } from '../http/errors.ts'
import { runSqlBox } from '../query/pipeline.ts'
import type { ServerEnv } from './server.ts'

export const queryRoutes = new Hono<ServerEnv>()

/** POST /api/servers/:s/query — the SQL tab (pma: /import with sql_query) */
queryRoutes.post('/', async (c) => {
  const { cfg, pools } = c.get('deps')
  const parsed = QueryRequest.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid request.',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  const req = parsed.data
  if (req.sql.trim() === '') throw new ValidationError('Missing value in the form!')
  const session = c.get('session')
  const executed = c.get('executed')
  const conn = await pools.acquire(session.id, c.get('serverIndex'), c.get('creds'), executed)
  try {
    const statements = await runSqlBox(
      {
        sql: req.sql,
        db: req.db ?? '',
        table: req.table ?? '',
        pos: req.pos,
        maxRows: req.maxRows ?? cfg.MaxRows,
        delimiter: req.delimiter,
        fkChecks: req.fkChecks,
      },
      { cfg, conn, hmacSecret: session.hmacSecret, executed },
    )
    const last = statements.at(-1)
    const body: QueryResponse = {
      statements,
      executed: cfg.DBG.sql ? executed : [],
      db: last?.db ?? (req.db === undefined || req.db === '' ? null : req.db),
      table: req.table ?? null,
    }
    return c.json(body)
  } finally {
    conn.raw.release()
  }
})
