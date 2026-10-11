import { Hono } from 'hono'
import type { ServerEnv } from './server.ts'
import { tableOpsRoutes } from './table-ops.ts'

/** The table-level screens beyond Structure (docs/features/04-table-level.md). */
export const tableLevelRoutes = new Hono<ServerEnv>()
tableLevelRoutes.route('/', tableOpsRoutes)
