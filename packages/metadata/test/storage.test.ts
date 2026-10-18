import { describe, expect, it } from 'vitest'
import {
  type RelationParametersArray,
  STORAGE_TABLE_DIRECTIVES,
  type StorageServer,
  relationParametersToArray,
} from '../src/relation-parameters.ts'
import { ConfigStorage } from '../src/storage.ts'
import { FakeConn, type Recorded, loadFixture, ok } from './fixtures.ts'

interface Step {
  step: 'init' | 'params' | 'flags' | 'fix_pmadb' | 'fixall_pmadb' | 'create_pmadb'
  statements: Array<{ conn: string } & Recorded>
  result: Record<string, unknown> | null
  message: string | null
  selectedServer: Record<string, string | false>
}
interface Scenario {
  name: string
  setup: {
    create?: Record<string, string> | []
    server: Record<string, string | false> | []
    currentDb?: string
    oldColumnInfo?: boolean
    denyTable?: string
    grantCreateNew?: boolean
  }
  steps: Step[]
  tablesAfter: Record<string, string[] | null>
}

const fixture = loadFixture<{ scenarios: Scenario[] }>('relation-storage.json')
const USER = 'm1meta_rpu'

/**
 * A tiny MySQL emulation with the privileges of the restricted control user the PHP generator used:
 * ALL on m1meta_rp.* (or table-level grants without `denyTable`), ALL on m1meta_rp_new.* only with
 * `grantCreateNew`, nothing on `phpmyadmin`.
 */
function emulate(sc: Scenario) {
  const dbs = new Map<string, Map<string, { old: boolean }>>()
  if (sc.setup.create !== undefined) {
    const t = new Map<string, { old: boolean }>()
    for (const [name, from] of Object.entries(sc.setup.create)) {
      t.set(name, { old: sc.setup.oldColumnInfo === true && from === 'pma__column_info' })
    }
    dbs.set('m1meta_rp', t)
  }
  const canSee = (db: string, table?: string) => {
    if (db === 'm1meta_rp') return table === undefined || table !== sc.setup.denyTable
    if (db === 'm1meta_rp_new') return sc.setup.grantCreateNew === true
    return false
  }
  let current = ''
  const err = (errno: number, error: string) => ({ errno, error })
  const conn = new FakeConn(
    (sql) => {
      let m = /^SHOW TABLES FROM `([^`]+)`;$/.exec(sql)
      if (m !== null) {
        const db = m[1] as string
        const t = dbs.get(db)
        if (t === undefined || !canSee(db))
          return err(1044, `Access denied for user '${USER}'@'%' to database '${db}'`)
        const names = [...t.keys()].filter((n) => canSee(db, n)).sort()
        return ok(
          names.map((n) => ({ [`Tables_in_${db}`]: n })),
          [`Tables_in_${db}`],
        )
      }
      m = /^SELECT NULL FROM `([^`]+)` LIMIT 0$/.exec(sql)
      if (m !== null) {
        const t = dbs.get(current)
        if (t?.has(m[1] as string) !== true || !canSee(current, m[1]))
          return err(1146, `Table '${m[1]}' doesn't exist`)
        return ok([], ['NULL'])
      }
      m = /^SHOW COLUMNS FROM `([^`]+)`\.`([^`]+)` WHERE Field IN/.exec(sql)
      if (m !== null) {
        const info = dbs.get(m[1] as string)?.get(m[2] as string)
        if (info === undefined) return err(1146, 'no table')
        return ok(
          info.old ? [] : [{ Field: 'input_transformation' }, { Field: 'input_transformation_options' }],
          ['Field'],
        )
      }
      if (sql.includes('SQL Commands to upgrade pmadb.pma__column_info')) {
        for (const t of dbs.values()) for (const v of t.values()) v.old = false
        return ok()
      }
      m = /CREATE TABLE IF NOT EXISTS `([^`]+)` \(/.exec(sql)
      if (m !== null) {
        dbs.get(current)?.set(m[1] as string, { old: false })
        return ok()
      }
      m = /^CREATE DATABASE IF NOT EXISTS `([^`]+)`$/.exec(sql)
      if (m !== null) {
        const db = m[1] as string
        if (!canSee(db)) return err(1044, `Access denied for user '${USER}'@'%' to database '${db}'`)
        if (!dbs.has(db)) dbs.set(db, new Map())
        return ok()
      }
      throw new Error(`unexpected statement: ${sql}`)
    },
    (db) => {
      if (!dbs.has(db) || !canSee(db)) return false
      current = db
      return true
    },
  )
  const tablesAfter = () =>
    Object.fromEntries(
      ['m1meta_rp', 'm1meta_rp_new'].map((db) => {
        const t = dbs.get(db)
        return [db, t === undefined ? null : [...t.keys()].sort()]
      }),
    )
  return { conn, tablesAfter }
}

