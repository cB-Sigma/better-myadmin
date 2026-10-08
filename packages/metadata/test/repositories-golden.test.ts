import { describe, expect, it } from 'vitest'
import type { QueryOutcome } from '../src/conn.ts'
import { type MetaSessionState, Metadata } from '../src/metadata.ts'
import type { RecentFavoriteTables } from '../src/recent-favorite.ts'
import { type RelationParametersArray, relationParametersFromArray } from '../src/relation-parameters.ts'
import {
  getDbComment,
  getDisplayField,
  getForeignersInternal,
  getMime,
  setDbComment,
} from '../src/relations.ts'
import type { UiProperty } from '../src/uiprefs.ts'
import { FakeConn, loadFixture } from './fixtures.ts'

interface Stmt {
  conn: 'control' | 'user'
  kind: 'query' | 'selectDb' | 'multi'
  sql: string
  fields?: string[]
  rows?: Array<Record<string, string | null>>
  error?: string
}
interface Op {
  group: string
  op: string
  args: unknown[]
  statements: Stmt[]
  result: unknown
  rows: Array<Record<string, string | null>> | null
}

const fx = loadFixture<{ relationParameters: RelationParametersArray; createTime: string; ops: Op[] }>(
  'repositories.json',
)
const USER = 'm1meta_rpu'
const DB = 'm1meta_rpd'
const TS = /'\d{4}-\d\d-\d\d \d\d:\d\d:\d\d'/g
const mask = (s: string) => s.replace(TS, "'<TS>'")

/**
 * Replays phpMyAdmin's control-link conversation: each statement we send must be the next one
 * phpMyAdmin sent (exactly, timestamps masked), and gets the rows phpMyAdmin got back.
 */
function replay(ops: Op[]) {
  const expected = ops.flatMap((o) => o.statements.filter((s) => s.conn === 'control'))
  let i = 0
  const conn = new FakeConn((sql) => {
    const e = expected[i++]
    expect(mask(sql), `statement #${i}`).toBe(e?.sql)
    if (e?.error !== undefined) return { error: e.error, errno: 1 }
    const out: QueryOutcome = { fields: e?.fields ?? [], rows: e?.rows ?? [], affectedRows: 0 }
    return out
  })
  return { conn, done: () => expect(i, 'all statements replayed').toBe(expected.length) }
}

const TABLES: Record<string, { view: boolean; cols: Array<{ field: string; type: string }> }> = {
  t: {
    view: false,
    cols: [
      { field: 'id', type: 'int' },
      { field: 'num', type: 'int' },
      { field: 'name', type: 'varchar(20)' },
      { field: 'note', type: 'text' },
    ],
  },
  t2: {
    view: false,
    cols: [
      { field: 'id', type: 'int' },
      { field: 'label', type: 'char(5)' },
    ],
  },
  nochar: {
    view: false,
    cols: [
      { field: 'id', type: 'int' },
      { field: 'n', type: 'int' },
    ],
  },
  v: {
    view: true,
    cols: [
      { field: 'id', type: 'int' },
      { field: 'name', type: 'varchar(20)' },
    ],
  },
}

function metadata(
  conn: FakeConn,
  state: MetaSessionState,
  sqlHistory: Array<{ db: string; table: string; sqlquery: string }>,
) {
  return new Metadata({
    control: conn,
    relationParameters: relationParametersFromArray(fx.relationParameters),
    local: null,
    settings: {
      AllowSharedBookmarks: true,
      QueryHistoryDB: true,
      QueryHistoryMax: 2,
      MaxCharactersInDisplayedSQL: 1000,
      NumRecentTables: 2,
      NumFavoriteTables: 2,
      MaxTableUiprefs: 2,
      DisableIS: false,
    },
    serverIndex: 1,
    user: USER,
    state,
    sqlHistory,
    tableExists: async (db, t) => db === DB && TABLES[t] !== undefined,
  })
}

const groups = [...new Set(fx.ops.map((o) => o.group))]

