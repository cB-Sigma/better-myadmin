import { Hono } from 'hono'
import type { ServerEnv } from './server.ts'

export const queryRoutes = new Hono<ServerEnv>()
