#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { ConfigError, loadConfig } from '@bettermyadmin/config'
import { type Translator, htmlspecialchars } from '@bettermyadmin/i18n'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app.ts'
import type { AppConfig } from './config.ts'
import { PoolManager } from './db/pool-manager.ts'
import { SecretBox } from './session/crypto.ts'
import { type SessionStore, SqliteSessionStore, connectRedisStore } from './session/store.ts'
import { setupOpenWarning } from './setup/service.ts'

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p
}

/**
 * blowfish_secret is required for cookie auth; when missing we generate one into DataDir (0600),
 * like phpMyAdmin's ZeroConf behaviour (docs/architecture/04-backend-architecture.md#configuration).
 */
function ensureSecret(cfg: AppConfig, dataDir: string): { secret: string; generated: boolean } {
  if (cfg.blowfish_secret !== '') return { secret: cfg.blowfish_secret, generated: false }
  const file = join(dataDir, 'secret')
  if (existsSync(file)) return { secret: readFileSync(file, 'utf8').trim(), generated: true }
  const secret = randomBytes(32).toString('base64url')
  writeFileSync(file, `${secret}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)
  return { secret, generated: true }
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      static: { type: 'string' },
    },
  })

  let loaded: Awaited<ReturnType<typeof loadConfig>>
  try {
    loaded = await loadConfig(values.config !== undefined ? { file: values.config } : {})
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`Configuration error:\n${e.message}`)
      process.exit(1)
    }
    throw e
  }
  for (const w of loaded.warnings) console.warn(`config: ${w}`)
  const cfg = loaded.config

  const dataDir = resolve(expandHome(cfg.DataDir))
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const configuredSecret = cfg.blowfish_secret
  const { secret, generated } = ensureSecret(cfg, dataDir)
  if (generated)
    console.warn(`blowfish_secret is not set; using the generated secret in ${join(dataDir, 'secret')}`)
  cfg.blowfish_secret = secret

  const pools = new PoolManager(cfg)
  // a session lives as long as its login can (the sweep below uses the same idle limit)
  const sessionTtl = Math.max(cfg.LoginCookieValidity, cfg.LoginCookieStore) * 2
  let store: SessionStore
  try {
    store =
      cfg.SessionStore === 'redis'
        ? await connectRedisStore(cfg.RedisUrl, sessionTtl)
        : new SqliteSessionStore(join(dataDir, 'sessions.sqlite'))
  } catch (e) {
    console.error(`Session store: ${(e as Error).message}`)
    process.exit(1)
  }
  console.log(`sessions: ${cfg.SessionStore === 'redis' ? 'Redis' : join(dataDir, 'sessions.sqlite')}`)
  const deps = {
    cfg,
    store,
    pools,
    credBox: new SecretBox(secret, 'credentials'),
    userBox: new SecretBox(secret, 'username'),
    configuredSecret,
    secretGenerated: configuredSecret === '',
    ...(loaded.file !== undefined ? { configFile: loaded.file } : {}),
  }
  const app = createApp(deps)
  const setupWarning = setupOpenWarning(deps)
  if (setupWarning !== null) console.warn(`setup: ${setupWarning}`)

  // static SPA: hashed assets are immutable, everything else falls back to index.html
  const here = dirname(fileURLToPath(import.meta.url))
  const staticRoot = resolve(values.static ?? join(here, '../../web/dist'))
  if (existsSync(join(staticRoot, 'index.html'))) {
    // ThemeDefault / ThemePerServer for public/theme-init.js, so the first paint uses the configured theme
    const indexHtml = readFileSync(join(staticRoot, 'index.html'), 'utf8')
      .replace(
        'data-theme-default="pmahomme"',
        `data-theme-default="${cfg.ThemeDefault.replace(/[^\w-]/g, '')}"`,
      )
      .replace('data-theme-per-server="0"', `data-theme-per-server="${cfg.ThemePerServer ? 1 : 0}"`)
    // serveStatic resolves `root` against the working directory
    const root = relative(process.cwd(), staticRoot) || '.'
    app.use(
      '/assets/*',
      serveStatic({
        root,
        onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable'),
      }),
    )
    app.use('*', serveStatic({ root }))
    // base.twig / login/header.twig <noscript>, in the request's language (set by the page middleware)
    const noscript = 'Javascript must be enabled past this point!'
    app.get('*', (c) => {
      const tr = c.get('tr') as Translator | undefined
      const text = tr?.gettext('Javascript must be enabled past this point!') ?? noscript
      return c.html(text === noscript ? indexHtml : indexHtml.replace(noscript, htmlspecialchars(text)))
    })
  } else {
    console.warn(`web assets not found in ${staticRoot}; serving the API only (run the web dev server)`)
  }

  const host = values.host ?? cfg.Listen.host
  const port = Number(values.port ?? cfg.Listen.port)
  const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
    console.log(`BetterMyAdmin listening on http://${info.address}:${info.port}`)
  })

  const sweep = setInterval(() => {
    void (async () => {
      await store.sweep(Math.floor(Date.now() / 1000), sessionTtl)
      // the connections of swept (or otherwise deleted, or expired in Redis) sessions
      await pools.dropSessionsExcept(async (id) => (await store.get(id)) !== null)
    })().catch((e) => console.error('session sweep:', e))
  }, 60_000)
  sweep.unref()

  const shutdown = async () => {
    server.close()
    await pools.closeAll()
    await store.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void main()
