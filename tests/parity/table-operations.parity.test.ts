import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { compareWrites, normalise } from './lib/compare.ts'
import { type Pairs, findForm, getPair, removePair, serializeForm, setPair } from './lib/form.ts'
import { GeneralLog } from './lib/general-log.ts'
import { decodeEntities } from './lib/nav-html.ts'
import { PmaClient, type PmaJson, visibleText } from './lib/pma.ts'

/**
 * Golden parity of the table Operations tab (docs/features/04-table-level.md#operations-tab):
 * every form is scraped from phpMyAdmin's own page and posted the way its JS does; BetterMyAdmin
 * gets the same values through its API. The write statements of both accounts in MySQL's general
 * log must be identical, and so must the resulting tables.
 */
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const PMA_USER = 'f04ops_pma'
const BMA_USER = 'f04ops_bma'
const P = { db: 'f04ops_pdb', db2: 'f04ops_pdb2' }
const B = { db: 'f04ops_bdb', db2: 'f04ops_bdb2' }
// longer names first: f04ops_pdb is a prefix of f04ops_pdb2
const dbMap = {
  [P.db2]: 'DB2',
  [B.db2]: 'DB2',
  [P.db]: 'DB',
  [B.db]: 'DB',
  [PMA_USER]: 'USER',
  [BMA_USER]: 'USER',
}

const reachable = await fetch(`${PMA_URL}/index.php`)
  .then((r) => r.ok)
  .catch(() => false)

const SEED = `
  CREATE TABLE t (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(20) COLLATE utf8mb4_unicode_ci,
    qty INT,
    gen INT AS (qty * 2) VIRTUAL,
    PRIMARY KEY (id), KEY k_qty (qty), FULLTEXT KEY ft (name)
  ) ENGINE=InnoDB AUTO_INCREMENT=10 COMMENT 'tc';
  INSERT INTO t (name, qty) VALUES ('a', 1), ('b', 2);
  CREATE TABLE child (id INT NOT NULL, t_id INT, PRIMARY KEY (id),
    CONSTRAINT fk_t FOREIGN KEY (t_id) REFERENCES t (id) ON DELETE CASCADE) ENGINE=InnoDB;
  INSERT INTO child VALUES (1, 10);
  CREATE TABLE m (a INT NOT NULL AUTO_INCREMENT, b VARCHAR(10), PRIMARY KEY (a)) ENGINE=MyISAM;
  INSERT INTO m (b) VALUES ('x');
  CREATE TABLE nopk (a INT, b INT) ENGINE=InnoDB;
  CREATE TABLE h (id INT) PARTITION BY HASH (id) PARTITIONS 3;
  CREATE TABLE r (id INT) PARTITION BY RANGE (id) (PARTITION p0 VALUES LESS THAN (10), PARTITION p1 VALUES LESS THAN MAXVALUE);
  CREATE VIEW v AS SELECT id FROM t;
  CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW SET NEW.qty = 1;
`

let log: GeneralLog
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let root: mysql.Connection

const bmaPath = (db: string, table: string, path: string) =>
  `/api/servers/1/databases/${db}/tables/${encodeURIComponent(table)}/operations${path}`
async function bmaPost(table: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await bma.req('POST', bmaPath(B.db, table, path), body)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}
async function bmaPage(table: string): Promise<Record<string, unknown>> {
  const r = await bma.req('GET', bmaPath(B.db, table, ''))
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}

/** A form of phpMyAdmin's Operations page, serialised like jQuery's $form.serialize(). */
async function pmaForm(table: string, id: string, route = '/table/operations'): Promise<Pairs> {
  const html = await pma.routePage(route, { db: P.db, table })
  return serializeForm(findForm(html, { id }))
}

