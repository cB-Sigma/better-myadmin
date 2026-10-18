import { type Browser, type Page, expect, test } from '@playwright/test'
import { FIX, PMA_URL, login, pmaReachable } from './lib/env.ts'

/**
 * What the export page posts (docs/features/07-export-import.md): in "Custom" mode with each
 * format selected, the fields our page sends are the ones phpMyAdmin's `form[name="dump"]` holds
 * (names and default values), at server, database and table scope. The output of those fields is
 * compared byte for byte by tests/parity/export-options.parity.test.ts.
 */
const FORMATS = [
  'codegen',
  'csv',
  'excel',
  'json',
  'latex',
  'mediawiki',
  'htmlword',
  'ods',
  'odt',
  'phparray',
].concat(['sql', 'texytext', 'toon', 'xml', 'yaml'])
const LEVELS = [
  { level: 'server', route: '/server/export', params: {}, path: '/s/1/export' },
  { level: 'database', route: '/database/export', params: { db: FIX.db }, path: `/s/1/db/${FIX.db}/export` },
  {
    level: 'table',
    route: '/table/export',
    params: { db: FIX.db, table: FIX.table, single_table: 'true' },
    path: `/s/1/db/${FIX.db}/t/${FIX.table}/export?single_table=true`,
  },
] as const

/** the session's own fields (token, server, lang) are not part of the comparison */
const comparable = (pairs: Array<[string, string]>) =>
  pairs
    .filter(([k]) => !['token', 'server', 'lang'].includes(k))
    .map(([k, v]) => `${k}=${v}`)
    .sort()

async function session(browser: Browser, baseURL: string, app: 'pma' | 'ours'): Promise<Page> {
  const page = await (await browser.newContext({ baseURL })).newPage()
  await login(page, app, baseURL)
  return page
}

for (const l of LEVELS) {
  test(`export ${l.level}: every format posts phpMyAdmin's fields and defaults`, async ({
    browser,
    baseURL,
  }) => {
    test.skip(!(await pmaReachable()), 'reference phpMyAdmin not reachable (BMA_PARITY_PMA_URL)')
    const pma = await session(browser, baseURL ?? '', 'pma')
    const ours = await session(browser, baseURL ?? '', 'ours')
    let posted: Array<[string, string]> = []
    await ours.route('**/api/servers/1/export', async (r) => {
      posted = (r.request().postDataJSON() as { params: Array<[string, string]> }).params
      await r.abort()
    })
    for (const f of FORMATS) {
      if (l.level === 'server' && f === 'xml') continue
      await pma.goto(
        `${PMA_URL}/index.php?${new URLSearchParams({ route: l.route, server: '1', ...l.params })}`,
      )
      await pma.locator('#radio_custom_export').check()
      await pma.locator('#plugins').selectOption(f)
      const expected = await pma.evaluate(() =>
        [...new FormData(document.querySelector('form[name="dump"]') as HTMLFormElement).entries()].map(
          ([k, v]) => [k, String(v)] as [string, string],
        ),
      )
      await ours.goto(l.path)
      await ours.locator('#radio_custom_export').check()
      await ours.locator('#plugins').selectOption(f)
      posted = []
      await ours.locator('#buttonGo').click()
      await expect.poll(() => posted.length).toBeGreaterThan(0)
      expect(comparable(posted), `${l.level} ${f}`).toEqual(comparable(expected))
    }
    await pma.context().close()
    await ours.context().close()
  })
}
