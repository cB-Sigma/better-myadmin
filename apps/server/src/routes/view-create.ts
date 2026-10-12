import { ViewSaveRequest } from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import { withDb } from '../database/context.ts'
import { saveView, viewForm } from '../table/view-create.ts'
import type { ServerEnv } from './server.ts'
import { body, parse, respond } from './table-scope.ts'

/**
 * The view form (pma: /view/create). Mounted at /api/servers/:s/databases. Like CreateController
 * the database must be selectable ("No databases selected.").
 */
export const viewCreateRoutes = new Hono<ServerEnv>()

/** GET …/views/form?table=v (Edit view) | ?sql=… (Create view with the query) */
viewCreateRoutes.get('/:db/views/form', async (c) =>
  c.json(await withDb(c, (ctx) => viewForm(ctx, { table: c.req.query('table'), sql: c.req.query('sql') }))),
)

/** POST …/views (createview / alterview) */
viewCreateRoutes.post('/:db/views', async (c) => {
  const req = parse(ViewSaveRequest, await body(c))
  return respond(c, await withDb(c, (ctx) => saveView(ctx, req)))
})
