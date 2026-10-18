import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * The Relation view page through the API (docs/features/04-table-level.md › Relation view): the
 * engine rules and the natural ordering. The statements are compared with phpMyAdmin in
 * tests/parity/table-relation.parity.test.ts.
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const DB = 'f04_it_rel'
const base = `/api/servers/1/databases/${DB}/tables`
let root: mysql.Connection

async function page(table: string, cfg = {}): Promise<Any> {
  const a = testApp(testConfig(cfg))
  await a.login()
  const r = await a.req('GET', `${base}/${table}/relation`)
  await a.close()
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE p (id INT PRIMARY KEY) ENGINE=InnoDB;
    CREATE TABLE c (id INT PRIMARY KEY, c10 INT, c9 INT, c1 INT, KEY k (c9),
      CONSTRAINT fk10 FOREIGN KEY (c10) REFERENCES p (id), CONSTRAINT fk9 FOREIGN KEY (c9) REFERENCES p (id))
      ENGINE=InnoDB;
    CREATE TABLE m (id INT PRIMARY KEY, a INT, b INT, KEY ka (a)) ENGINE=MyISAM;`)
})
afterAll(async () => {
  await root?.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root?.end()
})

describe('Relation view page', () => {
  it('foreign keys only for InnoDB; other engines offer only indexed local columns [p04-79a089]', async () => {
    const inno = await page('c')
    expect(inno.isForeignKeySupported).toBe(true)
    expect(inno.columns).toEqual(['', 'c1', 'c9', 'c10', 'id'])
    const myisam = await page('m')
    expect(myisam.isForeignKeySupported).toBe(false)
    expect(myisam.foreignKeys).toEqual([])
    expect(myisam.columns).toEqual(['', 'a', 'id'])
    expect(myisam.allColumns).toEqual(['id', 'a', 'b'])
  })

  it('columns and constraints in natural order when NaturalOrder, else as defined [p04-a09c34]', async () => {
    const natural = await page('c')
    expect(natural.foreignKeys.map((f: Any) => f.constraint)).toEqual(['fk9', 'fk10'])
    const plain = await page('c', { NaturalOrder: false })
    expect(plain.columns).toEqual(['', 'id', 'c10', 'c9', 'c1'])
    expect(plain.foreignKeys.map((f: Any) => f.constraint)).toEqual(['fk10', 'fk9'])
  })
})
