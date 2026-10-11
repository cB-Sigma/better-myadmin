/** Hierarchical, scope-first query keys (docs/architecture/03-frontend-architecture.md#query-keys). */
export const qk = {
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
  db: (s: number, db: string) => ['srv', s, 'db', db] as const,
  dbScope: (s: number, db: string) => ['srv', s, 'db', db, 'scope'] as const,
  tbl: (s: number, db: string, t: string) => ['srv', s, 'db', db, 'tbl', t] as const,
  tableScope: (s: number, db: string, t: string) => ['srv', s, 'db', db, 'tbl', t, 'scope'] as const,
  /** the Browse tab's /sql run (signed sql + pos from the URL) */
  browse: (s: number, db: string, t: string, q: object) =>
    ['srv', s, 'db', db, 'tbl', t, 'browse', q] as const,
}
