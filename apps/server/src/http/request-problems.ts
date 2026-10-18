import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app.ts'

/**
 * A `GLOBALS` parameter ("GLOBALS overwrite attempt") or 1000 parameters and more ("possible
 * exploit") stop the request with a 500, like phpMyAdmin's check of `$_REQUEST`: here the query
 * string and the top-level keys of a JSON body.
 * pma: src/Http/Middleware/RequestProblemChecking.php
 */
export function requestProblemChecking(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const names = new Set(new URL(c.req.url).searchParams.keys())
    if ((c.req.header('content-type') ?? '').includes('application/json')) {
      const body: unknown = await c.req.json().catch(() => null)
      if (body !== null && typeof body === 'object' && !Array.isArray(body))
        for (const k of Object.keys(body)) names.add(k)
    }
    const tr = c.get('tr')
    const message = names.has('GLOBALS')
      ? tr.gettext('GLOBALS overwrite attempt')
      : names.size >= 1000
        ? tr.gettext('possible exploit')
        : null
    if (message === null) return next()
    return c.json({ error: { code: 'INTERNAL', message } }, 500)
  }
}