/** The data-post parameters of a link of the Operations page. */
async function pmaLinkParams(table: string, find: RegExp, route = '/table/operations'): Promise<Pairs> {
  const html = await pma.routePage(route, { db: P.db, table })
  const m = find.exec(html)
  if (m === null) throw new Error(`link ${find} not found`)
  const post = /data-post="([^"]*)"/.exec(m[0])?.[1] ?? ''
  return [...new URLSearchParams(decodeEntities(post))]
}

async function showCreate(db: string, table: string): Promise<string | null> {
  try {
    const [rows] = await root.query({ sql: `SHOW CREATE TABLE \`${db}\`.\`${table}\``, rowsAsArray: true })
    return String((rows as unknown[][])[0]?.[1] ?? '').replace(/ AUTO_INCREMENT=\d+/, ' AUTO_INCREMENT=N')
  } catch {
    return null
  }
}

async function rows(db: string, table: string): Promise<unknown[] | null> {
  try {
    const [r] = await root.query(`SELECT * FROM \`${db}\`.\`${table}\``)
    return r as unknown[]
  } catch {
    return null
  }
}

interface Case {
  name: string
  /** [db key, table] whose structure and rows must match afterwards */
  tables: Array<['db' | 'db2', string]>
  pma: () => Promise<unknown>
  bma: () => Promise<unknown>
  check?: (pma: unknown, bma: unknown) => void
}

async function reset() {
  for (const x of [P, B]) {
    await root.query(
      `DROP DATABASE IF EXISTS \`${x.db}\`; DROP DATABASE IF EXISTS \`${x.db2}\`;
       CREATE DATABASE \`${x.db}\`; CREATE DATABASE \`${x.db2}\`; USE \`${x.db}\`; ${SEED}`,
    )
  }
  await root.query('USE mysql')
}

async function runCase(c: Case): Promise<void> {
  await reset()
  const m1 = await log.marker()
  const pr = await c.pma()
  const pmaLog = await log.since(PMA_USER, m1)
  const m2 = await log.marker()
  const br = await c.bma()
  const bmaLog = await log.since(BMA_USER, m2)
  const cmp = compareWrites(pmaLog, bmaLog, dbMap)
  expect(cmp.bma, `writes of ${c.name}`).toEqual(cmp.pma)
  for (const [k, table] of c.tables) {
    const a = await showCreate(P[k], table)
    const b = await showCreate(B[k], table)
    expect(b === null ? null : normalise(b, dbMap), `SHOW CREATE TABLE ${table}`).toBe(
      a === null ? null : normalise(a, dbMap),
    )
    expect(await rows(B[k], table), `rows of ${table}`).toEqual(await rows(P[k], table))
  }
  c.check?.(pr, br)
}

const pmaText = (j: PmaJson | string) =>
  normalise(visibleText(typeof j === 'string' ? j : String(j.message ?? j.error ?? '')), dbMap)
const bmaText = (j: unknown) =>
  normalise(
    ((j as { messages?: Array<{ text: string }> }).messages ?? []).map((m) => m.text).join(' '),
    dbMap,
  )

/** The Table options form of phpMyAdmin with modifications, posted like the page JS does. */
async function pmaOptions(table: string, mods: Array<[string, string | null]>, ajax: boolean) {
  let pairs = await pmaForm(table, 'tableOptionsForm')
  for (const [k, v] of mods) pairs = v === null ? removePair(pairs, k) : setPair(pairs, k, v)
  return ajax
    ? pma.postJson('/table/operations', pairs)
    : pma.post('/table/operations', pairs, { ajax: false })
}

