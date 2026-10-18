import { describe, expect, it } from 'vitest'
import { Conn, USER_STATEMENT } from '../../src/db/connection.ts'
import { MysqlError } from '../../src/http/errors.ts'

/**
 * A cancel that comes while the pipeline runs its own statements (USE, SHOW VARIABLES, the
 * tracking probe) must not kill those: the user's statement is then not sent at all.
 */
function fakeConn() {
  const sent: string[] = []
  const raw = {
    threadId: 7,
    async query(o: { sql: string }) {
      sent.push(o.sql)
      return [[], []]
    },
  }
  return { conn: new Conn(raw as never, []), sent }
}

describe('cancel before the user statement starts [p09-11fdd7]', () => {
  it('the statement is not sent and fails like a killed query; the flag is then cleared', async () => {
    const { conn, sent } = fakeConn()
    conn.cancelled = true
    // the pipeline's own statements still run
    await conn.query("SHOW SESSION VARIABLES LIKE 'FOREIGN_KEY_CHECKS';", 'var.get', false)
    const err = await conn.query('SELECT SLEEP(20)', USER_STATEMENT, false).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MysqlError)
    expect((err as MysqlError).extra.errno).toBe(1317)
    expect(sent).toEqual(["SHOW SESSION VARIABLES LIKE 'FOREIGN_KEY_CHECKS';"])
    await conn.query('SELECT 1', USER_STATEMENT, false)
    expect(sent.at(-1)).toBe('SELECT 1')
  })

  it('the label of the statement in flight is known while it runs', async () => {
    const { conn } = fakeConn()
    let during: string | null = null
    ;(conn.raw as unknown as { query: () => Promise<unknown> }).query = async () => {
      during = conn.activeLabel
      return [[], []]
    }
    await conn.query('SELECT 1', USER_STATEMENT, false)
    expect(during).toBe(USER_STATEMENT)
    expect(conn.activeLabel).toBeNull()
  })
})
