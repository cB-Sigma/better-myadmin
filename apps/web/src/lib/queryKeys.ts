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
}
