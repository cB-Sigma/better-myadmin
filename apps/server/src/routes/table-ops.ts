import {
  MaintenanceRequest,
  MoveCopyRequest,
  OrderByRequest,
  PartitionOpsRequest,
  RenameViewRequest,
  SqlActionRequest,
  TableOptionsRequest,
} from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import { recordHistory, shownSql } from '../metadata/hooks.ts'
import { maintenance } from '../table/maintenance.ts'
import {
  moveCopy,
  operationsPage,
  orderBy,
  partitionOps,
  renameView,
  sqlAction,
  tableOptions,
} from '../table/operations.ts'
import type { ServerEnv } from './server.ts'
import { body, parse, respond, withScope } from './table-scope.ts'

/**
 * Table Operations tab (pma: /table/operations, /view/operations, /table/maintenance/*, the /sql
 * links of the page). Mounted at /api/servers/:s/databases.
 */
export const tableOpsRoutes = new Hono<ServerEnv>()

tableOpsRoutes.get('/:db/tables/:t/operations', async (c) => c.json(await withScope(c, operationsPage)))

tableOpsRoutes.post('/:db/tables/:t/operations/order-by', async (c) => {
  const req = parse(OrderByRequest, await body(c))
  const r = await withScope(c, (x) => orderBy(x, req), { meta: false })
  await recordHistory(c, { db: c.req.param('db'), table: c.req.param('t'), sqlQuery: shownSql(r) })
  return respond(c, r)
})

tableOpsRoutes.post('/:db/tables/:t/operations/move-copy', async (c) => {
  const req = parse(MoveCopyRequest, await body(c))
  const { history, ...r } = await withScope(c, (x) => moveCopy(x, req))
  if (history !== undefined) await recordHistory(c, history)
  return respond(c, r)
})

tableOpsRoutes.post('/:db/tables/:t/operations/options', async (c) => {
  const req = parse(TableOptionsRequest, await body(c))
  const r = await withScope(c, (x) => tableOptions(x, req))
  await recordHistory(c, { db: c.req.param('db'), table: r.table, sqlQuery: shownSql(r) })
  return respond(c, r)
})

tableOpsRoutes.post('/:db/tables/:t/operations/maintenance', async (c) => {
  const req = parse(MaintenanceRequest, await body(c))
  return respond(
    c,
    await withScope(c, (x) => maintenance(x, req, x.table, c.get('session')), { meta: false }),
  )
})

tableOpsRoutes.post('/:db/tables/:t/operations/sql', async (c) => {
  const req = parse(SqlActionRequest, await body(c))
  return respond(c, await withScope(c, (x) => sqlAction(x, req)))
})

tableOpsRoutes.post('/:db/tables/:t/operations/partitions', async (c) => {
  const req = parse(PartitionOpsRequest, await body(c))
  const r = await withScope(c, (x) => partitionOps(x, req), { meta: false })
  await recordHistory(c, { db: c.req.param('db'), table: c.req.param('t'), sqlQuery: shownSql(r) })
  return respond(c, r)
})

tableOpsRoutes.post('/:db/tables/:t/operations/rename-view', async (c) => {
  const req = parse(RenameViewRequest, await body(c))
  return respond(c, await withScope(c, (x) => renameView(x, req)))
})
