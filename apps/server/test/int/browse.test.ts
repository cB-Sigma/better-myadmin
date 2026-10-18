import type { GridData, QueryResponse } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

const DB = 'f02_it_browse'

let root: mysql.Connection
const apps: Array<ReturnType<typeof testApp>> = []

async function app(cfg: Parameters<typeof testConfig>[0] = {}) {
  const a = testApp(testConfig(cfg))
  apps.push(a)
  await a.login()
  return a
}

type Browse = QueryResponse & { usingBookmark: string | null }

async function browse(a: ReturnType<typeof testApp>, body: Record<string, unknown>) {
  const r = await a.req('POST', '/api/servers/1/browse', { db: DB, ...body })
  expect(r.status, JSON.stringify(r.json).slice(0, 500)).toBe(200)
  const res = r.json as unknown as Browse
  return { res, st: res.statements[0]!, grid: res.statements[0]!.grid as GridData }
}

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(80) COMMENT 'the name', qty INT, d DATE) ENGINE=InnoDB;
    INSERT INTO t (name, qty, d) VALUES ${Array.from({ length: 30 }, (_, i) => `('item${i + 1}', ${i % 7}, '2020-01-${String((i % 28) + 1).padStart(2, '0')}')`).join(',')};
    UPDATE t SET name = REPEAT('x', 70) WHERE id = 3;
    CREATE TABLE child (id INT PRIMARY KEY, t_id INT, FOREIGN KEY (t_id) REFERENCES t (id)) ENGINE=InnoDB;
    INSERT INTO child VALUES (1, 1), (2, 2), (3, NULL);
    CREATE TABLE nk (a INT, b VARCHAR(5), bl BLOB);
    INSERT INTO nk VALUES (1, 'x', 'abc'), (2, 'y', NULL);
    CREATE TABLE e (id INT PRIMARY KEY, c ENUM('a','b','c'), s SET('x','y','z'));
    INSERT INTO e VALUES (1, 'b', 'x,z');`)
})
afterAll(async () => {
  for (const a of apps) await a.close()
  await root?.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root?.end()
})

describe('Browse (/sql)', () => {
  it('default browse query, navigation, unique conditions, comments [p02-26b09f p02-3ec720 p02-dc194e p02-50ad5b p02-3e8068]', async () => {
    const a = await app()
    const { st, grid } = await browse(a, { table: 't' })
    expect(st.executedSql).toBe('SELECT * FROM `t` LIMIT 0, 25')
    expect(st.message.text).toMatch(/^Showing rows 0 - 24 \(30 total, Query took [\d.]+ seconds\.\)$/)
    expect(grid.editable).toBe(true)
    expect(grid.missingUnique).toBeNull()
    expect(grid.displayParts.deleteLink).toBe('delete')
    expect(grid.rows[0]!.where).toBe('`t`.`id` = 1')
    expect(grid.rows[0]!.del?.sql).toBe('DELETE FROM `t` WHERE `t`.`id` = 1')
    expect(grid.columns.find((c) => c.name === 'name')?.comment).toBe('the name')
    expect(grid.navigation).toMatchObject({ posNext: 25, isLastPage: false, totalPages: 2, pages: [1, 2] })
    // truncated cell
    const cell = grid.rows[2]!.cells[1]!
    expect(cell.t).toBe(`${'x'.repeat(50)}...`)
    expect(cell.ol).toBe(70)
    expect(cell.cls).toContain('truncated')
    // sort link of the date column: SMART → DESC
    expect(grid.columns.find((c) => c.name === 'd')?.sort?.single.sql).toBe(
      'SELECT * FROM `t` ORDER BY `t`.`d` DESC',
    )
  })

  it('remembers the sort order and re-applies it to a plain browse [p02-dafcf6 p02-b74767 p02-c390b7]', async () => {
    const a = await app()
    const first = await browse(a, { table: 't' })
    const sort = first.grid.columns.find((c) => c.name === 'name')!.sort!.single
    const sorted = await browse(a, { table: 't', sql: sort.sql, sig: sort.sig })
    expect(sorted.st.executedSql).toBe('SELECT * FROM `t` ORDER BY `t`.`name` ASC LIMIT 0, 25')
    expect(sorted.st.message.text).toContain('[name: ITEM1... - ')
    const again = await browse(a, { table: 't' })
    expect(again.st.executedSql).toBe('SELECT * FROM `t` ORDER BY `name` ASC LIMIT 0, 25')
    const discard = await browse(a, { table: 't', sql: 'SELECT * FROM `t`', discardRememberedSort: true })
    expect(discard.st.executedSql).toBe('SELECT * FROM `t` LIMIT 0, 25')
  })

  it('refuses an unsigned or badly signed query [p02-fae7cc]', async () => {
    const a = await app()
    const r = await a.req('POST', '/api/servers/1/browse', { db: DB, sql: 'SELECT 1', sig: 'nope' })
    expect(r.status).toBe(400)
    expect(JSON.stringify(r.json)).toContain('Missing parameter:')
  })

  it('pagination and Show all are remembered per query [p02-284f7e p02-437552]', async () => {
    const a = await app()
    const p2 = await browse(a, { table: 't', sql: 'SELECT * FROM `t`', pos: 25 })
    expect(p2.st.executedSql).toBe('SELECT * FROM `t` LIMIT 25, 25')
    expect(p2.grid.navigation?.isLastPage).toBe(true)
    const again = await browse(a, { table: 't', sql: 'SELECT * FROM `t`' })
    expect(again.st.executedSql).toBe('SELECT * FROM `t` LIMIT 25, 25')
    const all = await browse(a, { table: 't', sql: 'SELECT * FROM `t`', maxRows: 'all', pos: 0 })
    expect(all.st.executedSql).toBe('SELECT * FROM `t`')
    expect(all.grid.navigation?.isShowingAll).toBe(true)
  })

  it('FK links with the display column, NULL keys untouched [p02-1e062a p02-2e6fb1]', async () => {
    const a = await app()
    const { grid } = await browse(a, { table: 'child', sql: 'SELECT * FROM `child` ORDER BY `id`' })
    const fk = grid.rows[0]!.cells[1]!.fk!
    expect(fk.sql).toBe(`SELECT * FROM \`${DB}\`.\`t\` WHERE \`id\` = 1`)
    expect(fk.title).toBe('item1')
    expect(grid.rows[2]!.cells[1]!.k).toBe('null')
    const d = await browse(a, {
      table: 'child',
      sql: 'SELECT * FROM `child` ORDER BY `id`',
      relationalDisplay: 'D',
    })
    expect(d.grid.rows[0]!.cells[1]!.t).toBe('item1')
    expect(d.grid.rows[0]!.cells[1]!.fk?.title).toBe('1')
  })

  it('a table without a unique key: no row actions and the notice [p02-c56862 p02-ed7243 p02-03ff49]', async () => {
    const a = await app()
    const { grid } = await browse(a, { table: 'nk' })
    expect(grid.editable).toBe(false)
    expect(grid.missingUnique).toBe('unavailable')
    expect(grid.displayParts.editLink).toBe(false)
    expect(grid.rows[0]!.cells[2]!.t).toBe('[BLOB - 3 B]')
    const blob = await browse(a, { table: 'nk', sql: 'SELECT * FROM `nk`', displayBlob: true })
    expect(blob.grid.rows[0]!.cells[2]!.t).toBe('abc')
    expect(blob.grid.rows[1]!.cells[2]!.k).toBe('null')
    const without = await app({ RowActionLinksWithoutUnique: true })
    const w = await browse(without, { table: 'nk' })
    expect(w.grid.missingUnique).toBe('undesired')
    expect(w.grid.rows[0]!.unique).toBe(false)
    expect(w.grid.rows[0]!.del?.sql).toMatch(/ LIMIT 1$/)
  })

  it('TablePrimaryKeyOrder adds an ORDER BY on the primary key [p02-1f1189]', async () => {
    const a = await app({ TablePrimaryKeyOrder: 'DESC', RememberSorting: false })
    const { st } = await browse(a, { table: 't' })
    expect(st.executedSql).toBe('SELECT * FROM `t` ORDER BY `t`.`id` DESC LIMIT 0, 25')
  })

  it('single-row delete keeps the deleted message; bulk delete re-runs the query [p02-2b0c72 p02-a3dbd4]', async () => {
    const a = await app()
    const del = await browse(a, {
      table: 't',
      sql: 'DELETE FROM `t` WHERE `t`.`id` = 30',
      messageToShow: 'The row has been deleted.',
    })
    expect(del.st.message.text).toMatch(/^1 row deleted\./)
    const r = await a.req('POST', '/api/servers/1/browse/delete-rows', {
      db: DB,
      table: 't',
      where: ['`t`.`id` = 29', '`t`.`id` = 28'],
      fkChecks: true,
      originalSql: 'SELECT * FROM `t`',
    })
    expect(r.status).toBe(200)
    const body = r.json as unknown as Browse & { previous: { sql: string } }
    expect(body.previous.sql).toBe(
      'DELETE FROM `t` WHERE `t`.`id` = 29 LIMIT 1;\nDELETE FROM `t` WHERE `t`.`id` = 28 LIMIT 1;',
    )
    expect(body.statements[0]!.grid?.total).toBe(27)
  })

  it('grid edit: save, full value, enum / set / relational editors [p02-10a94f p02-85eff6 p03-995b4e]', async () => {
    const a = await app()
    const save = await a.req('POST', '/api/servers/1/browse/save', {
      db: DB,
      table: 't',
      clauseIsUnique: true,
      rows: [{ where: '`t`.`id` = 2', fields: [{ name: 'name', value: "it's", isNull: false }] }],
    })
    expect(save.json).toMatchObject({ success: true, message: '1 row affected.', recheck: "it's" })
    expect(save.json.sql).toBe("UPDATE `t` SET `name` = 'it\\'s' WHERE `t`.`id` = 2")
    const full = await a.req('POST', '/api/servers/1/browse/grid-value', {
      db: DB,
      table: 't',
      column: 'name',
      where: '`t`.`id` = 3',
    })
    expect(full.json.value).toBe('x'.repeat(70))
    const en = await a.req('POST', '/api/servers/1/browse/values', {
      kind: 'enum',
      db: DB,
      table: 'e',
      column: 'c',
      currValue: 'b',
    })
    expect(en.json).toEqual({
      options: ['a', 'b', 'c'].map((v) => ({ value: v, label: v })),
      selected: ['b'],
    })
    const set = await a.req('POST', '/api/servers/1/browse/values', {
      kind: 'set',
      db: DB,
      table: 'e',
      column: 's',
      currValue: 'x',
      where: '`e`.`id` = 1',
    })
    expect(set.json.selected).toEqual(['x', 'z'])
    const rel = await a.req('POST', '/api/servers/1/browse/values', {
      kind: 'relational',
      db: DB,
      table: 'child',
      column: 't_id',
      currValue: '1',
    })
    const opts = rel.json.options as Array<{ value: string; label: string }>
    expect(opts[0]).toEqual({ value: '', label: '' })
    expect(opts[1]?.label).toMatch(/ - \d+$/)
  })

  it('the SQL tab returns the grid when asked [p02-c75482]', async () => {
    const a = await app()
    const r = await a.req('POST', '/api/servers/1/query', {
      sql: 'SELECT * FROM t WHERE qty = 1',
      db: DB,
      fromQueryBox: true,
      grid: true,
    })
    const st = (r.json as unknown as QueryResponse).statements[0]!
    expect(st.grid?.editable).toBe(true)
    expect(st.grid?.columns.find((c) => c.name === 'qty')?.condition).toBe(true)
  })
})
