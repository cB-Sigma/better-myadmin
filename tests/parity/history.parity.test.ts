import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { type Pairs, findForm, serializeForm, setPair } from './lib/form.ts'
import { type PmaInstance, phpAvailable, startPmaInstance } from './lib/pma-instance.ts'
import { PmaClient } from './lib/pma.ts'
import { PMA_STORAGE } from './lib/server-setup.ts'

/**
 * The SQL history outside the SQL box (pma: Http/Middleware/StatementHistory, which records
 * Current::$sqlQuery after every request): each action of a private phpMyAdmin (its
 * $_SESSION['sql_history'] dumped after every request) and the same action in BetterMyAdmin, then the
 * newest entry of both histories is compared. Actions phpMyAdmin records nothing for (the index
 * dialog, column changes, maintenance, search, collation, routines…) leave the previous entry, so
 * they are compared too. Only h09_* databases and users are touched.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const P = { user: 'h09_pma', db: 'h09_dp', newUser: 'h09_np' }
const B = { user: 'h09_bma', db: 'h09_db', newUser: 'h09_nb' }
type Side = typeof P
const available = phpAvailable()

// longest names first: h09_dp is a prefix of h09_dp_c
const NAMES: Array<[string, string]> = [
  [`${P.db}_c`, 'DB_c'],
  [`${B.db}_c`, 'DB_c'],
  [`${P.db}_r`, 'DB_r'],
  [`${B.db}_r`, 'DB_r'],
  [P.db, 'DB'],
  [B.db, 'DB'],
  ['h09\\_dp', 'DB_ESC'],
  ['h09\\_db', 'DB_ESC'],
  [P.newUser, 'NEW'],
  [B.newUser, 'NEW'],
  [P.user, 'USER'],
  [B.user, 'USER'],
]
const norm = (v: unknown) =>
  JSON.stringify(v ?? null, (_k, x: unknown) => {
    if (typeof x !== 'string') return x
    let out = x
    for (const [from, to] of NAMES) out = out.replaceAll(from, to)
    return out
  })

const SEED = (
  db: string,
) => `DROP DATABASE IF EXISTS ${db}; DROP DATABASE IF EXISTS ${db}_c; DROP DATABASE IF EXISTS ${db}_r;
  CREATE DATABASE ${db}; CREATE DATABASE ${db}_c; USE ${db};
  CREATE TABLE t (id INT PRIMARY KEY, name VARCHAR(20), KEY k_name (name)) ENGINE=InnoDB;
  INSERT INTO t VALUES (1, 'apple'), (2, 'pear'), (5, 'five'), (6, 'six');
  CREATE TABLE np (id INT, y INT) ENGINE=InnoDB;
  CREATE TABLE m (id INT) ENGINE=MyISAM;
  CREATE TABLE wp_one (id INT) ENGINE=InnoDB;
  CREATE TABLE nopk (a INT, b INT) ENGINE=InnoDB;
  CREATE TABLE h (id INT) ENGINE=InnoDB PARTITION BY HASH(id) PARTITIONS 2;
  CREATE TABLE cp_a (id INT) ENGINE=InnoDB;`

const pmaConfig = () => `$cfg['blowfish_secret'] = 'h09-parity-secret-0123456789abcdefghij';
$i = 1;
$cfg['Servers'][$i]['host'] = ${JSON.stringify(ROOT.host)};
$cfg['Servers'][$i]['port'] = ${JSON.stringify(String(ROOT.port))};
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['Servers'][$i]['controluser'] = '${PMA_STORAGE.controluser}';
$cfg['Servers'][$i]['controlpass'] = '${PMA_STORAGE.controlpass}';
$cfg['Servers'][$i]['pmadb'] = '${PMA_STORAGE.pmadb}';`

let root: mysql.Connection
let inst: PmaInstance
let pma: PmaClient
let bma: ReturnType<typeof testApp>

const sel = (ts: string[]): Pairs => ts.map((t) => ['selected[]', t])
const dbPath = (path: string) => `/api/servers/1/databases/${B.db}${path}`
const post = (path: string, body: unknown) => bma.req('POST', dbPath(path), body)
/** the privileges form as BetterMyAdmin's UI posts it: the same fields, `name[]` keys as lists */
const toBody = (pairs: Pairs) => {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of pairs) {
    if (!k.endsWith('[]')) out[k] = v
    else out[k.slice(0, -2)] = [...((out[k.slice(0, -2)] as string[] | undefined) ?? []), v]
  }
  return out
}
const fields = (s: Side): Pairs => [
  ['field_name[0]', 'z'],
  ['field_type[0]', 'INT'],
  ['field_length[0]', ''],
  ['field_default_type[0]', 'NONE'],
  ['field_default_value[0]', ''],
  ['field_attribute[0]', ''],
  ['field_key[0]', 'none_0'],
  ['field_comments[0]', ''],
  ['field_virtuality[0]', ''],
  ['field_expression[0]', ''],
  ['primary_indexes', '[]'],
  ['unique_indexes', '[]'],
  ['indexes', '[]'],
  ['fulltext_indexes', '[]'],
  ['spatial_indexes', '[]'],
  ['db', s.db],
]
const opsPage = (table: string) => pma.getPage('/table/operations', { db: P.db, table })

