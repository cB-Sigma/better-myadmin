import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
  expect,
  test,
} from '@playwright/test'
import mysql from 'mysql2/promise'
import {
  type CaptureOptions,
  type Control,
  SCOPES,
  SCOPE_EXCLUDE,
  type ScopeName,
  captureControls,
  settle,
} from './capture.ts'
import { type DiffResult, diffControls, formatDiff, loadMap, validateMap } from './diff.ts'
import { type App, PMA_URL, ROOT, login, pmaReachable, pmaUrl } from './env.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')
export const GALLERY_DIR = join(repo, '.data/ui-parity')
/** `diff` (default): screenshots of the steps with differences only; `all`: of every step */
const SHOTS = process.env.BMA_UIP_SHOTS === 'all' ? 'all' : 'diff'

/** An action expressed once and run in both apps, located by accessible name inside the scope. */
export type Action =
  | { click: string }
  | { check: string }
  | { uncheck: string }
  | { fill: [label: string, text: string] }
  | { select: [label: string, option: string] }
  | { press: string }
  | { hover: string }
  | { wait: number }

/** what a step runs in one app (its result is ignored) */
export type PageFn = (page: Page) => Promise<unknown>

export interface Step {
  /** shown in the report and the gallery (also the `step` of map selectors) */
  name: string
  /** the same action in both apps (or the same function, given each app's page) … */
  do?: Action | Action[] | PageFn
  /** … or one per app (functions get the app's page) */
  pma?: Action | Action[] | PageFn
  ours?: Action | Action[] | PageFn
  /** do not diff after this step (e.g. it only prepares the next one) */
  noCapture?: boolean
}

export type Scope = ScopeName | { pma: string; ours: string } | string

export interface PageSpec {
  /**
   * phpMyAdmin route (`/server/sql`) and query parameters (server=1 is added); or `path`, a URL
   * path of the instance (`/setup/index.php?route=/setup`) taken as is
   */
  pma: { route: string; params?: Record<string, string>; path?: string }
  /** our path (`/s/1/sql`) */
  ours: { path: string }
  /** region to compare (default `content`, phpMyAdmin's #page_content) */
  scope?: Scope
  /** further selectors to leave out (both apps) */
  exclude?: string[]
  /** map file name in tests/ui-parity/maps (default: the case name) */
  map?: string
  /** log in first (default true) */
  auth?: boolean
  /**
   * The session's language (default: none chosen, English). The reference must have compiled
   * translations: pass a translated instance through `bases` (startPmaInstance `locales`).
   */
  lang?: string
  /**
   * Other instances than the shared ones (the setup script without a configuration file, the
   * other auth types): their base URLs, read when the case runs (started in a beforeAll).
   */
  bases?: () => { pma?: string | undefined; ours?: string | undefined }
  /**
   * Seeds Math.random in both pages (a fixed-seed generator, before any script), for pages that
   * place things at random, such as the Designer's tables without saved coordinates: the layout
   * is then the same on every run.
   */
  seedRandom?: boolean
  /** browser context options per app (e.g. `httpCredentials` for http auth) */
  context?: Partial<Record<App, BrowserContextOptions>>
  /** SQL run as root before the case (fixtures beyond global-setup's) */
  sql?: string
  /** runs after navigation and settle, before the first capture */
  setup?: (p: { pma: Page; ours: Page }) => Promise<void>
  /** selector to wait for after navigation (per app) */
  ready?: { pma?: string; ours?: string }
  interactions?: Step[]
  /**
   * Known unmapped differences: the case is marked test.fail() with this TODO so it turns red as
   * soon as the page matches (then delete `known` and lock it in).
   */
  known?: string
}

const scopeSel = (s: Scope | undefined, app: App): string => {
  if (s === undefined) return SCOPES.content
  if (typeof s === 'object') return s[app]
  return s in SCOPES ? SCOPES[s as ScopeName] : s
}

