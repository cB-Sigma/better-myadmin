import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests against the built SPA served by the real server (apps/server/src/main.ts) and a
 * live MySQL (BMA_TEST_HOST/PORT, root password BMA_TEST_PASSWORD). Build the web app first
 * (`pnpm --filter @bettermyadmin/web build`), then `npx playwright test -c apps/web`.
 */
const PORT = Number(process.env.BMA_E2E_PORT ?? 18190)
const executablePath = process.env.BMA_E2E_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: { executablePath },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `../server/node_modules/.bin/tsx ../server/src/main.ts --port ${PORT} --host 127.0.0.1 --static dist`,
    url: `http://127.0.0.1:${PORT}/api/meta/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      BMA_HOST: process.env.BMA_TEST_HOST ?? '127.0.0.1',
      BMA_PORT: process.env.BMA_TEST_PORT ?? '3306',
      BMA__DataDir: join(tmpdir(), `bma-e2e-${PORT}`),
      BMA__blowfish_secret: 'e2e-secret-e2e-secret-e2e-secret-0123',
    },
  },
})
