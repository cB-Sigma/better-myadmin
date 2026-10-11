import { FIX as SHARED } from './lib/env.ts'
import { pageParity } from './lib/parity.ts'

/**
 * Insert/Edit form, its dialogs (Preview SQL, Browse foreign values, GIS editor) and the
 * transformation overview (docs/features/03-insert-edit-transformations.md).
 */
const T = 'uip_ie'
/** this suite's own database (per run, dropped by global-teardown) */
const FIX = { db: SHARED.insertDb }
const SQL = `CREATE DATABASE IF NOT EXISTS ${FIX.db}; DROP TABLE IF EXISTS ${FIX.db}.${T}; DROP TABLE IF EXISTS ${FIX.db}.uip_ie_parent;
  CREATE TABLE ${FIX.db}.uip_ie_parent (id INT PRIMARY KEY, label VARCHAR(20));
  INSERT INTO ${FIX.db}.uip_ie_parent VALUES (1, 'one'), (2, 'two');
  CREATE TABLE ${FIX.db}.${T} (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(20) COMMENT 'the name',
    body TEXT,
    kind ENUM('a','b') NOT NULL DEFAULT 'a',
    tags SET('p','q'),
    d DATE,
    ts TIMESTAMP NOT NULL,
    parent_id INT,
    pt POINT,
    FOREIGN KEY (parent_id) REFERENCES ${FIX.db}.uip_ie_parent (id)
  );`

pageParity('table-insert', {
  sql: SQL,
  pma: { route: '/table/change', params: { db: FIX.db, table: T } },
  ours: { path: `/s/1/db/${FIX.db}/t/${T}/insert` },
  ready: { pma: '#insertForm', ours: '#insertForm' },
  interactions: [
    { name: 'untick ignore', do: { uncheck: 'Ignore' } },
    {
      name: 'continue insertion',
      do: [{ fill: ['Amount of rows to insert', '3'] }, { press: 'Enter' }, { wait: 500 }],
    },
  ],
})

pageParity('table-insert-preview-sql', {
  sql: SQL,
  pma: { route: '/table/change', params: { db: FIX.db, table: T } },
  ours: { path: `/s/1/db/${FIX.db}/t/${T}/insert` },
  ready: { pma: '#insertForm', ours: '#insertForm' },
  // phpMyAdmin's page holds two #previewSqlModal (actions panel and table template): the shown one
  scope: { pma: '#previewSqlModal.show .modal-content', ours: '#previewSqlModal' },
  setup: async ({ pma, ours }) => {
    for (const page of [pma, ours]) {
      await page.getByRole('button', { name: 'Preview SQL' }).first().click()
      await page
        .locator('#previewSqlModal')
        .filter({ visible: true })
        .getByText('INSERT', { exact: false })
        .first()
        .waitFor()
    }
  },
})

pageParity('table-insert-gis-editor', {
  sql: SQL,
  pma: { route: '/table/change', params: { db: FIX.db, table: T } },
  ours: { path: `/s/1/db/${FIX.db}/t/${T}/insert` },
  ready: { pma: '#insertForm', ours: '#insertForm' },
  scope: { pma: '#gisEditorModal .modal-content', ours: '#gisEditorModal' },
  setup: async ({ pma, ours }) => {
    for (const page of [pma, ours]) {
      await page.getByRole('button', { name: 'Edit/Insert' }).first().click()
      await page.locator('#gis_data_textarea').waitFor()
    }
  },
  interactions: [{ name: 'type x', do: { fill: ['X', '3'] } }],
})

pageParity('transformation-overview', {
  pma: { route: '/transformation/overview' },
  ours: { path: '/s/1/transformations' },
})
