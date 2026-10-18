import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { compareWrites, normalise } from './lib/compare.ts'
import { type Harness, both, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of the table Structure central-columns actions (row links and With-selected
 * buttons), the "Pick from Central Columns" list and the table Privileges tab
 * (docs/features/04-table-level.md). Both tools use the control user `pma` and the `phpmyadmin`
 * configuration storage; the central list rows each tool leaves there are compared too.
 */
const users = { pma: 'f04_cp_pma', bma: 'f04_cp_bma' }
const P = 'f04_cpp'
const B = 'f04_cpb'
const CONTROL = { pma: 'pma', bma: 'pma' }
const dbMap: Record<string, string> = { [P]: 'DB', [B]: 'DB', [users.pma]: 'USER', [users.bma]: 'USER' }
let h: Harness
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })

const seed = (db: string, user: string) => `
DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db} DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE TABLE ${db}.t (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(20) COLLATE utf8mb4_bin DEFAULT 'x',
  created TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT
) ENGINE=InnoDB;
CREATE TABLE ${db}.t2 (id INT NOT NULL, other VARCHAR(5));
GRANT SELECT ON ${db}.* TO '${user}'@'%';
GRANT DELETE, ALTER, INDEX, INSERT ON ${db}.t TO '${user}'@'%';
`
const cleanPmadb = (db: string) => `DELETE FROM phpmyadmin.pma__central_columns WHERE db_name = '${db}';`

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
const mask = (s: string) => normalise(s, dbMap)

async function central(db: string): Promise<Array<Record<string, unknown>>> {
  const [r] = await h.root.query(
    'SELECT col_name, col_type, col_length, col_collation, col_isNull, col_extra, col_default FROM phpmyadmin.pma__central_columns WHERE db_name = ? ORDER BY col_name',
    [db],
  )
  return r as Array<Record<string, unknown>>
}

/** the control-user writes about this suite's database */
function controlWrites(r: { pmaLog: Array<{ sql: string }>; bmaLog: Array<{ sql: string }> }) {
  const w = compareWrites(r.pmaLog as never, r.bmaLog as never, dbMap, [/^\/\*NOTRACK\*\/\s*SELECT/])
  const mine = (xs: string[]) => xs.filter((s) => s.includes("'DB'")).map(mask)
  return { pma: mine(w.pma), bma: mine(w.bma) }
}

type Msgs = { messages: Array<{ type: string; text: string }> }

/** the same Structure action in both tools: the control writes and the central list agree */
async function structureStep(op: 'add' | 'remove', columns: string[]) {
  const r = await both(
    h,
    () =>
      h.pma.postJson(`/table/structure/central-columns-${op}`, [
        ['db', P],
        ['table', 't'],
        ...columns.map((c): [string, string] => ['selected_fld[]', c]),
      ]),
    () => h.bma.req('POST', bma(`/tables/t/structure/central-columns-${op}`), { columns }),
    CONTROL,
  )
  const w = controlWrites(r)
  expect(w.bma).toEqual(w.pma)
  expect(await central(B)).toEqual(await central(P))
  return { p: JSON.stringify(r.p), b: (r.b.json as Msgs).messages }
}

/** the central-columns links the Structure page shows (row links + the two bulk buttons) */
async function structureMarks() {
  const r = await both(
    h,
    () => h.pma.getPage('/table/structure', { db: P, table: 't' }),
    () => h.bma.req('GET', bma('/tables/t/structure')),
  )
  const p = String(r.p)
  const b = r.b.json as { columns: Array<{ name: string; inCentralList: boolean }> }
  const count = (s: string) => p.split(s).length - 1
  return {
    pma: { remove: count('central-columns-remove') - 1, add: count('central-columns-add') - 1 },
    bma: {
      remove: b.columns.filter((c) => c.inCentralList).length,
      add: b.columns.filter((c) => !c.inCentralList).length,
    },
    inList: b.columns.filter((c) => c.inCentralList).map((c) => c.name),
  }
}

