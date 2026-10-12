import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { compareWrites, normalise } from './lib/compare.ts'
import { type Harness, both, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of the navigation leftovers (docs/features/01-shell-and-navigation.md): the
 * NavigationWidth preference of /navigation/update-width, hiding and unhiding items, and the
 * Recent list a table visit writes. Both tools use the control user `pma` and the `phpmyadmin`
 * configuration storage; the rows each tool leaves are compared too.
 */
const users = { pma: 'f04_nx_pma', bma: 'f04_nx_bma' }
const P = 'f04_nxp'
const B = 'f04_nxb'
const CONTROL = { pma: 'pma', bma: 'pma' }
const dbMap: Record<string, string> = { [P]: 'DB', [B]: 'DB', [users.pma]: 'USER', [users.bma]: 'USER' }
let h: Harness
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })

const clean = () =>
  [users.pma, users.bma]
    .map(
      (u) =>
        `DELETE FROM phpmyadmin.pma__userconfig WHERE username = '${u}'; DELETE FROM phpmyadmin.pma__navigationhiding WHERE username = '${u}'; DELETE FROM phpmyadmin.pma__recent WHERE username = '${u}';`,
    )
    .join('')
const seed = (db: string) =>
  `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}; CREATE TABLE ${db}.t (id INT); CREATE TABLE ${db}.u (id INT);`

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness({}, users, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' })
  await h.root.query(seed(P) + seed(B) + clean())
})
afterAll(async () => {
  await h?.root.query(`${clean()} DROP DATABASE IF EXISTS ${P}; DROP DATABASE IF EXISTS ${B}`)
  await h?.close()
})

const mask = (s: string) => normalise(s, dbMap).replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/g, '<TS>')

/** the control user's writes about this suite's accounts (masked) */
function controlWrites(r: { pmaLog: Array<{ sql: string }>; bmaLog: Array<{ sql: string }> }, table: string) {
  const w = compareWrites(r.pmaLog as never, r.bmaLog as never, dbMap, [/^\/\*NOTRACK\*\/\s*SELECT/])
  const mine = (xs: string[]) => xs.filter((s) => s.includes(table) && s.includes("'USER'")).map(mask)
  return { pma: mine(w.pma), bma: mine(w.bma) }
}

async function rows(sql: string, user: string) {
  const [r] = await h.root.query(sql, [user])
  return (r as Array<Record<string, unknown>>).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        typeof v === 'string' ? mask(v) : v instanceof Date ? '<TS>' : v,
      ]),
    ),
  )
}

describe.skipIf(!pmaReachable)('parity: navigation width, hiding, recent tables', () => {
  it('/navigation/update-width stores NavigationWidth', async () => {
    const r = await both(
      h,
      () => h.pma.postJson('/navigation/update-width', [['value', '312']]),
      () => h.bma.req('POST', '/api/servers/1/navigation/width', { value: 312 }),
      CONTROL,
    )
    const w = controlWrites(r, 'pma__userconfig')
    expect(w.bma).toEqual(w.pma)
    const conf = (u: string) =>
      rows('SELECT config_data FROM phpmyadmin.pma__userconfig WHERE username = ?', u)
    expect(await conf(users.bma)).toEqual(await conf(users.pma))
    expect((await conf(users.pma))[0]?.config_data).toBe('{"NavigationWidth":312}')
  })

  it('hide two tables, then unhide one', async () => {
    const item = (db: string, name: string): Array<[string, string]> => [
      ['itemType', 'table'],
      ['itemName', name],
      ['dbName', db],
    ]
    for (const name of ['t', 'u']) {
      const r = await both(
        h,
        () => h.pma.postJson('/navigation', [['hideNavItem', '1'], ...item(P, name)]),
        () =>
          h.bma.req('POST', '/api/servers/1/navigation/hide', {
            itemType: 'table',
            itemName: name,
            dbName: B,
          }),
        CONTROL,
      )
      const w = controlWrites(r, 'pma__navigationhiding')
      expect(w.bma).toEqual(w.pma)
    }
    const r = await both(
      h,
      () => h.pma.postJson('/navigation', [['unhideNavItem', '1'], ...item(P, 't')]),
      () =>
        h.bma.req('POST', '/api/servers/1/navigation/unhide', {
          itemType: 'table',
          itemName: 't',
          dbName: B,
        }),
      CONTROL,
    )
    const w = controlWrites(r, 'pma__navigationhiding')
    expect(w.bma).toEqual(w.pma)
    const hidden = (u: string) =>
      rows(
        'SELECT item_name, item_type, db_name FROM phpmyadmin.pma__navigationhiding WHERE username = ? ORDER BY item_name',
        u,
      )
    expect(await hidden(users.bma)).toEqual(await hidden(users.pma))
    expect(await hidden(users.pma)).toEqual([{ item_name: 'u', item_type: 'table', db_name: 'DB' }])
  })

  it('visiting tables fills the Recent list (most recent first)', async () => {
    for (const name of ['t', 'u']) {
      const r = await both(
        h,
        () => h.pma.getPage('/table/structure', { db: P, table: name }),
        () => h.bma.req('POST', '/api/servers/1/recent', { db: B, table: name }),
        CONTROL,
      )
      const w = controlWrites(r, 'pma__recent')
      expect(w.bma).toEqual(w.pma)
    }
    const recent = (u: string) => rows('SELECT tables FROM phpmyadmin.pma__recent WHERE username = ?', u)
    expect(await recent(users.bma)).toEqual(await recent(users.pma))
    expect(String((await recent(users.pma))[0]?.tables)).toBe(
      '[{"db":"DB","table":"u"},{"db":"DB","table":"t"}]',
    )
  })
})
