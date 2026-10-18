import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

/**
 * UI structure parity: every case opens the same page in the reference phpMyAdmin (the run's own
 * instance started by global-setup, or BMA_PARITY_PMA_URL) and in BetterMyAdmin (the built SPA served by the real server, as in
 * tests/e2e) and diffs their controls. `pnpm test:ui-parity` builds the web app first.
 * Screenshot gallery: .data/ui-parity/index.html.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
// a random port unless given (several worktrees run suites concurrently); workers inherit the env
process.env.BMA_UIP_PORT ??= String(20000 + Math.floor(Math.random() * 20000))
const port = Number(process.env.BMA_UIP_PORT)
const chromium =
  process.env.PW_CHROMIUM ?? process.env.BMA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.uip.ts'],
  outputDir: join(repo, '.data/ui-parity-results'),
  timeout: 90_000,
  fullyParallel: false,
  // the cases share the fixture databases (each recreates its own before it runs): one at a time
  workers: 1,
  reporter: 'list',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'en-US',
    timezoneId: 'UTC',
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    ...(existsSync(chromium) ? { launchOptions: { executablePath: chromium } } : {}),
  },
  webServer: {
    command: `${join(repo, 'apps/server/node_modules/.bin/tsx')} ${join(repo, 'apps/server/src/main.ts')} --config ${join(repo, 'tests/ui-parity/bma.config.ts')} --port ${port} --host 127.0.0.1 --static ${join(repo, 'apps/web/dist')}`,
    url: `http://127.0.0.1:${port}/api/meta/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
