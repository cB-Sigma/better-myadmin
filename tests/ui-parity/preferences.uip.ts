import { pageParity } from './lib/parity.ts'

/**
 * User preferences: the eight Settings pages (docs/features/08-settings-preferences-pmadb.md),
 * each form of a tab compared after clicking its nav-tab.
 */
/**
 * phpMyAdmin's preferences templates leave `div.container-fluid` open, so its footer's #selflink
 * ends up inside #page_content; ours stays in the page footer.
 */
const exclude = ['#selflink']
/** phpMyAdmin's user starts from the defaults (ours never saves in these cases) */
const RESET = "DELETE FROM phpmyadmin.pma__userconfig WHERE username = 'uip_pma'"

const tabs: Array<{ tab: string; forms: string[] }> = [
  { tab: 'features', forms: ['Databases', 'Text fields', 'Page titles', 'Warnings', 'Console'] },
  { tab: 'sql', forms: ['SQL Query box'] },
  { tab: 'navigation', forms: ['Navigation tree', 'Servers', 'Databases', 'Tables'] },
  {
    tab: 'main-panel',
    forms: [
      'Database structure',
      'Table structure',
      'Browse mode',
      'Edit mode',
      'Tabs',
      'Display relational schema',
    ],
  },
  {
    tab: 'export',
    forms: ['SQL', 'CodeGen', 'CSV', 'LaTeX', 'Microsoft Office', 'OpenDocument', 'Texy! text'],
  },
  { tab: 'import', forms: ['SQL', 'CSV', 'OpenDocument'] },
]

for (const { tab, forms } of tabs) {
  pageParity(`preferences-${tab}`, {
    sql: RESET,
    pma: { route: `/preferences/${tab}` },
    ours: { path: `/s/1/preferences/${tab}` },
    ready: { pma: '#configFormDisplayTab', ours: '#configFormDisplayTab' },
    exclude,
    interactions: forms.map((f) => ({ name: f, do: { click: f } })),
  })
}

pageParity('preferences-manage', {
  sql: RESET,
  pma: { route: '/preferences/manage' },
  ours: { path: '/s/1/preferences/manage' },
  ready: { pma: '#user_prefs_tabs', ours: '#user_prefs_tabs' },
  exclude,
  interactions: [
    { name: 'from browser storage', do: { click: "Import from browser's storage" } },
    { name: 'to browser storage', do: { click: "Save to browser's storage" } },
  ],
})

pageParity('preferences-two-factor', {
  sql: RESET,
  pma: { route: '/preferences/two-factor' },
  ours: { path: '/s/1/preferences/two-factor' },
  ready: { pma: '#user_prefs_tabs', ours: '#user_prefs_tabs' },
  exclude,
})
