import type { GridCell, GridData, QueryResponse } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { getCreateTableSqlQueries } from '../../packages/metadata/src/resources.ts'
import { classify, normalise } from './lib/compare.ts'
import { GeneralLog, type LogEntry } from './lib/general-log.ts'
import { type PmaInstance, phpAvailable, startPmaInstance } from './lib/pma-instance.ts'
import { PmaClient, visibleText } from './lib/pma.ts'

/**
 * What the results grid decides on the server (docs/features/02-browse-results-grid.md), compared
 * with the page a private phpMyAdmin of the reference checkout renders for the same query: the
 * navigation bar's buttons and the End form's onsubmit, the total without a count query and with an
 * InnoDB estimate, the options form's radios, sort links, the bulk form's clause_is_unique, the
 * default-browse bookmark, FK and special schema links, views, row actions, Kill and geometry cells.
 * phpMyAdmin is given its own configuration storage (relation and table_info features) and
 * MaxExactCount = 50, ours the same. Only f02g_* databases and users are touched.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const DB = 'f02g_db'
const PMADB = 'f02g_pmadb'
const CTL = 'f02g_ctl'
const U = { pma: 'f02g_up', bma: 'f02g_ub' }

const available = phpAvailable()
let root: mysql.Connection
let inst: PmaInstance
let log: GeneralLog
let pma: PmaClient
let bma: ReturnType<typeof testApp>

const pmaConfig = () => `$cfg['blowfish_secret'] = 'f02g-parity-secret-0123456789abcdefgh';
$i = 1;
$cfg['Servers'][$i]['host'] = ${JSON.stringify(ROOT.host)};
$cfg['Servers'][$i]['port'] = ${JSON.stringify(String(ROOT.port))};
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['Servers'][$i]['controluser'] = '${CTL}';
$cfg['Servers'][$i]['controlpass'] = '${CTL}';
$cfg['Servers'][$i]['pmadb'] = '${PMADB}';
$cfg['MaxExactCount'] = 50;`

const SEED = `DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
  CREATE TABLE t (id INT PRIMARY KEY, name VARCHAR(20)) ENGINE=InnoDB;
  INSERT INTO t VALUES (1, 'one'), (2, 'two'), (3, 'three');
  CREATE TABLE child (id INT PRIMARY KEY, t_id INT, ref INT, FOREIGN KEY (t_id) REFERENCES t (id)) ENGINE=InnoDB;
  INSERT INTO child VALUES (1, 1, 2), (2, 2, 3), (3, NULL, NULL);
  CREATE TABLE big (id INT PRIMARY KEY AUTO_INCREMENT, v INT, w VARCHAR(10)) ENGINE=InnoDB;
  INSERT INTO big (v, w) VALUES ${Array.from({ length: 60 }, (_, i) => `(${(i * 7) % 11}, 'w${i}')`).join(', ')};
  ANALYZE TABLE big;
  CREATE TABLE ub (k VARBINARY(1200) NOT NULL, x INT, UNIQUE KEY (k)) ENGINE=InnoDB;
  INSERT INTO ub VALUES ('a', 1), (REPEAT('b', 1100), 2);
  CREATE TABLE geo (id INT PRIMARY KEY, g GEOMETRY) ENGINE=InnoDB;
  INSERT INTO geo VALUES (1, ST_GeomFromText('POINT(1 2)')), (2, NULL);
  CREATE VIEW v AS SELECT id, name FROM t;
  CREATE VIEW vb AS SELECT id, v FROM big;
  CREATE PROCEDURE f02g_proc () SELECT 1;`

/** POST /sql of phpMyAdmin (the AJAX answer of a link or form): the rendered grid. */
async function pmaGrid(form: Record<string, string>): Promise<string> {
  const r = await pma.postJson('/sql', { db: DB, ...form })
  expect(r.success, String(r.error ?? '')).toBe(true)
  return String(r.message)
}

/** POST /browse of ours: the first statement's grid. */
async function ourGrid(body: Record<string, unknown>): Promise<GridData> {
  const r = await bma.req('POST', '/api/servers/1/browse', { db: DB, ...body })
  expect(r.status, JSON.stringify(r.json).slice(0, 400)).toBe(200)
  return (r.json as unknown as QueryResponse).statements[0]!.grid as GridData
}

