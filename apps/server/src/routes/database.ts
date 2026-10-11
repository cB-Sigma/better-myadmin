import {
  AddPrefixRequest,
  BulkFkRequest,
  BulkTablesRequest,
  CopyTablesRequest,
  DbCollationRequest,
  DbCommentRequest,
  DbRenameCopyRequest,
  DbStructureQuery,
  MaintenanceRequest,
  ReplacePrefixRequest,
} from '@bettermyadmin/contracts'
import { type Context, Hono } from 'hono'
import {
  addPrefix,
  copyForm,
  copyTables,
  copyWithPrefix,
  dropTables,
  emptyTables,
  maintenance,
  replacePrefix,
  showCreate,
} from '../database/bulk.ts'
import { parse, withDb } from '../database/context.ts'
import { changeCollation, operationsPage, renameOrCopy, saveComment } from '../database/operations.ts'
import { realRowCountAction, structurePage } from '../database/structure.ts'
import type { ServerEnv } from './server.ts'

/**
 * Database level pages (docs/features/05-database-level.md). Mounted at /api/servers/:s/databases.
 */
export const databaseRoutes = new Hono<ServerEnv>()

const body = async (c: Context<ServerEnv>) => c.req.json().catch(() => ({}))

// ---------------------------------------------------------------- Structure

/** GET …/:db/structure (pma: /database/structure) */
databaseRoutes.get('/:db/structure', async (c) => {
  const q = parse(DbStructureQuery, c.req.query())
  return c.json(await withDb(c, (ctx) => structurePage(ctx, q)))
})

/** GET …/:db/structure/real-row-count?table=t | ?all=1 (pma: /database/structure/real-row-count) */
databaseRoutes.get('/:db/structure/real-row-count', async (c) => {
  const table = c.req.query('table')
  const all = c.req.query('all') !== undefined
  return c.json(
    await withDb(c, (ctx) => realRowCountAction(ctx, table === undefined ? { all } : { table, all })),
  )
})

/** GET …/:db/structure/copy-form (pma: /database/structure/copy-form) */
databaseRoutes.get('/:db/structure/copy-form', async (c) => c.json(await withDb(c, copyForm)))

/** pma: /database/structure/empty-table */
databaseRoutes.post('/:db/structure/empty', async (c) => {
  const req = parse(BulkFkRequest, await body(c))
  return c.json(await withDb(c, (ctx) => emptyTables(ctx, req)))
})

/** pma: /database/structure/drop-table */
databaseRoutes.post('/:db/structure/drop', async (c) => {
  const req = parse(BulkFkRequest, await body(c))
  return c.json(await withDb(c, (ctx) => dropTables(ctx, req)))
})

/** pma: /database/structure/add-prefix-table */
databaseRoutes.post('/:db/structure/add-prefix', async (c) => {
  const req = parse(AddPrefixRequest, await body(c))
  return c.json(await withDb(c, (ctx) => addPrefix(ctx, req)))
})

/** pma: /database/structure/replace-prefix */
databaseRoutes.post('/:db/structure/replace-prefix', async (c) => {
  const req = parse(ReplacePrefixRequest, await body(c))
  return c.json(await withDb(c, (ctx) => replacePrefix(ctx, req)))
})

/** pma: /database/structure/copy-table-with-prefix */
databaseRoutes.post('/:db/structure/copy-with-prefix', async (c) => {
  const req = parse(ReplacePrefixRequest, await body(c))
  return c.json(await withDb(c, (ctx) => copyWithPrefix(ctx, req)))
})

/** pma: /database/structure/copy-table */
databaseRoutes.post('/:db/structure/copy', async (c) => {
  const req = parse(CopyTablesRequest, await body(c))
  return c.json(await withDb(c, (ctx) => copyTables(ctx, req)))
})

/** pma: /database/structure/show-create */
databaseRoutes.post('/:db/structure/show-create', async (c) => {
  const req = parse(BulkTablesRequest, await body(c))
  return c.json(await withDb(c, (ctx) => showCreate(ctx, req.tables)))
})

/** pma: /table/maintenance/{analyze,check,checksum,optimize,repair} */
databaseRoutes.post('/:db/structure/maintenance', async (c) => {
  const req = parse(MaintenanceRequest, await body(c))
  return c.json(await withDb(c, (ctx) => maintenance(ctx, req)))
})

// ---------------------------------------------------------------- Operations

/** pma: GET /database/operations */
databaseRoutes.get('/:db/operations', async (c) => c.json(await withDb(c, operationsPage)))

/** pma: POST /database/operations comment= */
databaseRoutes.post('/:db/operations/comment', async (c) => {
  const req = parse(DbCommentRequest, await body(c))
  return c.json(await withDb(c, (ctx) => saveComment(ctx, req.comment)))
})

/** pma: /database/operations/collation */
databaseRoutes.post('/:db/operations/collation', async (c) => {
  const req = parse(DbCollationRequest, await body(c))
  return c.json(await withDb(c, (ctx) => changeCollation(ctx, req)))
})

/** pma: POST /database/operations db_rename=true */
databaseRoutes.post('/:db/operations/rename', async (c) => {
  const req = parse(DbRenameCopyRequest, await body(c))
  return c.json(await withDb(c, (ctx) => renameOrCopy(ctx, { ...req, move: true, what: 'data' })))
})

/** pma: POST /database/operations db_copy=true */
databaseRoutes.post('/:db/operations/copy', async (c) => {
  const req = parse(DbRenameCopyRequest, await body(c))
  return c.json(await withDb(c, (ctx) => renameOrCopy(ctx, { ...req, move: false })))
})
