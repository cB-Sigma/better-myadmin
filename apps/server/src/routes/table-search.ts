import { FindReplaceRequest, SearchRequest, ZoomRequest, ZoomRowRequest } from '@bettermyadmin/contracts'
import { Hono } from 'hono'
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

const base = '/:db/tables/:t/search'

tableSearchRoutes.get(base, async (c) => c.json(await withScope(c, searchPage)))

tableSearchRoutes.post(base, async (c) => {
  const req = parse(SearchRequest, await body(c))
  return c.json(await withScope(c, (x) => search(x, req), { meta: false }))
})

/** range_search=1 */
tableSearchRoutes.get(`${base}/range`, async (c) =>
  c.json(await withScope(c, (x) => rangeSearch(x, c.req.query('column') ?? ''), { meta: false })),
)

tableSearchRoutes.post(`${base}/zoom`, async (c) => {
  const req = parse(ZoomRequest, await body(c))
  return c.json(await withScope(c, (x) => zoomSearch(x, req)))
})

/** get_data_row=1 */
tableSearchRoutes.post(`${base}/zoom/row`, async (c) => {
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
  return respond(c, await withScope(c, (x) => findReplace(x, req), { meta: false }))
})