/** The same form built from BetterMyAdmin's page payload (what the UI posts). */
async function bmaOptions(table: string, mods: Record<string, unknown>) {
  const p = (await bmaPage(table)) as Record<string, string | boolean>
  const req: Record<string, unknown> = {
    newName: table,
    adjustPrivileges: p.hasPrivileges,
    comment: p.comment,
    prevComment: p.comment,
    engine: (p.storageEngines as unknown as Array<{ name: string }>).find(
      (e) => e.name.toLowerCase() === String(p.storageEngine).toLowerCase(),
    )?.name,
    collation: p.collation,
    changeAllCollations: false,
  }
  if (p.hasPackKeys) req.packKeys = p.packKeys
  if (p.hasChecksumAndDelayKeyWrite) {
    req.checksum = p.checksum === '1'
    req.delayKeyWrite = p.delayKeyWrite === '1'
  }
  if (p.hasTransactionalAndPageChecksum) {
    req.transactional = p.transactional === '1'
    req.pageChecksum = p.pageChecksum === '1'
  }
  if (p.hasAutoIncrement) {
    req.autoIncrement = p.autoIncrement
    req.hiddenAutoIncrement = p.autoIncrement
  }
  const formats = p.rowFormats as unknown as string[]
  if (formats.length > 0) {
    req.rowFormat = formats.find((f) => f === String(p.rowFormatCurrent).toUpperCase()) ?? formats[0]
  }
  return bmaPost(table, '/options', { ...req, ...mods })
}

