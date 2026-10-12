import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { compareWrites, normalise } from './lib/compare.ts'
import { type Pairs, findForm, serializeForm } from './lib/form.ts'
import { GeneralLog } from './lib/general-log.ts'
import { PmaClient, type PmaJson } from './lib/pma.ts'
import { pmaReachable } from './lib/server-setup.ts'

/**
 * Golden parity of the table Search tab (query by example), Zoom search and Find and replace
 * (docs/features/04-table-level.md#search-tab): the SELECT phpMyAdmin runs for a search is the
 * query BetterMyAdmin signs for its /sql view; Zoom runs the same `… LIMIT n`; Find and replace
 * sends the same preview SELECT and UPDATE.
 */
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const PMA_USER = 'f04srch_pma'
const BMA_USER = 'f04srch_bma'
const DB_PMA = 'f04srch_pdb'
const DB_BMA = 'f04srch_bdb'
const dbMap = { [DB_PMA]: 'DB', [DB_BMA]: 'DB', [PMA_USER]: 'USER', [BMA_USER]: 'USER' }

const reachable = pmaReachable

const SEED = `
  CREATE TABLE t (
    id INT UNSIGNED NOT NULL PRIMARY KEY, name VARCHAR(20), price DECIMAL(6,2), kind ENUM('a','b','c'),
    born DATE, note TEXT, g POINT
  );
  INSERT INTO t VALUES (1, 'Alpha', 1.5, 'a', '2020-01-01', 'one apple', ST_GeomFromText('POINT(1 1)')),
    (2, 'beta', 2.5, 'b', '2021-02-02', 'two apples', ST_GeomFromText('POINT(2 2)')),
    (3, NULL, NULL, 'c', NULL, 'Apple pie', NULL);
`

let log: GeneralLog
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let root: mysql.Connection

const base = `/api/servers/1/databases/${DB_BMA}/tables/t`
const post = async (path: string, b: unknown) => {
  const r = await bma.req('POST', `${base}${path}`, b)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}

interface Crit {
  i: number
  op: string
  value: string | string[]
  geom?: string
}

