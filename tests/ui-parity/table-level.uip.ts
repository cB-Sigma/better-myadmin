import { FIX } from './lib/env.ts'
import { pageParity } from './lib/parity.ts'

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
