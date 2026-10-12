import {
  BinlogQuery,
  ChangePrimaryRequest,
  CreateDatabaseRequest,
  DatabasesQuery,
  DropDatabasesRequest,
  MonitorChartRequest,
  MonitorLogRequest,
  MonitorLogVarsRequest,
  MonitorQueryRequest,
  ProcessesQuery,
  ReplicaControlRequest,
  ReplicaSkipErrorsRequest,
  ReplicaUserRequest,
  ReplicationQuery,
  SetVariableRequest,
  StatusVariablesRequest,
} from '@bettermyadmin/contracts'
import { phpIntval } from '@bettermyadmin/i18n'
import { Hono } from 'hono'
import { jsonBody, parse } from '../http/validate.ts'
import { collationsPage } from '../server-admin/charsets.ts'
import { withAdmin } from '../server-admin/context.ts'
import { createDatabase, databasesPage, dropDatabases } from '../server-admin/databases.ts'
import { enginePage, enginesPage } from '../server-admin/engines.ts'
import {
  chartData,
  generalLog,
  logVars,
  monitorPage,
  queryAnalyzer,
  slowLog,
} from '../server-admin/monitor.ts'
import { binlogPage, pluginsPage } from '../server-admin/plugins-binlog.ts'
import { addReplicaUser } from '../server-admin/replica-user.ts'
import {
  type ReplicationRequest,
  changePrimary,
  replicaControl,
  replicaSkipErrors,
  replicationPage,
} from '../server-admin/replication.ts'
import {
  advisorPage,
  killProcess,
  processList,
  queryStatistics,
  statusOverview,
  statusVariablesPage,
} from '../server-admin/status.ts'
import { getVariable, setVariable, variablesPage } from '../server-admin/variables.ts'
import type { ServerEnv } from './server.ts'

/**
 * Server-level pages (docs/features/06-server-level.md): Databases, Status, Variables, Charsets,
 * Engines, Plugins, Binary log, Replication. GET handlers only read; mutations are POST (CSRF-checked).
 */
export const serverAdminRoutes = new Hono<ServerEnv>()

/** pma: /server/databases */
serverAdminRoutes.get('/databases', async (c) => {
  const q = parse(DatabasesQuery, c.req.query())
  return c.json(
    await withAdmin(c, (ctx) =>
      databasesPage(ctx, {
        statistics: q.statistics,
        pos: q.pos,
        sortBy: q.sort_by,
        sortOrder: q.sort_order,
      }),
    ),
  )
})

/** pma: /server/databases/create */
serverAdminRoutes.post('/databases', async (c) => {
  const req = parse(CreateDatabaseRequest, await jsonBody(c, {}))
  const res = await withAdmin(c, (ctx) => createDatabase(ctx, req.new_db, req.db_collation))
  return c.json(res)
})

/** pma: /server/databases/destroy */
serverAdminRoutes.post('/databases/drop', async (c) => {
  const req = parse(DropDatabasesRequest, await jsonBody(c, {}))
  const res = await withAdmin(c, (ctx) => dropDatabases(ctx, req.selected_dbs))
  return c.json(res)
})

/** pma: /server/status */
serverAdminRoutes.get('/status', async (c) => c.json(await withAdmin(c, statusOverview)))

/** pma: /server/status/processes and /server/status/processes/refresh */
serverAdminRoutes.get('/status/processes', async (c) => {
  const q = parse(ProcessesQuery, c.req.query())
  return c.json(
    await withAdmin(c, (ctx) =>
      processList(ctx, {
        showExecuting: q.showExecuting,
        full: q.full,
        orderByField: q.order_by_field,
        sortOrder: q.sort_order,
      }),
    ),
  )
})

/** pma: /server/status/processes/kill/{id} */
serverAdminRoutes.post('/status/processes/:id/kill', async (c) => {
  const id = c.req.param('id')
  const n = /^\d+$/.test(id) ? Number(id) : 0
  const res = await withAdmin(c, (ctx) => killProcess(ctx, n))
  return c.json(res)
})

/** pma: /server/status/queries */
serverAdminRoutes.get('/status/queries', async (c) => c.json(await withAdmin(c, queryStatistics)))

/** pma: GET /server/status/variables */
serverAdminRoutes.get('/status/variables', async (c) => {
  const q = parse(StatusVariablesRequest, c.req.query())
  // GET never flushes
  return c.json(await withAdmin(c, (ctx) => statusVariablesPage(ctx, { ...q, flush: undefined })))
})

/** pma: POST /server/status/variables (filters and the FLUSH actions) */
serverAdminRoutes.post('/status/variables', async (c) => {
  const req = parse(StatusVariablesRequest, await jsonBody(c, {}))
  return c.json(await withAdmin(c, (ctx) => statusVariablesPage(ctx, req)))
})

/** pma: /server/status/advisor */
serverAdminRoutes.get('/status/advisor', async (c) => {
  const s = c.get('serverIndex')
  return c.json(
    await withAdmin(c, (ctx) =>
      advisorPage(ctx, (name) => `/s/${s}/variables?filter=${encodeURIComponent(name)}`),
    ),
  )
})

/** pma: /server/status/monitor (the page facts of #js_data and window.variableNames) */
serverAdminRoutes.get('/status/monitor', async (c) => c.json(await withAdmin(c, monitorPage)))

/** pma: /server/status/monitor/chart — one reading of the chart grid (polled by the page) */
serverAdminRoutes.post('/status/monitor/chart', async (c) => {
  const req = parse(MonitorChartRequest, await jsonBody(c, {}))
  return c.json(await withAdmin(c, (ctx) => chartData(ctx, req.requiredData)))
})

