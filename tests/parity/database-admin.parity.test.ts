import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { compareWrites, normalise } from './lib/compare.ts'
import { type Harness, both, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of the database-level administration pages (docs/features/05-database-level.md):
 * central columns (and the Structure bulk actions on the central list), tracking, the data
 * dictionary and the read-only Privileges tab. Both tools use the control user `pma` and the
 * `phpmyadmin` configuration storage; the rows each tool leaves there are compared too.
 */
const users = { pma: 'f05_ad_pma', bma: 'f05_ad_bma' }
const P = 'f05_adp'
const B = 'f05_adb'
const CONTROL = { pma: 'pma', bma: 'pma' }
const dbMap: Record<string, string> = { [P]: 'DB', [B]: 'DB', [users.pma]: 'USER', [users.bma]: 'USER' }
let h: Harness
// phpMyAdmin answers slowly while other suites run
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })

const seed = (db: string, user: string) => `
DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db} DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE TABLE ${db}.parent (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(20) COLLATE utf8mb4_bin DEFAULT 'x' COMMENT 'the name',
  created TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  KEY k_name (name(5))
) ENGINE=InnoDB COMMENT='parents';
CREATE TABLE ${db}.child (
  id INT NOT NULL PRIMARY KEY,
  parent_id INT UNSIGNED,
  name VARCHAR(40),
  CONSTRAINT fk_p FOREIGN KEY (parent_id) REFERENCES ${db}.parent (id)
) ENGINE=InnoDB;
CREATE TABLE ${db}.other (x INT, note TEXT);
CREATE DEFINER='${user}'@'%' VIEW ${db}.v AS SELECT id, name FROM ${db}.parent;
GRANT SELECT, INSERT ON ${db}.* TO '${user}'@'%';
`
const cleanPmadb = (db: string) =>
  `DELETE FROM phpmyadmin.pma__central_columns WHERE db_name = '${db}'; DELETE FROM phpmyadmin.pma__tracking WHERE db_name = '${db}';`

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness({}, users, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' })
  await h.root.query(seed(P, users.pma) + seed(B, users.bma) + cleanPmadb(P) + cleanPmadb(B))
})
afterAll(async () => {
  await h?.root.query(
    `${cleanPmadb(P)}${cleanPmadb(B)} DROP DATABASE IF EXISTS ${P}; DROP DATABASE IF EXISTS ${B}`,
  )
  await h?.close()
})

const bma = (path: string) => `/api/servers/1/databases/${B}${path}`
const mask = (s: string) =>
  normalise(s, dbMap)
    .replace(/'\d{4}-\d\d-\d\d \d\d:\d\d:\d\d'/g, "'<TS>'")
    .replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/g, '<TS>')

async function rows(table: string, db: string, order: string): Promise<Array<Record<string, unknown>>> {
  const [r] = await h.root.query(`SELECT * FROM phpmyadmin.${table} WHERE db_name = ? ORDER BY ${order}`, [
    db,
  ])
  return (r as Array<Record<string, unknown>>).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        typeof v === 'string'
          ? mask(v)
          : v instanceof Date
            ? '<TS>'
            : Buffer.isBuffer(v)
              ? mask(v.toString())
              : v,
      ]),
    ),
  )
}

const central = async () => ({
  p: await rows('pma__central_columns', P, 'col_name'),
  b: await rows('pma__central_columns', B, 'col_name'),
})

/**
 * The control-user writes about this suite's database (the control user is shared with other
 * suites; phpMyAdmin's per-request `/*NOTRACK*\/ SELECT` tracking probe is a read).
 */
function controlWrites(r: { pmaLog: Array<{ sql: string }>; bmaLog: Array<{ sql: string }> }) {
  const w = compareWrites(r.pmaLog as never, r.bmaLog as never, dbMap, [/^\/\*NOTRACK\*\/\s*SELECT/])
  const mine = (xs: string[]) => xs.filter((s) => s.includes("'DB'")).map(mask)
  return { pma: mine(w.pma), bma: mine(w.bma) }
}

/** The control-user writes of both tools are the same, and so are the central list rows. */
async function centralStep(pmaAction: () => Promise<unknown>, bmaAction: () => Promise<unknown>) {
  const r = await both(h, pmaAction, bmaAction, CONTROL)
  const w = controlWrites(r)
  expect(w.bma).toEqual(w.pma)
  const c = await central()
  expect(c.b).toEqual(c.p)
  return r
}

const centralPost = (form: Array<[string, string]>) =>
  h.pma.postJson('/database/central-columns', [['db', P], ...form])
const centralReq = (body: unknown) => h.bma.req('POST', bma('/central-columns'), body)

