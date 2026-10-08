import { defineConfig } from '@playwright/test'

const PORT = Number(process.env.BMA_E2E_PORT ?? 18431)

/**
 * End-to-end tests against the built SPA served by the BetterMyAdmin server (MySQL on :3306).
 * Run: pnpm --filter @bettermyadmin/web build && npx playwright test -c tests/e2e
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: process.env.PW_CHROMIUM !== undefined ? { executablePath: process.env.PW_CHROMIUM } : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm --filter @bettermyadmin/server exec tsx src/main.ts --config ../../tests/e2e/bma.e2e.yaml --port ${PORT} --host 127.0.0.1`,
    cwd: '../..',
    url: `http://127.0.0.1:${PORT}/api/meta/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
