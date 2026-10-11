import { Hono } from 'hono'
import type { ServerEnv } from './server.ts'
import { tableNormalizationRoutes } from './table-normalization.ts'
import { tableOpsRoutes } from './table-ops.ts'
import { tablePrivilegesRoutes } from './table-privileges.ts'
import { tableRelationRoutes } from './table-relation.ts'
import { tableSearchRoutes } from './table-search.ts'
import { tableTrackingRoutes } from './table-tracking.ts'

/** The table-level screens beyond Structure (docs/features/04-table-level.md). */
export const tableLevelRoutes = new Hono<ServerEnv>()
tableLevelRoutes.route('/', tableOpsRoutes)
tableLevelRoutes.route('/', tableRelationRoutes)
tableLevelRoutes.route('/', tableSearchRoutes)
tableLevelRoutes.route('/', tableTrackingRoutes)
tableLevelRoutes.route('/', tableNormalizationRoutes)
tableLevelRoutes.route('/', tablePrivilegesRoutes)
