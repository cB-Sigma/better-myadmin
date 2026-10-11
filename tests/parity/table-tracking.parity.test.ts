import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { compareWrites, normalise } from './lib/compare.ts'
import { type Pairs, findForm, serializeForm, setPair } from './lib/form.ts'
import { GeneralLog } from './lib/general-log.ts'
import { decodeEntities } from './lib/nav-html.ts'
import { PmaClient } from './lib/pma.ts'
import { pmaReachable } from './lib/server-setup.ts'

/**
 * Golden parity of the table Tracking tab (docs/features/04-table-level.md#tracking): create a
 * version (snapshot + DROP/CREATE log), delete versions, (de)activate, delete report entries,
 * the SQL execution export; then the report rows, both dumps and the structure snapshot read back.
 * The configuration-storage writes (control user `pma`) are compared on the statements naming
 * this suite's databases, with the clock's dates masked.
 */
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const PMA_USER = 'f04trk_pma'
const BMA_USER = 'f04trk_bma'
const DB_PMA = 'f04trk_pdb'
const DB_BMA = 'f04trk_bdb'
const dbMap = { [DB_PMA]: 'DB', [DB_BMA]: 'DB', [PMA_USER]: 'USER', [BMA_USER]: 'USER' }
const DATE = /\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\+\d\d:\d\d)?/g
const mask = (s: string) => s.replace(DATE, 'DATE')

const SEED = `
  CREATE TABLE t (id INT NOT NULL AUTO_INCREMENT, code VARCHAR(10) NOT NULL DEFAULT 'x' COMMENT 'the "code"',
    n BIT(3) DEFAULT b'101', PRIMARY KEY (id), UNIQUE KEY uq (code, n)) ENGINE=InnoDB AUTO_INCREMENT=5;
`

let log: GeneralLog
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let root: mysql.Connection

const trk = (db: string, user: string, version: string, active: number, set = 'UPDATE,INSERT,DELETE') => {
  const schema = [
    `# log 2024-01-01 10:00:00 ${user}\nDROP TABLE IF EXISTS \`t\`;\n`,
    `# log 2024-01-01 10:00:00 ${user}\nCREATE TABLE \`t\` (\n  \`id\` int NOT NULL,\n  \`code\` varchar(10) NOT NULL\n) ENGINE=InnoDB;\n`,
    `# log 2024-01-02 11:00:00 ${user}\nALTER TABLE \`t\` ADD PRIMARY KEY (\`id\`);\n`,
  ].join('')
  const data = [
    '\n',
    `# log 2024-01-03 12:00:00 ${user}\nINSERT INTO \`t\` (\`id\`, \`code\`) VALUES (1, 'a');\n`,
    `# log 2024-01-04 12:00:00 other\nINSERT INTO \`t\` (\`id\`, \`code\`) VALUES (2, 'b');\n`,
    `# log 2024-01-05 09:30:00 ${user}\nUPDATE \`t\` SET \`code\` = 'c' WHERE \`id\` = 1;\n`,
  ].join('')
  const snapshot =
    'a:2:{s:7:"COLUMNS";a:1:{i:0;a:8:{s:5:"Field";s:2:"id";s:4:"Type";s:3:"int";s:9:"Collation";N;s:4:"Null";s:2:"NO";s:3:"Key";s:3:"PRI";s:7:"Default";N;s:5:"Extra";s:0:"";s:7:"Comment";s:0:"";}}s:7:"INDEXES";a:1:{i:0;a:3:{s:8:"Key_name";s:7:"PRIMARY";s:10:"Non_unique";s:1:"0";s:11:"Column_name";s:2:"id";}}}'
  return root.query(
    'INSERT INTO phpmyadmin.pma__tracking (db_name, table_name, version, date_created, date_updated, schema_snapshot, schema_sql, data_sql, tracking, tracking_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [db, 't', version, '2024-01-01 10:00:00', '2024-01-05 09:30:00', snapshot, schema, data, set, active],
  )
}

const ours = (s: string) =>
  s.includes('f04trk_') && !s.startsWith('/*NOTRACK*/ SELECT') && !s.includes('`pma__recent`')

interface Case {
  name: string
  /** seed versions: [version, active] */
  versions?: Array<[string, number]>
  pma: () => Promise<unknown>
  bma: () => Promise<unknown>
}