const decode = (s: string) =>
  s
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')

/** The query parameters of a phpMyAdmin link (`index.php?route=…&…`), decoded, in order. */
function linkParams(href: string): Array<[string, string]> {
  const q = decode(href).split('?')[1] ?? ''
  return [...new URLSearchParams(q).entries()]
}

/** The first navigation bar: its buttons (titles), the End form's onsubmit and the page selector. */
function pmaNavigation(html: string) {
  const nav = /<table class="navigation[\s\S]*?<\/table>/.exec(html)?.[0] ?? ''
  return {
    present: nav !== '',
    buttons: [...nav.matchAll(/name="navig" class="[^"]*" value="[^"]*" title="([^"]+)"/g)].map((m) => m[1]),
    endSubmit: /method="post" onsubmit="return (true|false);">[\s\S]*?title="End"/.exec(nav)?.[1] ?? null,
    pages: [
      ...(/<select class="pageselector[\s\S]*?<\/select>/.exec(nav)?.[0] ?? '').matchAll(/value="(\d+)"/g),
    ].map((m) => Number(m[1])),
  }
}

function ourNavigation(g: GridData) {
  const n = g.navigation
  if (n === null) return { present: false, buttons: [], endSubmit: null, pages: [] }
  const showAll = n.isShowingAll
  const buttons: string[] = []
  if (g.view.pos > 0 && !showAll) buttons.push('Begin', 'Previous')
  if (!n.isLastPage) {
    buttons.push('Next')
    if (n.isLastPageKnown) buttons.push('End')
  }
  const per = g.view.maxRows === 'all' ? 0 : g.view.maxRows
  return {
    present: true,
    buttons,
    endSubmit: !n.isLastPage && n.isLastPageKnown ? String(n.endAllowed) : null,
    pages: n.pages.map((p) => (p - 1) * per),
  }
}

/** The inputs of the options form: `name=value` (+ `*` when checked). */
function pmaOptions(html: string): string[] {
  const form = /<form[^>]*name="displayOptionsForm"[\s\S]*?<\/form>/.exec(html)?.[0] ?? ''
  return [...form.matchAll(/<input\b[^>]*type="(radio|checkbox)"[^>]*>/g)].map((m) => {
    const tag = m[0]
    const name = /name="([^"]+)"/.exec(tag)?.[1]
    const value = /value="([^"]+)"/.exec(tag)?.[1]
    return `${name}${value === undefined ? '' : `=${value}`}${/\bchecked\b/.test(tag) ? '*' : ''}`
  })
}

function ourOptions(g: GridData): string[] {
  const v = g.view
  const r = (name: string, value: string, on: boolean) => `${name}=${value}${on ? '*' : ''}`
  return [
    r('pftext', 'P', v.pftext === 'P'),
    r('pftext', 'F', v.pftext === 'F'),
    ...(g.relationOptions
      ? [
          r('relational_display', 'K', v.relationalDisplay === 'K'),
          r('relational_display', 'D', v.relationalDisplay === 'D'),
        ]
      : []),
    // the checkboxes have no value attribute
    `display_binary${v.displayBinary ? '*' : ''}`,
    `display_blob${v.displayBlob ? '*' : ''}`,
    `hide_transformation${v.hideTransformation ? '*' : ''}`,
    ...(v.possibleAsGeometry ? [r('geoOption', 'GEOM', v.geoOption === 'GEOM')] : []),
    r('geoOption', 'WKT', v.geoOption === 'WKT'),
    r('geoOption', 'WKB', v.geoOption === 'WKB'),
  ]
}

/** A data cell (`class="… data …"`; the value-display ones have no data-* attributes). */
const DATA_TD = /<td\b(?=[^>]*\bclass="[^"]*\bdata\b)[^>]*>([\s\S]*?)<\/td>/g

/** The data cells of the grid's rows (`<td … class="… data …">`), as their visible text. */
function pmaCells(html: string): string[][] {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? ''
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) =>
    [...(r[1] ?? '').matchAll(DATA_TD)].map((c) => visibleText(c[1] ?? '')),
  )
}

