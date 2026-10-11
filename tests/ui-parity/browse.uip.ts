import { FIX } from './lib/env.ts'
import { pageParity } from './lib/parity.ts'

/**
 * The Browse tab and the results grid (docs/features/02-browse-results-grid.md): navigation bars,
 * Extra options, row actions, With selected, Query results operations, Bookmark this SQL query.
 */

pageParity('table-browse', {
  pma: { route: '/sql', params: { db: FIX.db, table: FIX.table, pos: '0' } },
  ours: { path: `/s/1/db/${FIX.db}/t/${FIX.table}/browse` },
  ready: { pma: 'table.table_results', ours: 'table.table_results' },
  interactions: [
    { name: 'extra options', do: { click: 'Extra options' } },
    { name: 'check all', do: { check: 'Check all' } },
  ],
})

pageParity('table-browse-no-unique', {
  sql: `CREATE TABLE IF NOT EXISTS ${FIX.db}.uip_nk (a INT, b VARCHAR(5)); DELETE FROM ${FIX.db}.uip_nk; INSERT INTO ${FIX.db}.uip_nk VALUES (1, 'x'), (2, 'y');`,
  pma: { route: '/sql', params: { db: FIX.db, table: 'uip_nk', pos: '0' } },
  ours: { path: `/s/1/db/${FIX.db}/t/uip_nk/browse` },
  ready: { pma: 'table.table_results', ours: 'table.table_results' },
})
