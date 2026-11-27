import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MYSQLND_CHARSETS, setCharset } from '../../src/db/mysqlnd-charsets.ts'
import { MysqlError } from '../../src/http/errors.ts'

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/mysqlnd-charsets.json', import.meta.url), 'utf8'),
) as string[]

describe('mysqli::set_charset (DatabaseInterface::setCharset)', () => {
  it('knows the names mysqlnd knows (scripts/gen-mysqlnd-charsets.php)', () => {
    expect([...MYSQLND_CHARSETS].sort()).toEqual(fixture)
  })

  it('sends SET NAMES for a known name (any case), nothing for an unknown one', async () => {
    const sent: string[] = []
    const conn = { query: async (sql: string) => void sent.push(sql) }
    expect(await setCharset(conn, 'LATIN1', 'x')).toBe(true)
    expect(await setCharset(conn, 'iso-8859-1', 'x')).toBe(false)
    expect(await setCharset(conn, 'utf8mb3', 'x')).toBe(false)
    expect(sent).toEqual(['SET NAMES LATIN1'])
  })

  it('fails when the server refuses the statement', async () => {
    const conn = {
      query: async () => {
        throw new MysqlError({
          errno: 1231,
          message: "Variable 'character_set_client' can't be set to the value of 'ucs2'",
        })
      },
    }
    expect(await setCharset(conn, 'ucs2', 'x')).toBe(false)
  })
})
