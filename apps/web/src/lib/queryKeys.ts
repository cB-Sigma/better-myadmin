/** Hierarchical, scope-first query keys (docs/architecture/03-frontend-architecture.md#query-keys). */
export const qk = {
  auth: ['auth'] as const,
  config: ['config-public'] as const,
  versionCheck: ['version-check'] as const,
  srv: (s: number) => ['srv', s] as const,
  /** server scope payload: identity, capabilities, server tabs */
  scope: (s: number) => ['srv', s, 'scope'] as const,
  home: (s: number) => ['srv', s, 'home'] as const,
  passwordForm: (s: number) => ['srv', s, 'account', 'password-form'] as const,
  db: (s: number, db: string) => ['srv', s, 'db', db] as const,
  dbScope: (s: number, db: string) => ['srv', s, 'db', db, 'scope'] as const,
  tbl: (s: number, db: string, t: string) => ['srv', s, 'db', db, 'tbl', t] as const,
  tableScope: (s: number, db: string, t: string) => ['srv', s, 'db', db, 'tbl', t, 'scope'] as const,
}
