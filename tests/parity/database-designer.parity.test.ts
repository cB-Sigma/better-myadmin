import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { compareWrites, normalise } from './lib/compare.ts'
import { type Harness, both, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of the Designer and the relational schema export (docs/features/05-database-level.md):
 * the configuration-storage writes of pages, positions, display fields, internal relations and
 * designer settings, the FOREIGN KEYs added and dropped from the canvas, the canvas data, and the
 * exported SVG / Dia / EPS bytes. Both tools use the control user `pma` and the `phpmyadmin` storage.
 */
const users = { pma: 'f05d_pma', bma: 'f05d_bma' }
const P = 'f05d_dp'
const B = 'f05d_db'
const CONTROL = { pma: 'pma', bma: 'pma' }
const dbMap: Record<string, string> = { [P]: 'DB', [B]: 'DB', [users.pma]: 'USER', [users.bma]: 'USER' }
let h: Harness
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })

const seed = (db: string) => `
DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db} DEFAULT CHARSET utf8mb4;
CREATE TABLE ${db}.parent (id INT PRIMARY KEY, name VARCHAR(20), KEY k (name)) ENGINE=InnoDB;
CREATE TABLE ${db}.child (id INT PRIMARY KEY, parent_id INT, note_text TEXT, born DATE,
  KEY kp (parent_id), CONSTRAINT fk_parent FOREIGN KEY (parent_id) REFERENCES ${db}.parent (id)) ENGINE=InnoDB;
CREATE TABLE ${db}.m1 (id INT PRIMARY KEY, label VARCHAR(10)) ENGINE=MyISAM;
CREATE TABLE ${db}.m2 (id INT PRIMARY KEY, m1_id INT, price DECIMAL(5,2)) ENGINE=MyISAM;
`
const cleanPmadb = (db: string) => `
DELETE FROM phpmyadmin.pma__table_coords WHERE db_name = '${db}';
DELETE FROM phpmyadmin.pma__pdf_pages WHERE db_name = '${db}';
DELETE FROM phpmyadmin.pma__table_info WHERE db_name = '${db}';
DELETE FROM phpmyadmin.pma__relation WHERE master_db = '${db}' OR foreign_db = '${db}';`
const cleanSettings = `DELETE FROM phpmyadmin.pma__designer_settings WHERE username IN ('${users.pma}', '${users.bma}');`

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness({}, users, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' })
  await h.root.query(seed(P) + seed(B) + cleanPmadb(P) + cleanPmadb(B) + cleanSettings)
})
afterAll(async () => {
  await h?.root.query(
    `${cleanPmadb(P)}${cleanPmadb(B)}${cleanSettings} DROP DATABASE IF EXISTS ${P}; DROP DATABASE IF EXISTS ${B}`,
  )
  await h?.close()
})

