import type { DbRef, TableRef } from './api.ts'

/**
 * Every query key of the app: hierarchical and scope-first (`['srv', s, 'db', db, 'tbl', t, …]`), so
 * invalidating a prefix (`qk.srv(s)`, `qk.tbl(ref)`) refreshes the subtree; the arguments mirror
 * the `api` call (docs/architecture/03-frontend-architecture.md#query-keys, 16-golden-path.md#data).
 */
export const qk = {
  /** every server's data (logout) */
  allServers: ['srv'] as const,
  auth: ['auth'] as const,
  i18n: ['i18n'] as const,
  srv: (s: number) => ['srv', s] as const,
  /** Navigation tree: the root and every branch (docs/architecture/03-frontend-architecture.md#query-keys). */
  nav: (s: number) => ['srv', s, 'nav'] as const,
  navTree: (s: number, q: object) => ['srv', s, 'nav', 'dbs', q] as const,
  navBranch: (s: number, q: object) => ['srv', s, 'nav', 'db', q] as const,
  sqlForm: (s: number, db: string, table: string, q: string) =>
    ['srv', s, 'db', db, 't', table, 'sqlForm', q] as const,
  autocomplete: (s: number, db: string) => ['srv', s, 'db', db, 'autocomplete'] as const,
  consoleConfig: (s: number) => ['srv', s, 'console', 'config'] as const,
  config: ['config-public'] as const,
  versionCheck: ['version-check'] as const,
  /** server scope payload: identity, capabilities, server tabs */
  scope: (s: number) => ['srv', s, 'scope'] as const,
  home: (s: number) => ['srv', s, 'home'] as const,
  passwordForm: (s: number) => ['srv', s, 'account', 'password-form'] as const,
  /** export page view-model of a scope (db/table empty above their scope) */
  exportPage: (s: number, db: string, t: string, q: string) =>
    ['srv', s, 'db', db, 'tbl', t, 'export', q] as const,
  exportAliasNames: (s: number, db: string, t: string) =>
    ['srv', s, 'db', db, 'tbl', t, 'aliasNames'] as const,
  importPage: (s: number, db: string, t: string, q: string) =>
    ['srv', s, 'db', db, 'tbl', t, 'import', q] as const,
  db: (r: DbRef) => ['srv', r.server, 'db', r.db] as const,
  dbScope: (r: DbRef) => ['srv', r.server, 'db', r.db, 'scope'] as const,
  /** a database page (structure, operations, routines, …) with its query */
  dbPage: (r: DbRef, page: string, q: object = {}) => ['srv', r.server, 'db', r.db, page, q] as const,
  tbl: (r: TableRef) => ['srv', r.server, 'db', r.db, 'tbl', r.table] as const,
  tableScope: (r: TableRef) => ['srv', r.server, 'db', r.db, 'tbl', r.table, 'scope'] as const,
  // SQL tab, bookmarks
  defaultFkCheck: (s: number) => ['srv', s, 'defaultFkCheck'] as const,
  bookmarks: (s: number, db: string | null) => ['srv', s, 'bookmarks', db] as const,
  // server administration
  allDatabases: (s: number) => ['srv', s, 'databases'] as const,
  databases: (s: number, q: object) => ['srv', s, 'databases', q] as const,
  status: (s: number, page: string, q: object = {}) => ['srv', s, 'status', page, q] as const,
  serverVariables: (s: number) => ['srv', s, 'variables'] as const,
  collations: (s: number) => ['srv', s, 'collations'] as const,
  engines: (s: number, engine = '', page = '') => ['srv', s, 'engines', engine, page] as const,
  plugins: (s: number) => ['srv', s, 'plugins'] as const,
  binlog: (s: number, q: object) => ['srv', s, 'binlog', q] as const,
  replication: (s: number, q: object = {}) => ['srv', s, 'replication', q] as const,
  monitor: (s: number) => ['srv', s, 'status', 'monitor'] as const,
  monitorLogVars: (s: number) => ['srv', s, 'status', 'monitor', 'log-vars'] as const,
  // user accounts and user groups (every privileges write invalidates qk.privileges)
  privileges: (s: number) => ['srv', s, 'privileges'] as const,
  usersOverview: (s: number, q: object) => ['srv', s, 'privileges', 'users', q] as const,
  addUserForm: (s: number, q: object) => ['srv', s, 'privileges', 'add-user', q] as const,
  userProperties: (s: number, q: object) => ['srv', s, 'privileges', 'user', q] as const,
  userGroups: (s: number) => ['srv', s, 'privileges', 'user-groups'] as const,
  userGroupUsers: (s: number, g: string) => ['srv', s, 'privileges', 'user-groups', 'users', g] as const,
  userGroupForm: (s: number, g: string | null) => ['srv', s, 'privileges', 'user-groups', 'form', g] as const,
  chooseUserGroup: (s: number, u: string) => ['srv', s, 'privileges', 'user-groups', 'choose', u] as const,
  // table structure (all below qk.tbl: DDL invalidates the table)
  tableStructure: (r: TableRef) => [...qk.tbl(r), 'structure'] as const,
  dbPrivileges: (r: DbRef) => [...qk.db(r), 'privileges'] as const,
  tablePrivileges: (r: TableRef) => [...qk.tbl(r), 'privileges'] as const,
  changeColumnsForm: (r: TableRef, fields: string[]) => [...qk.tbl(r), 'change-form', fields] as const,
  addColumnsForm: (r: TableRef) => [...qk.tbl(r), 'add-form'] as const,
  indexForm: (r: TableRef, q: object | null) => [...qk.tbl(r), 'index-form', q] as const,
  partitionForm: (r: TableRef) => [...qk.tbl(r), 'partition-form'] as const,
  createTableForm: (r: DbRef) => [...qk.db(r), 'create-form'] as const,
  // Insert/Edit, FK browser, transformations
  /** Insert/Edit form for one request (where clauses, toggles, row count) */
  insertForm: (r: TableRef, req: object) => [...qk.tbl(r), 'insertForm', req] as const,
  /** a page of the Browse foreign values popup */
  browseForeigners: (r: TableRef, req: object) => [...qk.tbl(r), 'browseForeigners', req] as const,
  /** stored MIME types / transformations of a table's columns (Browse grid, Insert form) */
  transformations: (r: TableRef) => [...qk.tbl(r), 'transformations'] as const,
  // user preferences: everything below qk.prefs(s) is refreshed after a save
  prefs: (s: number) => ['srv', s, 'prefs'] as const,
  preferencesForm: (s: number, tab: string) => ['srv', s, 'prefs', 'form', tab] as const,
  pageSettings: (s: number, group: string) => ['srv', s, 'prefs', 'page', group] as const,
  preferencesManage: (s: number) => ['srv', s, 'prefs', 'manage'] as const,
  preferencesAutoload: (s: number) => ['srv', s, 'prefs', 'autoload'] as const,
  twoFactor: (s: number) => ['srv', s, 'prefs', 'two-factor'] as const,
  /** the login challenge (no server scope: the login is pending) */
  twoFactorChallenge: ['auth', 'two-factor'] as const,
  /** the Browse tab's /sql run (signed sql + pos from the URL) */
  browse: (r: TableRef, q: object) => [...qk.tbl(r), 'browse', q] as const,
  /** a table-level page payload (operations, relation, search, tracking…) */
  tblPage: (r: TableRef, page: string) => [...qk.tbl(r), page] as const,
  /** a step payload of the normalization wizard */
  normalizationStep: (r: TableRef, step: string, q: object) =>
    [...qk.tbl(r), 'normalization', step, q] as const,
  /** a visualization of a query result (chart form / rows, GIS) for one request */
  /** the static pages: List of changes, License, runtime information */
  about: (server: number, page: 'changelog' | 'license' | 'runtime') =>
    ['srv', server, 'about', page] as const,
  /** the navigation's Recent / Favorites lists */
  recentFavorite: (server: number) => ['srv', server, 'recentFavorite'] as const,
  /** the hidden navigation items of a database (the Show hidden items dialog) */
  navHidden: (server: number, db: string) => ['srv', server, 'navHidden', db] as const,
  visualization: (
    r: { server: number; db?: string | undefined; table?: string | undefined },
    kind: 'chart' | 'chartData' | 'gis',
    req: object,
  ) => ['srv', r.server, 'visualization', r.db ?? '', r.table ?? '', kind, req] as const,
}
