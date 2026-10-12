import type { Page } from '@playwright/test'
import { type PageSpec, pageParity } from './lib/parity.ts'

/**
 * The Designer (docs/features/05-database-level.md): the canvas page, its dialogs, the relation
 * pane and the visual query builder, on a small fixture database `f05d_uip`.
 */
const DB = 'f05d_uip'
const SQL = `CREATE DATABASE IF NOT EXISTS ${DB};
CREATE TABLE IF NOT EXISTS ${DB}.parent (id INT NOT NULL PRIMARY KEY, name VARCHAR(20)) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ${DB}.child (id INT PRIMARY KEY, parent_id INT, born DATE,
  FOREIGN KEY (parent_id) REFERENCES ${DB}.parent (id)) ENGINE=InnoDB;`

const designer = (extra: Partial<PageSpec> = {}, query = false): PageSpec => ({
  sql: SQL,
  pma: { route: '/database/designer', params: query ? { db: DB, query: '1' } : { db: DB } },
  ours: { path: `/s/1/db/${DB}/designer${query ? '?query=1' : ''}` },
  ready: { pma: '#side_menu', ours: '#side_menu' },
  ...extra,
})

/** a side menu button (phpMyAdmin's anchors sit under its fixed header: forced clicks) */
const click = (page: Page, id: string) => page.locator(`#${id}`).first().click({ force: true })

/** A dialog of the Go modal (or the prompt) opened from the side menu. */
const dialog = (modal: string, open: (page: Page) => Promise<void>, ready: string): PageSpec =>
  designer({
    scope: { pma: `#${modal}.show .modal-content`, ours: `#${modal}` },
    ready: { pma: '#side_menu', ours: '#side_menu' },
    setup: async ({ pma, ours }) => {
      for (const page of [pma, ours]) {
        await open(page)
        await page.locator(`#${modal} ${ready}`).first().waitFor()
      }
    },
  })

pageParity(
  'db-designer',
  designer({
    interactions: [
      {
        name: 'tables list',
        pma: (p) => click(p, 'key_Show_left_menu'),
        ours: (p) => click(p, 'key_Show_left_menu'),
      },
    ],
  }),
)
pageParity(
  'db-designer-prompt',
  dialog('designerPromptModal', (p) => click(p, 'editPage'), '#designerModalNoButton'),
)
pageParity(
  'db-designer-open-page',
  dialog(
    'designerGoModal',
    async (p) => {
      await click(p, 'editPage')
      await p.locator('#designerModalNoButton').click()
    },
    '#selected_page',
  ),
)
pageParity(
  'db-designer-save-as',
  dialog('designerGoModal', (p) => click(p, 'SaveAs'), '#selected_value'),
)
pageParity(
  'db-designer-delete-page',
  dialog('designerGoModal', (p) => click(p, 'delPages'), '#selected_page'),
)
pageParity(
  'db-designer-export',
  dialog('designerGoModal', (p) => click(p, 'exportPages'), '#plugins'),
)
pageParity(
  'db-designer-add-table',
  dialog('designerGoModal', (p) => click(p, 'addOtherDbTables'), '#add_table'),
)
pageParity(
  'db-designer-new-relation',
  designer({
    scope: '#layer_new_relation',
    setup: async ({ pma, ours }) => {
      for (const page of [pma, ours]) {
        await click(page, 'rel_button')
        await page.locator(`[id="id_tr_parent.id"]`).click({ force: true })
        await page.locator(`[id="id_tr_child.parent_id"]`).click({ force: true })
        await page.locator('#layer_new_relation #ok_new_rel_panel').waitFor()
      }
    },
  }),
)
pageParity(
  'db-designer-query',
  designer(
    {
      interactions: [
        {
          name: 'column options',
          pma: (p) => p.locator('.small_tab_pref_click_opt').first().click({ force: true }),
          ours: (p) => p.locator('.small_tab_pref_click_opt').first().click({ force: true }),
        },
      ],
    },
    true,
  ),
)