/** The search form of phpMyAdmin with criteria, posted like select.ts (empty criteria dropped). */
async function pmaSearch(crits: Crit[], extra: Pairs = []): Promise<void> {
  const html = await pma.getPage('/table/search', { db: DB_PMA, table: 't' })
  const pairs = serializeForm(findForm(html, { id: 'tbl_search_form' }))
  const keep = pairs.filter(
    ([k]) =>
      !/^criteria(Values|ColumnOperators|ColumnNames|ColumnTypes|ColumnCollations)\[/.test(k) &&
      k !== 'columnsToDisplay[]' &&
      !k.startsWith('geom_func'),
  )
  const out: Pairs = [...keep]
  for (const c of crits) {
    for (const k of ['criteriaColumnNames', 'criteriaColumnTypes', 'criteriaColumnCollations']) {
      const v = pairs.find(([n]) => n === `${k}[${c.i}]`)?.[1] ?? ''
      out.push([`${k}[${c.i}]`, v])
    }
    out.push([`criteriaColumnOperators[${c.i}]`, c.op])
    if (Array.isArray(c.value)) for (const v of c.value) out.push([`criteriaValues[${c.i}][]`, v])
    else out.push([`criteriaValues[${c.i}]`, c.value])
    if (c.geom !== undefined) out.push([`geom_func[${c.i}]`, c.geom])
  }
  const cols = extra.filter(([k]) => k === 'columnsToDisplay[]')
  if (cols.length === 0) out.push(['displayAllColumns', 'true'])
  out.push(...extra)
  await pma.postJson('/table/search', out)
}

async function bmaCriteria(crits: Crit[]) {
  const page = (await bma.req('GET', `${base}/search`)).json as {
    columns: Array<{ name: string; type: string }>
  }
  return crits.map((c) => ({
    name: page.columns[c.i]?.name ?? '',
    type: page.columns[c.i]?.type ?? '',
    operator: c.op,
    value: c.value,
    ...(c.geom !== undefined ? { geomFunc: c.geom } : {}),
  }))
}

const SEARCHES: Array<{ name: string; crits: Crit[]; extra?: Pairs; bma?: Record<string, unknown> }> = [
  {
    name: 'LIKE %...% on text, = on number',
    crits: [
      { i: 1, op: 'LIKE %...%', value: 'ph' },
      { i: 2, op: '>', value: '1' },
    ],
  },
  {
    name: 'IN with an empty element, BETWEEN',
    crits: [
      { i: 0, op: 'IN (...)', value: '1,,3' },
      { i: 4, op: 'BETWEEN', value: '2020-01-01,2021-12-31' },
    ],
  },
  {
    name: 'unary operators and REGEXP ^...$',
    crits: [
      { i: 2, op: 'IS NULL', value: '' },
      { i: 5, op: 'REGEXP ^...$', value: 'Apple.*' },
    ],
  },
  { name: 'ENUM with one value', crits: [{ i: 3, op: '!=', value: 'b' }] },
  {
    name: 'GIS function with a geometry value',
    crits: [{ i: 6, op: '=', value: 'POINT(1 1)', geom: 'ST_Equals' }],
  },
  {
    name: "= '' (empty) and NOT LIKE",
    crits: [
      { i: 1, op: "= ''", value: '' },
      { i: 5, op: 'NOT LIKE', value: '%pie' },
    ],
  },
  {
    name: 'DISTINCT, selected columns and ORDER BY',
    crits: [{ i: 0, op: '>=', value: '1' }],
    extra: [
      ['columnsToDisplay[]', 'name'],
      ['columnsToDisplay[]', 'kind'],
      ['distinct', 'DISTINCT'],
      ['orderByColumn', 'kind'],
      ['order', 'DESC'],
    ],
    bma: { columns: ['name', 'kind'], distinct: true, orderBy: 'kind', order: 'DESC' },
  },
  {
    name: 'custom WHERE overrides the criteria',
    crits: [{ i: 0, op: '=', value: '2' }],
    extra: [['customWhereClause', 'id < 3 AND name IS NOT NULL']],
    bma: { customWhere: 'id < 3 AND name IS NOT NULL' },
  },
]

describe.skipIf(!reachable)('parity: table Search, Zoom search, Find and replace', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    for (const u of [PMA_USER, BMA_USER]) {
      await root.query(
        `DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON \`f04srch\\_%\`.* TO '${u}'@'%'`,
      )
    }
    for (const db of [DB_PMA, DB_BMA]) {
      await root.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`)
    }
    log = await GeneralLog.open(ROOT)
    pma = new PmaClient(PMA_URL)
    await pma.login(PMA_USER, PMA_USER)
    bma = testApp(testConfig())
    await bma.login(BMA_USER, BMA_USER)
  })

  afterAll(async () => {
    for (const db of [DB_PMA, DB_BMA]) await root?.query(`DROP DATABASE IF EXISTS ${db}`)
    await root?.query(`DROP USER IF EXISTS '${PMA_USER}'@'%'; DROP USER IF EXISTS '${BMA_USER}'@'%'`)
    await root?.end()
    await log?.close()
    await bma?.close()
  })

  // literal titles, so that the checklist items of docs/features/04-table-level.md can be claimed
  const search = (name: string) => async () => {
    const s = SEARCHES.find((x) => x.name === name)
    if (s === undefined) throw new Error(`no search ${name}`)
    {
      const m = await log.marker()
      await pmaSearch(s.crits, s.extra ?? [])
      const pmaLog = (await log.since(PMA_USER, m)).map((e) => normalise(e.sql, dbMap))
      const r = (await post('/search', { criteria: await bmaCriteria(s.crits), ...(s.bma ?? {}) })) as {
        sql: string
        sig: string
      }
      const sql = normalise(r.sql, dbMap)
      // Sql::executeQueryAndSendQueryResponse appends the page LIMIT
      expect(pmaLog, sql).toContain(`${sql} LIMIT 0, 25`)
      // the signed query runs in BetterMyAdmin's /sql view
      const q = await bma.req('POST', '/api/servers/1/query', {
        sql: r.sql,
        sig: r.sig,
        db: DB_BMA,
        table: 't',
      })
      expect(q.status, JSON.stringify(q.json)).toBe(200)
    }
  }
  it('search: LIKE %...% on text, = on number [p04-3ef752]', search('LIKE %...% on text, = on number'))
  it('search: IN with an empty element, BETWEEN', search('IN with an empty element, BETWEEN'))
  it('search: unary operators and REGEXP ^...$ [p04-3ef752]', search('unary operators and REGEXP ^...$'))
  it('search: ENUM with one value', search('ENUM with one value'))
  it('search: GIS function with a geometry value', search('GIS function with a geometry value'))
  it("search: = '' (empty) and NOT LIKE [p04-3ef752]", search("= '' (empty) and NOT LIKE"))
  it(
    'search: DISTINCT, selected columns and ORDER BY [p04-05763b]',
    search('DISTINCT, selected columns and ORDER BY'),
  )
  it(
    'search: custom WHERE overrides the criteria [p04-05763b]',
    search('custom WHERE overrides the criteria'),
  )
  it('every search has a test', () =>
    expect(SEARCHES.map((x) => x.name)).toEqual([
      'LIKE %...% on text, = on number',
      'IN with an empty element, BETWEEN',
      'unary operators and REGEXP ^...$',
      'ENUM with one value',
      'GIS function with a geometry value',
      "= '' (empty) and NOT LIKE",
      'DISTINCT, selected columns and ORDER BY',
      'custom WHERE overrides the criteria',
    ]))

  it('zoom search runs the same LIMITed query [p04-e40cc6]', async () => {
    const m = await log.marker()
    const html = await pma.getPage('/table/zoom-search', { db: DB_PMA, table: 't' })
    const pairs = serializeForm(findForm(html, { id: 'zoom_search_form' })).filter(
      ([k]) => !k.startsWith('criteria') && k !== 'maxPlotLimit' && k !== 'dataLabel',
    )
    await pma.postPage('/table/zoom-search', [
      ...pairs,
      ['criteriaColumnNames[]', 'id'],
      ['criteriaColumnNames[]', 'price'],
      ['criteriaColumnNames[]', 'name'],
      ['criteriaColumnNames[]', 'pma_null'],
      ['criteriaColumnTypes[0]', 'int'],
      ['criteriaColumnTypes[1]', 'decimal(6,2)'],
      ['criteriaColumnTypes[2]', 'varchar(20)'],
      ['criteriaColumnOperators[0]', '>'],
      ['criteriaValues[0]', '0'],
      ['criteriaColumnOperators[1]', '='],
      ['criteriaValues[1]', ''],
      ['criteriaColumnOperators[2]', 'LIKE'],
      ['criteriaValues[2]', '%a%'],
      ['dataLabel', 'name'],
      ['maxPlotLimit', '100'],
      ['zoom_submit', 'Go'],
    ])
    const pmaLog = (await log.since(PMA_USER, m)).map((e) => normalise(e.sql, dbMap))
    const z = (await post('/search/zoom', {
      criteria: [
        { name: 'id', type: 'int', operator: '>', value: '0' },
        { name: 'price', type: 'decimal(6,2)', operator: '=', value: '' },
        { name: 'name', type: 'varchar(20)', operator: 'LIKE', value: '%a%' },
      ],
      x: 'id',
      y: 'price',
      dataLabel: 'name',
      maxPlotLimit: 100,
    })) as { sql: string; points: Array<{ whereClause: string; sig: string; label: string }> }
    expect(pmaLog).toContain(normalise(z.sql, dbMap))
    expect(z.points.map((p) => p.whereClause)).toEqual(['`t`.`id` = 1', '`t`.`id` = 2'])
    // the data point dialog reads its row through the signed where clause
    const row = (await post('/search/zoom/row', {
      whereClause: z.points[0]?.whereClause,
      sig: z.points[0]?.sig,
    })) as {
      row: Record<string, string | null>
    }
    expect(row.row.name).toBe('Alpha')
    const pr = await pma.postJson('/table/zoom-search', {
      db: DB_PMA,
      table: 't',
      get_data_row: '1',
      where_clause: z.points[0]?.whereClause ?? '',
      where_clause_sign: '',
    })
    expect(pr.row_info).toBeUndefined()
  })

  const findReplace = (regex: boolean) => async () => {
    {
      for (const db of [DB_PMA, DB_BMA]) {
        await root.query(
          `DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`,
        )
      }
      await root.query('USE mysql')
      const find = regex ? '(a)(p+)' : 'pple'
      const repl = regex ? '$2-\\1' : 'PPLE'
      const m1 = await log.marker()
      const prev = (await pma.postJson('/table/find-replace', {
        db: DB_PMA,
        table: 't',
        find,
        replaceWith: repl,
        columnIndex: '5',
        ...(regex ? { useRegex: 'on' } : {}),
      })) as PmaJson
      await pma.postPage('/table/find-replace', [
        ['db', DB_PMA],
        ['table', 't'],
        ['replace', 'true'],
        ['columnIndex', '5'],
        ['findString', find],
        ['replaceWith', repl],
        ['useRegex', regex ? '1' : '0'],
      ])
      const pmaLog = await log.since(PMA_USER, m1)
      const m2 = await log.marker()
      const bp = (await post('/find-replace/preview', {
        columnIndex: 5,
        find,
        replaceWith: repl,
        useRegex: regex,
      })) as {
        rows: Array<{ original: string; replaced: string; count: string }>
      }
      await post('/find-replace', { columnIndex: 5, find, replaceWith: repl, useRegex: regex })
      const bmaLog = await log.since(BMA_USER, m2)
      const cmp = compareWrites(pmaLog, bmaLog, dbMap)
      expect(cmp.bma).toEqual(cmp.pma)
      const previewSelect = (l: typeof pmaLog) =>
        l.map((e) => normalise(e.sql, dbMap)).filter((s) => /COUNT\(\*\) FROM/.test(s))
      expect(previewSelect(bmaLog)).toEqual(previewSelect(pmaLog).slice(0, previewSelect(bmaLog).length))
      const preview = String(prev.preview ?? '')
      for (const row of bp.rows) {
        expect(preview).toContain(row.replaced.replaceAll('&', '&amp;'))
      }
      const [a] = await root.query(`SELECT note FROM ${DB_PMA}.t ORDER BY id`)
      const [b] = await root.query(`SELECT note FROM ${DB_BMA}.t ORDER BY id`)
      expect(b).toEqual(a)
    }
  }
  it('find and replace (plain): preview and replace [p04-741dc3]', findReplace(false))
  it('find and replace (regular expression): preview and replace [p04-741dc3]', findReplace(true))
})