describe.skipIf(!pmaReachable)('parity: central columns', () => {
  it('Structure → add the columns of tables to the central list (duplicates noticed)', async () => {
    const r = await centralStep(
      () =>
        h.pma.postJson('/database/structure/central-columns/add', [
          ['db', P],
          ['selected_tbl[]', 'parent'],
          ['selected_tbl[]', 'child'],
        ]),
      () => h.bma.req('POST', bma('/structure/central-add'), { tables: ['parent', 'child'] }),
    )
    const text = (r.b.json as { messages: Array<{ text: string }> }).messages[0]?.text ?? ''
    expect(text).toContain("Could not add 'id','name' as they already exist in central list!")
    expect(JSON.stringify(r.p)).toContain(
      'Could not add &#039;id&#039;,&#039;name&#039; as they already exist in central list!',
    )
  })

  it('the page: rows, tables and the "Showing rows" message', async () => {
    const r = await both(
      h,
      () => h.pma.getPage('/database/central-columns', { db: P }),
      () => h.bma.req('GET', bma('/central-columns')),
    )
    const b = r.b.json as { columns: Array<{ name: string; type: string }>; message: { text: string } }
    expect(r.p).toContain(b.message.text)
    for (const c of b.columns) expect(r.p).toContain(`value="${c.name}" id="checkbox_row_`)
    expect(b.columns.map((c) => c.name)).toEqual(['created', 'id', 'name', 'parent_id'])
  })

  it('add a new column, edit it inline, then through the multi-edit form', async () => {
    await centralStep(
      () =>
        centralPost([
          ['add_new_column', 'add_new_column'],
          ['col_name', 'extra1'],
          ['col_type', 'VARCHAR'],
          ['col_length', '10'],
          ['col_default', 'NONE'],
          // the forms post no col_default_sel; phpMyAdmin then fails on the missing parameter
          ['col_default_sel', ''],
          ['field_default_value[0]', ''],
          ['collation', 'utf8mb4_bin'],
          ['col_attribute', ''],
          ['col_isNull', 'YES'],
        ]),
      () =>
        centralReq({
          action: 'add-new',
          column: { name: 'extra1', type: 'VARCHAR', length: '10', collation: 'utf8mb4_bin', isNull: true },
        }),
    )
    await centralStep(
      () =>
        centralPost([
          ['edit_save', 'save'],
          ['orig_col_name', 'extra1'],
          ['col_name', 'extra2'],
          ['col_type', 'INT'],
          ['col_length', '11'],
          ['col_default', 'NULL'],
          // the forms post no col_default_sel; phpMyAdmin then fails on the missing parameter
          ['col_default_sel', ''],
          ['col_default_val', ''],
          ['collation', ''],
          ['col_attribute', 'UNSIGNED'],
          ['col_isNull', 'YES'],
          ['col_extra', 'auto_increment'],
        ]),
      () =>
        centralReq({
          action: 'edit',
          origName: 'extra1',
          column: {
            name: 'extra2',
            type: 'INT',
            length: '11',
            defaultType: 'NULL',
            attribute: 'UNSIGNED',
            isNull: true,
            autoIncrement: true,
          },
        }),
    )
    await centralStep(
      () =>
        centralPost([
          ['multi_edit_central_column_save', 'true'],
          ['orig_col_name[0]', 'extra2'],
          ['field_name[0]', 'extra3'],
          ['field_type[0]', 'INT'],
          ['field_length[0]', ''],
          ['field_default_type[0]', 'USER_DEFINED'],
          ['field_default_value[0]', '5'],
          ['field_collation[0]', ''],
          ['field_attribute[0]', ''],
          ['field_null[0]', 'YES'],
        ]),
      () =>
        centralReq({
          action: 'multi-edit',
          columns: [
            {
              origName: 'extra2',
              name: 'extra3',
              type: 'INT',
              defaultType: 'USER_DEFINED',
              defaultValue: '5',
              isNull: true,
            },
          ],
        }),
    )
  })

  it('NOT NULL on edit fails like phpMyAdmin (boolean concatenated into the UPDATE)', async () => {
    const r = await both(
      h,
      () =>
        h.pma.postJson('/database/central-columns', [
          ['db', P],
          ['edit_save', 'save'],
          ['orig_col_name', 'extra3'],
          ['col_name', 'extra3'],
          ['col_type', 'INT'],
          ['col_length', ''],
          ['col_default', 'NONE'],
          // the forms post no col_default_sel; phpMyAdmin then fails on the missing parameter
          ['col_default_sel', ''],
          ['collation', ''],
          ['col_attribute', ''],
        ]),
      () => centralReq({ action: 'edit', origName: 'extra3', column: { name: 'extra3', type: 'INT' } }),
      { pma: 'pma', bma: 'pma' },
    )
    // MySQL does not log a statement it cannot parse: compare the answers
    expect(JSON.stringify(r.p).replaceAll('&#039;', "'")).toContain(
      '#1064 - You have an error in your SQL syntax',
    )
    expect(JSON.stringify(r.p).replaceAll('&#039;', "'")).toContain("near ', col_collation = ")
    expect((r.b.json as { message: { text: string } }).message.text).toMatch(
      /^#1064 - You have an error in your SQL syntax.*near ', col_collation = /,
    )
    expect((r.b.json as { ok: boolean }).ok).toBe(false)
  })

  it('populate, add one column of a table, delete (with a missing one)', async () => {
    const r = await both(
      h,
      () =>
        h.pma.postJson('/database/central-columns/populate', [
          ['db', P],
          ['selectedTable', 'other'],
        ]),
      () => h.bma.req('GET', bma('/central-columns/populate?table=other')),
    )
    const opts = [...String(r.p.message).matchAll(/<option value="([^"]*)">/g)].map((m) => m[1])
    expect(r.b.json).toEqual(opts)
    await centralStep(
      () =>
        centralPost([
          ['add_column', 'add'],
          ['table-select', 'other'],
          ['column-select', 'note'],
        ]),
      () => centralReq({ action: 'add-from-table', table: 'other', column: 'note' }),
    )
    await centralStep(
      () =>
        centralPost([
          ['delete_save', 'delete'],
          ['col_name', 'selected_fld%5B%5D=extra3&selected_fld%5B%5D=nope'],
        ]),
      () => centralReq({ action: 'delete', columns: ['extra3', 'nope'] }),
    )
  })

  it('Structure → make consistent with the central list (referenced columns kept)', async () => {
    await h.root.query(
      `UPDATE phpmyadmin.pma__central_columns SET col_length = '30', col_default = 'y' WHERE col_name = 'name' AND db_name IN ('${P}', '${B}')`,
    )
    const r = await both(
      h,
      () =>
        h.pma.postJson('/database/structure/central-columns/make-consistent', [
          ['db', P],
          ['selected_tbl[]', 'parent'],
          ['selected_tbl[]', 'child'],
        ]),
      () => h.bma.req('POST', bma('/structure/central-make-consistent'), { tables: ['parent', 'child'] }),
    )
    const w = compareWrites(r.pmaLog, r.bmaLog, dbMap)
    expect(w.bma).toEqual(w.pma)
    expect(
      w.bma.some((s) => s.startsWith('ALTER TABLE `parent`') && s.includes('MODIFY `name` varchar(30)')),
    ).toBe(true)
  })

  it('Structure → remove the columns of a table from the central list', async () => {
    await centralStep(
      () =>
        h.pma.postJson('/database/structure/central-columns/remove', [
          ['db', P],
          ['selected_tbl[]', 'child'],
        ]),
      () => h.bma.req('POST', bma('/structure/central-remove'), { tables: ['child'] }),
    )
  })
})

