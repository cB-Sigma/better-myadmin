import { publicConfig } from '@bettermyadmin/config'
import type { VersionCheckResponse } from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import type { AppEnv } from '../app.ts'
import { getServer, serverIndexes } from '../config.ts'
import { withMeta } from '../metadata/service.ts'
import { readGitInfo } from '../shell/git.ts'
import { APP_VERSION } from '../shell/scope.ts'
import { getLatestVersions, latestCompatible } from '../shell/version.ts'
import { asServerRequest, loginCredentials } from './server.ts'

export const metaRoutes = new Hono<AppEnv>()

metaRoutes.get('/health', (c) => c.json({ ok: true }))

/** pma: /git-revision (GitInfoController) */
metaRoutes.get('/build', (c) => {
  const git = c.get('deps').cfg.ShowGitRevision ? readGitInfo() : null
  return c.json({
    name: 'BetterMyAdmin',
    version: APP_VERSION,
    commit: process.env.BMA_COMMIT ?? git?.hash ?? null,
    branch: git?.branch ?? null,
  })
})

/**
 * The client-visible configuration subset (allow-listed directives only, never secrets or
 * `Servers`), the equivalent of the inlined CommonParams/config JS globals, with the user's
 * preferences of the current server merged in.
 */
metaRoutes.get('/config-public', async (c) => {
  const { cfg, credBox } = c.get('deps')
  const session = c.get('session')
  const server = session.currentServer
  const login = session.servers[String(server)]
  // logged in: the user's preferences applied (UserPreferencesHandler::loadUserPreferences)
  if (login?.twoFactorOk === true && getServer(cfg, server) !== undefined) {
    const creds = loginCredentials(credBox, login)
    if (creds !== null) {
      try {
        const settings = await asServerRequest(c, server, creds, (sc) =>
          withMeta(sc, {}, (m) => m.settings()),
        )
        return c.json(publicConfig(settings))
      } catch {
        // the server is unreachable: the configuration alone
      }
    }
  }
  return c.json(publicConfig(cfg))
})

/**
 * GET /api/meta/version-check (pma: /version-check): `{}` when VersionCheck is off or no data,
 * else the latest compatible release `{version, date}` (empty strings when none is compatible).
 */
metaRoutes.get('/version-check', async (c) => {
  const { cfg } = c.get('deps')
  const url = process.env.BMA_VERSION_FEED_URL ?? ''
  if (!cfg.VersionCheck || url === '') return c.json({} satisfies VersionCheckResponse)
  const releases = await getLatestVersions(url, Date.now(), cfg)
  if (releases === null) return c.json({} satisfies VersionCheckResponse)
  const session = c.get('session')
  const single = serverIndexes(cfg).length === 1
  // VersionInformation::getMySQLVersion: the connected server's version string (recorded by the scope endpoint)
  const cached = session.servers[String(session.currentServer)]?.cache?.server_version
  const mysqlVersion = typeof cached === 'string' ? cached : null
  const latest = latestCompatible(releases, process.versions.node, mysqlVersion, single)
  const body: VersionCheckResponse = { version: latest?.version ?? '', date: latest?.date ?? '' }
  return c.json(body)
})
