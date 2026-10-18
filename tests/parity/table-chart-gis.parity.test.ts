import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { svgDocument, svgShapes } from '../../apps/web/src/features/gis/visualization.ts'
import { normalise } from './lib/compare.ts'
import { findForm, serializeForm } from './lib/form.ts'
import { type Harness, both, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of the query results' Display chart and Visualize GIS data
 * (docs/features/04-table-level.md): the chart form's columns and fieldset, the rows of the
 * chart's ajax submit, the GIS candidates, the modified GIS query and phpMyAdmin's inline SVG,
 * byte for byte, against the client's renderer fed with our rows.
 */
const users = { pma: 'f04_cg_pma', bma: 'f04_cg_bma' }
const P = 'f04_cgp'
const B = 'f04_cgb'
const dbMap: Record<string, string> = { [P]: 'DB', [B]: 'DB', [users.pma]: 'USER', [users.bma]: 'USER' }
let h: Harness
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })

const seed = (db: string) => `
DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db};
CREATE TABLE ${db}.t (id INT PRIMARY KEY, name VARCHAR(10), qty DECIMAL(6,2), d DATETIME, g GEOMETRY);
INSERT INTO ${db}.t VALUES
  (1, 'a', 1.5, '2024-01-01 10:00:00', ST_GeomFromText('POINT(1 2)')),
  (2, 'b', 2.5, '2024-01-02 11:00:00', ST_GeomFromText('LINESTRING(0 0,3 4,6 1)')),
  (3, 'c', 7, '2024-01-03 12:00:00', ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0),(2 2,4 2,4 4,2 4,2 2))')),
  (4, 'd', 3.25, NULL, ST_GeomFromText('MULTIPOINT((5 5),(7 8))')),
  (5, 'e', 4, '2024-01-05 00:00:00', ST_GeomFromText('GEOMETRYCOLLECTION(POINT(9 9),LINESTRING(1 9,9 1))')),
  (6, 'f', 5, '2024-01-06 00:00:00', ST_GeomFromText('MULTIPOLYGON(((20 20,25 20,25 25,20 20)),((30 30,35 30,35 35,30 30)))')),
  (7, 'g', 6, '2024-01-07 00:00:00', ST_GeomFromText('MULTILINESTRING((0 5,5 0),(1 1,2 2,3 1))'));
`

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness({}, users)
  await h.root.query(seed(P) + seed(B))
})
afterAll(async () => {
  await h?.root.query(`DROP DATABASE IF EXISTS ${P}; DROP DATABASE IF EXISTS ${B}`)
  await h?.close()
})

const bma = (path: string) => `/api/servers/1/databases/${B}/tables/t${path}`
const sql = 'SELECT id, name, qty, d FROM t ORDER BY id'

/** the statements each tool ran for the request (reads included), databases masked */
const statements = (log: Array<{ sql: string }>) =>
  log.map((e) => normalise(e.sql, dbMap)).filter((s) => /FROM (t\b|\(SELECT \* FROM t\))/.test(s))