const tracking = async () => ({
  p: await rows('pma__tracking', P, 'table_name, version'),
  b: await rows('pma__tracking', B, 'table_name, version'),
})

describe.skipIf(!pmaReachable)('parity: tracking (database)', () => {
  it('create version 1 for a table and a view', async () => {
    const r = await both(
      h,
      () =>
        h.pma.postPage('/database/tracking', [
          ['db', P],
          ['selected[]', 'parent'],
          ['selected[]', 'v'],
          ['version', '1'],
          ['alter_table', 'true'],
          ['create_view', 'true'],
          ['insert', 'true'],
          ['submit_create_version', '1'],
        ]),
      () =>
        h.bma.req('POST', bma('/tracking'), {
          action: 'create-version',
          tables: ['parent', 'v'],
          version: '1',
          statements: ['alter_table', 'create_view', 'insert'],
        }),
      CONTROL,
    )
    const ins = (log: Array<{ sql: string }>) =>
      log
        .map((e) => mask(e.sql))
        .filter(
          (s) =>
            /^\/\*NOTRACK\*\/\s*INSERT|^UPDATE `phpmyadmin`.`pma__tracking`/.test(s) && s.includes("'DB'"),
        )
    expect(ins(r.bmaLog)).toEqual(ins(r.pmaLog))
    expect(ins(r.bmaLog).length).toBe(4)
    const t = await tracking()
    expect(t.b).toEqual(t.p)
    expect(String(r.p)).toContain('Version 1 was created for selected tables, tracking is active for them.')
  })

  it('the page: tracked and untracked tables, the database log', async () => {
    const r = await both(
      h,
      () => h.pma.getPage('/database/tracking', { db: P }),
      () => h.bma.req('GET', bma('/tracking')),
    )
    const b = r.b.json as {
      tracked: Array<{ table: string; version: string }>
      untracked: string[]
      log: string | null
    }
    const p = String(r.p)
    const trackedHtml = p.slice(
      p.indexOf('id="trackedForm"'),
      p.indexOf('</form>', p.indexOf('id="trackedForm"')),
    )
    const untrackedHtml = p.slice(p.indexOf('id="untrackedForm"'))
    const ids = (html: string) => [...html.matchAll(/id="selected_tbl_([^"]+)"/g)].map((m) => m[1])
    expect(b.tracked.map((x) => x.table)).toEqual(ids(trackedHtml))
    expect(b.untracked).toEqual(ids(untrackedHtml))
    expect(b.log === null).toBe(!p.includes('Database Log'))
  })

  it('delete tracking of one table, then of the selected ones', async () => {
    const one = await both(
      h,
      () =>
        h.pma.postJson('/database/tracking', [
          ['db', P],
          ['table', 'v'],
          ['delete_tracking', 'true'],
        ]),
      () => h.bma.req('POST', bma('/tracking'), { action: 'delete', tables: ['v'] }),
      CONTROL,
    )
    const w = controlWrites(one)
    expect(w.bma).toEqual(w.pma)
    expect(w.bma.length).toBe(1)
    await both(
      h,
      () =>
        h.pma.postJson('/database/tracking', [
          ['db', P],
          ['selected_tbl[]', 'parent'],
          ['submit_mult', 'delete_tracking'],
        ]),
      () => h.bma.req('POST', bma('/tracking'), { action: 'delete', tables: ['parent'] }),
      CONTROL,
    )
    const t = await tracking()
    expect(t.b).toEqual(t.p)
    expect(t.b).toEqual([])
  })
})

