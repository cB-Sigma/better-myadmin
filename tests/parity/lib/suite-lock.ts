import { basename } from 'node:path'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, expect } from 'vitest'

/**
 * Vitest setup file of the `parity` project: every parity file holds a server-wide MySQL named lock
 * (`GET_LOCK`) for its fixture group while it runs. Several worktrees (agents, CI jobs) share one
 * MySQL; the suites recreate fixed accounts and databases (m1meta_*, m3srv_*, f03_* …), so the same
 * suite started twice must run one after the other instead of dropping each other's objects. The
 * server-* suites share their accounts (lib/server-setup.ts) and therefore one group.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: process.env.BMA_TEST_USER ?? 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const WAIT_S = Number(process.env.BMA_PARITY_LOCK_WAIT ?? 1800)

export function lockGroup(testPath: string): string {
  const name = basename(testPath).replace(/\.parity\.test\.ts$/, '')
  return `bma_parity:${name.startsWith('server-') ? 'server' : name}`
}

let conn: mysql.Connection | null = null

beforeAll(
  async () => {
    const group = lockGroup(expect.getState().testPath ?? 'unknown')
    conn = await mysql.createConnection(ROOT).catch(() => null)
    if (conn === null) return // no MySQL: the suite skips itself
    const [[got]] = (await conn.query({
      sql: 'SELECT GET_LOCK(?, ?)',
      values: [group, WAIT_S],
      rowsAsArray: true,
    })) as unknown as [[[number | null]]]
    if (Number(got) !== 1)
      throw new Error(`parity: could not take ${group} within ${WAIT_S} s (another run holds it)`)
  },
  (WAIT_S + 10) * 1000,
)

afterAll(async () => {
  // the lock is released with its connection
  await conn?.end().catch(() => {})
  conn = null
})
