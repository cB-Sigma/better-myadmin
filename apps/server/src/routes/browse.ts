import {
  BrowseRequest,
  ColumnValuesRequest,
  DeleteRowsRequest,
  GridSaveRequest,
  GridValueRequest,
} from '@bettermyadmin/contracts'
import { Hono, type Context as HonoContext } from 'hono'
import {
  type BrowseCtx,
  browseResponse,
  columnValues,
  deleteRows,
  getField,
  gridSave,
  gridValue,
} from '../browse/actions.ts'
import { afterSqlBox } from '../metadata/hooks.ts'
import { withMeta } from '../metadata/service.ts'
import type { ServerEnv } from './server.ts'
import { parseBody } from './sql.ts'

/** The results grid: /sql and its helper routes (docs/features/02-browse-results-grid.md). */
export const browseRoutes = new Hono<ServerEnv>()

type C = HonoContext<ServerEnv>

/** One request with the user's connection and the configuration storage. */
function withBrowse<T>(c: C, db: string, fn: (x: BrowseCtx) => Promise<T>): Promise<T> {
  return withMeta(c, { db }, async (m) =>
    fn({
      m,
      conn: await m.userConn(),
      settings: await m.settings(),
      tr: c.get('tr'),
      session: c.get('session'),
      executed: c.get('executed'),
      debugSql: c.get('deps').cfg.DBG.sql,
    }),
  )
}

/** POST /api/servers/:s/browse — pma: /sql */
browseRoutes.post('/', async (c) => {
  const req = await parseBody(c, BrowseRequest)
  const r = await withBrowse(c, req.db, (x) => browseResponse(x, req))
  // StatementHistory + RecentTableHandling middlewares
  await afterSqlBox(c, { db: req.db, table: req.table, current: r.current })
  return c.json(r.body)
})

/** POST /browse/grid-value — pma: /sql with grid_edit */
browseRoutes.post('/grid-value', async (c) => {
  const req = await parseBody(c, GridValueRequest)
  return c.json(await withBrowse(c, req.db, (x) => gridValue(x, req)))
})

/** POST /browse/values — pma: /sql/get-enum-values, /sql/get-set-values, /sql/get-relational-values */
browseRoutes.post('/values', async (c) => {
  const req = await parseBody(c, ColumnValuesRequest)
  return c.json(await withBrowse(c, req.db, (x) => columnValues(x, req)))
})

/** POST /browse/save — pma: /table/replace (grid edit) */
browseRoutes.post('/save', async (c) => {
  const req = await parseBody(c, GridSaveRequest)
  return c.json(await withBrowse(c, req.db, (x) => gridSave(x, req)))
})

/** POST /browse/delete-rows — pma: /table/delete/rows (then the original query again) */
browseRoutes.post('/delete-rows', async (c) => {
  const req = await parseBody(c, DeleteRowsRequest)
  const r = await withBrowse(c, req.db, async (x) => {
    const queries = await deleteRows(x, req)
    return browseResponse(x, BrowseRequest.parse({ db: req.db, table: req.table, sql: req.originalSql }), {
      sql: queries.join('\n'),
      message: x.tr.gettext('Your SQL query has been executed successfully.'),
    })
  })
  await afterSqlBox(c, { db: req.db, table: req.table, current: r.current })
  return c.json(r.body)
})

/** GET /browse/field?db&table&where&sig&key — pma: /table/get-field */
browseRoutes.get('/field', async (c) => {
  const q = {
    db: c.req.query('db') ?? '',
    table: c.req.query('table') ?? '',
    where: c.req.query('where') ?? '',
    sig: c.req.query('sig') ?? '',
    key: c.req.query('key') ?? '',
  }
  const bytes = await withBrowse(c, q.db, (x) => getField(x, q))
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${encodeURIComponent(`${q.table}-${q.key}.bin`)}"`,
    },
  })
})