function serverFrom(setup: Scenario['setup']): StorageServer {
  const s: StorageServer = {
    user: USER,
    pmadb: '',
    MaxTableUiprefs: 100,
    DisableIS: false,
    ...(Object.fromEntries(STORAGE_TABLE_DIRECTIVES.map((d) => [d, ''])) as Record<
      (typeof STORAGE_TABLE_DIRECTIVES)[number],
      string
    >),
  }
  for (const [k, v] of Object.entries(Array.isArray(setup.server) ? {} : setup.server)) {
    ;(s as Record<string, unknown>)[k] = v
  }
  return s
}

const UPGRADE = 'column_info needs the 4.3 upgrade'

/** Feature 08 checklist items each scenario proves (docs/features/08-settings-preferences-pmadb.md). */
const CHECKLIST: Record<string, string> = {
  'no pmadb configured, nothing found': '[p08-0c056a]',
  'pmadb configured but missing': '[p08-0c056a] [p08-19523b]',
  'all tables, auto-detected names': '[p08-759df7]',
  'all tables, explicit names': '[p08-759df7]',
  'subset of tables, auto-detected': '[p08-ac345c] [p08-d5ec83]',
  'custom table name': '[p08-759df7]',
  'features disabled with false': '[p08-759df7] [p08-d5ec83]',
  'all features disabled': '[p08-759df7]',
  [UPGRADE]: '[p08-5b639b]',
  'control user cannot read one table': '[p08-ac345c]',
  'tables in the current database are picked up (ZeroConf)': '[p08-0c056a]',
  'fix_pmadb creates the missing tables (explicit names)': '[p08-c68812]',
  'fix_pmadb with disabled tables skips them': '[p08-c68812]',
  'fixall_pmadb creates the storage in the current database': '[p08-c68812] [p08-19523b]',
  'create_pmadb creates the database and the tables': '[p08-c68812] [p08-19523b]',
  'create_pmadb without privileges': '[p08-19523b]',
}

describe('ConfigStorage (Relation.php) against phpMyAdmin run on a real server', () => {
  for (const sc of fixture.scenarios) {
    it(`${sc.name} ${CHECKLIST[sc.name] ?? ''}`.trim(), async () => {
      const { conn, tablesAfter } = emulate(sc)
      const server = serverFrom(sc.setup)
      const storage = new ConfigStorage(conn, server)
      for (const st of sc.steps) {
        const before = conn.log.length
        let result: unknown = null
        let message: string | null = null
        switch (st.step) {
          case 'init':
            await storage.initRelationParamsCache(sc.setup.currentDb ?? '')
            break
          case 'params':
            result = relationParametersToArray(await storage.getRelationParameters())
            break
          case 'flags':
            result = {
              arePmadbTablesDefined: storage.arePmadbTablesDefined(),
              arePmadbTablesAllDisabled: storage.arePmadbTablesAllDisabled(),
              configurationStorageDbName: storage.getConfigurationStorageDbName(),
            }
            break
          case 'fix_pmadb':
            message =
              (await storage.fixPmaTables(String((await storage.getRelationParameters()).db ?? '')))?.text ??
              null
            break
          case 'fixall_pmadb':
            message = (await storage.fixPmaTables(sc.setup.currentDb ?? ''))?.text ?? null
            break
          case 'create_pmadb': {
            const name = storage.getConfigurationStorageDbName()
            const msg = await storage.createPmaDatabase(name)
            if (msg === null) message = (await storage.fixPmaTables(name))?.text ?? null
            else message = msg.text
            break
          }
        }
        let expected = st.statements.map(({ kind, sql }) => ({ kind, sql }))
        let expectedResult = st.result
        if (sc.name === UPGRADE && st.step === 'init') {
          // phpMyAdmin leaves its control link out of sync after the upgrade multi-query, so its
          // `pma__users` probe fails and `pma__usergroups` is never probed; we consume all results
          // (docs/reference/parity-exceptions.md)
          const i = expected.findIndex((e) => e.sql === 'SELECT NULL FROM `pma__users` LIMIT 0')
          expected = [
            ...expected.slice(0, i + 1),
            { kind: 'query', sql: 'SELECT NULL FROM `pma__usergroups` LIMIT 0' },
            ...expected.slice(i + 1),
          ]
        }
        if (sc.name === UPGRADE && st.step === 'params' && expectedResult !== null) {
          const all = fixture.scenarios.find((s) => s.name === 'all tables, auto-detected names')
          expectedResult = all?.steps.find((s) => s.step === 'params')?.result ?? null
        }
        expect(conn.log.slice(before), `${st.step} statements`).toEqual(expected)
        if (expectedResult !== null) {
          expect(result as RelationParametersArray, `${st.step} result`).toEqual({
            ...expectedResult,
            user: expectedResult.user,
          })
        }
        expect(message, `${st.step} message`).toBe(st.message)
        const pick = Object.fromEntries(
          Object.keys(st.selectedServer).map((k) => [k, (server as Record<string, unknown>)[k]]),
        )
        expect(pick, `${st.step} selectedServer`).toEqual(st.selectedServer)
      }
      expect(tablesAfter()).toEqual(sc.tablesAfter)
    })
  }
})
