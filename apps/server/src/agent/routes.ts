import { englishTranslator } from '@bettermyadmin/i18n'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from '../app.ts'
import { BmaError, ValidationError } from '../http/errors.ts'
import { APP_VERSION } from '../shell/scope.ts'
import { AgentAuthRequired, checkAgentRequest, withAgent } from './auth.ts'
import { MCP_PROTOCOL_VERSIONS, handleMcp } from './mcp.ts'
import {
  AGENT_MAX_ROWS,
  describeTable,
  explain,
  listDatabases,
  listTables,
  runAgentQuery,
} from './service.ts'

/**
 * The agent API (docs/features/16-agent-api.md), mounted at /api/agent before the session and
 * CSRF middlewares: plain JSON for AI agents and scripts, every request authenticated on its own.
 *
 *   GET  /v1/servers/:s/databases
 *   GET  /v1/servers/:s/databases/:db/tables
 *   GET  /v1/servers/:s/databases/:db/tables/:table
 *   POST /v1/servers/:s/query     {sql, db?, maxRows?}
 *   POST /v1/servers/:s/explain   {sql, db?}
 *   POST /v1/servers/:s/mcp       MCP (Streamable HTTP, JSON responses)
 */
const QueryBody = z.object({
  sql: z.string().min(1),
  db: z.string().optional(),
  maxRows: z.number().int().min(1).max(AGENT_MAX_ROWS).optional(),
})
const ExplainBody = z.object({ sql: z.string().min(1), db: z.string().optional() })

async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    throw new ValidationError('The request body is not valid JSON.')
  }
  const r = schema.safeParse(json)
  if (!r.success)
    throw new ValidationError(
      'Invalid request body.',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  return r.data
}

export function agentRoutes(deps: AppDeps) {
  const app = new Hono()
  const tr = englishTranslator()
  const server = (s: string) => {
    const n = Number(s)
    if (!Number.isInteger(n) || n < 1) throw new ValidationError(`Invalid server: ${s}`)
    return n
  }

  // errors as JSON; a 401 of a Basic auth server asks for credentials
  app.onError((err, c) => {
    if (err instanceof BmaError) {
      const res = c.json({ error: { code: err.code, message: err.message, ...err.extra } }, err.status as 400)
      if (err instanceof AgentAuthRequired && err.basic)
        res.headers.set('WWW-Authenticate', 'Basic realm="BetterMyAdmin", charset="UTF-8"')
      return res
    }
    console.error('agent API:', err)
    return c.json({ error: { code: 'INTERNAL', message: 'Internal error.' } }, 500)
  })

  app.get('/v1/servers/:s/databases', async (c) =>
    c.json({ databases: await withAgent(c, deps, server(c.req.param('s')), tr, listDatabases) }),
  )
  app.get('/v1/servers/:s/databases/:db/tables', async (c) =>
    c.json({
      tables: await withAgent(c, deps, server(c.req.param('s')), tr, (ctx) =>
        listTables(ctx, c.req.param('db')),
      ),
    }),
  )
  app.get('/v1/servers/:s/databases/:db/tables/:table', async (c) =>
    c.json(
      await withAgent(c, deps, server(c.req.param('s')), tr, (ctx) =>
        describeTable(ctx, c.req.param('db'), c.req.param('table')),
      ),
    ),
  )
  app.post('/v1/servers/:s/query', async (c) => {
    const s = server(c.req.param('s'))
    checkAgentRequest(c)
    const b = await body(c.req.raw, QueryBody)
    return c.json(await withAgent(c, deps, s, tr, (ctx) => runAgentQuery(ctx, b)))
  })
  app.post('/v1/servers/:s/explain', async (c) => {
    const s = server(c.req.param('s'))
    checkAgentRequest(c)
    const b = await body(c.req.raw, ExplainBody)
    return c.json(await withAgent(c, deps, s, tr, (ctx) => explain(ctx, b)))
  })

  // MCP, Streamable HTTP without sessions or server-sent events: POST only
  app.get('/v1/servers/:s/mcp', (c) => c.body(null, 405, { Allow: 'POST' }))
  app.delete('/v1/servers/:s/mcp', (c) => c.body(null, 405, { Allow: 'POST' }))
  app.post('/v1/servers/:s/mcp', async (c) => {
    const s = server(c.req.param('s'))
    if (!deps.cfg.AgentApi)
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'The agent API is not enabled (AgentApi).' } },
        404,
      )
    checkAgentRequest(c)
    const asked = c.req.header('MCP-Protocol-Version')
    if (asked !== undefined && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked))
      return c.json(
        { error: { code: 'VALIDATION', message: `Unsupported MCP-Protocol-Version: ${asked}` } },
        400,
      )
    let msg: unknown
    try {
      msg = await c.req.json()
    } catch {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
    }
    const connect = <T>(fn: Parameters<typeof withAgent<T>>[4]) => withAgent(c, deps, s, tr, fn)
    // every message authenticates (tools/list too): an MCP client learns of missing credentials at once
    await withAgent(c, deps, s, tr, async () => undefined)
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map((m) => handleMcp(m, APP_VERSION, connect)))).filter(
        (r) => r !== null,
      )
      return out.length === 0 ? c.body(null, 202) : c.json(out)
    }
    const r = await handleMcp(msg, APP_VERSION, connect)
    return r === null ? c.body(null, 202) : c.json(r)
  })

  app.all('*', (c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404))
  return app
}
