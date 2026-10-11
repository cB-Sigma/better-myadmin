// fixture for the Hono route scanner (never executed)
import { Hono } from 'hono'
import { childRoutes, deepRoutes } from './routes/child.ts'

export function createApp() {
  const app = new Hono()
  app.use('*', async (_c, next) => next())
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.route('/api/child', childRoutes)
  app.route('/api/servers/:s{[0-9]+}/deep', deepRoutes)
  app.all('/api/*', (c) => c.json({}, 404))
  return app
}
