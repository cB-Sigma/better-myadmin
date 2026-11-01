import { ColumnNamesRequest, PaletteSearchQuery, TableNamesRequest } from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import { parse, parseJson } from '../http/validate.ts'
import { withAdmin } from '../server-admin/context.ts'
import { columnNames, tableNames } from '../server-admin/name-lists.ts'
import { paletteSearch } from '../server-admin/palette.ts'
import type { ServerEnv } from './server.ts'

/** The pickers' name lists (pma: /tables, /columns). Mounted at /api/servers/:s. */
export const nameListRoutes = new Hono<ServerEnv>()

/** pma: /tables (TableController) */
nameListRoutes.post('/tables', async (c) => {
  const req = await parseJson(c, TableNamesRequest, {})
  return c.json(await withAdmin(c, (ctx) => tableNames(ctx, req.db)))
})

/** BetterMyAdmin only (X61): the command palette's databases and tables, filtered on the server */
nameListRoutes.get('/command-palette', async (c) => {
  const q = parse(PaletteSearchQuery, c.req.query())
  return c.json(await withAdmin(c, (ctx) => paletteSearch(ctx, q)))
})

/** pma: /columns (ColumnController) */
nameListRoutes.post('/columns', async (c) => {
  const req = await parseJson(c, ColumnNamesRequest, {})
  return c.json(await withAdmin(c, (ctx) => columnNames(ctx, req.db, req.table)))
})