describe.skipIf(!pmaReachable)('parity: data dictionary and privileges', () => {
  it('data dictionary: tables, column types, defaults, links and indexes', async () => {
    const r = await both(
      h,
      () => h.pma.getPage('/database/data-dictionary', { db: P }),
      () => h.bma.req('GET', bma('/data-dictionary')),
    )
    const p = String(r.p)
    const b = r.b.json as {
      tables: Array<{
        name: string
        comment: string
        columns: Array<{ printType: string; relation: string; default: string | null }>
        indexes: Array<{ name: string }>
      }>
    }
    expect(b.tables.map((t) => t.name)).toEqual([...p.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]))
    const types = [...p.matchAll(/<td lang="en" dir="ltr"[^>]*>\s*([^<]*?)\s*<\/td>/g)].map((m) => m[1])
    expect(b.tables.flatMap((t) => t.columns.map((c) => c.printType))).toEqual(types)
    expect(p).toContain('parent -&gt; id')
    expect(b.tables.find((t) => t.name === 'child')?.columns[1]?.relation).toBe('parent -> id')
    expect(p).toContain('<em><pre>parents</pre></em>')
    expect(b.tables.find((t) => t.name === 'parent')?.indexes.map((i) => i.name)).toEqual([
      'PRIMARY',
      'k_name',
    ])
  })

  it('privileges: the accounts with access to the database and their privileges', async () => {
    const r = await both(
      h,
      () => h.pma.getPage('/database/privileges', { db: P }),
      () => h.bma.req('GET', bma('/privileges')),
    )
    const p = String(r.p)
    const b = r.b.json as {
      accounts: Array<{
        user: string
        host: string
        privileges: Array<{ type: string; privileges: Array<{ name: string }> }>
      }>
    }
    const accounts = [
      ...p.matchAll(/name="selected_usr\[\]"[^>]*value="([^"&]*)&amp;(?:amp;)?#27;([^"]*)"/g),
    ].map((m) => `${m[1]}@${m[2]}`)
    const ours = b.accounts.map((a) => `${a.user}@${a.host}`)
    // the other tool's account differs (its own user is global on both)
    const norm = (xs: string[]) =>
      xs.map((x) => x.replace(users.pma, 'USER').replace(users.bma, 'USER')).sort()
    expect(norm(ours)).toEqual(norm(accounts))
    const codes = [...p.matchAll(/<code>([\s\S]*?)<\/code>/g)].map((m) =>
      m[1]
        ?.replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    const mine = b.accounts.find((a) => a.user === users.bma)
    const pmaRow = codes.filter((c) => c === 'SELECT, INSERT')
    expect(
      mine?.privileges
        .find((x) => x.type === 'd')
        ?.privileges.map((x) => x.name)
        .join(', '),
    ).toBe('SELECT, INSERT')
    expect(pmaRow.length).toBeGreaterThan(0)
  })
})