describe.skipIf(!pmaReachable)('parity: Display chart', () => {
  it('the form: columns, numeric and date-time columns, the fieldset [p04-bc6299]', async () => {
    const r = await both(
      h,
      () =>
        h.pma.postPage('/table/chart', [
          ['db', P],
          ['table', 't'],
          ['sql_query', sql],
          ['unlim_num_rows', '7'],
          ['pos', '0'],
          ['session_max_rows', '5'],
        ]),
      () => h.bma.req('POST', bma('/chart'), { sql, unlimNumRows: 7, pos: 0, sessionMaxRows: 5 }),
    )
    const html = String(r.p)
    const pairs = new Map(serializeForm(findForm(html, { id: 'tblchartform' })))
    const b = r.b.json as {
      columns: Array<{ name: string; numeric: boolean; dateTime: boolean }>
      fieldset: { pos: number; rows: number; unlimNumRows: number }
    }
    const idx = (f: (c: { numeric: boolean; dateTime: boolean }) => boolean) =>
      b.columns.flatMap((c, i) => (f(c) ? [`${i} `] : [])).join('')
    expect(pairs.get('numericCols')).toBe(idx((c) => c.numeric))
    expect(pairs.get('dateTimeCols')).toBe(idx((c) => c.dateTime))
    const xOptions =
      [...html.matchAll(/<select[^>]*id="chartXAxisSelect"[^>]*>([\s\S]*?)<\/select>/g)][0]?.[1] ?? ''
    expect(b.columns.map((c) => c.name)).toEqual(
      [...xOptions.matchAll(/>([^<]+)<\/option>/g)].map((m) => m[1]),
    )
    expect(String(b.fieldset.pos)).toBe(pairs.get('pos'))
    expect(String(b.fieldset.rows)).toBe(pairs.get('session_max_rows'))
    expect(String(b.fieldset.unlimNumRows)).toBe(pairs.get('unlim_num_rows'))
    expect(pairs.get('xAxisLabelInput')).toBe('id')
  })

  it("the form's submit: the query with the form's LIMIT and its rows [p04-bc6299]", async () => {
    const r = await both(
      h,
      () =>
        h.pma.postJson('/table/chart', [
          ['db', P],
          ['table', 't'],
          ['sql_query', sql],
          ['pos', '2'],
          ['session_max_rows', '3'],
        ]),
      () => h.bma.req('POST', bma('/chart/data'), { sql, pos: 2, sessionMaxRows: 3 }),
    )
    expect(statements(r.bmaLog)).toEqual(statements(r.pmaLog))
    const p = JSON.parse((r.p as { chartData: string }).chartData)
    expect((r.b.json as { data: unknown }).data).toEqual(p)
  })

  it('the errors: no numeric column, no data', async () => {
    let r = await both(
      h,
      () =>
        h.pma.postJson('/table/chart', [
          ['db', P],
          ['table', 't'],
          ['sql_query', 'SELECT name FROM t'],
        ]),
      () => h.bma.req('POST', bma('/chart'), { sql: 'SELECT name FROM t' }),
    )
    expect(JSON.stringify(r.p)).toContain('No numeric columns present in the table to plot.')
    expect((r.b.json as { error: string }).error).toBe('No numeric columns present in the table to plot.')
    r = await both(
      h,
      () =>
        h.pma.postJson('/table/chart', [
          ['db', P],
          ['table', 't'],
          ['sql_query', sql],
          ['pos', '50'],
          ['session_max_rows', '3'],
        ]),
      () => h.bma.req('POST', bma('/chart/data'), { sql, pos: 50, sessionMaxRows: 3 }),
    )
    expect(JSON.stringify(r.p)).toContain('No data to display')
    expect((r.b.json as { error: string }).error).toBe('No data to display')
  })
})

/** COM_INIT_DB is logged as `USE \`db\`` (lib/general-log.ts) */
const uses = (log: Array<{ sql: string }>) => log.map((e) => e.sql).filter((x) => x.startsWith('USE '))

