// Regenerates public/themes/<id>/screen.png (the Themes gallery cards) from a running instance:
//   BMA_URL=http://127.0.0.1:8080 BMA_USER=root BMA_PASSWORD=… node apps/web/scripts/theme-screenshots.mjs
// phpMyAdmin ships a screenshot per theme; ours are pictures of BetterMyAdmin in each theme.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const base = process.env.BMA_URL ?? 'http://127.0.0.1:8080'
const out = join(dirname(fileURLToPath(import.meta.url)), '../public/themes')
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
)
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 0.5 })
await page.goto(`${base}/`)
await page.fill('#input_username', process.env.BMA_USER ?? 'root')
await page.fill('#input_password', process.env.BMA_PASSWORD ?? '')
await page.click('#input_go')
await page.waitForSelector('#maincontainer')
for (const id of ['bootstrap', 'metro', 'original', 'pmahomme']) {
  await page.evaluate((t) => {
    localStorage.setItem('bma_theme', t)
    localStorage.removeItem('bma_theme_color')
  }, id)
  await page.reload()
  await page.waitForSelector('#maincontainer')
  await page.waitForLoadState('networkidle')
  mkdirSync(join(out, id), { recursive: true })
  await page.screenshot({ path: join(out, id, 'screen.png') })
}
await page.evaluate(() => localStorage.removeItem('bma_theme'))
await browser.close()
