import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp } from '../support/app.ts'

/**
 * A browse page of large cells for several users at once (docs/architecture/17-large-data.md):
 * each request holds its own page only, and the page is phpMyAdmin's (the key's condition, the
 * BLOB placeholder, the truncated text with its length) without decoding the cells it does not show.
 */
const DB = 'f07_large_conc'
type Json = Record<string, unknown>
let root: mysql.Connection

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE big (id INT PRIMARY KEY, data LONGBLOB, note LONGTEXT);
    INSERT INTO big SELECT n, REPEAT(x'ab', 200000), REPEAT('€', 100000) FROM (
      WITH RECURSIVE s (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 30) SELECT n FROM s) q;
    CREATE TABLE nokey (data LONGBLOB, note TEXT);
    INSERT INTO nokey VALUES (REPEAT(x'ab', 200000), 'a'), (x'00ff', 'b');`)
})
afterAll(async () => {
  await root.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root.end()
})

type Grid = {
  rows: Array<{ where: string; unique: boolean; cells: Array<{ cls: string; t?: string; ol?: number }> }>
}
const gridOf = (json: Json) => ((json.statements as Json[])[0] as Json).grid as Grid

describe('Browse of large cells, five users at once', () => {
  it('every page is the first 25 rows with the key condition, placeholders and truncated text', async () => {
    const users = Array.from({ length: 5 }, () => testApp())
    try {
      await Promise.all(users.map((u) => u.login()))
      const pages = await Promise.all(
        users.map((u) => u.req('POST', '/api/servers/1/browse', { db: DB, table: 'big' })),
      )
      for (const r of pages) {
        expect(r.status).toBe(200)
        const grid = gridOf(r.json)
        expect(grid.rows).toHaveLength(25)
        expect(grid.rows.map((x) => x.where)).toEqual(
          Array.from({ length: 25 }, (_, i) => `\`big\`.\`id\` = ${i + 1}`),
        )
        const [, blob, note] = grid.rows[0]!.cells
        expect(blob!.t).toBe('[BLOB - 195.3 KiB]')
        expect(note!.cls).toContain('truncated')
        expect(note!.ol).toBe(100_000)
        expect(note!.t).toBe(`${'€'.repeat(50)}...`)
        expect(JSON.stringify(r.json).length).toBeLessThan(100_000)
      }
    } finally {
      await Promise.all(users.map((u) => u.close()))
    }
  })

  it('without a key: the all-columns condition leaves a long BLOB out and hexifies a short one', async () => {
    const t = testApp()
    try {
      await t.login()
      const r = await t.req('POST', '/api/servers/1/browse', { db: DB, table: 'nokey' })
      const grid = gridOf(r.json)
      expect(grid.rows.map((x) => [x.where, x.unique])).toEqual([
        ["`nokey`.`note` = 'a'", false],
        ["`nokey`.`data` = CAST(0x00ff AS BINARY) AND `nokey`.`note` = 'b'", false],
      ])
    } finally {
      await t.close()
    }
  })
})
