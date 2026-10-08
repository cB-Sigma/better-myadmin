import { describe, expect, it } from 'vitest'
import { BookmarkRepository, consoleBookmarkWelcome } from '../src/bookmarks.ts'
import { QueryHistory, type SessionHistoryEntry } from '../src/history.ts'
import { type MetaSessionState, Metadata } from '../src/metadata.ts'
import { PmadbDriver } from '../src/pmadb-driver.ts'
import { RecentFavoriteTables } from '../src/recent-favorite.ts'
import { type RelationParameters, emptyRelationParameters } from '../src/relation-parameters.ts'
import { LocalMetadataStore } from '../src/sqlite-driver.ts'
import { TableUiPrefs, type UiPrefs, setColumnPreferences } from '../src/uiprefs.ts'
import { type SessionUserConfig, UserPreferences } from '../src/userprefs.ts'
import { FakeConn, ok } from './fixtures.ts'

function rp(): RelationParameters {
  const r = emptyRelationParameters('u1')
  const database = 'pmadb'
  r.db = database
  r.bookmarkFeature = { database, bookmark: 'pma__bookmark' }
  r.sqlHistoryFeature = { database, history: 'pma__history' }
  r.recentlyUsedTablesFeature = { database, recent: 'pma__recent' }
  r.favoriteTablesFeature = { database, favorite: 'pma__favorite' }
  r.uiPreferencesFeature = { database, tableUiPrefs: 'pma__table_uiprefs' }
  r.userPreferencesFeature = { database, userConfig: 'pma__userconfig' }
  r.navigationItemsHidingFeature = { database, navigationHiding: 'pma__navigationhiding' }
  return r
}

const sqls = (c: FakeConn) => c.log.map((l) => l.sql.replace(/\s+/g, ' ').trim())

describe('bookmarks (BookmarkRepository / Bookmark)', () => {
  it('builds phpMyAdmin’s list / get / insert / delete statements', async () => {
    const conn = new FakeConn(() =>
      ok([{ id: '3', dbase: 'd', user: 'u1', label: 'L', query: 'SELECT [VARIABLE1]' }]),
    )
    const repo = new BookmarkRepository(new PmadbDriver(conn, rp()).bookmarks, true)
    const list = await repo.getList('u1', 'd')
    expect(list[0]).toMatchObject({ id: 3, variableCount: 1, isShared: false })
    await repo.getList('u1')
    await repo.get('u1', 3)
    await repo.get(null, 3)
    await repo.getByLabel('u1', 'd', "it's")
    const b = repo.createBookmark('SELECT 1', 'lbl', 'u1', 'd', true)
    expect(b).toEqual({ dbase: 'd', user: '', label: 'lbl', query: 'SELECT 1' })
    if (b !== false) await repo.save(b)
    await repo.delete(3)
    expect(sqls(conn)).toEqual([
      "SELECT * FROM `pmadb`.`pma__bookmark` WHERE (`user` = 'u1' OR `user` = '') AND dbase = 'd' ORDER BY label ASC",
      "SELECT * FROM `pmadb`.`pma__bookmark` WHERE (`user` = 'u1' OR `user` = '') ORDER BY label ASC",
      "SELECT * FROM `pmadb`.`pma__bookmark` WHERE `id` = 3 AND (user = 'u1' OR user = '') LIMIT 1",
      'SELECT * FROM `pmadb`.`pma__bookmark` WHERE `id` = 3 LIMIT 1',
      "SELECT * FROM `pmadb`.`pma__bookmark` WHERE `label` = 'it\\'s' AND dbase = 'd' AND user = 'u1' LIMIT 1",
      "INSERT INTO `pmadb`.`pma__bookmark` (id, dbase, user, query, label) VALUES (NULL, 'd', '', 'SELECT 1', 'lbl')",
      'DELETE FROM `pmadb`.`pma__bookmark` WHERE id = 3',
    ])
  })

  it('createBookmark rules: AllowSharedBookmarks, empty label/query, no user', () => {
    const conn = new FakeConn()
    const noShare = new BookmarkRepository(new PmadbDriver(conn, rp()).bookmarks, false)
    expect(noShare.createBookmark('q', 'l', 'u', 'd', true)).toEqual({
      dbase: 'd',
      user: 'u',
      label: 'l',
      query: 'q',
    })
    expect(noShare.createBookmark('', 'l', 'u', 'd')).toBe(false)
    expect(noShare.createBookmark('q', '', 'u', 'd')).toBe(false)
    expect(noShare.createBookmark('q', 'l', '', 'd')).toBe(false)
    const share = new BookmarkRepository(new PmadbDriver(conn, rp()).bookmarks, true)
    expect(share.createBookmark('q', 'l', '', 'd', true)).toEqual({
      dbase: 'd',
      user: '',
      label: 'l',
      query: 'q',
    })
    expect(new BookmarkRepository(null, true).createBookmark('q', 'l', 'u', 'd')).toBe(false)
  })

  it('without AllowSharedBookmarks the list matches the user exactly', async () => {
    const conn = new FakeConn(() => ok([]))
    await new BookmarkRepository(new PmadbDriver(conn, rp()).bookmarks, false).getList('u1', false)
    expect(sqls(conn)).toEqual([
      "SELECT * FROM `pmadb`.`pma__bookmark` WHERE (`user` = 'u1') ORDER BY label ASC",
    ])
  })

  it('storeTheQueryAsBookmark with replace deletes same-label bookmarks first', async () => {
    const conn = new FakeConn((sql) =>
      sql.startsWith('SELECT')
        ? ok([
            { id: '1', dbase: 'd', user: 'u1', label: 'L', query: 'x' },
            { id: '2', dbase: 'd', user: 'u1', label: 'M', query: 'y' },
          ])
        : ok(),
    )
    await new BookmarkRepository(new PmadbDriver(conn, rp()).bookmarks, true).storeTheQueryAsBookmark(
      'd',
      'u1',
      'SELECT 2',
      'L',
      true,
      false,
    )
    expect(sqls(conn).slice(1)).toEqual([
      'DELETE FROM `pmadb`.`pma__bookmark` WHERE id = 1',
      "INSERT INTO `pmadb`.`pma__bookmark` (id, dbase, user, query, label) VALUES (NULL, 'd', 'u1', 'SELECT 2', 'L')",
    ])
  })

  it('console welcome line', () => {
    expect(consoleBookmarkWelcome(0)).toBe('No bookmarks')
    expect(consoleBookmarkWelcome(1)).toBe('Showing 1 bookmark (both private and shared)')
    expect(consoleBookmarkWelcome(3)).toBe('Showing 3 bookmarks (both private and shared)')
  })
})

