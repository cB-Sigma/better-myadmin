import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * The table Triggers tab through the API (docs/features/04-table-level.md › Triggers): the editor's
 * validation, edit as DROP + CREATE with the restore of the old trigger, and the privilege gate.
 * The statements are compared with phpMyAdmin in tests/parity/database-programs.parity.test.ts.
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const DB = 'f04_it_trg'
const USER = 'f04_it_trg_ro'
const base = `/api/servers/1/databases/${DB}/triggers`
const app = testApp(testConfig({}))
let root: mysql.Connection

const save = async (body: Record<string, unknown>, a = app): Promise<Any> => {
  const r = await a.req('POST', `${base}?table=t`, {
    table: 't',
    timing: 'BEFORE',
    event: 'INSERT',
    definer: '',
    ...body,
  })
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}
const text = (j: Any): string => j.messages[0]?.text ?? ''
async function triggers(): Promise<Array<{ name: string; statement: string; timing: string }>> {
  const [r] = await root.query(
    `SELECT TRIGGER_NAME AS name, ACTION_STATEMENT AS statement, ACTION_TIMING AS timing FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = '${DB}' ORDER BY TRIGGER_NAME`,
  )
  return r as Array<{ name: string; statement: string; timing: string }>
}

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (v VARCHAR(10)); CREATE TABLE ${DB}.log (v VARCHAR(10)); CREATE VIEW ${DB}.v AS SELECT v FROM ${DB}.t;
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT SELECT ON \`${DB}\`.* TO '${USER}'@'%';`)
  await app.login()
})
afterAll(async () => {
  await root?.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await root?.end()
  await app.close()
})

describe('trigger editor', () => {
  it('validates the definer format and that the table exists [p04-5b8c51]', async () => {
    const r = await save({ name: 'x', definer: 'nohost', table: 'missing', definition: 'SET NEW.v = 1' })
    expect(r.messages[0].type).toBe('error')
    expect(text(r)).toContain('One or more errors have occurred while processing your request:')
    expect(text(r)).toContain('The definer must be in the "username@hostname" format!')
    expect(text(r)).toContain('You must provide a valid table name!')
    // Triggers::getQueryFromRequest checks the name against DatabaseInterface::getTables (views included)
    expect(await triggers()).toEqual([])
    const ok = await save({ name: 'tg', definer: 'root@%', definition: 'SET NEW.v = UPPER(NEW.v)' })
    expect(text(ok)).toBe('Trigger `tg` has been created.')
    expect(ok.messages[0].sql).toBe(
      'CREATE DEFINER=`root`@`%` TRIGGER `tg` BEFORE INSERT ON `t` FOR EACH ROW SET NEW.v = UPPER(NEW.v)',
    )
  })

  it('edits by DROP + CREATE, and restores the old trigger when the new one fails [p04-d706ba]', async () => {
    const ok = await save({
      originalName: 'tg',
      name: 'tg2',
      timing: 'AFTER',
      definition: 'INSERT INTO log VALUES (NEW.v)',
    })
    expect(text(ok)).toBe('Trigger `tg2` has been modified.')
    expect((await triggers()).map((t) => [t.name, t.timing])).toEqual([['tg2', 'AFTER']])
    const bad = await save({ originalName: 'tg2', name: 'tg3', definition: 'SET NEW.nope = 1' })
    expect(bad.messages[0].type).toBe('error')
    expect(text(bad)).toContain('The following query has failed: "CREATE TRIGGER `tg3`')
    // the backup of tg2 was re-created
    expect((await triggers()).map((t) => [t.name, t.statement])).toEqual([
      ['tg2', 'INSERT INTO log VALUES (NEW.v)'],
    ])
  })

  it('a failed create: the query, one line break, then the server error (upstream 499f30824a)', async () => {
    const bad = await save({ name: 'tg4', definition: 'SET NEW.nope = 1' })
    expect(bad.messages[0].type).toBe('error')
    expect(text(bad)).toMatch(
      /• The following query has failed: "CREATE TRIGGER `tg4` [^\n]*"\nMySQL said: [^\n]*nope[^\n]*$/,
    )
  })
})

describe('privileges', () => {
  it('only a user with TRIGGER may create [p04-941ec9]', async () => {
    const ro = testApp(testConfig({}))
    await ro.login(USER, USER)
    const list = (await ro.req('GET', `${base}?table=t`)).json as Any
    expect(list.canCreate).toBe(false)
    // MySQL lists triggers in INFORMATION_SCHEMA only to users with TRIGGER on the table
    expect(list.items).toEqual([])
    await ro.close()
    expect(((await app.req('GET', `${base}?table=t`)).json as Any).canCreate).toBe(true)
  })
})