const CASES: Case[] = [
  {
    name: 'alter table order by (descending)',
    tables: [['db', 'nopk']],
    pma: async () => {
      const pairs = setPair(
        setPair(await pmaForm('nopk', 'alterTableOrderby'), 'order_field', 'b'),
        'order_order',
        'desc',
      )
      return pma.post('/table/operations', pairs, { ajax: false })
    },
    bma: () => bmaPost('nopk', '/order-by', { field: 'b', order: 'desc' }),
  },
  {
    name: 'move (rename) within the database, privileges adjusted, with a trigger',
    tables: [
      ['db', 't'],
      ['db', 't2'],
    ],
    pma: async () => {
      const pairs = setPair(await pmaForm('t', 'moveTableForm'), 'new_name', 't2')
      return pma.postJson('/table/operations', [...pairs, ['submit_move', '1']])
    },
    bma: () =>
      bmaPost('t', '/move-copy', { op: 'move', newName: 't2', targetDb: B.db, adjustPrivileges: true }),
    check: (p, b) => expect(bmaText(b)).toBe(pmaText(p as PmaJson)),
  },
  {
    name: 'move to another database (triggers dropped first)',
    tables: [
      ['db', 't'],
      ['db2', 't'],
    ],
    pma: async () => {
      const pairs = removePair(
        setPair(await pmaForm('t', 'moveTableForm'), 'target_db', P.db2),
        'adjust_privileges',
      )
      return pma.postJson('/table/operations', [...pairs, ['submit_move', '1']])
    },
    bma: () => bmaPost('t', '/move-copy', { op: 'move', newName: 't', targetDb: B.db2 }),
  },
  {
    name: 'copy structure and data with AUTO_INCREMENT value (indexes, fulltext, generated column)',
    tables: [['db', 'tc']],
    pma: async () => {
      let pairs = setPair(await pmaForm('t', 'copyTable'), 'new_name', 'tc')
      pairs = removePair(pairs, 'adjust_privileges')
      pairs = [...pairs, ['sql_auto_increment', '1']]
      return pma.postJson('/table/operations', [...pairs, ['submit_copy', 'Go']])
    },
    bma: () => bmaPost('t', '/move-copy', { op: 'copy', newName: 'tc', targetDb: B.db, autoIncrement: true }),
    check: (p, b) => expect(bmaText(b)).toBe(pmaText(p as PmaJson)),
  },
  {
    name: 'copy structure only of a table with a foreign key, privileges adjusted',
    tables: [['db2', 'child']],
    pma: async () => {
      let pairs = setPair(await pmaForm('child', 'copyTable'), 'target_db', P.db2)
      pairs = setPair(pairs, 'what', 'structure')
      return pma.postJson('/table/operations', [...pairs, ['submit_copy', 'Go']])
    },
    bma: () =>
      bmaPost('child', '/move-copy', {
        op: 'copy',
        newName: 'child',
        targetDb: B.db2,
        what: 'structure',
        addConstraints: true,
        adjustPrivileges: true,
      }),
  },
  {
    name: 'copy data only into an existing table, with DROP TABLE first',
    tables: [['db', 'nopk']],
    pma: async () => {
      let pairs = setPair(await pmaForm('t', 'copyTable'), 'new_name', 'nopk')
      pairs = removePair(setPair(pairs, 'what', 'data'), 'adjust_privileges')
      pairs = [...pairs, ['drop_if_exists', 'true']]
      return pma.postJson('/table/operations', [...pairs, ['submit_copy', 'Go']])
    },
    bma: () =>
      bmaPost('t', '/move-copy', { op: 'copy', newName: 'nopk', targetDb: B.db, dropIfExists: true }),
  },
  {
    name: 'copy to the same table is refused',
    tables: [['db', 't']],
    pma: async () => {
      const pairs = await pmaForm('t', 'copyTable')
      return pma.postJson('/table/operations', [...pairs, ['submit_copy', 'Go']])
    },
    bma: () => bmaPost('t', '/move-copy', { op: 'copy', newName: 't', targetDb: B.db }),
    check: (p, b) => expect(pmaText(p as PmaJson)).toContain(bmaText(b)),
  },
  {
    name: 'table options: comment, collation and AUTO_INCREMENT (InnoDB)',
    tables: [['db', 't']],
    pma: () =>
      pmaOptions(
        't',
        [
          ['comment', "it's new"],
          ['tbl_collation', 'utf8mb4_bin'],
          ['new_auto_increment', '50'],
        ],
        false,
      ),
    bma: () => bmaOptions('t', { comment: "it's new", collation: 'utf8mb4_bin', autoIncrement: '50' }),
  },
  {
    name: 'table options: engine change to MyISAM and ROW_FORMAT',
    tables: [['db', 'nopk']],
    pma: () =>
      pmaOptions(
        'nopk',
        [
          ['new_tbl_storage_engine', 'MyISAM'],
          ['new_row_format', 'COMPACT'],
        ],
        false,
      ),
    bma: () => bmaOptions('nopk', { engine: 'MyISAM', rowFormat: 'COMPACT' }),
  },
  {
    name: 'table options (MyISAM): PACK_KEYS, CHECKSUM, DELAY_KEY_WRITE, ROW_FORMAT',
    tables: [['db', 'm']],
    pma: () =>
      pmaOptions(
        'm',
        [
          ['new_pack_keys', '1'],
          ['new_checksum', '1'],
          ['new_delay_key_write', '1'],
          ['new_row_format', 'FIXED'],
        ],
        false,
      ),
    bma: () => bmaOptions('m', { packKeys: '1', checksum: true, delayKeyWrite: true, rowFormat: 'FIXED' }),
  },
  {
    name: 'table options: rename and change all column collations (AJAX)',
    tables: [
      ['db', 't'],
      ['db', 'tr'],
    ],
    pma: () =>
      pmaOptions(
        't',
        [
          ['new_name', 'tr'],
          ['tbl_collation', 'latin1_swedish_ci'],
          ['change_all_collations', '1'],
        ],
        true,
      ),
    bma: () => bmaOptions('t', { newName: 'tr', collation: 'latin1_swedish_ci', changeAllCollations: true }),
  },
  ...(['analyze', 'check', 'checksum', 'optimize'] as const).map(
    (op): Case => ({
      name: `maintenance: ${op}`,
      tables: [['db', 't']],
      pma: async () =>
        pma.post(
          `/table/maintenance/${op}`,
          await pmaLinkParams('t', new RegExp(`<a href="[^"]*maintenance/${op}[^>]*>`)),
          {
            ajax: false,
          },
        ),
      bma: () => bmaPost('t', '/maintenance', { op }),
    }),
  ),
  {
    name: 'maintenance: repair (MyISAM)',
    tables: [['db', 'm']],
    pma: async () =>
      pma.post(
        '/table/maintenance/repair',
        await pmaLinkParams('m', /<a href="[^"]*maintenance\/repair[^>]*>/),
        {
          ajax: false,
        },
      ),
    bma: () => bmaPost('m', '/maintenance', { op: 'repair' }),
  },
  {
    name: 'defragment (via /sql)',
    tables: [['db', 'nopk']],
    pma: async () =>
      pma.postJson('/sql', [
        ['ajax_request', '1'],
        ...(await pmaLinkParams('nopk', /<a class="maintain_action ajax"[^>]*ENGINE[^>]*>/)),
      ]),
    bma: () => bmaPost('nopk', '/sql', { action: 'defragment' }),
  },
  {
    name: 'flush (via /sql)',
    tables: [['db', 'nopk']],
    pma: async () =>
      pma.postJson('/sql', [
        ['ajax_request', '1'],
        ...(await pmaLinkParams('nopk', /<a class="maintain_action ajax"[^>]*FLUSH[^>]*>/)),
      ]),
    bma: () => bmaPost('nopk', '/sql', { action: 'flush' }),
  },
  ...(
    [
      ['truncate', 'truncate_tbl_anchor', true],
      ['delete', 'delete_tbl_anchor', true],
      ['drop', 'drop_tbl_anchor', false],
    ] as const
  ).map(
    ([action, id, fk]): Case => ({
      name: `${action} with foreign key checks ${fk ? 'on' : 'off'} (via /sql)`,
      tables: [['db', 'child']],
      pma: async () =>
        pma.postJson('/sql', [
          ...(await pmaLinkParams('child', new RegExp(`<a[^>]*id="${id}"[^>]*>`))),
          ['is_js_confirmed', '1'],
          ['ajax_request', 'true'],
          ['fk_checks', fk ? '1' : '0'],
        ]),
      bma: () => bmaPost('child', '/sql', { action, fkChecks: fk }),
    }),
  ),
  {
    name: 'partition maintenance: analyze two partitions',
    tables: [['db', 'r']],
    pma: async () => {
      const pairs = await pmaForm('r', 'partitionsForm')
      return pma.postJson('/table/operations', [
        ...removePair(pairs, 'partition_name[]'),
        ['partition_name[]', 'p0'],
        ['partition_name[]', 'p1'],
        ['ajax_page_request', 'true'],
      ])
    },
    bma: () => bmaPost('r', '/partitions', { operation: 'ANALYZE', partitions: ['p0', 'p1'] }),
  },
  {
    name: 'partition maintenance: coalesce (HASH)',
    tables: [['db', 'h']],
    pma: async () => {
      const pairs = setPair(await pmaForm('h', 'partitionsForm'), 'partition_operation', 'COALESCE')
      return pma.postJson('/table/operations', [...pairs, ['ajax_page_request', 'true']])
    },
    bma: () => bmaPost('h', '/partitions', { operation: 'COALESCE', partitions: ['p0'] }),
  },
  {
    name: 'view: rename',
    tables: [['db', 'v2']],
    pma: async () => {
      const html = await pma.routePage('/view/operations', { db: P.db, table: 'v' })
      const pairs = setPair(serializeForm(findForm(html, { action: '/view/operations' })), 'new_name', 'v2')
      return pma.post('/view/operations', pairs, { ajax: false })
    },
    bma: () => bmaPost('v', '/rename-view', { newName: 'v2' }),
  },
  {
    name: 'view: drop (via /sql, no foreign key checkbox)',
    tables: [['db', 'v']],
    pma: async () =>
      pma.postJson('/sql', [
        ...(await pmaLinkParams('v', /<a[^>]*id="drop_view_anchor"[^>]*>/, '/view/operations')),
        ['is_js_confirmed', '1'],
        ['ajax_request', 'true'],
        ['fk_checks', '0'],
      ]),
    bma: () => bmaPost('v', '/sql', { action: 'dropView', fkChecks: false }),
  },
]