describe('pmadb repositories replay phpMyAdmin’s statements', () => {
  for (const group of groups) {
    it(group, async () => {
      const ops = fx.ops.filter((o) => o.group === group)
      const { conn, done } = replay(ops)
      const state: MetaSessionState = {}
      const sqlHistory: Array<{ db: string; table: string; sqlquery: string }> = []
      const m = metadata(conn, state, sqlHistory)
      const rp = m.relationParameters
      let recent: RecentFavoriteTables | null = null
      let favorite: RecentFavoriteTables | null = null
      for (const o of ops) {
        const a = o.args
        let result: unknown
        switch (`${group}.${o.op}`) {
          case 'bookmarks.create': {
            const [q, label, user, db, shared] = o.args as [string, string, string, string, boolean]
            const b = m.bookmarks().createBookmark(q, label, user, db, shared)
            result = b === false ? false : await m.bookmarks().save(b)
            break
          }
          case 'bookmarks.getList': {
            const [user, db] = o.args as [string, string | false]
            result = (await m.bookmarks().getList(user, db)).map(({ id, dbase, user: u, label, query }) => ({
              id,
              dbase,
              user: u,
              label,
              query,
            }))
            break
          }
          case 'bookmarks.get':
          case 'bookmarks.getByLabel': {
            const b =
              o.op === 'get'
                ? await m.bookmarks().get(a[0] as string | null, a[1] as number)
                : await m.bookmarks().getByLabel(a[0] as string, a[1] as string, a[2] as string)
            result =
              b === null ? null : { id: b.id, dbase: b.dbase, user: b.user, label: b.label, query: b.query }
            break
          }
          case 'bookmarks.delete': {
            const b = await m.bookmarks().get(USER, a[0] as number)
            result = b === null ? null : await m.bookmarks().delete(b.id)
            break
          }
          case 'history.setHistory':
            await m.history().setHistory(a[0] as string, a[1] as string, USER, a[2] as string)
            result = [...sqlHistory]
            break
          case 'history.getHistory':
            result = (
              (await m.history().getHistory(USER)) as Array<{ db: string; table: string; sqlquery: string }>
            ).map(({ db, table, sqlquery }) => ({ db, table, sqlquery }))
            break
          case 'recent.add': {
            recent ??= await m.recentFavorite('recent')
            const r = await recent.add({ db: a[0] as string, table: a[1] as string })
            result = { returned: r === true ? true : r.text, tables: recent.getTables() }
            break
          }
          case 'favorite.add':
          case 'favorite.remove': {
            favorite ??= await m.recentFavorite('favorite')
            const t = { db: a[0] as string, table: a[1] as string }
            const r = o.op === 'add' ? await favorite.add(t) : await favorite.remove(t)
            result = { returned: r === true ? true : r.text, tables: favorite.getTables() }
            break
          }
          case 'uiprefs.set':
          case 'uiprefs.get':
          case 'uiprefs.remove': {
            const [, table, prop, value, ct] = o.args as [
              string,
              string,
              UiProperty,
              number[] | string,
              string | null,
            ]
            const info = TABLES[table] as (typeof TABLES)[string]
            const ui = m.uiPrefs(DB, table, {
              isView: async () => info.view,
              createTime: async () => (info.view ? null : fx.createTime),
              columns: async () => info.cols.map((c) => `${DB}.${table}.${c.field}`),
            })
            const r =
              o.op === 'set'
                ? await ui.setUiProp(prop, value, ct)
                : o.op === 'get'
                  ? await ui.getUiProp(prop)
                  : await ui.removeUiProp(prop)
            result = typeof r === 'object' && r !== null && !Array.isArray(r) ? { message: r.text } : r
            break
          }
          case 'uiprefs.session':
            result = state.tableUiPrefs?.['1']
            break
          case 'userprefs.load': {
            const { mtime: _m, ...rest } = await m.userPreferences().load()
            result = {
              ...rest,
              config_data: Object.keys(rest.config_data).length === 0 ? [] : rest.config_data,
            }
            break
          }
          case 'userprefs.save':
            result = await m
              .userPreferences()
              .save((Array.isArray(a[0]) ? {} : a[0]) as Record<string, unknown>)
            break
          case 'userprefs.persistOption':
            result = await m.userPreferences().persistOption(a[0] as string, a[1], a[2])
            break
          case 'navigation.hide':
            result = await m.navigationHiding()?.hide(USER, a[0] as string, a[1] as string, a[2] as string)
            result = null
            break
          case 'navigation.unhide':
            await m.navigationHiding()?.unhide(USER, a[0] as string, a[1] as string, a[2] as string)
            result = null
            break
          case 'navigation.hiddenItems':
            result = await m.navigationHiding()?.hiddenItems(USER, a[0] as string)
            break
          case 'navigation.hiddenOfType':
            result = await m.navigationHiding()?.hiddenOfType(USER, a[0] as string, a[1] as string)
            break
          case 'navigation.hiddenCounts': {
            const counts = (await m.navigationHiding()?.hiddenCounts(USER)) ?? {}
            result = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, String(v)]))
            break
          }
          case 'relation.getForeignersInternal':
            result = await getForeignersInternal(conn, rp, a[0] as string, a[1] as string, a[2] as string)
            if (Object.keys(result as object).length === 0) result = []
            break
          case 'relation.getDisplayField': {
            const table = a[1] as string
            result = await getDisplayField(
              conn,
              rp,
              a[0] as string,
              table,
              async () => TABLES[table]?.cols ?? [],
            )
            break
          }
          case 'relation.getDbComment':
            result = await getDbComment(conn, rp, a[0] as string)
            break
          case 'relation.setDbComment':
            result = await setDbComment(conn, rp, a[0] as string, a[1] as string)
            break
          case 'relation.getMime':
            result = await getMime(conn, rp, a[0] as string, a[1] as string, a[2] as boolean, a[3] as boolean)
            break
          default:
            throw new Error(`no replay for ${group}.${o.op}`)
        }
        expect(result, `${group}.${o.op}(${JSON.stringify(o.args)}) result`).toEqual(o.result)
      }
      done()
    })
  }
})
