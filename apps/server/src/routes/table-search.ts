import { FindReplaceRequest, SearchRequest, ZoomRequest, ZoomRowRequest } from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import { recordHistory, shownSql } from '../metadata/hooks.ts'
import {
  findReplace,
  findReplacePreview,
  rangeSearch,
  search,
  searchPage,
  zoomRow,
  zoomSearch,
} from '../table/search.ts'
import type { ServerEnv } from './server.ts'
import { body, parse, respond, withScope } from './table-scope.ts'

/**
 * Table Search, Zoom search, Find and replace (pma: /table/search, /table/zoom-search,
 * /table/find-replace). Mounted at /api/servers/:s/databases.
 */
export const tableSearchRoutes = new Hono<ServerEnv>()

tableSearchRoutes.get('/:db/tables/:t/search', async (c) => c.json(await withScope(c, searchPage)))

tableSearchRoutes.post('/:db/tables/:t/search', async (c) => {
  const req = parse(SearchRequest, await body(c))
  return c.json(await withScope(c, (x) => search(x, req), { meta: false }))
})

/** range_search=1 */
tableSearchRoutes.get('/:db/tables/:t/search/range', async (c) =>
  c.json(await withScope(c, (x) => rangeSearch(x, c.req.query('column') ?? ''), { meta: false })),
)

tableSearchRoutes.post('/:db/tables/:t/search/zoom', async (c) => {
  const req = parse(ZoomRequest, await body(c))
  return c.json(await withScope(c, (x) => zoomSearch(x, req)))
})

/** get_data_row=1 */
tableSearchRoutes.post('/:db/tables/:t/search/zoom/row', async (c) => {
  const req = parse(ZoomRowRequest, await body(c))
  const { cfg } = c.get('deps')
  const hmac = c.get('session').hmacSecret
  return c.json(await withScope(c, (x) => zoomRow(x, req, hmac, cfg.blowfish_secret), { meta: false }))
})

tableSearchRoutes.post('/:db/tables/:t/find-replace/preview', async (c) => {
  const req = parse(FindReplaceRequest, await body(c))
  return c.json(await withScope(c, (x) => findReplacePreview(x, req), { meta: false }))
})

tableSearchRoutes.post('/:db/tables/:t/find-replace', async (c) => {
  const req = parse(FindReplaceRequest, await body(c))
  const r = await withScope(c, (x) => findReplace(x, req), { meta: false })
  await recordHistory(c, { db: c.req.param('db'), table: c.req.param('t'), sqlQuery: shownSql(r) })
  return respond(c, r)
})
