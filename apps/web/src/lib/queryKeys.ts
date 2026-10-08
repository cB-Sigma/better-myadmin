/** Hierarchical, scope-first query keys (docs/architecture/03-frontend-architecture.md#query-keys). */
export const qk = {
  auth: ['auth'] as const,
  i18n: ['i18n'] as const,
  srv: (s: number) => ['srv', s] as const,
}
