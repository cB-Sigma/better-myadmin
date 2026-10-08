/** Hierarchical, scope-first query keys (docs/architecture/03-frontend-architecture.md#query-keys). */
export const qk = {
  auth: ['auth'] as const,
  srv: (s: number) => ['srv', s] as const,
  sqlForm: (s: number, db: string, table: string, q: string) =>
    ['srv', s, 'db', db, 't', table, 'sqlForm', q] as const,
  autocomplete: (s: number, db: string) => ['srv', s, 'db', db, 'autocomplete'] as const,
  consoleConfig: (s: number) => ['srv', s, 'console', 'config'] as const,
}
