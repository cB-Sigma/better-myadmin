import { statSync } from 'node:fs'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app.ts'

/**
 * `CheckConfigurationPermissions`: a world-writable configuration file stops every request with
 * "Wrong permissions on configuration file, should not be world writable!" (500), except on
 * Windows. The file is checked on each request, like phpMyAdmin.
 * pma: src/Config.php::checkPermissions, src/Http/Middleware/ConfigErrorAndPermissionChecking.php
 */
export function worldWritable(file: string | undefined, platform = process.platform): boolean {
  if (file === undefined || platform === 'win32') return false
  try {
    return (statSync(file).mode & 0o002) !== 0
  } catch {
    return false
  }
}

export function configPermissions(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { cfg, configFile } = c.get('deps')
    if (!cfg.CheckConfigurationPermissions || !worldWritable(configFile)) return next()
    const message = c
      .get('tr')
      .gettext('Wrong permissions on configuration file, should not be world writable!')
    if (c.req.path.startsWith('/api/')) return c.json({ error: { code: 'INTERNAL', message } }, 500)
    // error/generic.twig (X33: the product name)
    const esc = message.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    return c.html(
      `<!DOCTYPE HTML><html><head><meta charset="utf-8"><title>BetterMyAdmin</title></head><body><h1>BetterMyAdmin - ${c.get('tr').gettext('Error')}</h1><div class="errormessage"><p>${esc}</p></div></body></html>`,
      500,
    )
  }
}
