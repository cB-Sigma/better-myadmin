import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Table Operations tab through the API (docs/features/04-table-level.md › Operations): the move /
 * copy refusals, the table options messages, the configuration storage copied with the table, the
 * referential integrity links and the settings that change the page. The statements themselves are
 * compared with phpMyAdmin in tests/parity/table-operations.parity.test.ts.
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const DB = 'f04_it_ops'
const DB2 = 'f04_it_ops2'
const PMADB = { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }
const app = testApp(testConfig({}, PMADB))
const base = `/api/servers/1/databases/${DB}/tables`
const clean = [DB, DB2]
  .map(
    (d) => `DELETE FROM phpmyadmin.pma__column_info WHERE db_name = '${d}';
    DELETE FROM phpmyadmin.pma__table_info WHERE db_name = '${d}';
    DELETE FROM phpmyadmin.pma__relation WHERE master_db = '${d}';`,
  )
  .join('\n')
let root: mysql.Connection

async function post(path: string, body: unknown, a = app): Promise<Any> {
  const r = await a.req('POST', `${base}/${path}`, body)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}
async function page(table: string, a = app): Promise<Any> {
  const r = await a.req('GET', `${base}/${table}/operations`)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}
const texts = (j: Any): string[] => (j.messages as Array<{ text: string }>).map((m) => m.text)
async function rows(sql: string): Promise<unknown[]> {
  const [r] = await root.query(sql)
  return r as unknown[]
}

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB2};
    CREATE DATABASE ${DB}; CREATE DATABASE ${DB2}; ${clean}
    CREATE TABLE ${DB}.parent (id INT PRIMARY KEY, name VARCHAR(10));
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, pid INT, v VARCHAR(10)) ENGINE=InnoDB;
    INSERT INTO ${DB}.parent VALUES (1, 'one');
    INSERT INTO ${DB}.t VALUES (1, 1, 'a'), (2, 9, 'b'), (3, NULL, 'c');
    INSERT INTO phpmyadmin.pma__column_info (db_name, table_name, column_name, comment, mimetype, transformation, transformation_options, input_transformation, input_transformation_options)
      VALUES ('${DB}', 't', 'v', 'the value', 'text_plain', 'output/text_plain_append.php', "'!'", '', '');
    INSERT INTO phpmyadmin.pma__table_info VALUES ('${DB}', 'parent', 'name');
    INSERT INTO phpmyadmin.pma__relation VALUES ('${DB}', 't', 'pid', '${DB}', 'parent', 'id');`)
  await app.login()
})
afterAll(async () => {
  await root?.query(`${clean} DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB2}`)
  await root?.end()
  await app.close()
})

describe('move and copy', () => {
  it('refuses the same name and an empty name [p04-72c855]', async () => {
    expect(texts(await post('t/operations/move-copy', { op: 'move', newName: 't', targetDb: DB }))).toEqual([
      "Can't move table to same one!",
    ])
    expect(texts(await post('t/operations/move-copy', { op: 'copy', newName: 't' }))).toEqual([
      "Can't copy table to same one!",
    ])
    expect(texts(await post('t/operations/move-copy', { op: 'move', newName: '' }))).toEqual([
      'The table name is empty!',
    ])
  })

  it('copies the configuration storage rows with the table [p04-e92555]', async () => {
    const r = await post('t/operations/move-copy', { op: 'copy', newName: 'tc', targetDb: DB2 })
    expect(texts(r)).toEqual([`Table \`${DB}\`.\`t\` has been copied to \`${DB2}\`.\`tc\`.`])
    expect(
      await rows(
        `SELECT column_name, comment, mimetype, transformation, transformation_options FROM phpmyadmin.pma__column_info WHERE db_name = '${DB2}' AND table_name = 'tc'`,
      ),
    ).toEqual([
      {
        column_name: 'v',
        comment: 'the value',
        mimetype: 'text_plain',
        transformation: 'output/text_plain_append.php',
        transformation_options: "'!'",
      },
    ])
    // TableMover::duplicateInfo: the relation now points into the target database
    expect(
      await rows(
        `SELECT master_field, foreign_db, foreign_table, foreign_field FROM phpmyadmin.pma__relation WHERE master_db = '${DB2}' AND master_table = 'tc'`,
      ),
    ).toEqual([{ master_field: 'pid', foreign_db: DB2, foreign_table: 'parent', foreign_field: 'id' }])
    await post('parent/operations/move-copy', { op: 'copy', newName: 'parent', targetDb: DB2 })
    expect(
      await rows(
        `SELECT display_field FROM phpmyadmin.pma__table_info WHERE db_name = '${DB2}' AND table_name = 'parent'`,
      ),
    ).toEqual([{ display_field: 'name' }])
  })

  it('"Switch to copied table" opens the copy and is remembered in the session [p04-2674e4]', async () => {
    expect((await page('t')).switchToNew).toBe(false)
    const r = await post('t/operations/move-copy', { op: 'copy', newName: 'tsw', switchToNew: true })
    expect([r.db, r.table]).toEqual([DB, 'tsw'])
    expect((await page('t')).switchToNew).toBe(true)
    const r2 = await post('t/operations/move-copy', { op: 'copy', newName: 'tsw2', what: 'structure' })
    expect([r2.db, r2.table]).toEqual([DB, 't'])
    expect((await page('t')).switchToNew).toBe(false)
    expect(await rows(`SELECT COUNT(*) AS n FROM ${DB}.tsw2`)).toEqual([{ n: 0 }])
  })
})

