import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Database → Diagram (BetterMyAdmin-only, X63): GET …/databases/:db/er-diagram returns the whole
 * database (tables, views, columns, keys, FOREIGN KEYs, internal relations) in one request, limited
 * to what the user can see.
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const DB = 'erd_it'
const OTHER = 'erd_it_other'
const USER = 'erd_it_limited'
const clean = `DELETE FROM phpmyadmin.pma__relation WHERE master_db = '${DB}';`
let root: mysql.Connection
const app = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }))
const bare = testApp(testConfig({ ZeroConf: false }, { pmadb: 'erd_it_no_storage' }))
const limited = testApp(testConfig({}))
const base = `/api/servers/1/databases/${DB}`

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${OTHER};
    CREATE DATABASE ${DB}; CREATE DATABASE ${OTHER};
    CREATE TABLE ${OTHER}.audit (id INT PRIMARY KEY) ENGINE=InnoDB;
    CREATE TABLE ${DB}.customer (id INT PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, note TEXT) ENGINE=InnoDB COMMENT 'people';
    CREATE TABLE ${DB}.\`order\` (id INT, rev INT, customer_id INT NULL, PRIMARY KEY (id, rev),
      CONSTRAINT fk_cust FOREIGN KEY (customer_id) REFERENCES customer (id)) ENGINE=InnoDB;
    CREATE TABLE ${DB}.order_line (order_id INT, order_rev INT, product_id INT, audit_id INT,
      CONSTRAINT fk_order FOREIGN KEY (order_id, order_rev) REFERENCES \`order\` (id, rev),
      CONSTRAINT fk_audit FOREIGN KEY (audit_id) REFERENCES ${OTHER}.audit (id)) ENGINE=InnoDB;
    CREATE TABLE ${DB}.product (id INT PRIMARY KEY, name VARCHAR(64)) ENGINE=MyISAM;
    CREATE VIEW ${DB}.v_customers AS SELECT id, email FROM ${DB}.customer;
    ${clean}
    INSERT INTO phpmyadmin.pma__relation (master_db, master_table, master_field, foreign_db, foreign_table, foreign_field)
      VALUES ('${DB}', 'order_line', 'product_id', '${DB}', 'product', 'id'),
             ('${DB}', 'order', 'customer_id', '${DB}', 'customer', 'id');
    DROP USER IF EXISTS '${USER}'@'%';
    CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT SELECT ON ${DB}.order_line TO '${USER}'@'%';
    GRANT SELECT (id, email) ON ${DB}.customer TO '${USER}'@'%';`)
  await app.login()
  await bare.login()
  expect((await limited.login(USER, USER)).status).toBe(200)
})
afterAll(async () => {
  await root.query(`${clean} DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${OTHER};
    DROP USER IF EXISTS '${USER}'@'%'`)
  await root.end()
  await app.close()
  await bare.close()
  await limited.close()
})

describe('GET …/er-diagram', () => {
  it('every table and view with columns and key markers, in one payload', async () => {
    const r = await app.req('GET', `${base}/er-diagram`)
    expect(r.status).toBe(200)
    const d = r.json as Any
    expect(d.db).toBe(DB)
    expect(d.tables.map((t: Any) => [t.name, t.view])).toEqual([
      ['customer', false],
      ['order', false],
      ['order_line', false],
      ['product', false],
      ['v_customers', true],
    ])
    const customer = d.tables[0]
    expect(customer).toMatchObject({ engine: 'InnoDB', comment: 'people' })
    expect(customer.columns).toEqual([
      // MariaDB keeps the display width
      { name: 'id', type: expect.stringMatching(/^int(\(11\))?$/), nullable: false, pk: true, unique: false },
      { name: 'email', type: 'varchar(255)', nullable: false, pk: false, unique: true },
      { name: 'note', type: 'text', nullable: true, pk: false, unique: false },
    ])
    expect(d.tables[1].columns.map((c: Any) => [c.name, c.pk, c.nullable])).toEqual([
      ['id', true, false],
      ['rev', true, false],
      ['customer_id', false, true],
    ])
    expect(d.tables[4]).toMatchObject({ engine: '', comment: '' })
  })

  it('FOREIGN KEYs (composite, cross-database) and the internal relations not already drawn', async () => {
    const d = (await app.req('GET', `${base}/er-diagram`)).json as Any
    expect(d.relations).toEqual([
      {
        kind: 'fk',
        name: 'fk_cust',
        table: 'order',
        columns: ['customer_id'],
        refDb: DB,
        refTable: 'customer',
        refColumns: ['id'],
      },
      {
        kind: 'fk',
        name: 'fk_audit',
        table: 'order_line',
        columns: ['audit_id'],
        refDb: OTHER,
        refTable: 'audit',
        refColumns: ['id'],
      },
      {
        kind: 'fk',
        name: 'fk_order',
        table: 'order_line',
        columns: ['order_id', 'order_rev'],
        refDb: DB,
        refTable: 'order',
        refColumns: ['id', 'rev'],
      },
      // order.customer_id → customer.id is a FOREIGN KEY too: listed once
      {
        kind: 'internal',
        name: '',
        table: 'order_line',
        columns: ['product_id'],
        refDb: DB,
        refTable: 'product',
        refColumns: ['id'],
      },
    ])
  })

  it('without the configuration storage: FOREIGN KEYs only', async () => {
    const d = (await bare.req('GET', `${base}/er-diagram`)).json as Any
    expect(d.relations.map((r: Any) => r.kind)).toEqual(['fk', 'fk', 'fk'])
  })

  it('a limited user sees only the tables and columns it has a privilege on', async () => {
    const r = await limited.req('GET', `${base}/er-diagram`)
    expect(r.status).toBe(200)
    const d = r.json as Any
    expect(d.tables.map((t: Any) => [t.name, t.columns.map((c: Any) => c.name)])).toEqual([
      ['customer', ['id', 'email']],
      ['order_line', ['order_id', 'order_rev', 'product_id', 'audit_id']],
    ])
    // the FOREIGN KEYs of order_line stay listed (information_schema shows them); `order` is not a table
    expect(d.tables.some((t: Any) => t.name === 'order')).toBe(false)
  })

  it('an unknown database is a 404', async () => {
    const r = await app.req('GET', '/api/servers/1/databases/erd_it_nope/er-diagram')
    expect(r.status).toBe(404)
  })
})
