import { FIX, RUN } from './lib/env.ts'
import { pageParity } from './lib/parity.ts'

/**
 * Server → User accounts (docs/features/06-server-level.md): the accounts overview (filtered to the
 * `F` initial, with this worker's f06u_uip1_<run> / f06u_uip2_<run> accounts created here), the Add user account form and the
 * edit-privileges form at global, database and table level.
 */
/** this worker's accounts (lib/env.ts caseObjectsOf drops them) */
const U1 = `f06u_uip1_${RUN}`
const U2 = `f06u_uip2_${RUN}`
const ACCOUNTS = `
DROP USER IF EXISTS '${U1}'@'%'; DROP USER IF EXISTS '${U1}'@'localhost'; DROP USER IF EXISTS '${U2}'@'%';
CREATE USER '${U1}'@'%' IDENTIFIED BY '${U1}' WITH MAX_QUERIES_PER_HOUR 5;
GRANT SELECT, INSERT, CREATE TEMPORARY TABLES ON *.* TO '${U1}'@'%';
CREATE USER '${U1}'@'localhost';
CREATE USER '${U2}'@'%' REQUIRE SSL ACCOUNT LOCK;
GRANT SELECT, UPDATE ON \`${FIX.db}\`.* TO '${U2}'@'%' WITH GRANT OPTION;
GRANT INSERT ON ${FIX.db}.${FIX.table} TO '${U2}'@'%';
GRANT SELECT (id, name) ON ${FIX.db}.${FIX.table} TO '${U2}'@'%';
`

/**
 * Other runs (agents, CI jobs) create and drop their own accounts on the shared server between the
 * two captures: only this worker's f06u_uip*_<run> rows are compared, and the initials bar, whose presence
 * depends on the server's total account count, is left out.
 */
const OTHER_ACCOUNTS = [
  `#userRightsTable tbody tr:not(:has(input[name="selected_usr[]"][value^="${U1}"], input[name="selected_usr[]"][value^="${U2}"]))`,
  '#userAccountsPagination',
]

pageParity('server-privileges', {
  pma: { route: '/server/privileges', params: { initial: 'F' } },
  ours: { path: '/s/1/privileges?initial=F' },
  sql: ACCOUNTS,
  exclude: OTHER_ACCOUNTS,
  ready: { pma: '#userRightsTable', ours: '#userRightsTable' },
  interactions: [{ name: 'check all', do: { check: 'Check all' } }],
})

pageParity('server-privileges-add-user', {
  pma: { route: '/server/privileges', params: { adduser: '1' } },
  ours: { path: '/s/1/privileges/add-user' },
  ready: { pma: '#addUsersForm', ours: '#addUsersForm' },
  interactions: [
    { name: 'any user', do: { select: ['User name:', 'Any user'] } },
    { name: 'local host', do: { select: ['Host name:', 'Local'] } },
    { name: 'no password', do: { select: ['Password:', 'No password'] } },
    { name: 'check all', do: { check: 'Check all' } },
    { name: 'data group', do: { uncheck: 'Data' } },
    { name: 'specified SSL', do: { check: 'SPECIFIED' } },
  ],
})

pageParity('server-privileges-edit-global', {
  pma: { route: '/server/privileges', params: { username: U1, hostname: '%' } },
  ours: { path: `/s/1/privileges/user?username=${U1}&hostname=%25` },
  sql: ACCOUNTS,
  ready: { pma: '#addUsersForm', ours: '#addUsersForm' },
})

pageParity('server-privileges-edit-database', {
  pma: {
    route: '/server/privileges',
    params: { username: U2, hostname: '%', dbname: `${FIX.db.replace('_', '\\_')}` },
  },
  ours: {
    path: `/s/1/privileges/user?username=${U2}&hostname=%25&dbname=${encodeURIComponent(FIX.db.replace('_', '\\_'))}`,
  },
  sql: ACCOUNTS,
  ready: { pma: '#addUsersForm', ours: '#addUsersForm' },
})

pageParity('server-privileges-edit-table', {
  pma: {
    route: '/server/privileges',
    params: {
      username: U2,
      hostname: '%',
      dbname: FIX.db.replace('_', '\\_'),
      tablename: FIX.table,
    },
  },
  ours: {
    path: `/s/1/privileges/user?username=${U2}&hostname=%25&dbname=${encodeURIComponent(FIX.db.replace('_', '\\_'))}&tablename=${FIX.table}`,
  },
  sql: ACCOUNTS,
  ready: { pma: '#addUsersForm', ours: '#addUsersForm' },
})
