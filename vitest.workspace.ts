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
      // transient connection/load flakes on 2-core shared runners (a dropped DB socket, a contended
      // read) self-heal on a re-run; each test is isolated, so a retry is safe
      retry: 2,
      testTimeout: 30000,
      // setup/teardown (fixture DDL, replica thread control) is slow on a 2-core CI runner
      hookTimeout: 30000,
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
      // a dropped DB socket / connection error under 2-core load flips this tier red for no product
      // reason; retry (each test is isolated) so transient connection flakes self-heal
      retry: 2,
      testTimeout: 60000,
      // replica setup and other hooks are slow on a 2-core CI runner (was hitting the 10s default)
      hookTimeout: 30000,
      // one file at a time, as the int project (see there)
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  },
])
