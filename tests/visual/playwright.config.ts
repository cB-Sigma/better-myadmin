import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

/**
 * Visual checks of the main pages (docs/architecture/11-testing-and-parity-strategy.md):
 *   desktop  1400×900, compared pixel by pixel with a baseline taken on the code before a change
 *            (`--update-snapshots` on the old code, then a run on the new one): desktop must not move
 *   mobile   iPhone 13 (390×844, touch), compared the same way once its baseline exists
 * Snapshots live in .data/visual (machine-specific fonts: not committed).
 *
 *   pnpm --filter @bettermyadmin/web build
 *   npx playwright test -c tests/visual/playwright.config.ts --project=desktop [--update-snapshots]
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const port = Number(process.env.BMA_VISUAL_PORT ?? 8180)
const chromium =
  process.env.PW_CHROMIUM ?? process.env.BMA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const launch = existsSync(chromium) ? { launchOptions: { executablePath: chromium } } : {}

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.visual.ts'],
  outputDir: join(repo, '.data/visual-results'),
  snapshotPathTemplate: join(repo, '.data/visual/{projectName}/{arg}{ext}'),
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' } },
  use: { baseURL: `http://127.0.0.1:${port}`, locale: 'en-US', ...launch },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1400, height: 900 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', ...launch } },
  ],
  webServer: {
    command: `${join(repo, 'apps/server/node_modules/.bin/tsx')} ${join(repo, 'apps/server/src/main.ts')} --config ${join(repo, 'tests/visual/bma.config.ts')} --port ${port} --host 127.0.0.1 --static ${join(repo, 'apps/web/dist')}`,
    url: `http://127.0.0.1:${port}/api/meta/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
