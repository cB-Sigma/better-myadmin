// fixture for the Hono route scanner (never executed)
import { Hono } from 'hono'

export const childRoutes = new Hono()
childRoutes.get('/', (c) => c.json({}))
childRoutes.post('/save', (c) => c.json({})).get('/load/:id', (c) => c.json({}))
childRoutes.on(['PUT', 'PATCH'], '/item/:id', (c) => c.json({}))

export const deepRoutes = new Hono()
const inner = new Hono()
inner.delete('/x', (c) => c.json({}))
deepRoutes.route('/inner/', inner)