describe('query history (Console/History.php)', () => {
  const cfg = { MaxCharactersInDisplayedSQL: 20, QueryHistoryMax: 2, QueryHistoryDB: true }

  it('records in the session (capped) and in pmadb, then purges', async () => {
    const conn = new FakeConn((sql) =>
      sql.includes('SELECT `timevalue`') ? ok([{ timevalue: '2026-10-08 10:00:00' }]) : ok(),
    )
    const session: SessionHistoryEntry[] = []
    const h = new QueryHistory(new PmadbDriver(conn, rp()).history, cfg, session)
    await h.setHistory('d', 't', 'u1', 'SELECT 1')
    await h.setHistory('d', '', 'u1', 'SELECT 2')
    await h.setHistory('d', '', 'u1', 'SELECT 3')
    expect(session.map((s) => s.sqlquery)).toEqual(['SELECT 2', 'SELECT 3'])
    expect(sqls(conn).slice(0, 3)).toEqual([
      "INSERT INTO `pmadb`.`pma__history` (`username`, `db`, `table`, `timevalue`, `sqlquery`) VALUES ('u1', 'd', 't', NOW(), 'SELECT 1')",
      "SELECT `timevalue` FROM `pmadb`.`pma__history` WHERE `username` = 'u1' ORDER BY `timevalue` DESC LIMIT 2, 1",
      "DELETE FROM `pmadb`.`pma__history` WHERE `username` = 'u1' AND `timevalue` <= '2026-10-08 10:00:00'",
    ])
  })

  it('skips queries longer than MaxCharactersInDisplayedSQL, and pmadb when QueryHistoryDB is off', async () => {
    const conn = new FakeConn()
    const session: SessionHistoryEntry[] = []
    const h = new QueryHistory(
      new PmadbDriver(conn, rp()).history,
      { ...cfg, QueryHistoryDB: false },
      session,
    )
    await h.setHistory('', '', 'u1', 'SELECT "this is too long"')
    expect(session).toEqual([])
    await h.setHistory('', '', 'u1', 'SELECT é')
    expect(session).toHaveLength(1)
    expect(conn.log).toEqual([])
    expect(await h.getHistory('u1')).toEqual([{ db: '', table: '', sqlquery: 'SELECT é' }])
    expect(await new QueryHistory(null, cfg, session).getHistory('u1')).toBe(false)
  })
})

