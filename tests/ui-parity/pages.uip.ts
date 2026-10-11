import { FIX } from './lib/env.ts'
import { pageParity } from './lib/parity.ts'

/**
 * v1 UI parity cases: the pages BetterMyAdmin already has. Each one compares the visible controls of
 * phpMyAdmin and ours (maps/<name>.yaml holds the intentional differences). `known` marks a case
 * whose differences are still to be fixed (test.fail): delete it once the page matches.
 */

pageParity('login', {
  auth: false,
  pma: { route: '/' },
  ours: { path: '/' },
  scope: 'page',
  ready: { pma: '#input_username', ours: '#input_username' },
})

pageParity('home', {
  pma: { route: '/' },
  ours: { path: '/s/1' },
})

pageParity('navigation', {
  pma: { route: '/' },
  ours: { path: '/s/1' },
  scope: 'navigation',
  interactions: [{ name: 'collapse all', do: { click: 'Collapse all' } }],
  known: '"Recent" and "Favorites" buttons missing; "Navigation panel settings" is disabled in ours',
})

pageParity('server-sql', {
  pma: { route: '/server/sql' },
  ours: { path: '/s/1/sql' },
  interactions: [{ name: 'bind parameters', do: { check: 'Bind parameters' } }],
})

pageParity('table-structure', {
  pma: { route: '/table/structure', params: { db: FIX.db, table: FIX.table } },
  ours: { path: `/s/1/db/${FIX.db}/t/${FIX.table}/structure` },
  interactions: [{ name: 'check all', do: { check: 'Check all' } }],
  known:
    'no "Add to central columns" / "Remove from central columns" bulk buttons yet (central columns land with the database-level work)',
})

pageParity('table-menu', {
  pma: { route: '/table/structure', params: { db: FIX.db, table: FIX.table } },
  ours: { path: `/s/1/db/${FIX.db}/t/${FIX.table}/structure` },
  scope: 'menu',
})

pageParity('server-variables', {
  pma: { route: '/server/variables' },
  ours: { path: '/s/1/variables' },
  interactions: [{ name: 'filter autocommit', do: { fill: ['Containing the word:', 'autocommit'] } }],
})

pageParity('server-databases', {
  pma: { route: '/server/databases' },
  ours: { path: '/s/1/databases' },
  interactions: [{ name: 'check all', do: { check: 'Check all' } }],
})

pageParity('server-status', {
  pma: { route: '/server/status' },
  ours: { path: '/s/1/status' },
})
