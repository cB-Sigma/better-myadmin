import { Hono } from 'hono'
import { withDb } from '../database/context.ts'
import { dbPrivileges } from '../database/privileges.ts'
import type { ServerEnv } from './server.ts'

/**
 * Table Privileges tab (pma: /table/privileges): the database Privileges service with the table's
 * `tables_priv` rows. Mounted at /api/servers/:s/databases. Like PrivilegesController it only
 * validates the names; it neither selects the database nor checks the table.
 */
export const tablePrivilegesRoutes = new Hono<ServerEnv>()

tablePrivilegesRoutes.get('/:db/tables/:t/privileges', async (c) =>
  c.json(await withDb(c, (ctx) => dbPrivileges(ctx, c.req.param('t')))),
)
