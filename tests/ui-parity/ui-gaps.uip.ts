import { test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { FIX, ROOT, USERS } from './lib/env.ts'
import { pageParity } from './lib/parity.ts'

/**
 * Controls behind a user preference: the legacy database select (ShowDatabasesNavigationAsTree
 * off), the inline column actions (HideStructureActions off), and the Insert page settings. The
 * preference is written straight into each app's own user configuration (phpMyAdmin's
 * `phpmyadmin.pma__userconfig`, our uip_pmadb) before the case logs in, and removed after the file.
 */
const prefs = (config: Record<string, unknown>) => {
  const json = JSON.stringify(config).replaceAll("'", "''")
  return [
    `REPLACE INTO phpmyadmin.pma__userconfig (username, timevalue, config_data) VALUES ('${USERS.pma}', NOW(), '${json}')`,
    `REPLACE INTO ${FIX.pmadb}.pma__userconfig (username, timevalue, config_data) VALUES ('${USERS.ours}', NOW(), '${json}')`,
  ].join(';\n')
}
const RESET = `DELETE FROM phpmyadmin.pma__userconfig WHERE username = '${USERS.pma}';
DELETE FROM ${FIX.pmadb}.pma__userconfig WHERE username = '${USERS.ours}'`

test.afterAll(async () => {
  const c = await mysql.createConnection({ ...ROOT, multipleStatements: true })
  await c.query(RESET)
  await c.end()
})

const LEGACY = prefs({ ShowDatabasesNavigationAsTree: false })

pageParity('navigation-legacy-select', {
  sql: LEGACY,
  pma: { route: '/' },
  ours: { path: '/s/1' },
  scope: 'navigation',
  map: 'navigation',
})

pageParity('navigation-legacy-select-db', {
  sql: LEGACY,
  pma: { route: '/database/structure', params: { db: FIX.db } },
  ours: { path: `/s/1/db/${FIX.db}/structure` },
  scope: 'navigation',
  map: 'navigation',
  ready: { pma: '#navi_db_select', ours: '#navi_db_select' },
})

pageParity('table-structure-inline-actions', {
  sql: prefs({ HideStructureActions: false }),
  pma: { route: '/table/structure', params: { db: FIX.db, table: FIX.table } },
  ours: { path: `/s/1/db/${FIX.db}/t/${FIX.table}/structure` },
  map: 'table-structure',
})

pageParity('page-settings-insert', {
  sql: RESET,
  pma: { route: '/table/change', params: { db: FIX.db, table: FIX.table } },
  ours: { path: `/s/1/db/${FIX.db}/t/${FIX.table}/insert` },
  ready: { pma: '#insertForm', ours: '#insertForm' },
  scope: { pma: '#pageSettingsModal .modal-content', ours: '#pageSettingsModal' },
  map: 'page-settings-browse',
  setup: async ({ pma, ours }) => {
    await pma.locator('#page_settings_icon').click()
    await pma.locator('#pageSettingsModal.show').waitFor()
    await ours.locator('#page_settings_icon button').click()
    await ours.locator('#pageSettingsModal input, #pageSettingsModal select').first().waitFor()
  },
  interactions: [{ name: 'text fields', do: { click: 'Text fields' } }],
})