describe('recent / favorite tables (RecentFavoriteTables.php)', () => {
  const exists = async () => true

  it('adds to the front, de-duplicates, trims and REPLACEs', async () => {
    const conn = new FakeConn((sql) =>
      sql.startsWith('SELECT') ? ok([{ tables: '[{"db":"d","table":"a"}]' }]) : ok(),
    )
    const list = await RecentFavoriteTables.load({
      type: 'recent',
      backend: new PmadbDriver(conn, rp()).recent,
      username: 'u1',
      max: 2,
      sessionList: undefined,
      tableExists: exists,
    })
    await list.add({ db: 'd', table: 'b' })
    await list.add({ db: 'd', table: 'b' }) // already first: no write
    await list.add({ db: 'd', table: 'a' })
    await list.add({ db: 'd', table: 'c' })
    expect(list.getTables()).toEqual([
      { db: 'd', table: 'c' },
      { db: 'd', table: 'a' },
    ])
    expect(sqls(conn)).toEqual([
      "SELECT `tables` FROM `pmadb`.`pma__recent` WHERE `username` = 'u1'",
      'REPLACE INTO `pmadb`.`pma__recent` (`username`, `tables`) VALUES (\'u1\', \'[{\\"db\\":\\"d\\",\\"table\\":\\"b\\"},{\\"db\\":\\"d\\",\\"table\\":\\"a\\"}]\')',
      'REPLACE INTO `pmadb`.`pma__recent` (`username`, `tables`) VALUES (\'u1\', \'[{\\"db\\":\\"d\\",\\"table\\":\\"a\\"},{\\"db\\":\\"d\\",\\"table\\":\\"b\\"}]\')',
      'REPLACE INTO `pmadb`.`pma__recent` (`username`, `tables`) VALUES (\'u1\', \'[{\\"db\\":\\"d\\",\\"table\\":\\"c\\"},{\\"db\\":\\"d\\",\\"table\\":\\"a\\"}]\')',
    ])
  })

  it('remove() keeps PHP keys, so the immediate save is a JSON object', async () => {
    const conn = new FakeConn()
    const list = await RecentFavoriteTables.load({
      type: 'favorite',
      backend: new PmadbDriver(conn, rp()).favorite,
      username: 'u1',
      max: 10,
      sessionList: [
        { db: 'd', table: 'a' },
        { db: 'd', table: 'b' },
      ],
      tableExists: exists,
    })
    expect(list.contains({ db: 'd', table: 'a' })).toBe(true)
    await list.remove({ db: 'd', table: 'a' })
    expect(sqls(conn)).toEqual([
      'REPLACE INTO `pmadb`.`pma__favorite` (`username`, `tables`) VALUES (\'u1\', \'{\\"1\\":{\\"db\\":\\"d\\",\\"table\\":\\"b\\"}}\')',
    ])
    expect(list.toSession()).toEqual([{ db: 'd', table: 'b' }])
  })

  it('does not add tables that do not exist, and needs no storage', async () => {
    const list = await RecentFavoriteTables.load({
      type: 'recent',
      backend: null,
      username: 'u1',
      max: 10,
      sessionList: undefined,
      tableExists: async (_db, t) => t !== 'gone',
    })
    expect(await list.add({ db: 'd', table: 'gone' })).toBe(true)
    await list.add({ db: 'd', table: 'here' })
    expect(list.getTables()).toEqual([{ db: 'd', table: 'here' }])
  })
})

