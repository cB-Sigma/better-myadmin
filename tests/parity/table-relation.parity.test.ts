import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { compareWrites, normalise } from './lib/compare.ts'
import { type Pairs, findForm, removePair, serializeForm, setPair } from './lib/form.ts'
import { GeneralLog } from './lib/general-log.ts'
import { decodeEntities } from './lib/nav-html.ts'
import { PmaClient, type PmaJson } from './lib/pma.ts'
import { pmaReachable } from './lib/server-setup.ts'

/**
 * Golden parity of the Relation view (docs/features/04-table-level.md#relation-view): FOREIGN KEY
 * add / change / drop / restore on failure, Preview SQL, internal relations and the display column.
 * The user's writes must match, and so must the configuration-storage writes of the control user
 * (`pma`, shared with the reference phpMyAdmin; only statements naming this suite's databases).
 */
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const PMA_USER = 'f04rel_pma'
const BMA_USER = 'f04rel_bma'
const DB_PMA = 'f04rel_pdb'
const DB_BMA = 'f04rel_bdb'
const dbMap = { [DB_PMA]: 'DB', [DB_BMA]: 'DB', [PMA_USER]: 'USER', [BMA_USER]: 'USER' }

const reachable = pmaReachable

const SEED = `
  CREATE TABLE t (id INT NOT NULL, code VARCHAR(10) NOT NULL, label VARCHAR(20), PRIMARY KEY (id), UNIQUE KEY (code)) ENGINE=InnoDB;
  CREATE TABLE child (id INT NOT NULL, t_id INT, t_code VARCHAR(10), note VARCHAR(5), PRIMARY KEY (id),
    KEY (t_code),
    CONSTRAINT fk_a FOREIGN KEY (t_id) REFERENCES t (id) ON DELETE CASCADE) ENGINE=InnoDB;
`

let log: GeneralLog
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let root: mysql.Connection

const bmaBase = (table: string) => `/api/servers/1/databases/${DB_BMA}/tables/${table}/relation`
async function bmaPage(table: string): Promise<Record<string, unknown>> {
  const r = await bma.req('GET', bmaBase(table))
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}
async function bmaSave(table: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await bma.req('POST', bmaBase(table), body)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}

/**
 * phpMyAdmin's form as the browser posts it. An ON DELETE / ON UPDATE that SHOW CREATE TABLE leaves
 * out (RESTRICT) matches no option, so the select posts its first one: RESTRICT since upstream
 * 8847e08639 (the order we use).
 */
async function pmaForm(table: string): Promise<Pairs> {
  const html = await pma.getPage('/table/relation', { db: DB_PMA, table })
  return serializeForm(findForm(html, { action: '/table/relation' }))
}

/** BetterMyAdmin's save request from its page: the rows as the form shows them, then `mods`. */
async function bmaRows(table: string) {
  const p = (await bmaPage(table)) as {
    foreignKeys: Array<{
      constraint: string | null
      indexList: string[]
      refDb: string
      refTable: string
      refIndexList: string[]
      onDelete: string
      onUpdate: string
    }>
    internal: Array<{ field: string; foreignDb: string; foreignTable: string; foreignColumn: string }>
    displayField: string
  }
  return {
    page: p,
    foreignKeys: [
      ...p.foreignKeys.map((k) => ({
        constraintName: k.constraint ?? '',
        onDelete: k.onDelete,
        onUpdate: k.onUpdate,
        columns: k.indexList,
        refDb: k.refDb,
        refTable: k.refTable,
        refColumns: k.refIndexList,
      })),
      {
        constraintName: '',
        onDelete: 'RESTRICT',
        onUpdate: 'RESTRICT',
        columns: [''],
        refDb: DB_BMA,
        refTable: '',
        refColumns: [''],
      },
    ],
    internal: p.internal.map((r) => ({
      field: r.field,
      db: r.foreignDb,
      table: r.foreignTable,
      column: r.foreignColumn,
    })),
    displayField: p.displayField,
  }
}

// configuration-storage statements about this suite's databases (not the tracking probes, nor the
// recent-tables list phpMyAdmin's RecentTableHandling middleware updates on every page)
const ours = (s: string) =>
  s.includes('f04rel_') && !s.startsWith('/*NOTRACK*/ SELECT') && !s.includes('`pma__recent`')

interface Case {
  name: string
  pma: () => Promise<unknown>
  bma: () => Promise<unknown>
  check?: (pma: unknown, bma: unknown) => void
}

