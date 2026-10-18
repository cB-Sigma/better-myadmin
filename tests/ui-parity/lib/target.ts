/**
 * `BMA_PARITY_TARGET` for UI parity (imported first by playwright.config.ts, before lib/env.ts reads
 * the port): `mysql` (default) is mysql84 :3306, `mariadb` is mariadb11 :3307. global-setup starts
 * the run's own reference phpMyAdmin against the same server (its `phpmyadmin` storage and control
 * user pma exist on both dev servers), so only the server port changes; an explicit BMA_TEST_PORT
 * wins. tests/parity/lib/target.ts is the parity suites' counterpart.
 */
export type UipTarget = 'mysql' | 'mariadb'

const raw = (process.env.BMA_PARITY_TARGET ?? 'mysql').toLowerCase()
if (raw !== 'mysql' && raw !== 'mariadb') throw new Error(`BMA_PARITY_TARGET: unknown target ${raw}`)
export const TARGET: UipTarget = raw
if (TARGET === 'mariadb') process.env.BMA_TEST_PORT ??= '3307'
