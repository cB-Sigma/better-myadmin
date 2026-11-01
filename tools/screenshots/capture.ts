/**
 * The README screenshots (docs/screenshots/*.jpg): BetterMyAdmin on the acme_store demo database
 * (docker/demo/acme_store.sql), each page framed in a window on a gradient.
 *
 *   pnpm --filter @bettermyadmin/web build
 *   npx tsx tools/screenshots/capture.ts [name …]
 *
 * It starts its own server on BMA_SHOT_PORT (8160) against the MySQL of BMA_TEST_HOST/PORT
 * (127.0.0.1:3306, root/root), so the demo database must be loaded there:
 *   mysql --default-character-set=utf8mb4 -uroot -proot < docker/demo/acme_store.sql
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Page, chromium } from '@playwright/test'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const port = Number(process.env.BMA_SHOT_PORT ?? 8160)
const base = `http://127.0.0.1:${port}`
const out = join(repo, 'docs/screenshots')
const DB = 'acme_store'
const MYSQL = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: process.env.BMA_TEST_USER ?? 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
// mysql2 ships with the server (apps/server)
const mysql = createRequire(join(repo, 'apps/server/package.json'))('mysql2/promise') as {
  createConnection(o: object): Promise<{ query(sql: string): Promise<unknown>; end(): Promise<void> }>
}

interface Shot {
  /** the file name in docs/screenshots (.jpg) */
  name: string
  /** the address shown in the window's title bar */
  title: string
  theme?: { theme: string; mode: 'light' | 'dark' }
  /** drives the page into the state to capture */
  run: (page: Page) => Promise<void>
}

