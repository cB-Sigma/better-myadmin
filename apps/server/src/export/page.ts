import { Hono } from 'hono'
import type { ServerEnv } from '../routes/server.ts'

/** The export page view-models (filled in with the export UI). */
export const exportPageRoutes = new Hono<ServerEnv>()