interface Step {
  name: string
  pma: () => Promise<unknown>
  bma: () => Promise<unknown>
  /** an intentional difference: what ours records instead of phpMyAdmin's entry (its sqlquery) */
  bmaRecords?: string
}

const STEPS: Step[] = [
  {
    name: 'grid edit: the UPDATE',
    pma: () =>
      pma.postJson('/table/replace', [
        ['db', P.db],
        ['table', 't'],
        ['clause_is_unique', '1'],
        ['where_clause[]', '`t`.`id` = 2'],
        ['fields[multi_edit][0][]', "it's"],
        ['fields_name[multi_edit][0][]', 'name'],
        ['fields_null[multi_edit][0][]', ''],
        ['rel_fields_list', ''],
        ['do_transformations', 'false'],
        ['transform_fields_list', ''],
        ['relational_display', 'K'],
        ['goto', 'index.php%3Froute%3D%2Fsql'],
        ['submit_type', 'save'],
        ['sql_query', 'SELECT * FROM `t`'],
      ]),
    bma: () =>
      bma.req('POST', '/api/servers/1/browse/save', {
        db: B.db,
        table: 't',
        clauseIsUnique: true,
        rows: [{ where: '`t`.`id` = 2', fields: [{ name: 'name', value: "it's", isNull: false }] }],
      }),
  },
  {
    name: 'insert form (Insert tab): the INSERT',
    pma: async () => {
      const html = await pma.getPage('/table/change', { db: P.db, table: 't' })
      let pairs = serializeForm(findForm(html, { id: 'insertForm' }))
      const key = pairs.find(([k]) => k.startsWith('fields[multi_edit][0]'))![0]
      pairs = setPair(pairs, key, '9')
      return pma.postJson('/table/replace', [...pairs, ['ajax_page_request', 'true']])
    },
    bma: () =>
      post('/tables/t/rows', {
        submitType: 'insert',
        rows: [
          {
            fields: [
              { name: 'id', value: '9', type: 'int' },
              { name: 'name', value: '', type: 'varchar(20)', isNull: true },
            ],
          },
        ],
      }),
  },
  {
    // X59: phpMyAdmin records the result query ("Go back"), ours the UPDATE that ran
    name: 'edit form from a result: the UPDATE (X59; phpMyAdmin: the result query)',
    bmaRecords: "UPDATE `t` SET `name` = 'apricot' WHERE `t`.`id` = 1;",
    pma: async () => {
      const html = await pma.postPage('/table/change/rows', [
        ['db', P.db],
        ['table', 't'],
        ['goto', 'index.php?route=/sql'],
        ['default_action', 'update'],
        ['rows_to_delete[]', '`t`.`id` = 1'],
        ['clause_is_unique', '1'],
        ['sql_query', 'SELECT * FROM `t`'],
      ])
      // the same change on both sides: name 'apple' → 'apricot'
      const pairs = serializeForm(findForm(html, { id: 'insertForm' })).map(([k, v]): [string, string] =>
        k.startsWith('fields[multi_edit][0]') && v === 'apple' ? [k, 'apricot'] : [k, v],
      )
      return pma.postJson('/table/replace', [...pairs, ['ajax_page_request', 'true']])
    },
    bma: () =>
      post('/tables/t/rows', {
        clauseIsUnique: true,
        sqlQuery: 'SELECT * FROM `t`',
        rows: [
          {
            whereClause: '`t`.`id` = 1',
            fields: [
              { name: 'id', value: '1', type: 'int', prev: '1' },
              { name: 'name', value: 'apricot', type: 'varchar(20)', prev: 'apple' },
            ],
          },
        ],
      }),
  },
  {
    // X59: phpMyAdmin records the result query shown again, ours the DELETE statements
    name: 'delete rows: the DELETE statements (X59; phpMyAdmin: the result query)',
    bmaRecords: 'DELETE FROM `t` WHERE `t`.`id` = 5 LIMIT 1;\nDELETE FROM `t` WHERE `t`.`id` = 6 LIMIT 1;',
    pma: () =>
      pma.postJson('/table/delete/rows', [
        ['db', P.db],
        ['table', 't'],
        ['selected[]', '`t`.`id` = 5'],
        ['selected[]', '`t`.`id` = 6'],
        ['original_sql_query', 'SELECT * FROM `t`'],
        ['fk_checks', '0'],
        ['fk_checks', '1'],
        ['mult_btn', 'Yes'],
      ]),
    bma: () =>
      bma.req('POST', '/api/servers/1/browse/delete-rows', {
        db: B.db,
        table: 't',
        where: ['`t`.`id` = 5', '`t`.`id` = 6'],
        fkChecks: true,
        originalSql: 'SELECT * FROM `t`',
      }),
  },
  {
    name: 'empty tables',
    pma: () =>
      pma.postJson('/database/structure/empty-table', [
        ['db', P.db],
        ...sel(['m', 'wp_one']),
        ['fk_checks', '1'],
        ['mult_btn', 'Yes'],
      ]),
    bma: () => post('/structure/empty', { tables: ['m', 'wp_one'], fkChecks: true, confirmed: true }),
  },
  {
    name: 'add prefix',
    pma: () =>
      pma.postJson('/database/structure/add-prefix-table', [
        ['db', P.db],
        ...sel(['m']),
        ['add_prefix', 'x_'],
      ]),
    bma: () => post('/structure/add-prefix', { tables: ['m'], prefix: 'x_' }),
  },
  {
    name: 'replace prefix',
    pma: () =>
      pma.postPage('/database/structure/replace-prefix', [
        ['db', P.db],
        ...sel(['wp_one']),
        ['from_prefix', 'wp_'],
        ['to_prefix', 'zz_'],
      ]),
    bma: () => post('/structure/replace-prefix', { tables: ['wp_one'], fromPrefix: 'wp_', toPrefix: 'zz_' }),
  },
  {
    name: 'copy with prefix',
    pma: () =>
      pma.postJson('/database/structure/copy-table-with-prefix', [
        ['db', P.db],
        ...sel(['cp_a']),
        ['from_prefix', 'cp_'],
        ['to_prefix', 'cq_'],
      ]),
    bma: () =>
      post('/structure/copy-with-prefix', {
        tables: ['cp_a'],
        fromPrefix: 'cp_',
        toPrefix: 'cq_',
        dropIfExists: false,
      }),
  },
  {
    name: 'drop tables',
    pma: () =>
      pma.postJson('/database/structure/drop-table', [
        ['db', P.db],
        ...sel(['x_m', 'zz_one']),
        ['fk_checks', '1'],
        ['mult_btn', 'Yes'],
      ]),
    bma: () => post('/structure/drop', { tables: ['x_m', 'zz_one'], fkChecks: true, confirmed: true }),
  },
  {
    name: 'copy table to another database: nothing',
    pma: () =>
      pma.postJson('/database/structure/copy-table', [
        ['db', P.db],
        ...sel(['cp_a']),
        ['target_db', `${P.db}_c`],
        ['what', 'structure'],
      ]),
    bma: () =>
      post('/structure/copy', {
        tables: ['cp_a'],
        targetDb: `${B.db}_c`,
        what: 'structure',
        dropIfExists: false,
        autoIncrement: false,
        addConstraints: false,
        adjustPrivileges: false,
      }),
  },
  {
    name: 'create table',
    pma: () =>
      pma.postJson('/table/create', [
        ...fields(P).map(([k, v]): [string, string] => [k, k === 'field_name[0]' ? 'id' : v]),
        ['table', 'c1'],
        ['orig_num_fields', '1'],
        ['tbl_storage_engine', 'InnoDB'],
        ['do_save_data', '1'],
      ]),
    bma: () => post('/tables', { table: 'c1', columns: [{ name: 'id', type: 'INT' }], engine: 'InnoDB' }),
  },
  {
    name: 'add column',
    pma: () =>
      pma.postJson('/table/add-field', [
        ...fields(P),
        ['table', 'c1'],
        ['field_where', 'last'],
        ['after_field', ''],
        ['orig_num_fields', '1'],
        ['do_save_data', '1'],
      ]),
    bma: () =>
      post('/tables/c1/columns/add', {
        columns: [{ name: 'z', type: 'INT' }],
        where: 'last',
        afterField: '',
      }),
  },
  {
    name: 'index dialog: nothing',
    pma: async () => {
      const f = await pma.postJson('/table/indexes', { db: P.db, table: 't', index: 'k_name' })
      const pairs = setPair(
        serializeForm(findForm(String(f.message), { action: '/table/indexes' })),
        'index[Index_choice]',
        'UNIQUE',
      )
      return pma.postJson('/table/indexes', [...pairs, ['do_save_data', '1']])
    },
    bma: async () => {
      const f = (await bma.req('GET', dbPath('/tables/t/indexes/form?index=k_name'))).json as Record<
        string,
        unknown
      >
      return post('/tables/t/indexes', {
        oldIndex: f.oldIndex,
        index: { ...(f.index as object), choice: 'UNIQUE' },
      })
    },
  },
  {
    name: 'primary key button',
    pma: () =>
      pma.postJson('/table/structure/primary', [
        ['db', P.db],
        ['table', 'np'],
        ['selected_fld[]', 'id'],
        ['ajax_page_request', 'true'],
      ]),
    bma: () => post('/tables/np/columns/key', { type: 'PRIMARY', columns: ['id'], source: 'bulk' }),
  },
  {
    name: 'index button',
    pma: () =>
      pma.postJson('/table/structure/index', [
        ['db', P.db],
        ['table', 'nopk'],
        ['selected_fld[]', 'a'],
        ['ajax_page_request', 'true'],
      ]),
    bma: () => post('/tables/nopk/columns/key', { type: 'INDEX', columns: ['a'], source: 'bulk' }),
  },
  {
    name: 'unique button',
    pma: () =>
      pma.postJson('/table/structure/unique', [
        ['db', P.db],
        ['table', 'nopk'],
        ['selected_fld[]', 'b'],
        ['ajax_page_request', 'true'],
      ]),
    bma: () => post('/tables/nopk/columns/key', { type: 'UNIQUE', columns: ['b'], source: 'bulk' }),
  },
  {
    name: 'table reorder',
    pma: async () => {
      const form = serializeForm(findForm(await opsPage('nopk'), { id: 'alterTableOrderby' }))
      return pma.postPage(
        '/table/operations',
        setPair(setPair(form, 'order_field', 'b'), 'order_order', 'desc'),
      )
    },
    bma: () => post('/tables/nopk/operations/order-by', { field: 'b', order: 'desc' }),
  },
  {
    name: 'table options',
    pma: async () => {
      const form = serializeForm(findForm(await opsPage('t'), { id: 'tableOptionsForm' }))
      return pma.postPage('/table/operations', setPair(form, 'comment', "it's new"))
    },
    bma: async () => {
      const p = (await bma.req('GET', dbPath('/tables/t/operations'))).json as Record<string, unknown>
      const engines = p.storageEngines as Array<{ name: string }>
      return post('/tables/t/operations/options', {
        newName: 't',
        adjustPrivileges: p.hasPrivileges,
        comment: "it's new",
        prevComment: p.comment,
        engine: engines.find((e) => e.name.toLowerCase() === String(p.storageEngine).toLowerCase())?.name,
        collation: p.collation,
        changeAllCollations: false,
        ...(p.hasAutoIncrement === true
          ? { autoIncrement: p.autoIncrement, hiddenAutoIncrement: p.autoIncrement }
          : {}),
        rowFormat:
          (p.rowFormats as string[]).find((f) => f === String(p.rowFormatCurrent).toUpperCase()) ??
          (p.rowFormats as string[])[0],
      })
    },
  },
  {
    name: 'table rename (move within the database)',
    pma: async () => {
      const form = serializeForm(findForm(await opsPage('c1'), { id: 'moveTableForm' }))
      return pma.postJson('/table/operations', [...setPair(form, 'new_name', 'c2'), ['submit_move', '1']])
    },
    bma: () =>
      post('/tables/c1/operations/move-copy', {
        op: 'move',
        newName: 'c2',
        targetDb: B.db,
        adjustPrivileges: true,
      }),
  },
  {
    name: 'table copy',
    pma: async () => {
      const form = serializeForm(findForm(await opsPage('nopk'), { id: 'copyTable' }))
      return pma.postJson('/table/operations', [...setPair(form, 'new_name', 'nopk2'), ['submit_copy', '1']])
    },
    bma: () =>
      post('/tables/nopk/operations/move-copy', {
        op: 'copy',
        newName: 'nopk2',
        targetDb: B.db,
        what: 'data',
        adjustPrivileges: true,
        dropIfExists: false,
        autoIncrement: false,
        addConstraints: false,
        switchToNew: false,
      }),
  },
  {
    name: 'partition maintenance',
    pma: async () => {
      const form = serializeForm(findForm(await opsPage('h'), { id: 'partitionsForm' }))
      // partition p1 on both sides (the form preselects whichever partition the server lists first)
      return pma.postJson('/table/operations', [
        ...setPair(form, 'partition_operation', 'ANALYZE').filter(([k]) => k !== 'partition_name[]'),
        ['partition_name[]', 'p1'],
        ['ajax_page_request', 'true'],
      ])
    },
    bma: () => post('/tables/h/operations/partitions', { operation: 'ANALYZE', partitions: ['p1'] }),
  },
  {
    name: 'find and replace',
    pma: () =>
      pma.postPage('/table/find-replace', [
        ['db', P.db],
        ['table', 't'],
        ['replace', 'true'],
        ['columnIndex', '1'],
        ['findString', 'pple'],
        ['replaceWith', 'PPLE'],
        ['useRegex', '0'],
      ]),
    bma: () =>
      post('/tables/t/find-replace', { columnIndex: 1, find: 'pple', replaceWith: 'PPLE', useRegex: false }),
  },
  {
    name: 'create view',
    pma: () =>
      pma.postJson('/view/create', [
        ['db', P.db],
        ['table', 't'],
        ['reload', '1'],
        ['ajax_request', '1'],
        ['createview', '1'],
        ['ajax_dialog', '1'],
        ['view[algorithm]', 'UNDEFINED'],
        ['view[definer]', ''],
        ['view[sql_security]', ''],
        ['view[name]', 'v2'],
        ['view[column_names]', ''],
        ['view[as]', 'SELECT * FROM t'],
        ['view[with]', ''],
      ]),
    bma: () =>
      post('/views', {
        operation: 'create',
        table: 't',
        view: { algorithm: 'UNDEFINED', name: 'v2', as: 'SELECT * FROM t' },
      }),
  },
  {
    name: 'database collation: nothing',
    pma: () =>
      pma.postJson('/database/operations/collation', [
        ['db', P.db],
        ['db_collation', 'utf8mb4_general_ci'],
        ['change_all_tables_collations', 'on'],
      ]),
    bma: () =>
      post('/operations/collation', {
        collation: 'utf8mb4_general_ci',
        changeAllTables: true,
        changeAllColumns: false,
      }),
  },
  {
    name: 'add user',
    pma: () => pma.postJson('/server/privileges', addUser(P)),
    bma: () => bma.req('POST', '/api/servers/1/privileges', toBody(addUser(B))),
  },
  {
    name: 'edit privileges',
    pma: () => pma.postJson('/server/privileges', editPrivs(P)),
    bma: () => bma.req('POST', '/api/servers/1/privileges', toBody(editPrivs(B))),
  },
  {
    name: 'export of a result: its query',
    pma: () => pma.postPage('/export', exportForm(P), { binary: true }),
    bma: () => bma.req('POST', '/api/servers/1/export', { params: exportForm(B) }),
  },
  {
    name: 'database copy',
    pma: async () => {
      await root.query(`DROP DATABASE ${P.db}_c; CREATE DATABASE ${P.db}_c`)
      return pma.postJson('/database/operations', [
        ['db', P.db],
        ['db_copy', 'true'],
        ['newname', `${P.db}_c`],
        ['what', 'structure'],
        ['submit_copy', 'Go'],
      ])
    },
    bma: async () => {
      await root.query(`DROP DATABASE ${B.db}_c; CREATE DATABASE ${B.db}_c`)
      return post('/operations/copy', {
        newName: `${B.db}_c`,
        what: 'structure',
        createDatabase: false,
        autoIncrement: false,
        addConstraints: false,
      })
    },
  },
  {
    name: 'database rename',
    pma: () =>
      pma.postJson('/database/operations', [
        ['db', P.db],
        ['what', 'data'],
        ['db_rename', 'true'],
        ['db_collation', 'utf8mb4_general_ci'],
        ['newname', `${P.db}_r`],
      ]),
    bma: () =>
      post('/operations/rename', {
        newName: `${B.db}_r`,
        collation: 'utf8mb4_general_ci',
        adjustPrivileges: false,
      }),
  },
]

