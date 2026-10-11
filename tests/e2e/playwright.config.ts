import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

/**
 * The one end-to-end setup: every suite (shell, navigation, SQL editor and console, language) against
 * the built SPA served by the real server. `pnpm test:e2e` builds the web app first. MySQL from
 * BMA_TEST_HOST/PORT (default 127.0.0.1:3306, root/root); global-setup creates the shell suite's
 * m1shell_* objects, the other suites create their own.
 * Chromium: PW_CHROMIUM or BMA_CHROMIUM, else the preinstalled one when present.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const port = Number(process.env.BMA_E2E_PORT ?? 8099)
const chromium =
  process.env.PW_CHROMIUM ?? process.env.BMA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.e2e.ts'],
  outputDir: join(repo, '.data/e2e-results'),
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'en-US',
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    ...(existsSync(chromium) ? { launchOptions: { executablePath: chromium } } : {}),
  },
  webServer: {
    command: `${join(repo, 'apps/server/node_modules/.bin/tsx')} ${join(repo, 'apps/server/src/main.ts')} --config ${join(repo, 'tests/e2e/bma.config.ts')} --port ${port} --host 127.0.0.1 --static ${join(repo, 'apps/web/dist')}`,
    url: `http://127.0.0.1:${port}/api/meta/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