describe('table options', () => {
  it('"No collation provided." for an empty collation, "No change" when nothing changed [p04-c9f811]', async () => {
    const p = await page('t')
    expect(texts(await post('t/operations/options', { comment: '', collation: '' }))).toEqual([
      'No collation provided.',
    ])
    expect(
      texts(
        await post('t/operations/options', {
          newName: 't',
          comment: p.comment,
          prevComment: p.comment,
          collation: p.collation,
          engine: p.storageEngine,
        }),
      ),
    ).toEqual(['No change'])
  })
})

describe('the page', () => {
  it('lists the referential integrity checks of the internal relations [p04-27eea3]', async () => {
    const p = await page('t')
    expect(p.foreigners).toHaveLength(1)
    const f = p.foreigners[0]
    expect([f.master, f.db, f.table, f.field]).toEqual(['pid', DB, 'parent', 'id'])
    expect(f.sql).toBe(
      `SELECT \`t\`.* FROM \`t\` LEFT JOIN \`${DB}\`.\`parent\` ON \`t\`.\`pid\` = \`${DB}\`.\`parent\`.\`id\` WHERE \`${DB}\`.\`parent\`.\`id\` IS NULL AND \`t\`.\`pid\` IS NOT NULL`,
    )
    // the query finds the orphan row (pid 9)
    await root.query(`USE ${DB}`)
    expect(((await rows(f.sql)) as Array<{ id: number }>).map((r) => r.id)).toEqual([2])
  })

  it('the target database is a list up to MaxDbList, else a text input [p04-98d742]', async () => {
    const p = await page('t')
    expect(p.databaseList).toEqual(expect.arrayContaining([DB, DB2]))
    expect(p.databaseList).not.toContain('information_schema')
    const small = testApp(testConfig({ MaxDbList: 1 }))
    await small.login()
    expect((await page('t', small)).databaseList).toBeNull()
    await small.close()
  })

  it('maintenance of several tables is refused with DisableMultiTableMaintenance [p04-83ca2d]', async () => {
    const strict = testApp(testConfig({ DisableMultiTableMaintenance: true }))
    await strict.login()
    const r = await post('t/operations/maintenance', { op: 'analyze', tables: ['t', 'parent'] }, strict)
    expect(texts(r)).toEqual(['Maintenance operations on multiple tables are disabled.'])
    const one = await post('t/operations/maintenance', { op: 'analyze', tables: ['t'] }, strict)
    expect(one.messages[0].type).not.toBe('error')
    await strict.close()
    const two = await post('t/operations/maintenance', { op: 'analyze', tables: ['t', 'parent'] })
    expect(two.messages[0].type).not.toBe('error')
  })

  it('the Analyze card carries a signature so Refresh re-runs it [p04-83ca2d]', async () => {
    const r = await post('t/operations/maintenance', { op: 'analyze', tables: ['t'] })
    const card = r.messages[0].card as { sql: string; sig?: string; links: { refresh: boolean } }
    // ANALYZE TABLE matches the Refresh regex, so the card offers Refresh/Profiling and must sign
    expect(card.links.refresh).toBe(true)
    expect(card.sql).toBe('ANALYZE TABLE `t`;')
    expect(typeof card.sig).toBe('string')
    expect(card.sig).not.toBe('')
    // Refresh posts the card's query with its signature: the query route accepts it
    const ok = await app.req('POST', '/api/servers/1/query', {
      sql: card.sql,
      sig: card.sig,
      db: DB,
      grid: true,
    })
    expect(ok.status, JSON.stringify(ok.json)).toBe(200)
    // the pre-fix behaviour (an empty signature, "present but invalid") is still rejected
    const empty = await app.req('POST', '/api/servers/1/query', {
      sql: card.sql,
      sig: '',
      db: DB,
      grid: true,
    })
    expect(empty.status).toBe(400)
  })
})

describe('the Tracking tab', () => {
  it('only with the tracking feature of the configuration storage [p04-010770]', async () => {
    const tabs = async (server: Record<string, unknown>) => {
      const a = testApp(testConfig({}, server))
      await a.login()
      const r = await a.req('GET', `${base}/t/capabilities`)
      await a.close()
      return ((r.json as Any).tabs as Array<{ key: string }>).map((x) => x.key)
    }
    expect(await tabs(PMADB)).toContain('tracking')
    expect(await tabs({ ...PMADB, tracking: false })).not.toContain('tracking')
  })
})