describe.skipIf(!pmaReachable)('parity: Display chart of a result without a table', () => {
  const raw = 'SELECT 1 AS a, 2.5 AS b UNION SELECT 3, 4.5'
  it('database level: the form and the rows', async () => {
    const r = await both(
      h,
      () =>
        h.pma.postPage('/table/chart', [
          ['db', P],
          ['sql_query', raw],
          ['unlim_num_rows', '2'],
          ['pos', '0'],
          ['session_max_rows', '25'],
        ]),
      () =>
        h.bma.req('POST', `/api/servers/1/databases/${B}/chart`, {
          sql: raw,
          unlimNumRows: 2,
          pos: 0,
          sessionMaxRows: 25,
        }),
    )
    const pairs = new Map(serializeForm(findForm(String(r.p), { id: 'tblchartform' })))
    const b = r.b.json as { error: string | null; columns: Array<{ numeric: boolean }> }
    expect(b.error).toBeNull()
    expect(pairs.get('numericCols')).toBe(b.columns.flatMap((c, i) => (c.numeric ? [`${i} `] : [])).join(''))
    const d = await both(
      h,
      () =>
        h.pma.postJson('/table/chart', [
          ['db', P],
          ['sql_query', raw],
          ['pos', '0'],
          ['session_max_rows', '25'],
        ]),
      () =>
        h.bma.req('POST', `/api/servers/1/databases/${B}/chart/data`, {
          sql: raw,
          pos: 0,
          sessionMaxRows: 25,
        }),
    )
    // the page selects the database, the ajax submit (no table) does not
    expect(uses(r.bmaLog)).toEqual(uses(r.pmaLog).map((x) => x.replace(P, B)))
    expect(uses(d.bmaLog)).toEqual(uses(d.pmaLog))
    expect((d.b.json as { data: unknown }).data).toEqual(JSON.parse((d.p as { chartData: string }).chartData))
  })

  it('server level: the rows (mysql selected for a super user)', async () => {
    const d = await both(
      h,
      () =>
        h.pma.postJson('/table/chart', [
          ['sql_query', raw],
          ['pos', '0'],
          ['session_max_rows', '25'],
        ]),
      () =>
        h.bma.req('POST', '/api/servers/1/visualization/chart/data', {
          sql: raw,
          pos: 0,
          sessionMaxRows: 25,
        }),
    )
    expect((d.b.json as { data: unknown }).data).toEqual(JSON.parse((d.p as { chartData: string }).chartData))

    expect(uses(d.bmaLog)).toEqual(uses(d.pmaLog))
    // the page selects `mysql` for a super user
    const p = await both(
      h,
      () =>
        h.pma.postPage('/table/chart', [
          ['sql_query', raw],
          ['unlim_num_rows', '2'],
        ]),
      () => h.bma.req('POST', '/api/servers/1/visualization/chart', { sql: raw, unlimNumRows: 2 }),
    )
    expect(uses(p.pmaLog)).toContain('USE `mysql`')
    expect(uses(p.bmaLog)).toEqual(uses(p.pmaLog))
  })

  it('GIS without a database: Missing parameter', async () => {
    const r = await both(
      h,
      () => h.pma.postPage('/table/gis-visualization', [['sql_query', 'SELECT POINT(1, 2) AS g']]),
      () => h.bma.req('POST', '/api/servers/1/visualization/gis', { sql: 'SELECT POINT(1, 2) AS g' }),
    )
    expect(String(r.p)).toContain('Missing parameter: db')
    expect((r.b.json as { error: string }).error).toBe('Missing parameter: db')
  })
})

describe.skipIf(!pmaReachable)('parity: GIS visualization', () => {
  const gisSql = 'SELECT * FROM t'
  it('the candidates, the modified query and the SVG, byte for byte [p04-1f3c9c]', async () => {
    const r = await both(
      h,
      () =>
        h.pma.postPage('/table/gis-visualization', [
          ['db', P],
          ['table', 't'],
          ['sql_query', gisSql],
          ['pos', '0'],
          ['session_max_rows', '25'],
          ['visualizationSettings[labelColumn]', 'name'],
          ['visualizationSettings[spatialColumn]', 'g'],
        ]),
      () =>
        h.bma.req('POST', bma('/gis'), {
          sql: gisSql,
          pos: 0,
          sessionMaxRows: 25,
          labelColumn: 'name',
          spatialColumn: 'g',
        }),
    )
    expect(statements(r.bmaLog)).toEqual(statements(r.pmaLog))
    const html = String(r.p)
    const b = r.b.json as {
      labelCandidates: string[]
      spatialCandidates: string[]
      rows: Array<{ wkt: string | null; label: string }>
      width: number
      height: number
    }
    const options = (id: string) =>
      [
        ...(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html)?.[1] ?? '').matchAll(
          /<option value="([^"]*)"/g,
        ),
      ].map((m) => m[1])
    expect(['', ...b.labelCandidates]).toEqual(options('labelColumn'))
    expect(b.spatialCandidates).toEqual(options('spatialColumn'))
    const svg = /<div class="visualization-target visualization-target-svg hide">([\s\S]*?<\/svg>)/.exec(
      html,
    )?.[1]
    expect(svg).toBe(svgDocument(svgShapes(b.rows, b.width, b.height), b.width, b.height))
  })

  it('no spatial column', async () => {
    const r = await both(
      h,
      () =>
        h.pma.postPage('/table/gis-visualization', [
          ['db', P],
          ['table', 't'],
          ['sql_query', 'SELECT id FROM t'],
        ]),
      () => h.bma.req('POST', bma('/gis'), { sql: 'SELECT id FROM t' }),
    )
    expect(String(r.p)).toContain('No spatial column found for this SQL query.')
    expect((r.b.json as { error: string }).error).toBe('No spatial column found for this SQL query.')
  })
})