function target(page: Page, scope: string, name: string): Locator {
  const root = page.locator(scope).first()
  const opt = { name, exact: true }
  return root
    .getByRole('button', opt)
    .or(root.getByRole('link', opt))
    .or(root.getByRole('tab', opt))
    .or(root.getByRole('menuitem', opt))
    .or(root.getByRole('checkbox', opt))
    .or(root.getByRole('radio', opt))
    .first()
}

async function runAction(page: Page, scope: string, a: Action): Promise<void> {
  const root = page.locator(scope).first()
  if ('click' in a) await target(page, scope, a.click).click()
  else if ('check' in a) await root.getByLabel(a.check, { exact: true }).first().check()
  else if ('uncheck' in a) await root.getByLabel(a.uncheck, { exact: true }).first().uncheck()
  else if ('fill' in a) {
    // typed key by key: phpMyAdmin's filters listen to keyup, not input
    const box = root.getByLabel(a.fill[0], { exact: true }).first()
    await box.fill('')
    await box.pressSequentially(a.fill[1])
  } else if ('select' in a)
    await root.getByLabel(a.select[0], { exact: true }).first().selectOption({ label: a.select[1] })
  else if ('press' in a) await page.keyboard.press(a.press)
  else if ('hover' in a) await target(page, scope, a.hover).hover()
  else if ('wait' in a) await page.waitForTimeout(a.wait)
}

async function runStep(page: Page, app: App, scope: string, s: Step): Promise<void> {
  const what = s[app] ?? s.do
  if (what === undefined) return
  if (typeof what === 'function') await what(page)
  else for (const a of Array.isArray(what) ? what : [what]) await runAction(page, scope, a)
}

export interface StepRecord {
  step: string
  pma: { url: string; shot: string; controls: Control[] }
  ours: { url: string; shot: string; controls: Control[] }
  diff: DiffResult
}

async function openApp(browser: Browser, baseURL: string, app: App, spec: PageSpec): Promise<Page> {
  const ctx = await browser.newContext({ baseURL, ...spec.context?.[app] })
  if (spec.seedRandom === true) await ctx.addInitScript(seedMathRandom)
  try {
    return await openPage(ctx, baseURL, app, spec)
  } catch (e) {
    // a page that failed to open is closed at once: left open it keeps polling the server
    await ctx.close()
    throw e
  }
}

async function openPage(ctx: BrowserContext, baseURL: string, app: App, spec: PageSpec): Promise<Page> {
  const page = await ctx.newPage()
  const bases = spec.bases?.() ?? {}
  if (spec.auth !== false)
    await login(
      page,
      app,
      baseURL,
      spec.lang === undefined
        ? {}
        : { lang: spec.lang, ...(bases.pma !== undefined ? { pmaBase: bases.pma } : {}) },
    )
  else await ctx.clearCookies()
  const url =
    app === 'pma'
      ? spec.pma.path !== undefined
        ? `${bases.pma ?? PMA_URL}${spec.pma.path}`
        : pmaUrl(spec.pma.route, spec.pma.params, bases.pma)
      : `${bases.ours ?? baseURL}${spec.ours.path}`
  await page.goto(url)
  const ready = spec.ready?.[app]
  if (ready !== undefined) await expect(page.locator(ready).first()).toBeVisible({ timeout: 30_000 })
  else await expect(page.locator(scopeSel(spec.scope, app)).first()).toBeVisible({ timeout: 30_000 })
  await settle(page)
  return page
}

/**
 * One UI parity case: opens the page in both apps, diffs their controls, then performs each
 * interaction in both and diffs again. Unmapped differences fail the test; screenshots and the
 * captured controls go to .data/ui-parity/<name>/.
 */
