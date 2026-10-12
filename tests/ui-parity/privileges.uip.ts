import { FIX } from './lib/env.ts'
import { pageParity } from './lib/parity.ts'

/**
 * Server → User accounts (docs/features/06-server-level.md): the accounts overview (filtered to the
 * `F` initial, with the f06u_uip* accounts created here), the Add user account form and the
 * edit-privileges form at global, database and table level.
 */
const ACCOUNTS = `
DROP USER IF EXISTS 'f06u_uip1'@'%'; DROP USER IF EXISTS 'f06u_uip1'@'localhost'; DROP USER IF EXISTS 'f06u_uip2'@'%';
CREATE USER 'f06u_uip1'@'%' IDENTIFIED BY 'f06u_uip1' WITH MAX_QUERIES_PER_HOUR 5;
GRANT SELECT, INSERT, CREATE TEMPORARY TABLES ON *.* TO 'f06u_uip1'@'%';
CREATE USER 'f06u_uip1'@'localhost';
CREATE USER 'f06u_uip2'@'%' REQUIRE SSL ACCOUNT LOCK;
GRANT SELECT, UPDATE ON \`${FIX.db}\`.* TO 'f06u_uip2'@'%' WITH GRANT OPTION;
GRANT INSERT ON ${FIX.db}.${FIX.table} TO 'f06u_uip2'@'%';
GRANT SELECT (id, name) ON ${FIX.db}.${FIX.table} TO 'f06u_uip2'@'%';
`

/**
 * Other runs (agents, CI jobs) create and drop their own accounts on the shared server between the
 * two captures: only this case's f06u_uip* rows are compared, and the initials bar, whose presence
 * depends on the server's total account count, is left out.
 */
const OTHER_ACCOUNTS = [
  '#userRightsTable tbody tr:not(:has(input[name="selected_usr[]"][value^="f06u_uip"]))',
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
  pma: { route: '/server/privileges', params: { username: 'f06u_uip1', hostname: '%' } },
  ours: { path: '/s/1/privileges/user?username=f06u_uip1&hostname=%25' },
  sql: ACCOUNTS,
  ready: { pma: '#addUsersForm', ours: '#addUsersForm' },
})

pageParity('server-privileges-edit-database', {
  pma: {
    route: '/server/privileges',
    params: { username: 'f06u_uip2', hostname: '%', dbname: `${FIX.db.replace('_', '\\_')}` },
  },
  ours: {
    path: `/s/1/privileges/user?username=f06u_uip2&hostname=%25&dbname=${encodeURIComponent(FIX.db.replace('_', '\\_'))}`,
  },
  sql: ACCOUNTS,
  ready: { pma: '#addUsersForm', ours: '#addUsersForm' },
})

pageParity('server-privileges-edit-table', {
  pma: {
    route: '/server/privileges',
    params: {
      username: 'f06u_uip2',
      hostname: '%',
      dbname: FIX.db.replace('_', '\\_'),
      tablename: FIX.table,
    },
  },
  ours: {
    path: `/s/1/privileges/user?username=f06u_uip2&hostname=%25&dbname=${encodeURIComponent(FIX.db.replace('_', '\\_'))}&tablename=${FIX.table}`,
  },
  sql: ACCOUNTS,
  ready: { pma: '#addUsersForm', ours: '#addUsersForm' },
})