const bmaBase = `/api/servers/1/databases/${DB_BMA}/tables/t/tracking`
async function bmaPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await bma.req('POST', `${bmaBase}${path}`, body)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}
const pmaPost = (pairs: Record<string, string> | Pairs) =>
  pma.post('/table/tracking', Array.isArray(pairs) ? pairs : { db: DB_PMA, table: 't', ...pairs }, {
    ajax: false,
  })

async function seed(versions: Array<[string, number]>) {
  for (const [db, user] of [
    [DB_PMA, PMA_USER],
    [DB_BMA, BMA_USER],
  ] as const) {
    await root.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`)
    await root.query('DELETE FROM phpmyadmin.pma__tracking WHERE db_name = ?', [db])
    for (const [v, a] of versions) await trk(db, user, v, a)
  }
  await root.query('USE mysql')
}

async function runCase(c: Case) {
  await seed(c.versions ?? [])
  const m1 = await log.marker()
  await c.pma()
  const pmaLog = await log.since(PMA_USER, m1)
  const pmaCtl = (await log.since('pma', m1)).filter((e) => ours(e.sql))
  const m2 = await log.marker()
  await c.bma()
  const bmaLog = await log.since(BMA_USER, m2)
  const bmaCtl = (await log.since('pma', m2)).filter((e) => ours(e.sql))
  const cmp = compareWrites(pmaLog, bmaLog, dbMap)
  expect(cmp.bma, `writes of ${c.name}`).toEqual(cmp.pma)
  const ctl = compareWrites(pmaCtl, bmaCtl, dbMap)
  expect(ctl.bma.map(mask), `control-user writes of ${c.name}`).toEqual(ctl.pma.map(mask))
  const rows = async (db: string) => {
    const [r] = await root.query(
      'SELECT version, schema_snapshot, schema_sql, data_sql, tracking, tracking_active FROM phpmyadmin.pma__tracking WHERE db_name = ? ORDER BY version',
      [db],
    )
    return mask(normalise(JSON.stringify(r), dbMap))
  }
  expect(await rows(DB_BMA)).toBe(await rows(DB_PMA))
}

/** the "Create version" form of the page, as the browser posts it */
async function pmaCreateForm(): Promise<Pairs> {
  const html = await pma.routePage('/table/tracking', { db: DB_PMA, table: 't' })
  // the action URL carries db + table (url_params); the hidden inputs only db and selected[]
  // (the navigation settings form is also .disableAjax: start at the create_tracking_version form)
  const at = html.lastIndexOf('<form', html.indexOf('name="submit_create_version"'))
  return [...serializeForm(findForm(html.slice(at), { cls: 'disableAjax' })), ['table', 't']]
}
async function bmaDefaultStatements(): Promise<string[]> {
  const r = await bma.req('GET', bmaBase)
  const page = r.json as { defaultStatements: string; type: string }
  const all = ['ALTER TABLE', 'RENAME TABLE', 'CREATE TABLE', 'DROP TABLE', 'CREATE INDEX', 'DROP INDEX']
  return [...all, 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'].filter((s) => page.defaultStatements.includes(s))
}

const CASES: Case[] = [
  {
    name: 'create version 1 with the default statements (snapshot, DROP + CREATE log)',
    pma: async () => pmaPost(await pmaCreateForm()),
    bma: async () => bmaPost('/versions', { version: '1', statements: await bmaDefaultStatements() }),
  },
  {
    name: 'create version 2 with some statements unchecked (deactivates version 1)',
    versions: [['1', 1]],
    pma: async () => {
      const pairs = (await pmaCreateForm()).filter(([k]) => !['drop_table', 'insert', 'truncate'].includes(k))
      return pmaPost(pairs)
    },
    bma: async () =>
      bmaPost('/versions', {
        version: '2',
        statements: (await bmaDefaultStatements()).filter(
          (s) => !['DROP TABLE', 'INSERT', 'TRUNCATE'].includes(s),
        ),
      }),
  },
  {
    name: 'deactivate tracking',
    versions: [['1', 1]],
    pma: () => pmaPost({ version: '1', toggle_activation: 'deactivate_now' }),
    bma: () => bmaPost('/toggle', { version: '1', action: 'deactivate' }),
  },
  {
    name: 'activate tracking',
    versions: [['1', 0]],
    pma: () => pmaPost({ version: '1', toggle_activation: 'activate_now' }),
    bma: () => bmaPost('/toggle', { version: '1', action: 'activate' }),
  },
  {
    name: 'delete a version from its row',
    versions: [
      ['1', 0],
      ['2', 1],
    ],
    pma: () => pmaPost({ version: '2', submit_delete_version: '1' }),
    bma: () => bmaPost('/versions/delete', { versions: ['2'], multiple: false }),
  },
  {
    name: 'delete the checked versions',
    versions: [
      ['1', 0],
      ['2', 0],
      ['3', 1],
    ],
    pma: () =>
      pmaPost([
        ['db', DB_PMA],
        ['table', 't'],
        ['selected_versions[]', '3'],
        ['selected_versions[]', '1'],
        ['submit_mult', 'delete_version'],
      ]),
    bma: () => bmaPost('/versions/delete', { versions: ['3', '1'], multiple: true }),
  },
  {
    name: 'delete a data definition entry from the report',
    versions: [['1', 1]],
    pma: () => pmaPost({ version: '1', report: 'true', delete_ddlog: '1' }),
    bma: () => bmaPost('/report', { version: '1', deleteDdlog: 1 }),
  },
  {
    name: 'delete a data manipulation entry from the report',
    versions: [['1', 1]],
    pma: () => pmaPost({ version: '1', report: 'true', delete_dmlog: '2' }),
    bma: () => bmaPost('/report', { version: '1', deleteDmlog: 2 }),
  },
  {
    name: 'export as SQL execution (structure and data of one user, from a date)',
    versions: [['1', 1]],
    pma: () =>
      pmaPost({
        version: '1',
        report: 'true',
        log_type: 'schema_and_data',
        date_from: '2024-01-01 10:00:00',
        date_to: '2024-01-04 23:00:00',
        users: PMA_USER,
        export_type: 'execution',
      }),
    bma: () =>
      bmaPost('/report', {
        version: '1',
        logType: 'schema_and_data',
        dateFrom: '2024-01-01 10:00:00',
        dateTo: '2024-01-04 23:00:00',
        users: BMA_USER,
        exportType: 'execution',
      }),
  },
]

/** the rows of a report table of phpMyAdmin: [#, date, user, statement text] */
function pmaReportRows(html: string, id: string): string[][] | null {
  const t = new RegExp(`<table id="${id}"[\\s\\S]*?</table>`).exec(html)
  if (t === null) return null
  return [...t[0].matchAll(/<tr class="noclick">([\s\S]*?)<\/tr>/g)].map((r) =>
    [...(r[1] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .slice(0, 4)
      .map((c) => normalise(decodeEntities((c[1] ?? '').replace(/<[^>]+>/g, '')), dbMap)),
  )
}
const bmaReportRows = (entries: unknown) =>
  entries === null
    ? null
    : (entries as Array<{ lineNumber: number; date: string; username: string; statement: string }>).map(
        (e) => [String(e.lineNumber), e.date, normalise(e.username, dbMap), normalise(e.statement, dbMap)],
      )

describe.skipIf(!pmaReachable)('parity: table Tracking (phpMyAdmin forms vs BetterMyAdmin API)', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    for (const u of [PMA_USER, BMA_USER]) {
      await root.query(
        `DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON \`f04trk\\_%\`.* TO '${u}'@'%'`,
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
      await root?.query(`DROP DATABASE IF EXISTS ${db}`)
      await root?.query('DELETE FROM phpmyadmin.pma__tracking WHERE db_name = ?', [db])
    }
    await root?.query(`DROP USER IF EXISTS '${PMA_USER}'@'%'; DROP USER IF EXISTS '${BMA_USER}'@'%'`)
    await root?.end()
    await log?.close()
    await bma?.close()
  })

  for (const c of CASES) it(c.name, () => runCase(c))

  it('the page lists the same versions and tracked tables', async () => {
    await seed([
      ['1', 0],
      ['2', 1],
    ])
    const html = await pma.routePage('/table/tracking', { db: DB_PMA, table: 't' })
    const b = (await bma.req('GET', bmaBase)).json as {
      versions: Array<{ version: string; active: boolean }>
      lastVersion: number
      activeMessage: boolean
      trackedTables: Array<{ name: string; active: boolean }>
    }
    const versions = [...html.matchAll(/id="selected_versions_(\d+)"/g)].map((m) => m[1])
    expect(b.versions.map((v) => v.version)).toEqual(versions)
    expect(b.lastVersion).toBe(2)
    expect(html).toContain('Deactivate tracking for')
    expect(b.versions[0]?.active).toBe(true)
    expect(html.includes('Tracking of')).toBe(b.activeMessage)
    expect(html).toContain('Create version 3 of')
  })

  it('the report shows the same rows for each log type and filter', async () => {
    await seed([['1', 1]])
    const filters: Array<Record<string, string>> = [
      {},
      { log_type: 'schema' },
      { log_type: 'data' },
      {
        log_type: 'data',
        users: `other, ${PMA_USER}`,
        date_from: '2024-01-04 00:00:00',
        date_to: '2024-01-06 00:00:00',
      },
    ]
    for (const f of filters) {
      const html = await pmaPost({ version: '1', report: 'true', ...f })
      const b = await bmaPost('/report', {
        version: '1',
        ...(f.log_type !== undefined ? { logType: f.log_type } : {}),
        ...(f.users !== undefined ? { users: f.users.replace(PMA_USER, BMA_USER) } : {}),
        ...(f.date_from !== undefined ? { dateFrom: f.date_from, dateTo: f.date_to } : {}),
      })
      expect(bmaReportRows(b.ddl), JSON.stringify(f)).toEqual(pmaReportRows(html, 'ddl_versions'))
      expect(bmaReportRows(b.dml), JSON.stringify(f)).toEqual(pmaReportRows(html, 'dml_versions'))
      const dateFrom = /name="date_from" value="([^"]*)"/.exec(html)?.[1]
      expect(b.dateFrom).toBe(dateFrom)
      expect(html).toContain(`Tracking statements ${b.tracking}`)
    }
  })

  it('the SQL dump and the file download hold the same statements', async () => {
    await seed([['1', 1]])
    const form = { version: '1', report: 'true', log_type: 'schema_and_data', users: '*' }
    const html = await pmaPost({ ...form, export_type: 'sqldump' })
    const textarea = /<textarea[^>]*name="sql_query"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? ''
    const b = await bmaPost('/report', { version: '1', exportType: 'sqldump' })
    expect(normalise(String(b.sqlDump), dbMap)).toBe(normalise(decodeEntities(textarea), dbMap))
    expect(html).toContain('SQL statements exported. Please copy the dump or execute it.')

    const file = await pmaPost({ ...form, export_type: 'sqldumpfile' })
    const bf = (await bmaPost('/report', { version: '1', exportType: 'sqldumpfile' })).download as {
      filename: string
      dump: string
    }
    expect(bf.filename).toBe('log_t.sql')
    expect(mask(normalise(bf.dump, dbMap))).toBe(mask(normalise(file, dbMap)))
  })

  it('the structure snapshot shows the same SQL, columns and indexes', async () => {
    await seed([])
    await pmaPost(await pmaCreateForm())
    await bmaPost('/versions', { version: '1', statements: await bmaDefaultStatements() })
    const html = await pmaPost({ version: '1', snapshot: 'true' })
    const b = (await bma.req('GET', `${bmaBase}/snapshot?version=1`)).json as {
      sql: string
      columns: Array<Record<string, string | null>>
      indexes: Array<Record<string, string | null>>
    }
    const code = [...html.matchAll(/<code class="sql"[^>]*>([\s\S]*?)<\/code>/g)]
      .map((m) => decodeEntities((m[1] ?? '').replace(/<[^>]+>/g, '')))
      .join('\n')
    expect(normalise(b.sql, dbMap)).toBe(normalise(code, dbMap))
    const cols = [...html.matchAll(/<table id="tablestructure"[\s\S]*?<\/table>/g)][0]?.[0] ?? ''
    const fields = [...cols.matchAll(/<strong>\s*([^<\s]+)/g)].map((m) => m[1])
    expect(b.columns.map((c) => c.Field)).toEqual(fields)
    const idx = /<table id="tablestructure_indexes"[\s\S]*?<\/table>/.exec(html)?.[0] ?? ''
    const keys = [...idx.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m) => m[1])
    expect(b.indexes.map((i) => i.Key_name)).toEqual(keys)
    expect(b.columns[1]).toMatchObject({ Field: 'code', Default: 'x', Comment: 'the "code"' })
  })
})