/** Links inside the data cells: [row][col] → href + title (or null). */
function pmaCellLinks(html: string): Array<Array<{ href: string; title: string } | null>> {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? ''
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) =>
    [...(r[1] ?? '').matchAll(DATA_TD)].map((c) => {
      const a = /<a\b[^>]*>/.exec(c[1] ?? '')?.[0]
      if (a === undefined) return null
      const attr = (n: string) => decode(new RegExp(`\\b${n}="([^"]*)"`).exec(a)?.[1] ?? '')
      return { href: attr('href'), title: attr('title') }
    }),
  )
}

const ourText = (c: GridCell) => (c.k === 'null' ? 'NULL' : (c.t ?? ''))

/** The statements on the user's data (writes, and reads of the seeded tables). */
function dataStatements(entries: LogEntry[]): string[] {
  return entries
    .map((e) => normalise(e.sql, {}))
    .filter((s) => {
      if (/`pma__\w+`|information_schema/i.test(s)) return false
      return classify(s) === 'read' && /^SELECT\b/i.test(s) && /\bf02g_db\b|`big`|\bbig\b/.test(s)
    })
}

describe.skipIf(!available)('parity: results grid decisions vs a private phpMyAdmin', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    await root.query(
      `DROP DATABASE IF EXISTS ${PMADB}; CREATE DATABASE ${PMADB} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
    )
    await root.query(`USE ${PMADB}`)
    for (const sql of Object.values(getCreateTableSqlQueries({}))) await root.query(sql)
    await root.query(SEED)
    for (const u of [U.pma, U.bma, CTL]) {
      await root.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'`)
    }
    await root.query(`GRANT ALL ON *.* TO '${U.pma}'@'%'; GRANT ALL ON *.* TO '${U.bma}'@'%';
      GRANT SELECT, INSERT, UPDATE, DELETE ON \`${PMADB}\`.* TO '${CTL}'@'%'; GRANT SELECT ON mysql.* TO '${CTL}'@'%';`)
    // an internal relation (pma__relation) next to the native FOREIGN KEY, with display columns
    await root.query(`INSERT INTO ${PMADB}.pma__relation VALUES ('${DB}', 'child', 'ref', '${DB}', 't', 'id');
      INSERT INTO ${PMADB}.pma__table_info VALUES ('${DB}', 't', 'name');`)
    inst = await startPmaInstance(pmaConfig())
    pma = new PmaClient(inst.url)
    await pma.login(U.pma, U.pma)
    bma = testApp(testConfig({ MaxExactCount: 50 }, { controluser: CTL, controlpass: CTL, pmadb: PMADB }))
    await bma.login(U.bma, U.bma)
    log = await GeneralLog.open(ROOT)
  }, 60_000)

  afterAll(async () => {
    await bma?.close()
    await log?.close()
    await inst?.stop()
    await root?.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${PMADB}`)
    for (const u of [U.pma, U.bma, CTL]) await root?.query(`DROP USER IF EXISTS '${u}'@'%'`)
    await root?.end()
  })

  it('navigation: End refuses submit, the total without a count query, an InnoDB estimate keeps Next [p02-52b650] [p02-5e25ea] [p02-f57dae]', async () => {
    const cases: Array<[Record<string, string>, Record<string, unknown>]> = [
      [
        { table: 'big', pos: '0' },
        { table: 'big', pos: 0 },
      ],
      [
        { table: 'big', pos: '25' },
        { table: 'big', pos: 25 },
      ],
      // a full page reaching the estimated total: not the last page while the count is inexact
      [
        { table: 'big', sql_query: 'SELECT * FROM `big`', session_max_rows: '30', pos: '30' },
        { table: 'big', sql: 'SELECT * FROM `big`', maxRows: 30, pos: 30 },
      ],
      // a short page: the total is pos + rows
      [
        { table: 'big', sql_query: 'SELECT * FROM `big`', session_max_rows: '25', pos: '50' },
        { table: 'big', sql: 'SELECT * FROM `big`', maxRows: 25, pos: 50 },
      ],
      [
        { table: 'big', sql_query: 'SELECT * FROM `big` WHERE v > 8' },
        { table: 'big', sql: 'SELECT * FROM `big` WHERE v > 8' },
      ],
    ]
    for (const [form, body] of cases) {
      const m1 = await log.marker()
      const html = await pmaGrid(form)
      const pmaLog = dataStatements(await log.since(U.pma, m1))
      const m2 = await log.marker()
      const g = await ourGrid(body)
      const ourLog = dataStatements(await log.since(U.bma, m2))
      expect(ourNavigation(g), JSON.stringify(form)).toEqual(pmaNavigation(html))
      // the same statements: no count query after a short page
      expect(ourLog, JSON.stringify(form)).toEqual(pmaLog)
      const shown = /Showing rows ([^(]*)\(([^,)]*)/.exec(visibleText(html))
      if (g.numRows < (g.view.maxRows === 'all' ? Number.POSITIVE_INFINITY : g.view.maxRows)) {
        expect(g.total).toBe(g.view.pos + g.numRows)
        expect(ourLog.some((s) => /COUNT\(/i.test(s))).toBe(false)
      }
      expect(shown?.[2]?.trim()).toBe(/~/.test(shown?.[2] ?? '') ? shown?.[2]?.trim() : `${g.total} total`)
    }
    // the inexact page above: Next and End (which refuses to submit) remain
    expect(
      ourNavigation(await ourGrid({ table: 'big', sql: 'SELECT * FROM `big`', maxRows: 30, pos: 30 })),
    ).toMatchObject({ buttons: ['Begin', 'Previous', 'Next', 'End'], endSubmit: 'false' })
  })

  it('views at MaxExactCountViews 0: "Showing rows 0 - ..." with the hint, no total, page selector or End, Next stays [p02-17edb6]', async () => {
    const html = await pmaGrid({ table: 'vb', pos: '0' })
    const g = await ourGrid({ table: 'vb' })
    expect(visibleText(html)).toContain('Showing rows 0 - ... This view has at least this number of rows.')
    expect(g.viewHint).toBe(true)
    expect(ourNavigation(g)).toEqual(pmaNavigation(html))
    expect(ourNavigation(g)).toMatchObject({ buttons: ['Next'], pages: [] })
    const r = await bma.req('POST', '/api/servers/1/browse', { db: DB, table: 'vb' })
    expect((r.json as unknown as QueryResponse).statements[0]!.message.text).toMatch(
      /^Showing rows 0 - \.\.\. \(/,
    )
  })

  it('sort links carry session_max_rows, Show all survives a re-sort (Q72); ORDER BY 2 is shown on the second column [p02-c6fb7a] [p02-794830]', async () => {
    const html = await pmaGrid({
      table: 'big',
      sql_query: 'SELECT * FROM `big` ORDER BY 2',
      session_max_rows: 'all',
    })
    const g = await ourGrid({ table: 'big', sql: 'SELECT * FROM `big` ORDER BY 2', maxRows: 'all' })
    // Q72: phpMyAdmin's sort links post session_max_rows=0 after Show all ((int) 'all') and the
    // sorted page fails (DivisionByZeroError); ours keeps the grid's maxRows: still all 60 rows
    const links = [...html.matchAll(/<a href="([^"]+)" class="sortlink">/g)].map((m) =>
      linkParams(m[1] ?? ''),
    )
    expect(links.length).toBe(3)
    for (const p of links) expect(p).toContainEqual(['session_max_rows', '0'])
    await expect(
      pma.getJson('/sql', Object.fromEntries(links[0]!.filter(([k]) => k !== 'route'))),
    ).rejects.toThrow(/DivisionByZeroError|did not answer JSON/)
    const first = g.columns[0]!.sort!.single
    expect(first.sql).toBe(links[0]!.find(([k]) => k === 'sql_query')![1])
    const ourSorted = await ourGrid({ table: 'big', sql: first.sql, sig: first.sig, maxRows: g.view.maxRows })
    expect(ourSorted.rows.length).toBe(60)
    expect(ourSorted.view.maxRows).toBe('all')
    // without Show all the links carry the page size (and so does ours)
    const paged = await pmaGrid({
      table: 'big',
      sql_query: 'SELECT * FROM `big` ORDER BY 2',
      session_max_rows: '30',
    })
    for (const m of paged.matchAll(/<a href="([^"]+)" class="sortlink">/g)) {
      expect(linkParams(m[1] ?? '')).toContainEqual(['session_max_rows', '30'])
    }
    expect(
      (await ourGrid({ table: 'big', sql: 'SELECT * FROM `big` ORDER BY 2', maxRows: 30 })).view.maxRows,
    ).toBe(30)
    // the indicator: v (the second column) is the sorted one, ascending, position 1
    const v = /data-column="v"[\s\S]*?<\/th>/.exec(html)?.[0] ?? ''
    expect(v).toMatch(/alt="Ascending" class="icon ic_s_asc soimg"/)
    expect(v).toContain('<small>1</small>')
    const col = g.columns.find((c) => c.name === 'v')!
    expect(col.sort).toMatchObject({ dir: 'ASC', position: 1 })
    for (const c of g.columns.filter((x) => x.name !== 'v')) expect(c.sort?.dir).toBeNull()
    // the next click sorts the other way, like phpMyAdmin's link
    const pmaNext = links[1]!.find(([k]) => k === 'sql_query')![1]
    expect(col.sort!.single.sql).toBe(pmaNext)
  })

  it('options: Full texts for EXPLAIN, Show binary contents on by default and kept by the text toggle, radios per features [p02-cfee9e] [p02-153856] [p02-f0006f]', async () => {
    const steps: Array<[Record<string, string>, Record<string, unknown>]> = [
      [{ table: 't', pos: '0' }, { table: 't' }],
      [{ sql_query: 'EXPLAIN SELECT * FROM `t`' }, { sql: 'EXPLAIN SELECT * FROM `t`' }],
      // the full/partial toggle link (full_text_button) changes pftext only
      [
        { table: 't', sql_query: 'SELECT * FROM `t`', pftext: 'F', full_text_button: '1' },
        { table: 't', sql: 'SELECT * FROM `t`', pftext: 'F', fullTextButton: true },
      ],
      // a multi-table result is not editable: no Geometry radio
      [
        { sql_query: 'SELECT t.id, child.id FROM t JOIN child ON child.t_id = t.id' },
        { sql: 'SELECT t.id, child.id FROM t JOIN child ON child.t_id = t.id' },
      ],
      // unchecking Show binary contents in the options form
      [
        {
          table: 't',
          sql_query: 'SELECT * FROM `t`',
          display_options_form: '1',
          pftext: 'P',
          geoOption: 'WKT',
        },
        {
          table: 't',
          sql: 'SELECT * FROM `t`',
          displayOptionsForm: true,
          pftext: 'P',
          geoOption: 'WKT',
          displayBinary: false,
        },
      ],
    ]
    for (const [form, body] of steps) {
      const html = await pmaGrid(form)
      const g = await ourGrid(body)
      expect(ourOptions(g), JSON.stringify(form)).toEqual(pmaOptions(html))
    }
    // without the relation features (no configuration storage) the radios are not offered
    const plain = testApp(testConfig({ MaxExactCount: 50 }, { pmadb: 'f02g_no_storage' }))
    await plain.login(U.bma, U.bma)
    const r = await plain.req('POST', '/api/servers/1/browse', { db: DB, table: 'child' })
    expect(((r.json as unknown as QueryResponse).statements[0]!.grid as GridData).relationOptions).toBe(false)
    await plain.close()
  })

  it('options persist per query; RelationalDisplay is the default only for a query without a choice [p02-4f4783]', async () => {
    const q1 = 'SELECT * FROM `child`'
    const q2 = 'SELECT * FROM `child` WHERE id > 0'
    const steps: Array<[Record<string, string>, Record<string, unknown>]> = [
      [
        {
          table: 'child',
          sql_query: q1,
          display_options_form: '1',
          pftext: 'F',
          relational_display: 'D',
          geoOption: 'WKT',
        },
        {
          table: 'child',
          sql: q1,
          displayOptionsForm: true,
          pftext: 'F',
          relationalDisplay: 'D',
          geoOption: 'WKT',
          displayBinary: false,
        },
      ],
      [
        { table: 'child', sql_query: q2 },
        { table: 'child', sql: q2 },
      ],
      [
        { table: 'child', sql_query: q1 },
        { table: 'child', sql: q1 },
      ],
    ]
    const seen: string[][] = []
    for (const [form, body] of steps) {
      const html = await pmaGrid(form)
      const g = await ourGrid(body)
      expect(ourOptions(g), JSON.stringify(form)).toEqual(pmaOptions(html))
      seen.push(ourOptions(g))
    }
    // the second query starts from the defaults (RelationalDisplay K); the first keeps its choices
    // (Show binary contents is defaulted again for a request without the options form, p02-153856)
    expect(seen[1]).toContain('relational_display=K*')
    expect(seen[1]).toContain('pftext=P*')
    for (const o of ['pftext=F*', 'relational_display=D*', 'geoOption=WKT*']) expect(seen[2]).toContain(o)
  })

  it('the bulk form’s clause_is_unique is the last row’s [p02-42af8c]', async () => {
    for (const dir of ['ASC', 'DESC']) {
      const sql = `SELECT * FROM \`ub\` ORDER BY x ${dir}`
      const html = await pmaGrid({ table: 'ub', sql_query: sql })
      const g = await ourGrid({ table: 'ub', sql })
      const pmaValue = /name="clause_is_unique" value="([^"]*)"/.exec(html)?.[1]
      expect(g.clauseIsUnique ? '1' : '', dir).toBe(pmaValue)
      expect(g.rows.map((r) => r.unique)).toEqual(dir === 'ASC' ? [true, false] : [false, true])
    }
  })

  it('a bookmark labelled like the table replaces the default browse query [p02-70a47e]', async () => {
    for (const u of [U.pma, U.bma]) {
      await root.query(
        `INSERT INTO ${PMADB}.pma__bookmark (dbase, user, label, query) VALUES ('${DB}', '${u}', 't', 'SELECT name FROM t WHERE id > 1')`,
      )
    }
    try {
      const html = await pmaGrid({ table: 't', pos: '0' })
      const r = await bma.req('POST', '/api/servers/1/browse', { db: DB, table: 't' })
      const res = r.json as unknown as QueryResponse & { usingBookmark?: string | null }
      const g = res.statements[0]!.grid as GridData
      expect(visibleText(html)).toContain('Using bookmark "t" as default browse query.')
      expect(html).toContain('faq6-22')
      expect(res.usingBookmark).toBe('Using bookmark "t" as default browse query.')
      expect(g.columns.map((c) => c.name)).toEqual(['name'])
      expect(g.rows.map((x) => x.cells.map(ourText))).toEqual(pmaCells(html))
    } finally {
      await root.query(`DELETE FROM ${PMADB}.pma__bookmark WHERE dbase = '${DB}'`)
    }
  })

  it('FK links: internal relations and native foreign keys, emulated relations of information_schema / mysql, special schema links [p02-cc52ab]', async () => {
    const fk = (c: GridCell) =>
      c.fk === undefined ? null : { db: c.fk.db, table: c.fk.table, sql: c.fk.sql, title: c.fk.title }
    const pmaFk = (l: { href: string; title: string } | null) => {
      if (l === null) return null
      const params = new Map(linkParams(l.href))
      return {
        db: params.get('db'),
        table: params.get('table'),
        sql: params.get('sql_query'),
        title: l.title,
      }
    }
    // child.t_id: native FOREIGN KEY; child.ref: pma__relation; both show t.name (pma__table_info)
    const cases: Array<[string, string]> = [
      [DB, 'child'],
      ['information_schema', 'CHARACTER_SETS'],
      ['mysql', 'db'],
    ]
    for (const [db, table] of cases) {
      const sql =
        table === 'CHARACTER_SETS'
          ? "SELECT * FROM `CHARACTER_SETS` WHERE CHARACTER_SET_NAME IN ('latin1', 'utf8mb4') ORDER BY 1"
          : table === 'db'
            ? `SELECT * FROM \`db\` WHERE Db = '${DB}'`
            : 'SELECT * FROM `child`'
      if (table === 'db') {
        await root.query(`GRANT SELECT ON \`${DB}\`.* TO '${CTL}'@'%'`)
      }
      const r = await pma.postJson('/sql', { db, table, sql_query: sql })
      const html = String(r.message)
      const res = await bma.req('POST', '/api/servers/1/browse', { db, table, sql })
      const g = (res.json as unknown as QueryResponse).statements[0]!.grid as GridData
      const ours = g.rows.map((row) => row.cells.map(fk))
      const theirs = pmaCellLinks(html).map((row) => row.map(pmaFk))
      // special links are not FK links
      const special = g.rows.map((row) => row.cells.map((c) => c.sl !== undefined))
      expect(ours.length, `${db}.${table}`).toBe(theirs.length)
      ours.forEach((row, i) =>
        row.forEach((c, j) => {
          if (special[i]![j]) return
          expect(c, `${db}.${table} [${i}][${j}]`).toEqual(theirs[i]![j]!)
        }),
      )
      expect(
        ours.flat().some((c) => c !== null),
        `${db}.${table}`,
      ).toBe(true)
      if (table === 'db') await root.query(`REVOKE SELECT ON \`${DB}\`.* FROM '${CTL}'@'%'`)
    }

    // SpecialSchemaLinks: the same route and parameters as phpMyAdmin's Text_Plain_Link
    const specials: Array<[string, string, string]> = [
      [
        'mysql',
        'user',
        `SELECT Host, User FROM \`user\` WHERE User IN ('${U.pma}', '${U.bma}') ORDER BY User`,
      ],
      ['mysql', 'db', `SELECT * FROM \`db\` WHERE Db = '${DB}'`],
      [
        'information_schema',
        'TABLES',
        `SELECT TABLE_SCHEMA, TABLE_NAME FROM \`TABLES\` WHERE TABLE_SCHEMA = '${DB}' ORDER BY 2`,
      ],
      [
        'information_schema',
        'COLUMNS',
        `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM \`COLUMNS\` WHERE TABLE_SCHEMA = '${DB}' AND TABLE_NAME = 't' ORDER BY 3`,
      ],
      [
        'information_schema',
        'ROUTINES',
        `SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE FROM \`ROUTINES\` WHERE ROUTINE_SCHEMA = '${DB}'`,
      ],
      ['information_schema', 'SCHEMATA', `SELECT SCHEMA_NAME FROM \`SCHEMATA\` WHERE SCHEMA_NAME = '${DB}'`],
    ]
    let count = 0
    for (const [db, table, sql] of specials) {
      const html = String((await pma.postJson('/sql', { db, table, sql_query: sql })).message)
      const res = await bma.req('POST', '/api/servers/1/browse', { db, table, sql })
      const g = (res.json as unknown as QueryResponse).statements[0]!.grid as GridData
      const theirs = pmaCellLinks(html)
      expect(g.rows.length, `${db}.${table}`).toBe(theirs.length)
      g.rows.forEach((row, i) =>
        row.cells.forEach((c, j) => {
          const l = theirs[i]![j]!
          const isSpecial = l?.href.startsWith('./index.php?route=') === true
          if (!isSpecial) {
            expect(c.sl, `${db}.${table} [${i}][${j}]`).toBeUndefined()
            return
          }
          count++
          const route = new URLSearchParams(l.href.split('?')[1]).get('route')
          expect(c.sl, `${db}.${table} [${i}][${j}]`).toEqual({
            route,
            params: linkParams(l.href).filter(([k]) => k !== 'route'),
          })
          expect(c.cls).toMatch(/ Text_Plain transformed$/)
        }),
      )
    }
    expect(count).toBeGreaterThanOrEqual(8)
  })

  it('row actions: none for joins, sub-queries and information_schema; an updatable view has them [p02-7b03e0]', async () => {
    const cases: Array<[string, string, string]> = [
      [DB, '', 'SELECT t.id, child.id FROM t JOIN child ON child.t_id = t.id'],
      [DB, '', 'SELECT * FROM (SELECT * FROM t) AS s'],
      ['information_schema', 'SCHEMATA', `SELECT * FROM \`SCHEMATA\` WHERE SCHEMA_NAME = '${DB}'`],
      [DB, 'v', 'SELECT * FROM `v`'],
      [DB, 't', 'SELECT * FROM `t`'],
    ]
    for (const [db, table, sql] of cases) {
      const html = String((await pma.postJson('/sql', { db, table, sql_query: sql })).message)
      const res = await bma.req('POST', '/api/servers/1/browse', { db, table, sql })
      const g = (res.json as unknown as QueryResponse).statements[0]!.grid as GridData
      const pmaEdit = (html.match(/default_action=update/g) ?? []).length > 0
      const pmaGridEdit = /class="[^"]*\bgrid_edit\b/.test(html)
      const ourEdit = g.displayParts.editLink && g.rows.length > 0
      const ourGridEdit = g.rows.some((r) => r.cells.some((c) => /\bgrid_edit\b/.test(c.cls)))
      expect([ourEdit, ourGridEdit], sql).toEqual([pmaEdit, pmaGridEdit])
      expect(ourEdit, sql).toBe(table === 'v' || table === 't')
    }
  })

  it('SHOW PROCESSLIST rows get Kill: KILL <id>; on the mysql database [p02-87c19f]', async () => {
    const html = String((await pma.postJson('/sql', { db: DB, sql_query: 'SHOW FULL PROCESSLIST' })).message)
    const kills = [...html.matchAll(/data-post="([^"]*KILL[^"]*)"/g)].map(
      (m) => new Map(linkParams(`?${m[1]}`)),
    )
    expect(kills.length).toBeGreaterThan(0)
    for (const k of kills) {
      expect(k.get('db')).toBe('mysql')
      expect(k.get('sql_query')).toMatch(/^KILL \d+;$/)
    }
    expect(visibleText(html)).toContain('Kill')
    const g = await ourGrid({ sql: 'SHOW FULL PROCESSLIST' })
    expect(g.displayParts.deleteLink).toBe('kill')
    for (const row of g.rows) {
      expect(row.kill?.sql).toBe(`KILL ${row.cells[0]!.t};`)
      expect(row.del).toBeUndefined()
    }
  })

  it('geometry cells: the GEOMETRY link, WKT, WKB without SRID (with Show binary contents) [p02-f1f356]', async () => {
    const steps: Array<[Record<string, string>, Record<string, unknown>]> = [
      [{ table: 'geo', pos: '0' }, { table: 'geo' }],
      [
        {
          table: 'geo',
          sql_query: 'SELECT * FROM `geo`',
          display_options_form: '1',
          pftext: 'P',
          geoOption: 'WKT',
          display_binary: 'on',
        },
        {
          table: 'geo',
          sql: 'SELECT * FROM `geo`',
          displayOptionsForm: true,
          pftext: 'P',
          geoOption: 'WKT',
          displayBinary: true,
        },
      ],
      [
        {
          table: 'geo',
          sql_query: 'SELECT * FROM `geo`',
          display_options_form: '1',
          pftext: 'P',
          geoOption: 'WKB',
          display_binary: 'on',
        },
        {
          table: 'geo',
          sql: 'SELECT * FROM `geo`',
          displayOptionsForm: true,
          pftext: 'P',
          geoOption: 'WKB',
          displayBinary: true,
        },
      ],
    ]
    const shown: string[] = []
    for (const [form, body] of steps) {
      const html = await pmaGrid(form)
      const g = await ourGrid(body)
      expect(
        g.rows.map((r) => r.cells.map(ourText)),
        JSON.stringify(form),
      ).toEqual(pmaCells(html))
      // never grid-editable
      expect(g.rows.some((r) => /\bgrid_edit\b/.test(r.cells[1]!.cls))).toBe(false)
      expect(/<td data-decimals[^>]*data-type="geometry"[^>]*class="[^"]*grid_edit/.test(html)).toBe(false)
      shown.push(ourText(g.rows[0]!.cells[1]!))
    }
    expect(shown[0]).toMatch(/^\[GEOMETRY - \d+ B\]$/)
    expect(shown[1]).toBe('POINT(1 2)')
    expect(shown[2]).toBe('0101000000000000000000f03f0000000000000040')
  })
})