describe.skipIf(!pmaReachable)('parity: table Structure central columns', () => {
  it('row link: add one column; the page marks it [p04-a0caf6]', async () => {
    const r = await structureStep('add', ['name'])
    expect(r.b[0]?.text).toBe('Your SQL query has been executed successfully.')
    expect(r.p).toContain('Your SQL query has been executed successfully.')
    const m = await structureMarks()
    expect(m.bma).toEqual(m.pma)
    expect(m.inList).toEqual(['name'])
  })

  it('With selected: add columns, the existing one noticed [p04-a0caf6]', async () => {
    const r = await structureStep('add', ['id', 'name', 'created'])
    expect(r.b[0]?.text).toContain("Could not add 'name' as they already exist in central list!")
    expect(r.p).toContain('Could not add &#039;name&#039; as they already exist in central list!')
    const m = await structureMarks()
    expect(m.bma).toEqual(m.pma)
    expect(m.inList).toEqual(['id', 'name', 'created'])
  })

  it('Pick from Central Columns: the central columns the table does not have', async () => {
    const r = await both(
      h,
      () =>
        h.pma.postJson('/database/central-columns', [
          ['db', P],
          ['cur_table', 't2'],
          ['getColumnList', 'true'],
        ]),
      () => h.bma.req('GET', bma('/central-columns/list?table=t2')),
    )
    const p = (r.p as { message: Array<{ col_name: string; col_type: string; col_attribute: string }> })
      .message
    const b = r.b.json as Array<{ name: string; type: string; attribute: string }>
    expect(b.map((c) => [c.name, c.type, c.attribute])).toEqual(
      p.map((c) => [c.col_name, c.col_type, c.col_attribute]),
    )
    expect(b.map((c) => c.name).sort()).toEqual(['created', 'name'])
  })

  it('With selected: remove columns, the missing one noticed [p04-a0caf6]', async () => {
    const r = await structureStep('remove', ['name', 'note'])
    expect(r.b[0]?.text).toContain(
      "Couldn't remove Column(s) 'note' as they don't exist in central columns list!",
    )
    expect(r.p).toContain("Couldn't remove Column(s) &#039;note&#039;")
    const m = await structureMarks()
    expect(m.bma).toEqual(m.pma)
  })

  it('no column selected', async () => {
    const r = await both(
      h,
      () =>
        h.pma.postJson('/table/structure/central-columns-remove', [
          ['db', P],
          ['table', 't'],
        ]),
      () => h.bma.req('POST', bma('/tables/t/structure/central-columns-remove'), { columns: [] }),
      CONTROL,
    )
    expect(JSON.stringify(r.p)).toContain('No column selected.')
    expect((r.b.json as Msgs).messages[0]).toEqual({ type: 'error', text: 'No column selected.' })
    expect(controlWrites(r)).toEqual({ pma: [], bma: [] })
  })
})

describe.skipIf(!pmaReachable)('parity: table Privileges', () => {
  it('the accounts with access to the table, with the table-specific privileges [p04-f4f8d7]', async () => {
    const r = await both(
      h,
      () => h.pma.getPage('/table/privileges', { db: P, table: 't' }),
      () => h.bma.req('GET', bma('/tables/t/privileges')),
    )
    const p = String(r.p)
    const b = r.b.json as {
      table: string
      accounts: Array<{
        user: string
        host: string
        privileges: Array<{
          type: string
          table?: string
          hasGrant: boolean
          privileges: Array<{ name: string }>
        }>
      }>
    }
    expect(b.table).toBe('t')
    const accounts = [
      ...p.matchAll(/name="selected_usr\[\]"[^>]*value="([^"&]*)&amp;(?:amp;)?#27;([^"]*)"/g),
    ].map((m) => `${m[1]}@${m[2]}`)
    const norm = (xs: string[]) =>
      xs.map((x) => x.replace(users.pma, 'USER').replace(users.bma, 'USER')).sort()
    expect(norm(b.accounts.map((a) => `${a.user}@${a.host}`))).toEqual(norm(accounts))

    // the type cells and privilege lists of this suite's user, in page order
    const mine = b.accounts.find((a) => a.user === users.bma)
    // the harness accounts are global too
    expect(mine?.privileges.map((x) => x.type)).toEqual(['g', 'd', 't'])
    // getTableGrantsArray has no SELECT / INSERT / UPDATE: INSERT is not listed
    const tablePrivs = mine?.privileges[2]?.privileges.map((x) => x.name).join(', ')
    expect(tablePrivs).toBe('DELETE, INDEX, ALTER')
    expect(p).toContain('table-specific')
    const codes = [...p.matchAll(/<code>([\s\S]*?)<\/code>/g)].map((m) =>
      m[1]
        ?.replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    expect(codes).toContain(tablePrivs)
    expect(p).toContain(`${P}.t</a>`)
  })
})
