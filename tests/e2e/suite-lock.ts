import mysql from 'mysql2/promise'

/**
 * A server-wide MySQL named lock (GET_LOCK) held for a whole Playwright run, the browser suites'
 * counterpart of tests/parity/lib/suite-lock.ts: several worktrees (agents, CI jobs) share one
 * MySQL and the suites recreate fixed accounts and databases, so two runs of the same suite wait
 * for each other instead of dropping each other's objects. Called from a globalSetup; the returned
 * function (Playwright's global teardown of that setup) releases the lock with its connection.
 * BMA_BROWSER_LOCK_WAIT (seconds, default 1800).
 */
export async function holdSuiteLock(
  name: string,
  root: { host: string; port: number; user: string; password: string },
): Promise<() => Promise<void>> {
  const wait = Number(process.env.BMA_BROWSER_LOCK_WAIT ?? 1800)
  const conn = await mysql.createConnection(root)
  const [[got]] = (await conn.query({
    sql: 'SELECT GET_LOCK(?, ?)',
    values: [name, wait],
    rowsAsArray: true,
  })) as unknown as [[[number | null]]]
  if (Number(got) !== 1) {
    await conn.end()
    throw new Error(`${name}: could not take the lock within ${wait} s (another run holds it)`)
  }
  return async () => {
    await conn.end().catch(() => {})
  }
}
