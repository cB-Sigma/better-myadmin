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
import {
  maintenance,
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

const base = '/:db/tables/:t/operations'

tableOpsRoutes.get(base, async (c) => c.json(await withScope(c, operationsPage)))

tableOpsRoutes.post(`${base}/order-by`, async (c) => {
  const req = parse(OrderByRequest, await body(c))
  return respond(c, await withScope(c, (x) => orderBy(x, req), { meta: false }))
})

tableOpsRoutes.post(`${base}/move-copy`, async (c) => {
  const req = parse(MoveCopyRequest, await body(c))
  return respond(c, await withScope(c, (x) => moveCopy(x, req)))
})

tableOpsRoutes.post(`${base}/options`, async (c) => {
  const req = parse(TableOptionsRequest, await body(c))
  return respond(c, await withScope(c, (x) => tableOptions(x, req)))
})

tableOpsRoutes.post(`${base}/maintenance`, async (c) => {
  const req = parse(MaintenanceRequest, await body(c))
  return respond(c, await withScope(c, (x) => maintenance(x, req), { meta: false }))
})

tableOpsRoutes.post(`${base}/sql`, async (c) => {
  const req = parse(SqlActionRequest, await body(c))
  return respond(c, await withScope(c, (x) => sqlAction(x, req)))
})

tableOpsRoutes.post(`${base}/partitions`, async (c) => {
  const req = parse(PartitionOpsRequest, await body(c))
  return respond(c, await withScope(c, (x) => partitionOps(x, req), { meta: false }))
})

tableOpsRoutes.post(`${base}/rename-view`, async (c) => {
  const req = parse(RenameViewRequest, await body(c))
  return respond(c, await withScope(c, (x) => renameView(x, req)))
})
