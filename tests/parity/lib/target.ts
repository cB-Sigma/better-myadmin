/**
 * Vitest setup file of the `parity` project (runs before suite-lock and every suite's imports):
 * `BMA_PARITY_TARGET` picks the dev server pair both tools are compared on. `mysql` (default) is
 * mysql84 :3306 with the reference on :8081; `mariadb` is mariadb11 (MariaDB 11.4) :3307 with its own
 * reference on :8084 (and the MariaDB replica :3309 / :8085). It only fills the variables the suites
 * already read (BMA_TEST_PORT, BMA_PARITY_PMA_URL, …) when they are not set, so any of them can still
 * be overridden. docs/architecture/14-development-setup.md#mariadb
 */
export type ParityTarget = 'mysql' | 'mariadb'

const DEFAULTS: Record<ParityTarget, Record<string, string>> = {
  mysql: {},
  mariadb: {
    BMA_TEST_PORT: '3307',
    BMA_PARITY_PMA_URL: 'http://127.0.0.1:8084',
    BMA_PARITY_REPLICA_PORT: '3309',
    BMA_PARITY_REPLICA_PMA_URL: 'http://127.0.0.1:8085',
    BMA_PARITY_REPLICA_SOURCE_PORT: '3307',
    // there is no translated MariaDB reference: the i18n suite skips itself
    PMA_I18N_URL: 'http://127.0.0.1:1',
  },
}

const raw = (process.env.BMA_PARITY_TARGET ?? 'mysql').toLowerCase()
if (raw !== 'mysql' && raw !== 'mariadb') throw new Error(`BMA_PARITY_TARGET: unknown target ${raw}`)
export const TARGET: ParityTarget = raw
for (const [k, v] of Object.entries(DEFAULTS[TARGET])) process.env[k] ??= v
