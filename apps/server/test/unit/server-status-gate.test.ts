import { englishTranslator } from '@bettermyadmin/i18n'
import { describe, expect, it } from 'vitest'
import type { AdminCtx } from '../../src/server-admin/context.ts'
import {
  advisorPage,
  killProcess,
  queryStatistics,
  statusOverview,
  statusVariablesPage,
} from '../../src/server-admin/status.ts'

/**
 * The Status pages without `SHOW GLOBAL STATUS` (Data::$dataLoaded false) and the Amazon RDS kill
 * statement, on a scripted DatabaseInterface: every statement is recorded, `SHOW GLOBAL STATUS`
 * fails when `status` is false.
 * pma: src/Server/Status/Data.php, DatabaseInterface::getKillQuery / isAmazonRds
 */
function fakeCtx(o: { status: boolean; basedir?: string; superuser?: boolean }) {
  const sent: string[] = []
  const dbi = {
    cache: {} as Record<string, unknown>,
    async tryQuery(sql: string) {
      sent.push(sql)
      if (sql === 'SHOW GLOBAL STATUS' && !o.status) return null
      if (sql.startsWith('SHOW GLOBAL'))
        return { fields: ['Variable_name', 'Value'], rows: [['Uptime', '100']] }
      return { fields: [], rows: [] }
    },
    async fetchResultSimple(sql: string) {
      sent.push(sql)
      return []
    },
    async fetchValue(sql: string) {
      sent.push(sql)
      if (sql === 'SELECT @@basedir') return o.basedir ?? '/usr/'
      if (sql === 'SELECT 1 FROM mysql.user LIMIT 1') return o.superuser === true ? '1' : false
      return '0'
    },
  }
  const ctx = {
    dbi,
    tr: englishTranslator(),
    versionInt: 80400,
    isMariaDb: false,
    timeZone: 'UTC',
  } as unknown as AdminCtx
  return { ctx, sent }
}

describe('Status pages without SHOW GLOBAL STATUS [p06-032e98]', () => {
  it('every page reports isDataLoaded false and computes nothing', async () => {
    const { ctx } = fakeCtx({ status: false })
    const overview = await statusOverview(ctx)
    expect(overview).toMatchObject({ isDataLoaded: false, networkTraffic: null, traffic: [] })
    expect(await queryStatistics(ctx)).toMatchObject({ isDataLoaded: false })
    expect(await statusVariablesPage(ctx, { filterAlert: false, dontFormat: false })).toMatchObject({
      isDataLoaded: false,
      variables: [],
    })
    expect(await advisorPage(ctx, (n) => n)).toEqual({
      isDataLoaded: false,
      fired: [],
      notfired: [],
      unchecked: [],
      errors: [],
    })
  })
})

describe('Kill on Amazon RDS [p06-fa6805]', () => {
  const kill = async (o: { basedir: string; superuser: boolean }) => {
    const { ctx, sent } = fakeCtx({ status: true, ...o })
    const r = await killProcess(ctx, 42)
    expect(r).toMatchObject({ success: true, message: { text: 'Thread 42 was successfully killed.' } })
    return sent.filter((s) => /^(KILL|CALL)/.test(s))
  }
  it('RDS as superuser: CALL mysql.rds_kill(id)', async () => {
    expect(await kill({ basedir: '/rdsdbbin/mysql/', superuser: true })).toEqual(['CALL mysql.rds_kill(42);'])
  })
  it('RDS without superuser, and any other server: KILL id', async () => {
    expect(await kill({ basedir: '/rdsdbbin/mysql/', superuser: false })).toEqual(['KILL 42;'])
    expect(await kill({ basedir: '/usr/', superuser: true })).toEqual(['KILL 42;'])
  })
})
