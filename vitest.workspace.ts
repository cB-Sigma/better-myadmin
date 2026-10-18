import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: [
        'packages/*/test/**/*.test.{ts,tsx}',
        'apps/*/test/unit/**/*.test.ts',
        'apps/web/src/**/*.test.{ts,tsx}',
        'tools/*/test/**/*.test.ts',
        'tests/ui-parity/**/*.test.ts',
      ],
    },
  },
  {
    test: {
      name: 'int',
      include: ['apps/*/test/int/**/*.test.ts', 'packages/*/test/int/**/*.test.ts'],
      // one run of a file per MySQL across worktrees (apps/server/test/support/int-suite-lock.ts)
      setupFiles: ['apps/server/test/support/int-suite-lock.ts'],
      testTimeout: 30000,
      // one file at a time (they share fixed accounts and databases on one MySQL). Per project,
      // vitest 3 ignores fileParallelism and maxWorkers (not in ProjectConfig): a single fork is the
      // per-project way, files then run one after another (each still isolated)
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  },
  {
    test: {
      name: 'parity',
      include: ['tests/parity/**/*.parity.test.ts'],
      // one run per fixture group across worktrees sharing a MySQL (tests/parity/lib/suite-lock.ts)
      setupFiles: ['tests/parity/lib/target.ts', 'tests/parity/lib/suite-lock.ts'],
      testTimeout: 60000,
      // one file at a time, as the int project (see there)
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  },
])
