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
  known: 'the logo link "phpMyAdmin" above the login form is missing',
})

pageParity('home', {
  pma: { route: '/' },
  ours: { path: '/s/1' },
  known:
    'the "Web server" card has no Documentation link (ours renders one in "Appearance settings"); the "documentation" link phpMyAdmin shows outside the cards sits in our "phpMyAdmin" card',
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
  known:
    'the SQL box has no section: phpMyAdmin groups its controls under the legend "Run SQL query/queries on server …:", ours renders that title in a plain div (use a fieldset/legend or a labelled group)',
})

pageParity('table-structure', {
  pma: { route: '/table/structure', params: { db: FIX.db, table: FIX.table } },
  ours: { path: `/s/1/db/${FIX.db}/t/${FIX.table}/structure` },
  interactions: [{ name: 'check all', do: { check: 'Check all' } }],
  known:
    'missing "Table structure"/"Relation view" sub-tab links, "Add to central columns", "Remove from central columns", "Track table", "Normalize"; With-selected buttons disabled until a row is checked (always enabled in phpMyAdmin); Indexes/Partitions/Information controls are not in a section (no legend/heading); "Create an index on" textbox labelled differently',
})

pageParity('table-menu', {
  pma: { route: '/table/structure', params: { db: FIX.db, table: FIX.table } },
  ours: { path: `/s/1/db/${FIX.db}/t/${FIX.table}/structure` },
  scope: 'menu',
  known:
    'ours exposes "Open user account menu" and "Click on the bar to scroll to top of page" as buttons in the menubar; phpMyAdmin has no such controls there',
})

pageParity('server-variables', {
  pma: { route: '/server/variables' },
  ours: { path: '/s/1/variables' },
  interactions: [{ name: 'filter autocommit', do: { fill: ['Containing the word:', 'autocommit'] } }],
  known:
    'ours adds a "Documentation" link to every variable row (phpMyAdmin links the variable name only); the filter box is not in a "Filters" section',
})

pageParity('server-databases', {
  pma: { route: '/server/databases' },
  ours: { path: '/s/1/databases' },
  interactions: [{ name: 'check all', do: { check: 'Check all' } }],
  known: 'the create form is not in a "Create database" section (phpMyAdmin: card header)',
})

pageParity('server-status', {
  pma: { route: '/server/status' },
  ours: { path: '/s/1/status' },
})
