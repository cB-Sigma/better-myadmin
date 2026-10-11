import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: [
        'packages/*/test/**/*.test.ts',
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
      testTimeout: 30000,
      fileParallelism: false,
    },
  },
  {
    test: {
      name: 'parity',
      include: ['tests/parity/**/*.parity.test.ts'],
      testTimeout: 60000,
      fileParallelism: false,
    },
  },
])
