import { test } from '@playwright/test'
import { shippedLocales } from '../../packages/i18n/src/generated/catalog-index.ts'
import { FIX, ROOT } from './lib/env.ts'
import { type PmaInstance, startPmaInstance } from './lib/instances.ts'
import { type PageSpec, pageParity } from './lib/parity.ts'

/**
 * UI parity in Arabic (right to left) and Japanese (docs/architecture/10-i18n-and-accessibility.md):
 * a few full pages compared against a reference phpMyAdmin of its own with compiled translations
 * (the run's shared reference is the English-only checkout, and its maps say so). The intentional
 * differences of these pages are those of their English cases, with translated labels:
 * `maps/i18n-<lang>.yaml`.
 */
const LANGS = ['ar', 'ja'] as const

let ref: PmaInstance | undefined
test.beforeAll(async () => {
  // compiling 48 catalogues takes a while
  test.setTimeout(300_000)
  ref = await startPmaInstance(
    `$cfg['blowfish_secret'] = 'uip-i18n-reference-0123456789abcdef!';
$i = 1;
$cfg['Servers'][$i]['host'] = ${JSON.stringify(ROOT.host)};
$cfg['Servers'][$i]['port'] = ${JSON.stringify(String(ROOT.port))};
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['Servers'][$i]['controluser'] = 'pma';
$cfg['Servers'][$i]['controlpass'] = 'pmapass';
$cfg['Servers'][$i]['pmadb'] = 'phpmyadmin';`,
    // every shipped catalogue, like a release: the language selector lists them all
    { workers: 6, locales: shippedLocales },
  )
  // compile the templates once, before the first case's timeout runs
  await fetch(`${ref.url}/index.php`).catch(() => {})
})
test.afterAll(async () => {
  await ref?.stop()
})

const P = { db: FIX.db, table: FIX.table }
const T = `/s/1/db/${FIX.db}/t/${FIX.table}`
const PAGES: Array<[string, Pick<PageSpec, 'pma' | 'ours' | 'scope' | 'exclude' | 'auth' | 'ready'>]> = [
  ['home', { pma: { route: '/' }, ours: { path: '/s/1' }, exclude: ['#li_pma_version_git'] }],
  [
    'db-structure',
    {
      pma: { route: '/database/structure', params: { db: FIX.db } },
      ours: { path: `/s/1/db/${FIX.db}/structure` },
    },
  ],
  ['table-structure', { pma: { route: '/table/structure', params: P }, ours: { path: `${T}/structure` } }],
  ['server-sql', { pma: { route: '/server/sql' }, ours: { path: '/s/1/sql' } }],
  ['table-search', { pma: { route: '/table/search', params: P }, ours: { path: `${T}/search` } }],
  [
    'menu',
    { pma: { route: '/table/structure', params: P }, ours: { path: `${T}/structure` }, scope: 'menu' },
  ],
]

for (const lang of LANGS) {
  pageParity(`i18n-${lang}-login`, {
    auth: false,
    lang,
    map: `i18n-${lang}`,
    pma: { route: '/', params: { lang } },
    ours: { path: `/?lang=${lang}` },
    scope: 'page',
    ready: { pma: '#input_username', ours: '#input_username' },
    bases: () => ({ pma: ref?.url }),
  })
  for (const [name, spec] of PAGES) {
    pageParity(`i18n-${lang}-${name}`, {
      ...spec,
      lang,
      map: `i18n-${lang}`,
      bases: () => ({ pma: ref?.url }),
    })
  }
}