describe('table UI preferences (Table.php)', () => {
  function make(
    conn: FakeConn,
    info: Partial<{ view: boolean; create: string | null; cols: string[] }> = {},
  ) {
    let slot: UiPrefs | undefined
    const t = new TableUiPrefs({
      backend: new PmadbDriver(conn, rp()).uiPrefs,
      username: 'u1',
      db: 'd',
      table: 't',
      maxRows: 2,
      info: {
        isView: async () => info.view ?? false,
        createTime: async () => info.create ?? '2026-10-08 10:00:00',
        columns: async () => info.cols ?? ['id', 'name'],
      },
      sessionSlot: {
        get: () => slot,
        set: (p) => {
          slot = p
        },
      },
    })
    return { t, slot: () => slot }
  }

  it('saves col_order / col_visib with CREATE_TIME and trims to MaxTableUiprefs', async () => {
    const conn = new FakeConn((sql) => (sql.startsWith('SELECT COUNT') ? ok([{ 'COUNT(*)': '5' }]) : ok([])))
    const { t } = make(conn)
    expect(
      await setColumnPreferences(t, {
        colOrder: '1,0',
        colVisib: '1,1',
        tableCreateTime: '2026-10-08 10:00:00',
      }),
    ).toBe(true)
    expect(sqls(conn)).toEqual([
      "SELECT `prefs` FROM `pmadb`.`pma__table_uiprefs` WHERE `username` = 'u1' AND `db_name` = 'd' AND `table_name` = 't'",
      "REPLACE INTO `pmadb`.`pma__table_uiprefs` (username, db_name, table_name, prefs) VALUES ('u1', 'd', 't', '{\\\"CREATE_TIME\\\":\\\"2026-10-08 10:00:00\\\",\\\"col_order\\\":[1,0]}')",
      'SELECT COUNT(*) FROM `pmadb`.`pma__table_uiprefs`',
      'DELETE FROM `pmadb`.`pma__table_uiprefs` ORDER BY last_update ASC LIMIT 3',
      'REPLACE INTO `pmadb`.`pma__table_uiprefs` (username, db_name, table_name, prefs) VALUES (\'u1\', \'d\', \'t\', \'{\\"CREATE_TIME\\":\\"2026-10-08 10:00:00\\",\\"col_order\\":[1,0],\\"col_visib\\":[1,1]}\')',
      'SELECT COUNT(*) FROM `pmadb`.`pma__table_uiprefs`',
      'DELETE FROM `pmadb`.`pma__table_uiprefs` ORDER BY last_update ASC LIMIT 3',
    ])
    expect(await t.getUiProp('col_order')).toEqual([1, 0])
  })

  it('refuses col_order when the table was altered, and drops stale values', async () => {
    const conn = new FakeConn((sql) =>
      sql.startsWith('SELECT `prefs`')
        ? ok([{ prefs: '{"col_order":["1","0"],"CREATE_TIME":"old","sorted_col":"`gone` ASC"}' }])
        : ok([{ 'COUNT(*)': '1' }]),
    )
    const { t } = make(conn)
    const r = await t.setUiProp('col_order', [0, 1], 'old')
    expect(r).toEqual({
      type: 'error',
      text: 'Cannot save UI property "col_order". The changes made will not be persistent after you refresh this page. Please check if the table structure has been changed.',
    })
    expect(await t.getUiProp('col_order')).toBe(false)
    expect(await t.getUiProp('sorted_col')).toBe(false)
    expect(t.prefs).toEqual({ CREATE_TIME: 'old' })
  })

  it('sorted_col survives when its column still exists', async () => {
    const conn = new FakeConn(() => ok([{ prefs: '{"sorted_col":"`name` DESC"}' }]))
    const { t } = make(conn)
    expect(await t.getUiProp('sorted_col')).toBe('`name` DESC')
    expect(await t.getUiProp('sorted_col', true)).toBe(false)
  })
})

