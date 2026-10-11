import type { PrivForm } from '@bettermyadmin/contracts'
import { englishTranslator } from '@bettermyadmin/i18n'
import { describe, expect, it } from 'vitest'
import fixture from '../../../../packages/sql-gen/test/fixtures/privileges.json' with { type: 'json' }
import type { Conn, QueryResult } from '../../src/db/connection.ts'
import { NavDbi } from '../../src/navigation/dbi.ts'
import { PasswordUpdateFailure, Privileges } from '../../src/privileges/privileges.ts'
import type { AdminCtx } from '../../src/server-admin/context.ts'

/**
 * Privileges::updatePassword over the server matrix: the statements BetterMyAdmin runs (and their
 * order) against phpMyAdmin executed with the same answers (packages/sql-gen/scripts/
 * generate-privileges-fixtures.php).
 */

type Answer = { fields: string[]; rows: string[][] } | null

/** A connection that records statements and answers the reads the fixture generator answers. */
function fakeConn(answer: (sql: string) => Answer) {
  const ran: string[] = []
  const conn = {
    log: [] as Array<{ sql: string; ms: number; label: string }>,
    serverInfo: null,
    async query(sql: string, label: string): Promise<QueryResult> {
      ran.push(sql)
      conn.log.push({ sql, ms: 0, label })
      const a = answer(sql)
      if (a === null) return { resultSets: [], header: null, ms: 0 }
      return {
        resultSets: [
          {
            fields: a.fields.map(
              (name) => ({ name }) as unknown as QueryResult['resultSets'][number]['fields'][number],
            ),
            rows: a.rows.map((r) => r.map((v) => Buffer.from(v))),
          },
        ],
        header: null,
        ms: 0,
      }
    },
  }
  return { conn: conn as unknown as Conn, ran }
}

function answers(plugin: string) {
  return (sql: string): Answer => {
    if (sql.startsWith('SELECT PASSWORD('))
      return { fields: ['PASSWORD'], rows: [[`*HASHED-${Buffer.byteLength(sql)}`]] }
    if (sql === 'SELECT @@old_passwords;') return { fields: ['@@old_passwords'], rows: [['0']] }
    if (sql.startsWith('SELECT `plugin` FROM')) return { fields: ['plugin'], rows: [[plugin]] }
    return null
  }
}

function privileges(vendor: string, version: number, post: PrivForm) {
  const { conn, ran } = fakeConn(answers('mysql_native_password'))
  const dbi = new NavDbi(conn, { is_superuser: true, is_grantuser: true, is_createuser: true })
  const ctx = {
    cfg: {},
    server: { AllowNoPassword: false },
    serverIndex: 1,
    conn,
    dbi,
    tr: englishTranslator(),
    timeZone: 'UTC',
    versionInt: version,
    isMariaDb: vendor === 'mariadb',
  } as unknown as AdminCtx
  return { p: new Privileges(ctx, null, post, {}), ran }
}

describe('Privileges::updatePassword (golden, executed phpMyAdmin over a server matrix)', () => {
  for (const c of fixture.password) {
    it(`${c.vendor} ${c.version}: ${c.case}`, async () => {
      const { p, ran } = privileges(c.vendor, c.version, c.post as PrivForm)
      let message: string
      try {
        message = (await p.updatePassword('u', 'h')).text
      } catch (e) {
        if (!(e instanceof PasswordUpdateFailure)) throw e
        message = e.message
      }
      expect(ran).toEqual(c.ran)
      expect(message).toBe(c.message)
    })
  }
})
