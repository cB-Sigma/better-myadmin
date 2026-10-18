import { basename } from 'node:path'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, expect } from 'vitest'

/**
 * Vitest setup file of the `int` project: every int file holds a server-wide MySQL named lock
 * (`GET_LOCK('bma_int:<file>')`) while it runs, like the parity files (tests/parity/lib/suite-lock.ts).
 * Several worktrees (agents, CI jobs) share one MySQL and each int file recreates its own fixed
 * databases and accounts (m1nav_it_*, f04_it_* …), so the same file started from two checkouts runs
 * one after the other instead of dropping the other's objects mid-way. No two int files share a
 * fixture name, so files of different names still run side by side across checkouts.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: process.env.BMA_TEST_USER ?? 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const WAIT_S = Number(process.env.BMA_INT_LOCK_WAIT ?? 1800)

export const lockGroup = (testPath: string): string =>
  `bma_int:${basename(testPath).replace(/\.test\.ts$/, '')}`

let conn: mysql.Connection | null = null

beforeAll(
  async () => {
    const group = lockGroup(expect.getState().testPath ?? 'unknown')
    conn = await mysql.createConnection(ROOT).catch(() => null)
    if (conn === null) return // no MySQL: the file skips itself
    const [[got]] = (await conn.query({
      sql: 'SELECT GET_LOCK(?, ?)',
      values: [group, WAIT_S],
      rowsAsArray: true,
    })) as unknown as [[[number | null]]]
    if (Number(got) !== 1)
      throw new Error(`int: could not take ${group} within ${WAIT_S} s (another run holds it)`)
  },
  (WAIT_S + 10) * 1000,
)

afterAll(async () => {
  // the lock is released with its connection
  await conn?.end().catch(() => {})
  conn = null
})