export function pageParity(name: string, spec: PageSpec): void {
  test(name, async ({ browser, baseURL }, info) => {
    test.skip(!(await pmaReachable()), 'reference phpMyAdmin not reachable (BMA_PARITY_PMA_URL)')
    if (spec.known !== undefined) {
      test.fail(true, `TODO(ui-parity): ${spec.known}`)
      info.annotations.push({ type: 'todo', description: spec.known })
    }
    const map = loadMap(spec.map ?? name)
    const problems = validateMap(map)
    if (problems.length > 0)
      throw new Error(`tests/ui-parity/maps/${spec.map ?? name}.yaml:\n  ${problems.join('\n  ')}`)
    if (spec.sql !== undefined) {
      const c = await mysql.createConnection({ ...ROOT, multipleStatements: true })
      try {
        // a DDL blocked by a metadata lock fails this case instead of waiting (lock_wait_timeout
        // defaults to a year): left waiting, it outlives the case and every later case touching
        // the schema queues behind its pending exclusive lock
        await c.query('SET SESSION lock_wait_timeout = 20')
        await c.query(spec.sql)
      } finally {
        await c.end()
      }
    }
    const base = baseURL ?? ''
    const pmaPage = await openApp(browser, base, 'pma', spec)
    const oursPage = await openApp(browser, base, 'ours', spec).catch(async (e: unknown) => {
      await pmaPage.context().close()
      throw e
    })
    const pages = { pma: pmaPage, ours: oursPage }
    const dir = join(GALLERY_DIR, slug(name))
    mkdirSync(dir, { recursive: true })
    const opts = (app: App): CaptureOptions => ({
      scope: scopeSel(spec.scope, app),
      exclude: [...(SCOPE_EXCLUDE[(spec.scope ?? 'content') as ScopeName] ?? []), ...(spec.exclude ?? [])],
    })
    const records: StepRecord[] = []
    const report: string[] = []
    const capture = async (step: string) => {
      const side = async (app: App) => {
        const page = pages[app]
        await settle(page)
        return { url: page.url(), shot: '', controls: await captureControls(page, opts(app)) }
      }
      const p = await side('pma')
      const o = await side('ours')
      const diff = diffControls(p.controls, o.controls, map, step)
      // screenshots (the gallery, a review aid) only where they help: steps with differences, or
      // every step with BMA_UIP_SHOTS=all; full-page shots were a large part of a case's time
      if (SHOTS === 'all' || diff.differences.length > 0) {
        for (const [app, rec] of [
          ['pma', p],
          ['ours', o],
        ] as const) {
          rec.shot = `${String(records.length).padStart(2, '0')}-${slug(step)}-${app}.png`
          await pages[app].screenshot({ path: join(dir, rec.shot), fullPage: true })
        }
      }
      records.push({ step, pma: p, ours: o, diff })
      report.push(formatDiff(name, step, diff))
      for (const w of diff.warnings) report.push(`  (warning) ${w}`)
    }
    try {
      await spec.setup?.(pages)
      await capture('initial')
      for (const s of spec.interactions ?? []) {
        await runStep(pages.pma, 'pma', scopeSel(spec.scope, 'pma'), s)
        await runStep(pages.ours, 'ours', scopeSel(spec.scope, 'ours'), s)
        if (s.noCapture !== true) await capture(s.name)
      }
    } finally {
      writeFileSync(
        join(dir, 'result.json'),
        JSON.stringify({ name, spec: specSummary(spec), records }, null, 1),
      )
      await pages.pma.context().close()
      await pages.ours.context().close()
    }
    const text = report.join('\n')
    await info.attach('ui-parity.txt', { body: text, contentType: 'text/plain' })
    const total = records.reduce((n, r) => n + r.diff.differences.length, 0)
    expect(total, text).toBe(0)
  })
}

/** Replaces Math.random with mulberry32 (fixed seed); runs in the page. */
function seedMathRandom(): void {
  let a = 0x5eed1234
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const specSummary = (s: PageSpec) => ({
  pma: s.pma,
  ours: s.ours,
  scope: s.scope ?? 'content',
  known: s.known,
  steps: (s.interactions ?? []).map((i) => i.name),
})

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