describe.skipIf(!reachable)('parity: table Operations (phpMyAdmin forms vs BetterMyAdmin API)', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    for (const u of [PMA_USER, BMA_USER]) {
      await root.query(
        `DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON *.* TO '${u}'@'%'`,
      )
    }
    log = await GeneralLog.open(ROOT)
    pma = new PmaClient(PMA_URL)
    await pma.login(PMA_USER, PMA_USER)
    // the reference phpMyAdmin writes its configuration storage through the control user
    bma = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }))
    await bma.login(BMA_USER, BMA_USER)
  })

  afterAll(async () => {
    for (const x of [P, B])
      await root?.query(`DROP DATABASE IF EXISTS ${x.db}; DROP DATABASE IF EXISTS ${x.db2}`)
    await root?.query(`DROP USER IF EXISTS '${PMA_USER}'@'%'; DROP USER IF EXISTS '${BMA_USER}'@'%'`)
    await root?.end()
    await log?.close()
    await bma?.close()
  })

  for (const c of CASES) it(c.name, () => runCase(c))

  it('the page offers the same controls and values', async () => {
    await reset()
    for (const table of ['t', 'm', 'h', 'child']) {
      const html = await pma.routePage('/table/operations', { db: P.db, table })
      const b = (await bmaPage(table)) as Record<string, unknown>
      const opts = serializeForm(findForm(html, { id: 'tableOptionsForm' }))
      expect(b.comment, table).toBe(getPair(opts, 'comment'))
      expect(b.collation, table).toBe(getPair(opts, 'tbl_collation'))
      expect(b.hasAutoIncrement ? b.autoIncrement : undefined, table).toBe(
        getPair(opts, 'new_auto_increment'),
      )
      expect(b.hasPackKeys ? b.packKeys : undefined, table).toBe(getPair(opts, 'new_pack_keys'))
      expect(b.hideOrderTable, table).toBe(!html.includes('id="alterTableOrderby"'))
      expect(b.hasForeignKeys, table).toBe(html.includes('id="checkbox_constraints"'))
      const rowFormats = [
        ...html.matchAll(/<select class="form-select" id="new_row_format"[\s\S]*?<\/select>/g),
      ].flatMap((m) => [...m[0].matchAll(/<option value="([^"]+)"/g)].map((x) => x[1]))
      expect(b.rowFormats, table).toEqual(rowFormats)
      const choices = [...html.matchAll(/name="partition_operation" id="[^"]+" value="([^"]+)"/g)].map(
        (x) => x[1],
      )
      expect(
        (b.partitionChoices as Array<{ value: string }>).map((c) => c.value),
        table,
      ).toEqual(choices)
      const maint = [
        ...html.matchAll(/<ul class="list-group list-group-flush" id="tbl_maintenance">([\s\S]*?)<\/ul>/g),
      ]
      const links = [...(maint[0]?.[1] ?? '').matchAll(/<a [^>]*>\s*([^<]+?)\s*<\/a>/g)].map((x) => x[1])
      expect(maintenanceLinks(String(b.storageEngine)), table).toEqual(links)
    }
  })
})

/** The web page's maintenance list (OperationsPage.tsx) for an engine. */
function maintenanceLinks(engine: string): string[] {
  const four = ['MYISAM', 'ARIA', 'INNODB', 'TOKUDB'].includes(engine)
  return [
    ...(four ? ['Analyze table', 'Check table'] : []),
    'Checksum table',
    ...(engine === 'INNODB' ? ['Defragment table'] : []),
    'Flush the table (FLUSH)',
    ...(four ? ['Optimize table'] : []),
    ...(['MYISAM', 'ARIA'].includes(engine) ? ['Repair table'] : []),
  ]
}
