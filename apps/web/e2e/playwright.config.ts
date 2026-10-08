import { defineConfig } from '@playwright/test'

/**
 * E2E against the built SPA served by the real server (build first: `pnpm --filter
 * @bettermyadmin/web build`), MySQL from BMA_TEST_* (default 127.0.0.1:3306 root/root).
 * `PW_CHROMIUM` points at a local Chromium when Playwright's own browsers are not installed.
 */
const port = Number(process.env.BMA_E2E_PORT ?? 8095)
const mysqlHost = process.env.BMA_TEST_HOST ?? '127.0.0.1'

export default defineConfig({
  testDir: '.',
  outputDir: '../../../.data/e2e-results',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  webServer: {
    command: `npx tsx src/main.ts --port ${port} --static ../web/dist`,
    cwd: '../../server',
    url: `http://127.0.0.1:${port}/api/meta/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      BMA_HOST: mysqlHost,
      BMA_PORT: process.env.BMA_TEST_PORT ?? '3306',
      BMA__DataDir: '../../.data/e2e',
      BMA__blowfish_secret: 'e2e-secret-e2e-secret-e2e-secret',
    },
  },
})
