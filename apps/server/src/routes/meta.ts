import { Hono } from 'hono'
import type { AppEnv } from '../app.ts'

export const metaRoutes = new Hono<AppEnv>()

metaRoutes.get('/health', (c) => c.json({ ok: true }))

metaRoutes.get('/build', (c) =>
  c.json({ name: 'BetterMyAdmin', version: process.env.BMA_VERSION ?? '0.0.0-dev', commit: process.env.BMA_COMMIT ?? null }),
)
