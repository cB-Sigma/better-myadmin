import type { Page } from '@playwright/test'
import { type PageSpec, pageParity } from './lib/parity.ts'

/**
 * The database-level pages (docs/features/05-database-level.md): Structure, Operations, Search,
 * Query, Routines, Events, Triggers, Tracking, Central columns, Data dictionary, Privileges.
 * Each case runs against its own copy of a small fixture database, `f05_uip`.
 */
const DB = 'f05_uip'
const SQL = `CREATE DATABASE IF NOT EXISTS ${DB};
CREATE TABLE IF NOT EXISTS ${DB}.parent (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20)) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ${DB}.child (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES ${DB}.parent (id)) ENGINE=InnoDB;
CREATE OR REPLACE VIEW ${DB}.v AS SELECT id, name FROM ${DB}.parent;
DROP PROCEDURE IF EXISTS ${DB}.p1; CREATE PROCEDURE ${DB}.p1(IN x INT) SELECT x;
DROP EVENT IF EXISTS ${DB}.e1; CREATE EVENT ${DB}.e1 ON SCHEDULE EVERY 1 DAY DISABLE DO SELECT 1;
DROP TRIGGER IF EXISTS ${DB}.t_ins; CREATE TRIGGER ${DB}.t_ins BEFORE INSERT ON ${DB}.parent FOR EACH ROW SET NEW.name = UPPER(NEW.name);`

const db = (route: string, path: string, extra: Partial<PageSpec> = {}): PageSpec => ({
  sql: SQL,
  pma: { route, params: { db: DB } },
  ours: { path: `/s/1/db/${DB}/${path}` },
  ...extra,
})

pageParity(
  'db-structure',
  db('/database/structure', 'structure', {
    ready: { pma: '#tablesForm', ours: '#tablesForm' },
    interactions: [{ name: 'check all', do: { check: 'Check all' } }],
  }),
)
pageParity('db-operations', db('/database/operations', 'operations'))
pageParity('db-search', db('/database/search', 'search'))
pageParity('db-query', db('/database/multi-table-query', 'multi-table-query'))
pageParity('db-routines', db('/database/routines', 'routines'))
pageParity('db-events', db('/events', 'events'))
pageParity('db-triggers', db('/triggers', 'triggers'))

/** An editor dialog: phpMyAdmin's Bootstrap modal (opened by its ajax anchor) and our Dialog. */
const editor = (route: string, path: string, modal: string, open: string, ready: string): PageSpec =>
  db(route, path, {
    scope: { pma: `#${modal}.show .modal-content`, ours: `#${modal}` },
    // the scope only exists once setup opened the dialog
    ready: { pma: '#page_content', ours: '#page_content' },
    setup: async ({ pma, ours }) => {
      // phpMyAdmin's anchor sits under its floating menu bar: a normal click never becomes actionable
      await pma.locator('#page_content a.add_anchor').first().click({ force: true })
      await ours.getByRole('button', { name: open }).first().click()
      for (const page of [pma, ours]) await page.locator(`#${modal} [name="${ready}"]`).first().waitFor()
    },
  })
pageParity(
  'db-routine-editor',
  editor('/database/routines', 'routines', 'routinesEditorModal', 'Create new routine', 'item_name'),
)
pageParity(
  'db-event-editor',
  editor('/events', 'events', 'eventsEditorModal', 'Create new event', 'item_name'),
)
pageParity(
  'db-trigger-editor',
  editor('/triggers', 'triggers', 'triggersEditorModal', 'Create new trigger', 'item_name'),
)
pageParity('table-triggers', {
  sql: SQL,
  pma: { route: '/triggers', params: { db: DB, table: 'parent' } },
  ours: { path: `/s/1/db/${DB}/t/parent/triggers` },
})
pageParity('db-tracking', db('/database/tracking', 'tracking'))
/**
 * The Add row of Central columns with type ENUM. central_columns.ts renames the Add row's controls
 * after their cells (col_type); phpMyAdmin shows the form open while the list is empty, and an
 * "Add new column" click toggles it, so it is opened first when hidden.
 */
async function enumType(page: Page, toggle: string): Promise<void> {
  const type = page.locator('#add_col_div select[name="col_type"]')
  if (!(await type.isVisible())) {
    await page.locator(toggle).first().click()
    await type.waitFor({ state: 'visible', timeout: 10_000 })
  }
  await type.selectOption('ENUM', { timeout: 10_000 })
}

pageParity(
  'db-central-columns',
  db('/database/central-columns', 'central-columns', {
    interactions: [
      {
        name: 'add new column',
        pma: async (page) => page.locator('#add_col_div > a').click({ force: true }),
        ours: async (page) => page.locator('#add_col_div button').first().click(),
      },
      {
        // p.enum_notice: the "Edit ENUM/SET values" link shows once the type is ENUM or SET
        name: 'ENUM type shows the ENUM/SET editor link',
        pma: (page) => enumType(page, '#add_col_div > a'),
        ours: (page) => enumType(page, '#add_col_div button'),
      },
    ],
  }),
)
// the ENUM/SET editor opened from the Add row (functions.ts a.open_enum_editor)
pageParity('db-central-columns-enum-editor', {
  ...db('/database/central-columns', 'central-columns'),
  scope: { pma: '#enumEditorModal.show .modal-content', ours: '[role=dialog]:has(#enumEditorGoButton)' },
  ready: { pma: '#page_content', ours: '#page_content' },
  setup: async ({ pma, ours }) => {
    await enumType(pma, '#add_col_div > a')
    await pma.locator('#add_col_div a.open_enum_editor').first().click()
    await enumType(ours, '#add_col_div button')
    await ours.getByRole('button', { name: 'Edit ENUM/SET values' }).first().click()
    await pma.locator('#enumEditorModal.show .modal-content #enumEditorGoButton').first().waitFor()
    await ours.locator('[role=dialog]:has(#enumEditorGoButton) #enumEditorGoButton').first().waitFor()
  },
})
pageParity('db-data-dictionary', db('/database/data-dictionary', 'data-dictionary'))
pageParity('db-privileges', db('/database/privileges', 'privileges'))
