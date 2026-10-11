import { FIX } from './lib/env.ts'
import { type PageFn, pageParity } from './lib/parity.ts'

/**
 * UI parity of the table-level pages beyond Structure (docs/features/04-table-level.md):
 * Operations, Relation view, Search, Zoom search, Find and replace, Tracking, Privileges, Triggers,
 * view create, chart, GIS, normalization.
 */
const T = `/s/1/db/${FIX.db}/t`
const p = (table: string) => ({ db: FIX.db, table })

/** a child table with a foreign key and a MyISAM table, for the engine-dependent controls */
const CHILD = `CREATE TABLE IF NOT EXISTS ${FIX.db}.uip_child (
    id INT NOT NULL PRIMARY KEY, t_id INT UNSIGNED, note VARCHAR(10), g POINT,
    CONSTRAINT fk_uip FOREIGN KEY (t_id) REFERENCES ${FIX.db}.${FIX.table} (id) ON DELETE CASCADE
  ) ENGINE=InnoDB;
  CREATE TABLE IF NOT EXISTS ${FIX.db}.uip_my (a INT NOT NULL AUTO_INCREMENT PRIMARY KEY, b VARCHAR(5)) ENGINE=MyISAM;`

pageParity('table-operations', {
  sql: CHILD,
  pma: { route: '/table/operations', params: p(FIX.table) },
  ours: { path: `${T}/${FIX.table}/operations` },
  interactions: [
    { name: 'copy: structure only', do: { check: 'Structure only' } },
    { name: 'change all collations', do: { check: 'Change all column collations' } },
  ],
})

pageParity('table-operations-myisam', {
  sql: CHILD,
  pma: { route: '/table/operations', params: p('uip_my') },
  ours: { path: `${T}/uip_my/operations` },
})

pageParity('table-relation', {
  sql: CHILD,
  pma: { route: '/table/relation', params: p('uip_child') },
  ours: { path: `${T}/uip_child/relation` },
  interactions: [{ name: 'internal relationships', do: { click: 'Internal relationships' } }],
})

pageParity('table-search', {
  sql: CHILD,
  pma: { route: '/table/search', params: p('uip_child') },
  ours: { path: `${T}/uip_child/search` },
  interactions: [{ name: 'extra options', do: { click: 'Extra options' } }],
})

pageParity('table-zoom-search', {
  pma: { route: '/table/zoom-search', params: p(FIX.table) },
  ours: { path: `${T}/${FIX.table}/zoom-search` },
})

pageParity('table-find-replace', {
  pma: { route: '/table/find-replace', params: p(FIX.table) },
  ours: { path: `${T}/${FIX.table}/find-replace` },
})

/** one tracking version of uip_child, with a log of each kind (in the reference's and our pmadb) */
const TRACKED = `${CHILD}${['phpmyadmin', FIX.pmadb].map((pmadb) => trackingRow(pmadb)).join('')}`
function trackingRow(pmadb: string): string {
  return `
  DELETE FROM ${pmadb}.pma__tracking WHERE db_name = '${FIX.db}';
  INSERT INTO ${pmadb}.pma__tracking (db_name, table_name, version, date_created, date_updated, schema_snapshot, schema_sql, data_sql, tracking, tracking_active)
  VALUES ('${FIX.db}', 'uip_child', '1', '2024-01-01 10:00:00', '2024-01-02 10:00:00',
    'a:2:{s:7:"COLUMNS";a:1:{i:0;a:8:{s:5:"Field";s:2:"id";s:4:"Type";s:3:"int";s:9:"Collation";N;s:4:"Null";s:2:"NO";s:3:"Key";s:3:"PRI";s:7:"Default";N;s:5:"Extra";s:0:"";s:7:"Comment";s:0:"";}}s:7:"INDEXES";a:0:{}}',
    '# log 2024-01-01 10:00:00 root\\nDROP TABLE IF EXISTS \`uip_child\`;\\n# log 2024-01-01 10:00:00 root\\nCREATE TABLE \`uip_child\` (\\n  \`id\` int NOT NULL\\n);\\n',
    '\\n# log 2024-01-02 10:00:00 root\\nINSERT INTO \`uip_child\` (\`id\`) VALUES (1);\\n', 'INSERT,UPDATE', 1);`
}

pageParity('table-tracking', {
  sql: TRACKED,
  pma: { route: '/table/tracking', params: p('uip_child') },
  ours: { path: `${T}/uip_child/tracking` },
  interactions: [
    { name: 'tracking report', pma: showLink('Tracking report'), ours: showLink('Tracking report') },
    { name: 'structure snapshot', pma: showLink('Structure snapshot'), ours: showLink('Structure snapshot') },
  ],
})

/** a stored transformation of uip_t.created (in the reference's and our pmadb) */
const MIME = ['phpmyadmin', FIX.pmadb]
  .map(
    (pmadb) => `DELETE FROM ${pmadb}.pma__column_info WHERE db_name = '${FIX.db}';
  INSERT INTO ${pmadb}.pma__column_info (db_name, table_name, column_name, comment, mimetype, transformation, transformation_options, input_transformation, input_transformation_options)
  VALUES ('${FIX.db}', '${FIX.table}', 'created', '', 'text_plain', 'output/text_plain_dateformat.php', '0', '', '');`,
  )
  .join('\n')

pageParity('table-column-change', {
  sql: MIME,
  pma: {
    route: '/table/structure/change',
    params: { ...p(FIX.table), field: 'created', change_column: '1' },
  },
  ours: { path: `${T}/${FIX.table}/structure/change?fields=created` },
  interactions: [
    {
      name: 'pick from central columns',
      pma: (page) => page.locator('a.central_columns_dialog').first().click(),
      ours: (page) => page.locator('.central_columns_dialog').first().click(),
    },
  ],
})

pageParity('table-normalization', {
  pma: { route: '/normalization', params: p(FIX.table) },
  ours: { path: `${T}/${FIX.table}/normalization` },
  interactions: [
    { name: '1NF step 1', do: { click: 'Go' } },
    {
      name: '1NF step 2',
      // normalization.js listens to `click` on the select (a mouse choice fires it; selectOption does not)
      pma: async (page) => {
        await page.locator('#selectNonAtomicCol').selectOption('no_such_col')
        await page.locator('#selectNonAtomicCol').dispatchEvent('click')
        await page.waitForTimeout(500)
      },
      ours: (page) => page.locator('#selectNonAtomicCol').selectOption('no_such_col'),
    },
  ],
})

pageParity('table-privileges', {
  pma: { route: '/table/privileges', params: p(FIX.table) },
  ours: { path: `${T}/${FIX.table}/privileges` },
})

const VIEW = `CREATE OR REPLACE VIEW ${FIX.db}.uip_v AS SELECT id FROM ${FIX.db}.${FIX.table};`

pageParity('view-create', {
  pma: { route: '/view/create', params: { db: FIX.db } },
  ours: { path: `/s/1/db/${FIX.db}/view/create` },
})

pageParity('view-edit', {
  sql: VIEW,
  pma: { route: '/view/create', params: p('uip_v') },
  ours: { path: `/s/1/db/${FIX.db}/view/create?table=uip_v` },
})

/** an icon + text link (the reference's accessible name repeats the image's alt) */
function showLink(text: string): PageFn {
  return (page) => page.locator('#page_content a', { hasText: text }).first().click()
}
