import { basename } from 'node:path'
import { Hono } from 'hono'
import { aboutFile, readLicense, renderChangelog, runtimeInfo } from '../shell/about.ts'
import type { ServerEnv } from './server.ts'

/**
 * The static pages behind the login, as every phpMyAdmin route but /url and /messages. Mounted at
 * /api/servers/:s/about.
 * pma: ChangeLogController (/changelog), LicenseController (/license), PhpInfoController (/phpinfo)
 */
export const aboutRoutes = new Hono<ServerEnv>()

const PROJECT_URL = 'https://github.com/cB-Abhinav-Gautam/better-myadmin'
const FAQ_URL = `${PROJECT_URL}/blob/main/docs/README.md`

/** "The %s file is not available on this system, please visit %s for more information." */
const unavailable = (file: string) => ({ available: false as const, file: basename(file), url: PROJECT_URL })

aboutRoutes.get('/license', (c) => {
  const file = aboutFile('license')
  const text = readLicense(file)
  return c.json(text === null ? unavailable(file) : { available: true as const, file: basename(file), text })
})

aboutRoutes.get('/changelog', (c) => {
  const file = aboutFile('changelog')
  const text = readLicense(file)
  if (text === null) return c.json(unavailable(file))
  return c.json({
    available: true as const,
    file: basename(file),
    html: renderChangelog(text, PROJECT_URL, FAQ_URL),
  })
})

/** PhpInfoController: only with $cfg['ShowPhpInfo'] (else phpMyAdmin redirects to the home page) */
aboutRoutes.get('/runtime', (c) => {
  const cfg = c.get('deps').cfg
  if (!cfg.ShowPhpInfo) return c.json({ enabled: false as const })
  return c.json({ enabled: true as const, ...runtimeInfo(cfg) })
})
