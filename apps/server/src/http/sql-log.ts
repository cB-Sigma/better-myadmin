import type { Executed } from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app.ts'

/**
 * `$cfg['DBG']['sqllog']` (with `DBG/sql`): one line per statement,
 * `SQL[index.php?route=<route>]: <seconds>(W:<warnings>,C:y,L:0x<link>) > <query>`. phpMyAdmin sends
 * it to syslog as each statement runs; Node has no syslog, so the lines go to the server's error
 * output when the request ends (X46). The route is the API path; `C` (cacheAffectedRows) is `y`, the
 * value of every statement phpMyAdmin logs this way; `L` is 0 for the user link, 1 for the control link.
 * pma: src/Dbal/DatabaseInterface.php::query
 */
export function sqlLogLine(route: string, e: Executed): string {
  return sprintf(
    'SQL[%s?route=%s]: %0.3f(W:%d,C:%s,L:0x%02X) > %s',
    'index.php',
    route,
    e.ms / 1000,
    e.warnings ?? 0,
    'y',
    e.label === 'pmadb' ? 1 : 0,
    e.sql,
  )
}

export function sqlLog(write: (line: string) => void = (l) => console.error(l)): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next()
    const { cfg } = c.get('deps')
    if (!cfg.DBG.sql || !cfg.DBG.sqllog) return
    for (const e of c.get('executed') ?? []) write(sqlLogLine(c.req.path, e))
  }
}
