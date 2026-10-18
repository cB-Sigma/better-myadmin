import { type Browser, type Page, expect, test } from '@playwright/test'
import { FIX, PMA_URL, login, pmaReachable } from './lib/env.ts'

/**
 * What the import page posts (docs/features/07-export-import.md): with each format selected, the
 * fields our page sends with the file are the ones phpMyAdmin's `#import_file_form` holds (names and
 * default values) at server, database and table scope. The outcome of those fields is compared by
 * tests/parity/import-options.parity.test.ts.
 */
const LEVELS = [
  {
    level: 'server',
    route: '/server/import',
    params: {},
    path: '/s/1/import',
    formats: ['csv', 'mediawiki', 'ods', 'shp', 'sql', 'xml'],
  },
  {
    level: 'database',
    route: '/database/import',
    params: { db: FIX.db },
    path: `/s/1/db/${FIX.db}/import`,
    formats: ['csv', 'mediawiki', 'ods', 'shp', 'sql', 'xml'],
  },
  {
    level: 'table',
    route: '/table/import',
    params: { db: FIX.db, table: FIX.table },
    path: `/s/1/db/${FIX.db}/t/${FIX.table}/import`,
    formats: ['csv', 'ldi', 'mediawiki', 'ods', 'shp', 'sql', 'xml'],
  },
] as const

/** the session's fields and the file input are not part of the comparison */
const comparable = (pairs: Array<[string, string]>) =>
  pairs
    .filter(([k]) => !['token', 'server', 'lang', 'import_file', 'noplugin'].includes(k))
    .map(([k, v]) => `${k}=${v}`)
    .sort()

async function session(browser: Browser, baseURL: string, app: 'pma' | 'ours'): Promise<Page> {
  const page = await (await browser.newContext({ baseURL })).newPage()
  await login(page, app, baseURL)
  return page
}

for (const l of LEVELS) {
  test(`import ${l.level}: every format posts phpMyAdmin's fields and defaults`, async ({
    browser,
    baseURL,
  }) => {
    test.skip(!(await pmaReachable()), 'reference phpMyAdmin not reachable (BMA_PARITY_PMA_URL)')
    const pma = await session(browser, baseURL ?? '', 'pma')
    const ours = await session(browser, baseURL ?? '', 'ours')
    let posted: Array<[string, string]> = []
    await ours.route('**/api/servers/1/import/jobs', async (r) => {
      posted = (r.request().postDataJSON() as { params: Array<[string, string]> }).params
      await r.abort()
    })
    for (const f of l.formats) {
      await pma.goto(
        `${PMA_URL}/index.php?${new URLSearchParams({ route: l.route, server: '1', ...l.params })}`,
      )
      await pma.locator('#plugins').selectOption(f)
      const expected = await pma.evaluate(() =>
        [...new FormData(document.querySelector('#import_file_form') as HTMLFormElement).entries()]
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => [k, String(v)] as [string, string]),
      )
      await ours.goto(l.path)
      await ours.locator('#plugins').selectOption(f)
      await ours
        .locator('#input_import_file')
        .setInputFiles({ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('x') })
      posted = []
      await ours.locator('#buttonGo').click()
      await expect.poll(() => posted.length).toBeGreaterThan(0)
      expect(comparable(posted), `${l.level} ${f}`).toEqual(comparable(expected))
    }
    await pma.context().close()
    await ours.context().close()
  })
}
