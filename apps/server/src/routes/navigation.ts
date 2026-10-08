import { NavBranchQuery, NavTreeQuery, NavTreeRequest } from '@bettermyadmin/contracts'
import { type Context, Hono } from 'hono'
import type { z } from 'zod'
import { getServer } from '../config.ts'
import { ValidationError } from '../http/errors.ts'
import {
  type NavServiceDeps,
  navigationBranch,
  navigationHiding,
  navigationTree,
} from '../navigation/service.ts'
import type { ServerEnv } from './server.ts'

export const navigationRoutes = new Hono<ServerEnv>()

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value)
  if (!r.success) {
    throw new ValidationError(
      'Invalid request.',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  return r.data
}

async function withDeps<T>(c: Context<ServerEnv>, fn: (deps: NavServiceDeps) => Promise<T>): Promise<T> {
  const { cfg, pools } = c.get('deps')
  const session = c.get('session')
  const serverIndex = c.get('serverIndex')
  const server = getServer(cfg, serverIndex)
  const login = session.servers[String(serverIndex)]
  if (server === undefined || login === undefined) throw new ValidationError('Invalid server index!')
  login.cache ??= {}
  const conn = await pools.acquire(session.id, serverIndex, c.get('creds'), c.get('executed'))
  try {
    const base = { cfg, server, conn, cache: login.cache }
    return await fn({ ...base, hiding: navigationHiding(base) })
  } finally {
    conn.raw.release()
  }
}

/** GET /api/servers/:s/navigation/tree — the whole tree (pma: POST /navigation full=1). */
navigationRoutes.get('/tree', async (c) => {
  const q = parse(NavTreeQuery, c.req.query())
  const body = await withDeps(c, (deps) => navigationTree(deps, { ...q, paths: [], reload: false }))
  return c.json(body)
})

/**
 * POST /api/servers/:s/navigation/tree — the tree with expanded branches: state restore after a page
 * load, and "Reload navigation panel" (`reload: true`). pma: POST /navigation reload=1 n{i}_aPath…
 */
navigationRoutes.post('/tree', async (c) => {
  const req = parse(NavTreeRequest, await c.req.json().catch(() => null))
  const body = await withDeps(c, (deps) => navigationTree(deps, req))
  return c.json(body)
})

/** GET /api/servers/:s/navigation/branch?path=db&path=tables… — one branch (pma: loadChildNodes, treePagination). */
navigationRoutes.get('/branch', async (c) => {
  const q = parse(NavBranchQuery, { ...c.req.query(), path: c.req.queries('path') ?? [] })
  const body = await withDeps(c, (deps) => navigationBranch(deps, q))
  return c.json(body)
})