async function runCase(c: Case) {
  for (const db of [DB_PMA, DB_BMA]) {
    await root.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`)
    await root.query(
      `DELETE FROM phpmyadmin.pma__relation WHERE master_db = '${db}'; DELETE FROM phpmyadmin.pma__table_info WHERE db_name = '${db}'`,
    )
  }
  await root.query('USE mysql')
  const m1 = await log.marker()
  const pr = await c.pma()
  const pmaLog = await log.since(PMA_USER, m1)
  const pmaCtl = (await log.since('pma', m1)).filter((e) => ours(e.sql))
  const m2 = await log.marker()
  const br = await c.bma()
  const bmaLog = await log.since(BMA_USER, m2)
  const bmaCtl = (await log.since('pma', m2)).filter((e) => ours(e.sql))
  const cmp = compareWrites(pmaLog, bmaLog, dbMap)
  expect(cmp.bma, `writes of ${c.name}`).toEqual(cmp.pma)
  const ctl = compareWrites(pmaCtl, bmaCtl, dbMap)
  expect(ctl.bma, `control-user writes of ${c.name}`).toEqual(ctl.pma)
  const show = async (db: string) => {
    const [rows] = await root.query({ sql: `SHOW CREATE TABLE \`${db}\`.child`, rowsAsArray: true })
    return normalise(String((rows as unknown[][])[0]?.[1]), dbMap)
  }
  expect(await show(DB_BMA)).toBe(await show(DB_PMA))
  c.check?.(pr, br)
}

/** the blank last row of phpMyAdmin's form, filled in */
function newRow(pairs: Pairs, i: number, row: Record<string, string>): Pairs {
  let out = pairs
  for (const [k, v] of Object.entries(row)) out = setPair(out, k.replace('#', String(i)), v)
  return out
}

const CASES: Case[] = [
  {
    name: 'add a constraint with a name, ON DELETE CASCADE / ON UPDATE SET NULL [p04-b2ab58]',
    pma: async () =>
      pma.postPage(
        '/table/relation',
        newRow(await pmaForm('child'), 1, {
          'constraint_name[#]': 'fk_new',
          'on_delete[#]': 'CASCADE',
          'on_update[#]': 'SET_NULL',
          'foreign_key_fields_name[#][]': 't_code',
          'destination_foreign_table[#]': 't',
          'destination_foreign_column[#][]': 'code',
        }),
      ),
    bma: async () => {
      const r = await bmaRows('child')
      Object.assign(r.foreignKeys[1] ?? {}, {
        constraintName: 'fk_new',
        onDelete: 'CASCADE',
        onUpdate: 'SET_NULL',
        columns: ['t_code'],
        refTable: 't',
        refColumns: ['code'],
      })
      return bmaSave('child', {
        foreignKeys: r.foreignKeys,
        internal: r.internal,
        displayField: r.displayField,
      })
    },
  },
  {
    name: 'change ON UPDATE of an existing constraint (drop + create) [p04-b2ab58]',
    pma: async () =>
      pma.postPage('/table/relation', setPair(await pmaForm('child'), 'on_update[0]', 'NO_ACTION')),
    bma: async () => {
      const r = await bmaRows('child')
      Object.assign(r.foreignKeys[0] ?? {}, { onUpdate: 'NO_ACTION' })
      return bmaSave('child', {
        foreignKeys: r.foreignKeys,
        internal: r.internal,
        displayField: r.displayField,
      })
    },
  },
  {
    name: 'clearing the referenced table drops the constraint [p04-b2ab58]',
    pma: async () =>
      pma.postPage('/table/relation', setPair(await pmaForm('child'), 'destination_foreign_table[0]', '')),
    bma: async () => {
      const r = await bmaRows('child')
      Object.assign(r.foreignKeys[0] ?? {}, { refTable: '' })
      return bmaSave('child', {
        foreignKeys: r.foreignKeys,
        internal: r.internal,
        displayField: r.displayField,
      })
    },
  },
  {
    name: 'a failing change restores the dropped constraint [p04-b2ab58]',
    pma: async () =>
      pma.postPage(
        '/table/relation',
        setPair(
          setPair(await pmaForm('child'), 'foreign_key_fields_name[0][]', 'note'),
          'on_delete[0]',
          'RESTRICT',
        ),
      ),
    bma: async () => {
      const r = await bmaRows('child')
      Object.assign(r.foreignKeys[0] ?? {}, { columns: ['note'], onDelete: 'RESTRICT' })
      return bmaSave('child', {
        foreignKeys: r.foreignKeys,
        internal: r.internal,
        displayField: r.displayField,
      })
    },
  },
  {
    name: 'Preview SQL shows the statements and runs none of them [p04-929453]',
    pma: async () =>
      pma.postJson('/table/relation', [
        ...setPair(await pmaForm('child'), 'on_delete[0]', 'SET_NULL'),
        ['preview_sql', '1'],
      ]),
    bma: async () => {
      const r = await bmaRows('child')
      Object.assign(r.foreignKeys[0] ?? {}, { onDelete: 'SET_NULL' })
      return bmaSave('child', { foreignKeys: r.foreignKeys, internal: r.internal, preview: true })
    },
    check: (p, b) => {
      const html = String((p as PmaJson).sql_data ?? '')
      const codes = [...html.matchAll(/<code class="sql"[^>]*>([\s\S]*?)<\/code>/g)]
        .map((m) => decodeEntities((m[1] ?? '').replace(/<[^>]+>/g, '')))
        .join('\n')
      expect(normalise(String((b as { preview: string }).preview), dbMap)).toBe(normalise(codes, dbMap))
    },
  },
  {
    name: 'drop a constraint from its row link (via /sql) [p04-2da92c]',
    pma: async () => {
      const html = await pma.getPage('/table/relation', { db: DB_PMA, table: 'child' })
      const post =
        /class="drop_foreign_key_anchor ajax"[^>]*data-post="([^"]*)"|data-post="([^"]*)"[^>]*class="drop_foreign_key_anchor ajax"/.exec(
          html,
        )
      const params = [...new URLSearchParams(decodeEntities(post?.[1] ?? post?.[2] ?? ''))]
      return pma.postJson('/sql', [
        ...params,
        ['is_js_confirmed', '1'],
        ['ajax_request', 'true'],
        ['fk_checks', '0'],
      ])
    },
    bma: () =>
      bma.req('POST', `${bmaBase('child')}/drop-foreign-key`, { constraint: 'fk_a' }).then((r) => r.json),
  },
  {
    name: 'internal relations and the display column (configuration storage) [p04-111f1c]',
    pma: async () => {
      let pairs = await pmaForm('t')
      const hash = (await import('node:crypto')).createHash('md5').update('label').digest('hex')
      pairs = setPair(pairs, `destination_table[${hash}]`, 'child')
      pairs = setPair(pairs, `destination_column[${hash}]`, 'id')
      pairs = setPair(pairs, 'display_field', 'code')
      return pma.postPage('/table/relation', removePair(pairs, 'preview_sql'))
    },
    bma: async () => {
      const r = await bmaRows('t')
      const row = r.internal.find((x) => x.field === 'label')
      if (row !== undefined) Object.assign(row, { table: 'child', column: 'id' })
      return bmaSave('t', {
        foreignKeys: r.foreignKeys,
        internal: r.internal,
        displayField: 'code',
      })
    },
  },
]