/** pma: /server/status/monitor/slow-log */
serverAdminRoutes.post('/status/monitor/slow-log', async (c) => {
  const req = parse(MonitorLogRequest, await jsonBody(c, {}))
  return c.json(await withAdmin(c, (ctx) => slowLog(ctx, phpIntval(req.time_start), phpIntval(req.time_end))))
})

/** pma: /server/status/monitor/general-log */
serverAdminRoutes.post('/status/monitor/general-log', async (c) => {
  const req = parse(MonitorLogRequest, await jsonBody(c, {}))
  // (bool) of the posted string: '' and '0' are false
  const bool = (v: string | undefined) => v !== undefined && v !== '' && v !== '0'
  return c.json(
    await withAdmin(c, (ctx) =>
      generalLog(
        ctx,
        phpIntval(req.time_start),
        phpIntval(req.time_end),
        bool(req.limitTypes),
        bool(req.removeVariables),
      ),
    ),
  )
})

/** pma: /server/status/monitor/log-vars */
serverAdminRoutes.post('/status/monitor/log-vars', async (c) => {
  const req = parse(MonitorLogVarsRequest, await jsonBody(c, {}))
  return c.json(await withAdmin(c, (ctx) => logVars(ctx, req.varName, req.varValue)))
})

/** pma: /server/status/monitor/query */
serverAdminRoutes.post('/status/monitor/query', async (c) => {
  const req = parse(MonitorQueryRequest, await jsonBody(c, {}))
  // a link of its own, like phpMyAdmin's: the analyzed query is profiled as query 1 and its
  // database and PROFILING do not stay on a pooled connection
  return c.json(await withAdmin(c, (ctx) => queryAnalyzer(ctx, req.database, req.query), true))
})

/** pma: /server/variables */
serverAdminRoutes.get('/variables', async (c) => c.json(await withAdmin(c, variablesPage)))

/** pma: /server/variables/get/{name} */
serverAdminRoutes.get('/variables/:name', async (c) => {
  const name = c.req.param('name')
  return c.json(await withAdmin(c, (ctx) => getVariable(ctx, name)))
})

/** pma: /server/variables/set/{name} */
serverAdminRoutes.post('/variables/:name', async (c) => {
  const name = c.req.param('name')
  const req = parse(SetVariableRequest, await jsonBody(c, {}))
  const res = await withAdmin(c, (ctx) => setVariable(ctx, name, req.varValue))
  return c.json(res)
})

/** pma: /server/collations */
serverAdminRoutes.get('/collations', async (c) => c.json(await withAdmin(c, collationsPage)))

/** pma: /server/engines */
serverAdminRoutes.get('/engines', async (c) => c.json(await withAdmin(c, enginesPage)))

/** pma: /server/engines/{engine}[/{page}] */
serverAdminRoutes.get('/engines/:engine/:page?', async (c) => {
  const engine = c.req.param('engine')
  const page = c.req.param('page') ?? ''
  return c.json(await withAdmin(c, (ctx) => enginePage(ctx, engine, page)))
})

/** pma: /server/plugins */
serverAdminRoutes.get('/plugins', async (c) => c.json(await withAdmin(c, pluginsPage)))

/** pma: /server/binlog */
serverAdminRoutes.get('/binlog', async (c) => {
  const q = parse(BinlogQuery, c.req.query())
  return c.json(
    await withAdmin(c, (ctx) => binlogPage(ctx, { log: q.log, pos: q.pos, isFullQuery: q.is_full_query })),
  )
})

/** The replication page variant an action renders after it ran (the action's own POST). */
const actionPage = (primaryConnection: string | undefined): ReplicationRequest => ({
  view: '',
  primaryConnection: primaryConnection ?? null,
  username: null,
  hostname: null,
})

/** pma: /server/replication */
serverAdminRoutes.get('/replication', async (c) => {
  const q = parse(ReplicationQuery, c.req.query())
  return c.json(
    await withAdmin(c, (ctx) =>
      replicationPage(ctx, {
        view: q.view,
        primaryConnection: q.primary_connection ?? null,
        username: q.username ?? null,
        hostname: q.hostname ?? null,
      }),
    ),
  )
})

/** pma: /server/replication with sr_replica_server_control (Full start/stop, thread only, reset) */
serverAdminRoutes.post('/replication/control', async (c) => {
  const req = parse(ReplicaControlRequest, await jsonBody(c, {}))
  return c.json(
    await withAdmin(c, (ctx) =>
      replicaControl(ctx, actionPage(req.primary_connection), req.action, req.control),
    ),
  )
})

/** pma: /server/replication with sr_replica_skip_error */
serverAdminRoutes.post('/replication/skip-errors', async (c) => {
  const req = parse(ReplicaSkipErrorsRequest, await jsonBody(c, {}))
  return c.json(
    await withAdmin(c, (ctx) =>
      replicaSkipErrors(ctx, actionPage(req.primary_connection), phpIntval(req.count)),
    ),
  )
})

/** pma: /server/replication with replica_changeprimary */
serverAdminRoutes.post('/replication/change-primary', async (c) => {
  const req = parse(ChangePrimaryRequest, await jsonBody(c, {}))
  return c.json(
    await withAdmin(c, (ctx) =>
      changePrimary(ctx, actionPage(req.primary_connection), {
        username: req.username,
        password: req.password,
        hostname: req.hostname,
        port: phpIntval(req.port),
      }),
    ),
  )
})

/** pma: /server/privileges with adduser_submit from the replication page's "Add replica replication user" */
serverAdminRoutes.post('/replication/replica-user', async (c) => {
  const req = parse(ReplicaUserRequest, await jsonBody(c, {}))
  return c.json(await withAdmin(c, (ctx) => addReplicaUser(ctx, req)))
})
