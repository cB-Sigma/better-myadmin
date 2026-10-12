import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { compareWrites, normalise } from './lib/compare.ts'
import { GeneralLog } from './lib/general-log.ts'
import { decodeEntities } from './lib/nav-html.ts'
import { PmaClient } from './lib/pma.ts'
import { pmaReachable } from './lib/server-setup.ts'

/**
 * Golden parity of the normalization wizard (docs/features/04-table-level.md#normalization-wizard):
 * the statements of 1NF (move a repeating group), 2NF and 3NF (split the table), and what the
 * steps propose (partial dependencies found in the data, the new tables of 2NF and 3NF, the 3NF
 * candidates). phpMyAdmin is driven with the requests normalization.js sends.
 */
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const PMA_USER = 'f04norm_pma'
const BMA_USER = 'f04norm_bma'
const DB_PMA = 'f04norm_pdb'
const DB_BMA = 'f04norm_bdb'
const dbMap = { [DB_PMA]: 'DB', [DB_BMA]: 'DB', [PMA_USER]: 'USER', [BMA_USER]: 'USER' }

/** orders(order_id, item_id) → qty depends on both, item_name/price on item_id; city → zip */
const SEED = `
  CREATE TABLE orders (order_id INT NOT NULL, item_id INT NOT NULL, item_name VARCHAR(20), price INT,
    qty INT, PRIMARY KEY (order_id, item_id)) ENGINE=InnoDB;
  INSERT INTO orders VALUES (1, 1, 'pen', 2, 5), (1, 2, 'ink', 3, 1), (2, 1, 'pen', 2, 7), (3, 2, 'ink', 3, 2);
  CREATE TABLE people (id INT NOT NULL PRIMARY KEY, name VARCHAR(20), city VARCHAR(20), zip VARCHAR(10),
    phone1 VARCHAR(10), phone2 VARCHAR(10)) ENGINE=InnoDB;
  INSERT INTO people VALUES (1, 'a', 'x', '100', '1', '2'), (2, 'b', 'y', '200', '3', NULL), (3, 'c', 'x', '100', '4', '5');
`

let log: GeneralLog
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let root: mysql.Connection

const base = (table: string) => `/api/servers/1/databases/${DB_BMA}/tables/${table}/normalization`
async function bmaPost(table: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await bma.req('POST', `${base(table)}${path}`, body)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}
const pmaPost = (route: string, table: string, form: Record<string, string>) =>
  pma.postJson(route, { db: DB_PMA, table, ...form })

async function seed() {
  for (const db of [DB_PMA, DB_BMA]) {
    await root.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`)
  }
  await root.query('USE mysql')
}

async function runCase(pmaFn: () => Promise<unknown>, bmaFn: () => Promise<unknown>) {
  await seed()
  const m1 = await log.marker()
  const p = await pmaFn()
  const pmaLog = await log.since(PMA_USER, m1)
  const m2 = await log.marker()
  const b = await bmaFn()
  const bmaLog = await log.since(BMA_USER, m2)
  const cmp = compareWrites(pmaLog, bmaLog, dbMap)
  expect(cmp.pma.length, 'the reference wrote').toBeGreaterThan(0)
  expect(cmp.bma).toEqual(cmp.pma)
  const tables = async (db: string) => {
    const [rows] = await root.query({ sql: `SHOW TABLES FROM \`${db}\``, rowsAsArray: true })
    const out: string[] = []
    for (const [t] of rows as string[][]) {
      const [c] = await root.query({ sql: `SHOW CREATE TABLE \`${db}\`.\`${t}\``, rowsAsArray: true })
      const [d] = await root.query(`SELECT * FROM \`${db}\`.\`${t}\` ORDER BY 1, 2`)
      out.push(normalise(String((c as string[][])[0]?.[1]), dbMap), JSON.stringify(d))
    }
    return out
  }
  expect(await tables(DB_BMA)).toEqual(await tables(DB_PMA))
  return { p, b }
}

// 2NF: item_name, price depend on item_id; qty on the whole key
const PD2: Array<[string, string[]]> = [
  ['order_id, item_id', ['qty']],
  ['item_id', ['item_name', 'price']],
]