const bma = (path: string) => `/api/servers/1/databases/${B}${path}`
const mask = (s: string) => normalise(s, dbMap)
/** page ids are AUTO_INCREMENT values of one shared table: compared through their names */
const maskPages = (s: string) =>
  mask(s)
    .replace(/(pdf_page_number|page_nr)` = '?\d+'?/g, '$1` = <PAGE>')
    .replace(/(pma__table_coords`.* VALUES \('[^']*', '[^']*', )'\d+'/, "$1'<PAGE>'")

async function query(sql: string, args: unknown[]): Promise<Array<Record<string, unknown>>> {
  const [r] = await h.root.query(sql, args)
  return (r as Array<Record<string, unknown>>).map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' ? mask(v) : v])),
  )
}

/** The pages of a database with their coordinates (page ids replaced by names). */
const pages = async (db: string) =>
  query(
    `SELECT p.page_descr, c.table_name, c.x, c.y FROM phpmyadmin.pma__pdf_pages p
       LEFT JOIN phpmyadmin.pma__table_coords c ON c.pdf_page_number = p.page_nr AND c.db_name = p.db_name
     WHERE p.db_name = ? ORDER BY p.page_descr, c.table_name`,
    [db],
  )
const pageId = async (db: string, name: string): Promise<string> =>
  String(
    (
      await query('SELECT page_nr FROM phpmyadmin.pma__pdf_pages WHERE db_name = ? AND page_descr = ?', [
        db,
        name,
      ])
    )[0]?.page_nr ?? '0',
  )
const tableInfo = (db: string) =>
  query(
    'SELECT table_name, display_field FROM phpmyadmin.pma__table_info WHERE db_name = ? ORDER BY table_name',
    [db],
  )
const relations = (db: string) =>
  query(
    'SELECT master_table, master_field, foreign_db, foreign_table, foreign_field FROM phpmyadmin.pma__relation WHERE master_db = ? ORDER BY master_table, master_field',
    [db],
  )
const settings = async (user: string) =>
  (await query('SELECT settings_data FROM phpmyadmin.pma__designer_settings WHERE username = ?', [user]))[0]
    ?.settings_data ?? null

/** Control-user writes about this suite (the user is shared with other suites). */
function controlWrites(r: { pmaLog: Array<{ sql: string }>; bmaLog: Array<{ sql: string }> }) {
  // RecentTableHandling records any request with db and table parameters (the designer's AJAX calls
  // too); our SPA records the opened table itself (POST /recent), like the other suites exclude it.
  // On a pmadb where the table is already the most recent one phpMyAdmin skips the write.
  const w = compareWrites(r.pmaLog as never, r.bmaLog as never, dbMap, [
    /^\/\*NOTRACK\*\/\s*SELECT/,
    /`pma__recent`/,
  ])
  const mine = (xs: string[]) => xs.filter((s) => s.includes("'DB'") || s.includes("'USER'")).map(maskPages)
  return { pma: mine(w.pma), bma: mine(w.bma) }
}

const designerPost = (form: Array<[string, string]>) =>
  h.pma.postJson('/database/designer', [['db', P], ...form])

/** DesignerMove.getUrlPos: t_x[i] … t_tbl[i] from 1 */
const positionsForm = (db: string, tables: Array<{ t: string; x: number; y: number; h?: boolean }>) =>
  tables.flatMap(
    (p, i): Array<[string, string]> => [
      [`t_x[${i + 1}]`, String(p.x)],
      [`t_y[${i + 1}]`, String(p.y)],
      [`t_v[${i + 1}]`, '1'],
      [`t_h[${i + 1}]`, p.h === false ? '0' : '1'],
      [`t_db[${i + 1}]`, db],
      [`t_tbl[${i + 1}]`, p.t],
    ],
  )
const positionsBody = (db: string, tables: Array<{ t: string; x: number; y: number; h?: boolean }>) =>
  tables.map((p) => ({ x: String(p.x), y: String(p.y), v: true, h: p.h !== false, db, table: p.t }))

const layout = [
  { t: 'parent', x: 20, y: 30 },
  { t: 'child', x: 300, y: 120 },
  { t: 'm1', x: 50, y: 250 },
  { t: 'm2', x: 400, y: 300, h: false },
]

describe.skipIf(!pmaReachable)('parity: designer pages', () => {
  it('savePage new: the page and the shown tables’ coordinates', async () => {
    const r = await both(
      h,
      () =>
        designerPost([
          ['operation', 'savePage'],
          ['save_page', 'new'],
          ['selected_value', `${P}_first`],
          ...positionsForm(P, layout),
        ]),
      () =>
        h.bma.req('POST', bma('/designer/save-page'), {
          save_page: 'new',
          selected_value: `${B}_first`,
          tables: positionsBody(B, layout),
        }),
      CONTROL,
    )
    const w = controlWrites(r)
    expect(w.bma).toEqual(w.pma)
    expect(w.pma.length).toBeGreaterThan(0)
    expect(await pages(B)).toEqual(await pages(P))
    expect(r.p.success).toBe(true)
    expect(typeof r.p.id).toBe('number')
    expect((r.b.json as { id: number }).id).toBeGreaterThan(0)
  })

  it('savePage new with a taken name: the message, nothing written', async () => {
    const r = await both(
      h,
      () =>
        designerPost([
          ['operation', 'savePage'],
          ['save_page', 'new'],
          ['selected_value', `${P}_first`],
        ]),
      () =>
        h.bma.req('POST', bma('/designer/save-page'), {
          save_page: 'new',
          selected_value: `${B}_first`,
          tables: [],
        }),
      CONTROL,
    )
    const w = controlWrites(r)
    expect(w.bma).toEqual(w.pma)
    expect(r.p.success).toBe(false)
    expect((r.b.json as { message: string }).message).toBe(
      `There already exists a page named "${B}_first" please rename it to something else.`,
    )
  })

  it('savePage same: the coordinates are replaced', async () => {
    const moved = [
      { t: 'parent', x: 40, y: 60 },
      { t: 'child', x: 310, y: 130, h: false },
    ]
    const r = await both(
      h,
      async () =>
        designerPost([
          ['operation', 'savePage'],
          ['save_page', 'same'],
          ['selected_page', await pageId(P, `${P}_first`)],
          ...positionsForm(P, moved),
        ]),
      async () =>
        h.bma.req('POST', bma('/designer/save-page'), {
          save_page: 'same',
          selected_page: await pageId(B, `${B}_first`),
          tables: positionsBody(B, moved),
        }),
      CONTROL,
    )
    const w = controlWrites(r)
    expect(w.bma).toEqual(w.pma)
    expect(await pages(B)).toEqual(await pages(P))
  })

  it('the canvas: page loaded, positions, shown tables, relations, display field', async () => {
    await h.root.query(
      `INSERT INTO phpmyadmin.pma__pdf_pages (db_name, page_descr) VALUES ('${P}', '${P}'), ('${B}', '${B}');`,
    )
    const pp = await pageId(P, P)
    const bp = await pageId(B, B)
    await h.root.query(
      `INSERT INTO phpmyadmin.pma__table_coords (db_name, table_name, pdf_page_number, x, y) VALUES
       ('${P}', 'child', ${pp}, 111, 222), ('${B}', 'child', ${bp}, 111, 222);`,
    )
    const html = await h.pma.getPage('/database/designer', { db: P })
    const res = await h.bma.req('GET', bma('/designer'))
    const d = res.json as {
      displayPage: number
      selectedPage: string
      tables: Array<{
        table: string
        x: number
        y: number
        onPage: boolean
        supportsFk: boolean
        columns: Array<{ name: string; icon: string }>
      }>
      relations: Array<{
        constraint: string
        masterTable: string
        masterField: string
        foreignTable: string
        foreignField: string
      }>
    }
    // the default page (named after the database) is loaded
    expect(d.displayPage).toBe(Number(bp))
    expect(html).toMatch(new RegExp(`<span id="page_name">\\s*${P}\\s*</span>`))
    expect(d.selectedPage).toBe(B)
    // saved tables at their place and shown, the others hidden
    const child = d.tables.find((t) => t.table === 'child')
    expect(child).toMatchObject({ x: 111, y: 222, onPage: true })
    expect(html).toMatch(new RegExp(`id="${P}\\.child"[\\s\\S]*?left:111px; top:222px; display:block;`))
    expect(html).toMatch(new RegExp(`id="${P}\\.parent"[\\s\\S]*?display:none;`))
    expect(d.tables.filter((t) => t.onPage).map((t) => t.table)).toEqual(['child'])
    // column icons
    const icons = [
      ...html.matchAll(/<img src="[^"]*\/(designer\/[A-Za-z_]+)\.png" alt="\*">\s*(\S+) :/g),
    ].map((m) => `${m[2]}=${m[1]}`)
    expect(d.tables.flatMap((t) => t.columns.map((c) => `${c.name}=${c.icon}`))).toEqual(icons)
    // designerConfig: j_tabs and the relations (scriptContr)
    const cfg = JSON.parse(html.match(/window\.designerConfig = (\{.*\});/)?.[1] ?? '{}') as {
      scriptTables: { j_tabs: Record<string, number> }
      scriptContr: Array<Record<string, Record<string, Record<string, [string, string]>>>>
    }
    expect(d.tables.map((t) => `${t.table}=${t.supportsFk ? 1 : 0}`)).toEqual(
      Object.entries(cfg.scriptTables.j_tabs).map(([k, v]) => `${decodeURIComponent(k).split('.')[1]}=${v}`),
    )
    const contr = cfg.scriptContr.flatMap((e) =>
      Object.entries(e).flatMap(([c, by]) =>
        Object.entries(by).flatMap(([m, fields]) =>
          Object.entries(fields).map(([f, [ft, ff]]) =>
            mask(`${c}|${decodeURIComponent(m)}.${f}->${decodeURIComponent(ft)}.${ff}`),
          ),
        ),
      ),
    )
    expect(
      d.relations.map((x) =>
        mask(`${x.constraint}|${x.masterTable}.${x.masterField}->${x.foreignTable}.${x.foreignField}`),
      ),
    ).toEqual(contr)
  })

  it('deletePage: the page and its coordinates', async () => {
    const r = await both(
      h,
      async () =>
        designerPost([
          ['operation', 'deletePage'],
          ['selected_page', await pageId(P, `${P}_first`)],
        ]),
      async () =>
        h.bma.req('POST', bma('/designer/delete-page'), { selected_page: await pageId(B, `${B}_first`) }),
      CONTROL,
    )
    const w = controlWrites(r)
    expect(w.bma).toEqual(w.pma)
    expect(await pages(B)).toEqual(await pages(P))
    expect((await pages(B)).map((x) => x.page_descr)).toEqual(['DB'])
  })
})

describe.skipIf(!pmaReachable)('parity: display field, relations, settings', () => {
  it('setDisplayField, then clear it', async () => {
    for (const field of ['name', '']) {
      const r = await both(
        h,
        () =>
          designerPost([
            ['operation', 'setDisplayField'],
            ['table', 'parent'],
            ['field', field],
          ]),
        () => h.bma.req('POST', bma('/designer/display-field'), { db: B, table: 'parent', field }),
        CONTROL,
      )
      const w = controlWrites(r)
      expect(w.bma).toEqual(w.pma)
      expect(await tableInfo(B)).toEqual(await tableInfo(P))
      expect(r.p.success).toBe(true)
    }
  })

  it('addNewRelation between MyISAM tables: an internal relation', async () => {
    const rel = (db: string) => ({
      DB1: db,
      T1: 'm1',
      F1: 'id',
      DB2: db,
      T2: 'm2',
      F2: 'm1_id',
      on_delete: 'nix',
      on_update: 'nix',
    })
    const r = await both(
      h,
      () =>
        designerPost([
          ['operation', 'addNewRelation'],
          ...(Object.entries(rel(P)) as Array<[string, string]>),
        ]),
      () => h.bma.req('POST', bma('/designer/add-relation'), rel(B)),
      CONTROL,
    )
    const w = controlWrites(r)
    expect(w.bma).toEqual(w.pma)
    expect(await relations(B)).toEqual(await relations(P))
    expect((r.b.json as { message: { text: string } }).message.text).toBe(
      'Internal relationship has been added.',
    )
    expect(String(r.p.message)).toContain('Internal relationship has been added.')
  })

  it('addNewRelation between InnoDB tables: a FOREIGN KEY; then the missing index and the duplicate', async () => {
    const add = (db: string, f2: string) => ({
      DB1: db,
      T1: 'parent',
      F1: 'id',
      DB2: db,
      T2: 'child',
      F2: f2,
      on_delete: 'CASCADE',
      on_update: 'nix',
    })
    const cases: Array<[string, string]> = [
      ['id', 'FOREIGN KEY relationship has been added.'],
      ['note_text', 'Error: Missing index on column(s).'],
      ['parent_id', 'Error: relationship already exists.'],
    ]
    for (const [f2, text] of cases) {
      const r = await both(
        h,
        () =>
          designerPost([
            ['operation', 'addNewRelation'],
            ...(Object.entries(add(P, f2)) as Array<[string, string]>),
          ]),
        () => h.bma.req('POST', bma('/designer/add-relation'), add(B, f2)),
      )
      const w = compareWrites(r.pmaLog as never, r.bmaLog as never, dbMap)
      expect(w.bma).toEqual(w.pma)
      expect((r.b.json as { message: { text: string } }).message.text).toBe(text)
      expect(String(r.p.message ?? r.p.error)).toContain(text)
    }
    const [[a], [b]] = (await Promise.all([
      h.root.query(`SHOW CREATE TABLE ${P}.child`),
      h.root.query(`SHOW CREATE TABLE ${B}.child`),
    ])) as unknown as Array<Array<Record<string, string>>>
    expect(mask(String(b?.['Create Table']))).toBe(mask(String(a?.['Create Table'])))
  })

  it('removeRelation: the FOREIGN KEY dropped, then the internal relation deleted', async () => {
    const fk = (db: string) => ({ T1: `${db}.parent`, F1: 'id', T2: `${db}.child`, F2: 'id' })
    const internal = (db: string) => ({ T1: `${db}.m1`, F1: 'id', T2: `${db}.m2`, F2: 'm1_id' })
    for (const [body, text] of [
      [fk, 'FOREIGN KEY relationship has been removed.'],
      [internal, 'Internal relationship has been removed.'],
    ] as const) {
      const r = await both(
        h,
        () =>
          designerPost([
            ['operation', 'removeRelation'],
            ...(Object.entries(body(P)) as Array<[string, string]>),
          ]),
        () => h.bma.req('POST', bma('/designer/remove-relation'), body(B)),
        CONTROL,
      )
      expect((r.b.json as { message: { text: string } }).message.text).toBe(text)
      expect(String(r.p.message)).toContain(text)
    }
    expect(await relations(B)).toEqual(await relations(P))
  })

  it('save_setting_value: inserted, then merged into the JSON', async () => {
    for (const [index, value] of [
      ['angular_direct', 'angular'],
      ['snap_to_grid', 'on'],
      ['relation_lines', 'false'],
    ]) {
      const r = await both(
        h,
        () =>
          designerPost([
            ['operation', 'save_setting_value'],
            ['index', index],
            ['value', value],
          ]),
        () => h.bma.req('POST', bma('/designer/setting'), { index, value }),
        CONTROL,
      )
      const w = controlWrites(r)
      expect(w.bma).toEqual(w.pma)
    }
    expect(await settings(users.bma)).toBe(await settings(users.pma))
    expect(await settings(users.bma)).toBe(
      '{"angular_direct":"angular","snap_to_grid":"on","relation_lines":"false"}',
    )
    // the side menu reads them back
    const d = (await h.bma.req('GET', bma('/designer'))).json as { sideMenu: Record<string, boolean> }
    expect(d.sideMenu).toMatchObject({ angular_direct: true, snap_to_grid: true, relation_lines: true })
    const html = await h.pma.getPage('/database/designer', { db: P })
    expect(html).toMatch(/class="M_butt_Selected_down" id="angular_direct_button"/)
    expect(html).toMatch(/class="M_butt_Selected_down" id="grid_button"/)
    expect(html).toMatch(/id="relLineInvert" class="M_butt_Selected_down"/)
  })
})

describe.skipIf(!pmaReachable)('parity: relational schema export', () => {
  const tables = [
    { t: 'parent', x: 20, y: 30 },
    { t: 'child', x: 300, y: 120 },
    { t: 'm1', x: 50, y: 250 },
    { t: 'm2', x: 400, y: 300 },
  ]
  beforeAll(async () => {
    if (!pmaReachable) return
    // internal relations so the SVG draws its lines too (it skips tables without one)
    await h.root.query(
      `INSERT INTO phpmyadmin.pma__relation (master_db, master_table, master_field, foreign_db, foreign_table, foreign_field) VALUES
       ('${P}', 'm2', 'm1_id', '${P}', 'm1', 'id'), ('${B}', 'm2', 'm1_id', '${B}', 'm1', 'id');`,
    )
  })

  const run = async (type: string, options: Record<string, string>) => {
    let disposition = ''
    const p = await h.pma.postPage(
      '/schema-export',
      [
        ['db', P],
        ['page_number', '-1'],
        ['offline_export', 'true'],
        ['export_type', type],
        ...Object.entries(options),
        ...positionsForm(P, tables),
      ],
      {
        onHeaders: (_s, headers) => {
          disposition = headers.get('content-disposition') ?? ''
        },
      },
    )
    const b = (
      await h.bma.req('POST', bma('/schema-export'), {
        page_number: '-1',
        offline_export: true,
        export_type: type,
        options,
        tables: positionsBody(B, tables),
      })
    ).json as { fileName: string; data: string }
    // byte for byte, the database names aside
    const exact = (x: string) => x.replaceAll(P, 'DB').replaceAll(B, 'DB')
    return { p: exact(p), b: exact(b.data), disposition: exact(disposition), fileName: exact(b.fileName) }
  }

  it('SVG (relations, table dimensions, same width)', async () => {
    const r = await run('svg', { svg_show_table_dimension: 'y', svg_all_tables_same_width: 'y' })
    expect(r.b).toBe(r.p)
    expect(r.b).toContain('<line ')
    expect(r.disposition).toContain(`filename="${r.fileName}"`)
  })

  it('Dia (keys only, landscape, letter)', async () => {
    const r = await run('dia', { dia_show_keys: 'y', dia_orientation: 'L', dia_paper: 'letter' })
    expect(r.b).toBe(r.p)
    expect(r.b).toContain('Database - Reference')
  })

  it('EPS (portrait), creator and creation date aside', async () => {
    const r = await run('eps', { eps_orientation: 'P', eps_show_table_dimension: 'y' })
    const stable = (s: string) =>
      s.replace(/^%%Creator: .*$/m, '%%Creator:').replace(/^%%CreationDate: .*$/m, '%%CreationDate:')
    expect(stable(r.b)).toBe(stable(r.p))
    expect(r.b).toContain('lineto')
  })

  it('a missing table: the schema error', async () => {
    const p = await h.pma.postPage('/schema-export', [
      ['db', P],
      ['page_number', '-1'],
      ['export_type', 'svg'],
      ...positionsForm(P, [{ t: 'nope', x: 0, y: 0 }]),
    ])
    const b = await h.bma.req('POST', bma('/schema-export'), {
      export_type: 'svg',
      tables: positionsBody(B, [{ t: 'nope', x: 0, y: 0 }]),
    })
    expect(p).toContain('The nope table doesn&#039;t exist!')
    expect(p).toContain('SCHEMA ERROR: SVG')
    expect(JSON.stringify(b.json)).toContain("SCHEMA ERROR: SVG The nope table doesn't exist!")
  })
})