describe.skipIf(!reachable)('parity: Relation view (phpMyAdmin forms vs BetterMyAdmin API)', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    for (const u of [PMA_USER, BMA_USER]) {
      await root.query(
        `DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON \`f04rel\\_%\`.* TO '${u}'@'%'`,
      )
    }
    log = await GeneralLog.open(ROOT)
    pma = new PmaClient(PMA_URL)
    await pma.login(PMA_USER, PMA_USER)
    bma = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }))
    await bma.login(BMA_USER, BMA_USER)
  })

  afterAll(async () => {
    for (const db of [DB_PMA, DB_BMA]) {
      await root?.query(
        `DROP DATABASE IF EXISTS ${db}; DELETE FROM phpmyadmin.pma__relation WHERE master_db = '${db}'; DELETE FROM phpmyadmin.pma__table_info WHERE db_name = '${db}'`,
      )
    }
    await root?.query(`DROP USER IF EXISTS '${PMA_USER}'@'%'; DROP USER IF EXISTS '${BMA_USER}'@'%'`)
    await root?.end()
    await log?.close()
    await bma?.close()
  })

  for (const c of CASES) it(c.name, () => runCase(c))

  it('the page shows the same constraints, choices and dropdown values [p04-9bf7e7]', async () => {
    for (const db of [DB_PMA, DB_BMA]) {
      await root.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`)
    }
    const pairs = await pmaForm('child')
    const r = await bmaRows('child')
    const pmaRow0 = {
      constraintName: pairs.find(([k]) => k === 'constraint_name[0]')?.[1],
      onDelete: pairs.find(([k]) => k === 'on_delete[0]')?.[1],
      onUpdate: pairs.find(([k]) => k === 'on_update[0]')?.[1],
      columns: pairs.filter(([k]) => k === 'foreign_key_fields_name[0][]').map(([, v]) => v),
      refDb: normalise(pairs.find(([k]) => k === 'destination_foreign_db[0]')?.[1] ?? '', dbMap),
      refTable: pairs.find(([k]) => k === 'destination_foreign_table[0]')?.[1],
      refColumns: pairs.filter(([k]) => k === 'destination_foreign_column[0][]').map(([, v]) => v),
    }
    expect({ ...r.foreignKeys[0], refDb: normalise(r.foreignKeys[0]?.refDb ?? '', dbMap) }).toEqual(pmaRow0)
    const dd = await pma.postJson('/table/relation', {
      db: DB_PMA,
      table: 'child',
      getDropdownValues: 'true',
      foreignDb: DB_PMA,
      foreignTable: 't',
    })
    const b = await bma.req('GET', `${bmaBase('child')}/dropdown?foreignDb=${DB_BMA}&foreignTable=t`)
    expect(b.json.columns).toEqual(dd.columns)
    expect(b.json.primary).toEqual(dd.primary)
  })
})