async function setQuery(page: Page, sql: string) {
  await page.locator('[id^="sqltabpanel-"]:not([hidden]) #sqlquery .cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(sql)
}

async function renameTab(page: Page, from: string, to: string) {
  await page.getByRole('tab', { name: from }).dblclick()
  const box = page.getByRole('textbox', { name: 'Rename' })
  await box.fill(to)
  await box.press('Enter')
}

const SHOTS: Shot[] = [
  {
    name: 'tabs',
    title: `localhost:8080 / ${DB} / SQL`,
    run: async (page) => {
      await page.goto(`/s/1/db/${DB}/sql`)
      await setQuery(page, 'SELECT name, category, price FROM products ORDER BY price DESC LIMIT 5;')
      await page.getByRole('button', { name: 'New query tab' }).click()
      await page.getByRole('button', { name: 'New query tab' }).click()
      await renameTab(page, 'Query 1', 'Top products')
      await renameTab(page, 'Query 2', 'Revenue')
      await renameTab(page, 'Query 3', 'Customers')
      await page.getByRole('tab', { name: 'Revenue' }).click()
      await setQuery(
        page,
        'SELECT id, first_name, last_name, country, is_vip\nFROM customers\nWHERE is_vip = 1\nORDER BY signed_up_at DESC;',
      )
      await page.keyboard.press('Control+Enter')
      await page.locator('[id^="sqltabpanel-"]:not([hidden]) table.table_results').waitFor()
    },
  },
  {
    name: 'palette',
    title: `localhost:8080 / ${DB} / products`,
    theme: { theme: 'modern', mode: 'dark' },
    run: async (page) => {
      await page.goto(`/s/1/db/${DB}/t/products/browse`)
      await page.locator('table.table_results').waitFor()
      await page.keyboard.press('Control+Shift+P')
      const input = page.getByRole('dialog').getByRole('combobox')
      await input.waitFor()
      await page.keyboard.insertText('pr')
      await page.waitForTimeout(600)
    },
  },
  {
    name: 'diagram',
    title: `localhost:8080 / ${DB} / Diagram`,
    run: async (page) => {
      await page.goto(`/s/1/db/${DB}/diagram`)
      await page.getByRole('button', { name: 'Zoom to fit' }).click()
      await page.waitForTimeout(800)
    },
  },
  {
    name: 'dashboard',
    title: 'localhost:8080 / Status / Dashboard',
    run: async (page) => {
      await page.goto('/s/1/status/dashboard')
      // the 2 s refresh: enough points for the charts to have a shape
      await page.getByRole('combobox', { name: 'Refresh rate' }).selectOption({ label: '2 seconds' })
      // some traffic with a changing rate, so the charts have a shape
      const conn = await mysql.createConnection({ ...MYSQL, database: DB })
      try {
        for (let i = 0; i < 40; i++) {
          const n = 20 + Math.round(30 * Math.abs(Math.sin(i / 5)))
          for (let k = 0; k < n; k++)
            await conn.query(
              'SELECT p.category, SUM(oi.quantity * oi.unit_price) FROM order_items oi JOIN products p ON p.id = oi.product_id GROUP BY p.category',
            )
          await page.waitForTimeout(700)
        }
      } finally {
        await conn.end()
      }
    },
  },
  {
    name: 'slow-queries',
    title: 'localhost:8080 / Status / Slow queries',
    run: async (page) => {
      // a clean digest table and a shop-like workload (this resets performance_schema's statement
      // statistics of the server it runs against: use a development server)
      const conn = await mysql.createConnection({ ...MYSQL, database: DB })
      try {
        await conn.query('TRUNCATE TABLE performance_schema.events_statements_summary_by_digest')
        const work = [
          [
            40,
            "SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.email LIKE '%@example.%' ORDER BY o.placed_at DESC",
          ],
          [
            25,
            'SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue FROM order_items oi JOIN products p ON p.id = oi.product_id GROUP BY p.category ORDER BY revenue DESC',
          ],
          [60, "SELECT * FROM products WHERE name LIKE '%desk%' OR category = 'Furniture'"],
          [
            30,
            'SELECT c.country, COUNT(*) AS n, AVG(o.total) FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.country',
          ],
          [80, 'SELECT id, name, price FROM products WHERE id = 7'],
          [
            20,
            'SELECT r.rating, r.body FROM reviews r WHERE r.product_id IN (SELECT id FROM products WHERE price > 100) ORDER BY r.created_at DESC',
          ],
          [15, "UPDATE products SET stock = stock WHERE category = 'Audio'"],
        ] as const
        for (const [n, sql] of work) for (let k = 0; k < n; k++) await conn.query(sql)
      } finally {
        await conn.end()
      }
      await page.goto('/s/1/status/slow-queries')
      await page.locator('#slowQueriesDb').selectOption(DB)
      const first = page.locator('table tbody tr').first()
      await first.waitFor()
      await first.locator('.slow-query-open').click()
      const dialog = page.locator('#slowQueryDetail')
      await dialog.waitFor()
      await dialog.locator('#slowQueryExplain').click()
      await dialog.locator('#slowQueryExplainResult tbody tr').first().waitFor()
      await dialog.locator('#slowQueryExplainResult tbody tr').first().scrollIntoViewIfNeeded()
      await page.waitForTimeout(400)
    },
  },
]

/** The window frame around a screenshot, rendered as HTML (macOS-style chrome on a gradient). */
function frame(png: Buffer, title: string, w: number, h: number): string {
  return `<!doctype html><html><head><style>
  html,body{margin:0;background:transparent}
  body{width:${w + 80}px;padding:32px 40px 40px;box-sizing:border-box;
    background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 45%,#60a5fa 100%);font-family:-apple-system,"Segoe UI",Roboto,sans-serif}
  .win{border-radius:14px;overflow:hidden;box-shadow:0 30px 60px rgba(15,23,42,.45),0 0 0 1px rgba(255,255,255,.08);background:#fff}
  .bar{height:40px;display:flex;align-items:center;gap:8px;padding:0 16px;background:#eef0f3;border-bottom:1px solid #d9dce1;position:relative}
  .dot{width:12px;height:12px;border-radius:50%}
  .url{position:absolute;left:50%;transform:translateX(-50%);background:#e2e5ea;color:#4b5563;font-size:13px;padding:4px 70px;border-radius:7px}
  img{display:block;width:${w}px;height:${h}px}
  </style></head><body><div class="win"><div class="bar">
  <span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
  <span class="url">${title}</span></div>
  <img src="data:image/png;base64,${png.toString('base64')}"></div></body></html>`
}

function startServer(): ChildProcess {
  const dir = mkdtempSync(join(tmpdir(), 'bma-shots-'))
  const config = join(dir, 'bettermyadmin.config.json')
  writeFileSync(
    config,
    JSON.stringify({
      blowfish_secret: 'screenshots-secret-screenshots-secret!',
      DataDir: dir,
      ZeroConf: false,
      Servers: [
        {
          host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
          port: Number(process.env.BMA_TEST_PORT ?? 3306),
          verbose: 'Production',
          // the demo database only (the shared test server has many others)
          only_db: [DB],
          pmadb: 'bma_shots_no_storage',
        },
      ],
    }),
  )
  return spawn(
    join(repo, 'apps/server/node_modules/.bin/tsx'),
    [
      join(repo, 'apps/server/src/main.ts'),
      '--config',
      config,
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
      '--static',
      join(repo, 'apps/web/dist'),
    ],
    { cwd: dir, stdio: 'ignore' },
  )
}

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${base}/api/meta/health`)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`the server on ${base} did not start`)
}

const wanted = new Set(process.argv.slice(2))
const server = startServer()
try {
  await waitUp()
  // the e2e run's Chromium (tests/e2e/playwright.config.ts), else Playwright's own
  const exe =
    process.env.PW_CHROMIUM ??
    process.env.BMA_CHROMIUM ??
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
  const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {})
  const W = 1400
  const H = 860
  for (const shot of SHOTS.filter((s) => wanted.size === 0 || wanted.has(s.name))) {
    const ctx = await browser.newContext({
      baseURL: base,
      viewport: { width: W, height: H },
      deviceScaleFactor: 2,
      colorScheme: shot.theme?.mode ?? 'light',
    })
    // the theme the page starts with (packages/ui themes: localStorage bma_theme / bma_theme_color)
    if (shot.theme !== undefined)
      await ctx.addInitScript((t) => {
        localStorage.setItem('bma_theme', t.theme)
        localStorage.setItem('bma_theme_color', t.mode)
      }, shot.theme)
    const page = await ctx.newPage()
    await page.goto('/')
    await page.fill('#input_username', process.env.BMA_TEST_USER ?? 'root')
    await page.fill('#input_password', process.env.BMA_TEST_PASSWORD ?? 'root')
    await page.click('#input_go')
    await page.locator('#maincontainer').waitFor()
    await shot.run(page)
    // no caret or hover state in the picture
    await page.mouse.move(W - 2, H - 2)
    const png = await page.screenshot()
    await ctx.close()

    const shown = { w: 1000, h: Math.round((1000 * H) / W) }
    const fctx = await browser.newContext({ deviceScaleFactor: 2.16, viewport: { width: 1080, height: 800 } })
    const fp = await fctx.newPage()
    await fp.setContent(frame(png, shot.title, shown.w, shown.h))
    await fp.locator('body').screenshot({ path: join(out, `${shot.name}.jpg`), type: 'jpeg', quality: 88 })
    await fctx.close()
    console.log(`docs/screenshots/${shot.name}.jpg`)
  }
  await browser.close()
} finally {
  server.kill()
}