describe.skipIf(!pmaReachable)('parity: normalization wizard (phpMyAdmin vs BetterMyAdmin)', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    for (const u of [PMA_USER, BMA_USER]) {
      await root.query(
        `DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON \`f04norm\\_%\`.* TO '${u}'@'%'`,
      )
    }
    log = await GeneralLog.open(ROOT)
    pma = new PmaClient(PMA_URL)
    await pma.login(PMA_USER, PMA_USER)
    bma = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }))
    await bma.login(BMA_USER, BMA_USER)
  })

  afterAll(async () => {
    for (const db of [DB_PMA, DB_BMA]) await root?.query(`DROP DATABASE IF EXISTS ${db}`)
    await root?.query(`DROP USER IF EXISTS '${PMA_USER}'@'%'; DROP USER IF EXISTS '${BMA_USER}'@'%'`)
    await root?.end()
    await log?.close()
    await bma?.close()
  })

  it('1NF: move a repeating group to a new table', () =>
    runCase(
      () =>
        pmaPost('/normalization/move-repeating-group', 'people', {
          repeatingColumns: 'phone1, phone2',
          newTable: 'phones',
          newColumn: 'phone',
          primary_columns: 'id',
        }),
      () =>
        bmaPost('people', '/move-repeating-group', {
          repeatingColumns: 'phone1, phone2',
          newTable: 'phones',
          newColumn: 'phone',
          primaryColumns: 'id',
        }),
    ))

  it('2NF: split on a partial dependency, the original table kept', () =>
    runCase(
      () =>
        pmaPost('/normalization/2nf/create-new-tables', 'orders', {
          pd: JSON.stringify(Object.fromEntries(PD2)),
          newTablesName: JSON.stringify({ 'order_id, item_id': 'orders', item_id: 'items' }),
        }),
      () =>
        bmaPost('orders', '/2nf/create-new-tables', {
          pd: PD2,
          newTablesName: { 'order_id, item_id': 'orders', item_id: 'items' },
        }),
    ))

  it('2NF: every group renamed (the original table is dropped)', () =>
    runCase(
      () =>
        pmaPost('/normalization/2nf/create-new-tables', 'orders', {
          pd: JSON.stringify(Object.fromEntries(PD2)),
          newTablesName: JSON.stringify({ 'order_id, item_id': 'order_items', item_id: 'items' }),
        }),
      () =>
        bmaPost('orders', '/2nf/create-new-tables', {
          pd: PD2,
          newTablesName: { 'order_id, item_id': 'order_items', item_id: 'items' },
        }),
    ))

  it('3NF: the new tables proposed and created for a transitive dependency', async () => {
    // normalization.js processDependencies(…, true): name, city → people; zip → city
    const pd = { '': [], people: ['name', 'city'], city: ['zip'] }
    const tables: Array<[string, string[]]> = [['people', ['people', 'people', 'people', 'city']]]
    await seed()
    const p = (await pmaPost('/normalization/3nf/new-tables', 'people', {
      pd: JSON.stringify(pd),
      tables: JSON.stringify(Object.fromEntries(tables)),
    })) as { newTables: Record<string, Record<string, { pk: string; nonpk: string }>> }
    const b = (await bmaPost('people', '/3nf/new-tables', { pd, tables })) as {
      newTables: Array<[string, Array<[string, { pk: string; nonpk: string }]>]>
    }
    const asObject = Object.fromEntries(b.newTables.map(([t, l]) => [t, Object.fromEntries(l)]))
    expect(asObject).toEqual(p.newTables)
    // the user renames the second table (goTo3NFFinish), then Go
    const renamed = { people: { people: p.newTables.people?.people, cities: p.newTables.people?.table2 } }
    await runCase(
      () => pmaPost('/normalization/3nf/create-new-tables', 'people', { newTables: JSON.stringify(renamed) }),
      () =>
        bmaPost('people', '/3nf/create-new-tables', {
          newTables: [
            [
              'people',
              [
                ['people', renamed.people.people],
                ['cities', renamed.people.cities],
              ],
            ],
          ],
        }),
    )
  })

  it('2NF: the tables proposed for the selected dependencies', async () => {
    await seed()
    const html = String(
      (
        await pmaPost('/normalization/2nf/new-tables', 'orders', {
          pd: JSON.stringify(Object.fromEntries(PD2)),
        })
      ).message,
    )
    const inputs = [...html.matchAll(/<input type="text" name="([^"]*)" value="([^"]*)">/g)].map((m) => [
      decodeEntities(m[1] ?? ''),
      decodeEntities(m[2] ?? ''),
    ])
    const b = (await bmaPost('orders', '/2nf/new-tables', { pd: PD2 })) as {
      tables: Array<{ key: string; name: string }>
    }
    expect(b.tables.map((t) => [t.key, t.name])).toEqual(inputs)
  })

  it('the partial dependencies found in the data', async () => {
    await seed()
    const html = String((await pmaPost('/normalization/partial-dependencies', 'orders', {})).message)
    const found = [
      ...html.matchAll(/class="determinants">([^<]*)<\/span> -> <span class="dependents">([^<]*)</g),
    ].map((m) => [decodeEntities(m[1] ?? ''), decodeEntities(m[2] ?? '')])
    const b = (await bmaPost('orders', '/partial-dependencies', {})) as {
      dependencies: Array<{ determinants: string; dependents: string[] }>
    }
    expect(b.dependencies.map((d) => [d.determinants, d.dependents.join(', ')])).toEqual(found)
    expect(found.length).toBeGreaterThan(0)
  })

  it('3NF step 1: the candidates of each table', async () => {
    await seed()
    const p = await pma.postJson('/normalization/3nf/step1', [
      ['db', DB_PMA],
      ['tables[]', 'people'],
      ['tables[]', 'orders'],
    ])
    const forms = [...String(p.extra).matchAll(/data-colname="([^"]*)" data-tablename="([^"]*)"/g)].map(
      (m) => [m[2], m[1]],
    )
    const b = (await bmaPost('people', '/3nf/step1', { tables: ['people', 'orders'] })) as {
      tables: Array<{ table: string; nonPk: string[] }>
    }
    expect(b.tables.flatMap((t) => t.nonPk.map((c) => [t.table, c]))).toEqual(forms)
  })
})