function addUser(s: Side): Pairs {
  return [
    ['pred_username', 'userdefined'],
    ['username', s.newUser],
    ['pred_hostname', 'any'],
    ['hostname', '%'],
    ['pred_password', 'none'],
    ['adduser_submit', '1'],
  ]
}
function editPrivs(s: Side): Pairs {
  return [
    ['username', s.newUser],
    ['hostname', '%'],
    ['dbname', s.db.replaceAll('_', '\\_')],
    ['Select_priv', 'Y'],
    ['grant_count', '19'],
    ['update_privs', '1'],
  ]
}
function exportForm(s: Side): Pairs {
  return [
    ['db', s.db],
    ['table', 't'],
    ['export_type', 'table'],
    ['what', 'sql'],
    ['output_format', 'sendit'],
    ['sql_query', 'SELECT * FROM `t` WHERE `id` > 1'],
    ['single_table', 'true'],
  ]
}

describe.skipIf(!available)(
  'parity: the SQL history of actions outside the SQL box (StatementHistory) [p09-45cd38]',
  () => {
    beforeAll(async () => {
      root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
      for (const s of [P, B]) {
        await root.query(`DROP USER IF EXISTS '${s.user}'@'%'; CREATE USER '${s.user}'@'%' IDENTIFIED BY '${s.user}';
        GRANT ALL ON *.* TO '${s.user}'@'%' WITH GRANT OPTION; DROP USER IF EXISTS '${s.newUser}'@'%'`)
        await root.query(SEED(s.db))
      }
      inst = await startPmaInstance(pmaConfig(), { dumpState: true })
      pma = new PmaClient(inst.url)
      await pma.login(P.user, P.user)
      bma = testApp(testConfig({}, PMA_STORAGE))
      await bma.login(B.user, B.user)
    }, 60_000)

    afterAll(async () => {
      await bma?.close()
      await inst?.stop()
      for (const s of [P, B]) {
        await root?.query(`DROP DATABASE IF EXISTS ${s.db}; DROP DATABASE IF EXISTS ${s.db}_c; DROP DATABASE IF EXISTS ${s.db}_r;
        DROP USER IF EXISTS '${s.user}'@'%'; DROP USER IF EXISTS '${s.newUser}'@'%'`)
      }
      await root?.end()
    })

    // one session each, in order: every step builds on the tables the previous ones left
    for (const step of STEPS) {
      it(step.name, async () => {
        await step.pma()
        const last = inst.dumps().at(-1)?.sqlHistory?.at(-1) ?? null
        await step.bma()
        const hist = (await bma.req('GET', '/api/servers/1/sql/history')).json.history as
          | Array<{ db: string; table: string; sqlquery: string }>
          | false
        const mine = hist === false || hist.length === 0 ? null : hist[0]!
        const expected =
          step.bmaRecords !== undefined && last !== null ? { ...last, sqlquery: step.bmaRecords } : last
        expect(norm(mine === null ? null : { db: mine.db, table: mine.table, sqlquery: mine.sqlquery })).toBe(
          norm(expected),
        )
      })
    }
  },
)