describe('user preferences (UserPreferences.php)', () => {
  it('session storage when there is no userconfig table', async () => {
    let s: SessionUserConfig | undefined
    const up = new UserPreferences({
      backend: null,
      kind: 'db',
      username: null,
      session: {
        get: () => s,
        set: (v) => {
          s = v
        },
      },
      now: () => 100,
    })
    expect(await up.load()).toEqual({ config_data: {}, mtime: 100, type: 'session' })
    await up.save({ MaxRows: 50, '2fa': { backend: 'x' } })
    await up.save({ MaxRows: 25 })
    expect(s).toEqual({ db: { MaxRows: 25, '2fa': { backend: 'x' } }, ts: 100 })
    await up.persistOption('MaxRows', 25, 25)
    expect(s?.db).toEqual({ '2fa': { backend: 'x' } })
  })

  it('pmadb: load, then UPDATE or INSERT keeping 2fa', async () => {
    const conn = new FakeConn((sql) => {
      if (sql.startsWith('SELECT `config_data`'))
        return ok([{ config_data: '{"2fa":{"backend":"application"},"lang":"cs"}', ts: '1700000000' }])
      if (sql.startsWith('SELECT `username`')) return ok([{ username: 'u1' }])
      return ok()
    })
    const up = new UserPreferences({
      backend: new PmadbDriver(conn, rp()).userConfig,
      kind: 'db',
      username: 'u1',
      session: { get: () => undefined, set: () => {} },
    })
    expect(await up.load()).toEqual({
      config_data: { '2fa': { backend: 'application' }, lang: 'cs' },
      mtime: 1700000000,
      type: 'db',
    })
    await up.persistOption('Console/Mode', 'collapse', 'info')
    expect(sqls(conn).slice(-2)).toEqual([
      "SELECT `username` FROM `pmadb`.`pma__userconfig` WHERE `username` = 'u1'",
      'UPDATE `pmadb`.`pma__userconfig` SET `timevalue` = NOW(), `config_data` = \'{\\"2fa\\":{\\"backend\\":\\"application\\"},\\"lang\\":\\"cs\\",\\"Console\\\\/Mode\\":\\"collapse\\"}\' WHERE `username` = \'u1\'',
    ])
  })
})

describe('SqliteDriver (local fallback store)', () => {
  it('serves every per-user feature, isolated per server', async () => {
    const store = new LocalMetadataStore(':memory:')
    const state: MetaSessionState = {}
    const meta = (server: number, user: string) =>
      new Metadata({
        control: null,
        relationParameters: emptyRelationParameters(),
        local: store.driver(server),
        settings: {
          AllowSharedBookmarks: true,
          QueryHistoryDB: true,
          QueryHistoryMax: 2,
          MaxCharactersInDisplayedSQL: 1000,
          NumRecentTables: 10,
          NumFavoriteTables: 10,
          MaxTableUiprefs: 1,
          DisableIS: false,
        },
        serverIndex: server,
        user,
        state,
        sqlHistory: [],
        tableExists: async () => true,
      })
    const m = meta(1, 'alice')
    expect(m.stores()).toEqual({
      bookmarks: 'local',
      history: 'local',
      recent: 'local',
      favorite: 'local',
      uiPrefs: 'local',
      userConfig: 'local',
    })
    const b = m.bookmarks()
    const nb = b.createBookmark('SELECT 1', 'one', 'alice', 'db1')
    if (nb !== false) await b.save(nb)
    const shared = b.createBookmark('SELECT 2', 'two', 'alice', 'db1', true)
    if (shared !== false) await b.save(shared)
    expect((await b.getList('alice', 'db1')).map((x) => x.label)).toEqual(['one', 'two'])
    expect((await meta(1, 'bob').bookmarks().getList('bob', 'db1')).map((x) => x.label)).toEqual(['two'])
    expect(await meta(2, 'alice').bookmarks().getList('alice', 'db1')).toEqual([])

    const h = m.history()
    for (const q of ['SELECT 1', 'SELECT 2', 'SELECT 3']) await h.setHistory('db1', '', 'alice', q)
    expect(((await h.getHistory('alice')) as Array<{ sqlquery: string }>).map((x) => x.sqlquery)).toEqual([
      'SELECT 3',
      'SELECT 2',
    ])

    const fav = await m.recentFavorite('favorite')
    await fav.add({ db: 'db1', table: 't' })
    state.favoriteTables = undefined
    expect((await m.recentFavorite('favorite')).getTables()).toEqual([{ db: 'db1', table: 't' }])

    const up = m.userPreferences()
    await up.save({ MaxRows: 100 })
    expect((await up.load()).config_data).toEqual({ MaxRows: 100 })
    expect((await up.load()).type).toBe('local')

    const info = { isView: async () => false, createTime: async () => 'c', columns: async () => ['id'] }
    await m.uiPrefs('db1', 't1', info).setUiProp('sorted_col', '`id` ASC')
    await m.uiPrefs('db1', 't2', info).setUiProp('sorted_col', '`id` DESC')
    state.tableUiPrefs = undefined
    // MaxTableUiprefs = 1: the older row was evicted
    expect(await m.uiPrefs('db1', 't1', info).getUiProp('sorted_col')).toBe(false)
    state.tableUiPrefs = undefined
    expect(await m.uiPrefs('db1', 't2', info).getUiProp('sorted_col')).toBe('`id` DESC')
    store.close()
  })
})
