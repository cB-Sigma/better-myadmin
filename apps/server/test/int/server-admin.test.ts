import type {
  AdvisorResponse,
  BinlogResponse,
  CollationsResponse,
  DatabasesResponse,
  EngineResponse,
  EnginesResponse,
  PluginsResponse,
  ProcessList,
  QueryStatistics,
  ServerVariablesResponse,
  StatusOverview,
  StatusVariables,
} from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'
import { hasPerformanceSchema, isMariaDb, utf8mb4Default } from '../support/vendor.ts'

/** The server-level endpoints against a real MySQL (docs/features/06-server-level.md). */
let t: ReturnType<typeof testApp>
let limited: ReturnType<typeof testApp>
let root: mysql.Connection
const USER = 'm3srv_it_user'

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS m3srv_it_a; CREATE DATABASE m3srv_it_a COLLATE utf8mb4_bin;
    CREATE TABLE m3srv_it_a.t (id INT PRIMARY KEY); INSERT INTO m3srv_it_a.t VALUES (1),(2);
    DROP DATABASE IF EXISTS m3srv_it_new; DROP DATABASE IF EXISTS m3srv_it_drop;
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`m3srv\\_it\\_%\`.* TO '${USER}'@'%'`)
  t = testApp()
  await t.login()
  limited = testApp(testConfig())
  await limited.login(USER, USER)
})
afterAll(async () => {
  await t?.close()
  await limited?.close()
  await root.query(`DROP DATABASE IF EXISTS m3srv_it_a; DROP DATABASE IF EXISTS m3srv_it_new;
    DROP DATABASE IF EXISTS m3srv_it_drop; DROP DATABASE IF EXISTS m3srv_it_lower; DROP USER IF EXISTS '${USER}'@'%'`)
  await root.end()
})

const get = async <T>(path: string, app = t) => {
  const r = await app.req('GET', `/api/servers/1${path}`)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json as unknown as T
}

describe('databases', () => {
  it('lists with collations; statistics add the six columns and totals', async () => {
    const d = await get<DatabasesResponse>('/databases?statistics=1')
    const a = d.databases.find((x) => x.name === 'm3srv_it_a')!
    expect(a.collation).toEqual({ name: 'utf8mb4_bin', description: 'Unicode (UCA 4.0.0), binary' })
    expect(a.statistics.map((s) => s.key)).toEqual([
      'SCHEMA_TABLES',
      'SCHEMA_TABLE_ROWS',
      'SCHEMA_DATA_LENGTH',
      'SCHEMA_INDEX_LENGTH',
      'SCHEMA_LENGTH',
      'SCHEMA_DATA_FREE',
    ])
    expect(a.statistics[0]!.value).toBe('1')
    expect(d.totalStatistics).toHaveLength(6)
    expect(d.isDropAllowed).toBe(true)
    expect(d.databases.find((x) => x.name === 'mysql')!.isSystemSchema).toBe(true)
  })

  it('a limited account sees its databases, gets the wildcard prefilled and no drop', async () => {
    const d = await get<DatabasesResponse>('/databases', limited)
    expect(d.databases.map((x) => x.name)).toEqual([
      'information_schema',
      'm3srv_it_a',
      ...(hasPerformanceSchema ? ['performance_schema'] : []),
    ])
    expect(d.hasCreateDatabasePrivileges).toBe(true)
    expect(d.databaseToCreate).toBe('m3srv_it_')
    expect(d.isDropAllowed).toBe(false)
    const r = await limited.req('POST', '/api/servers/1/databases/drop', { selected_dbs: ['m3srv_it_a'] })
    expect(r.json.success).toBe(false)
  })

  it('sorting falls back to SCHEMA_NAME, order to asc', async () => {
    const d = await get<DatabasesResponse>('/databases?sort_by=x;DROP&sort_order=sideways')
    expect([d.sortBy, d.sortOrder]).toEqual(['SCHEMA_NAME', 'asc'])
  })

  it('creates and drops', async () => {
    const c = await t.req('POST', '/api/servers/1/databases', {
      new_db: 'm3srv_it_new',
      db_collation: 'latin1_swedish_ci',
    })
    expect(c.status).toBe(200)
    expect(c.json.message).toEqual({ type: 'success', text: 'Database m3srv_it_new has been created.' })
    expect((c.json.sqlQuery as { sql: string }).sql).toBe(
      'CREATE DATABASE `m3srv_it_new` DEFAULT CHARSET=latin1 COLLATE latin1_swedish_ci;',
    )
    const again = await t.req('POST', '/api/servers/1/databases', { new_db: 'm3srv_it_new' })
    expect((again.json.message as { type: string }).type).toBe('error')
    expect((again.json.message as { text: string }).text).toMatch(/^#1007 - /)
    const d = await t.req('POST', '/api/servers/1/databases/drop', {
      selected_dbs: ['m3srv_it_new', 'sys', 7],
    })
    expect(d.json.message).toEqual({ type: 'success', text: '1 database has been dropped successfully.' })
  })

  it('mutations need the CSRF token', async () => {
    const r = await t.req(
      'POST',
      '/api/servers/1/databases',
      { new_db: 'm3srv_it_x' },
      { 'X-BMA-Token': 'nope' },
    )
    expect(r.status).toBe(403)
  })
})

describe('status', () => {
  it('overview [p06-770074] [p06-8b5ab5]', async () => {
    const o = await get<StatusOverview>('/status')
    expect(o.isDataLoaded).toBe(true)
    expect(o.traffic.map((x) => x.name)).toEqual(['Received', 'Sent', 'Total'])
    expect(o.connections.map((x) => x.name)).toEqual([
      'Max. concurrent connections',
      'Failed attempts',
      'Aborted',
      'Total',
    ])
    expect(o.uptime).toMatch(/^\d+ days, \d+ hours, \d+ minutes and \d+ seconds$/)
  })

  it('processes: sort, filter, full texts, kill [p06-0b7c03] [p06-9768f8]', async () => {
    const c = await mysql.createConnection(MYSQL)
    void c.query('SELECT SLEEP(30) /* m3srv_it_sleep */').catch(() => {})
    await new Promise((r) => setTimeout(r, 200))
    try {
      const l = await get<ProcessList>('/status/processes?order_by_field=Id&sort_order=ASC&showExecuting=on')
      const ids = l.rows.map((r) => Number(r.id))
      expect(ids).toEqual([...ids].sort((a, b) => a - b))
      expect(l.rows.every((r) => r.command !== 'Sleep')).toBe(true)
      expect(l.columns.find((x) => x.orderByField === 'Id')).toMatchObject({
        isSorted: true,
        sortOrder: 'DESC',
      })
      expect(l.columns.at(-1)).toMatchObject({ orderByField: 'Info', hasFullQuery: true })
      const mine = l.rows.find((r) => r.id === String(c.threadId))!
      expect(mine.info).toContain('m3srv_it_sleep')
      const k = await t.req('POST', `/api/servers/1/status/processes/${c.threadId}/kill`)
      expect(k.json).toEqual({
        success: true,
        message: { type: 'success', text: `Thread ${c.threadId} was successfully killed.` },
      })
      const k2 = await t.req('POST', `/api/servers/1/status/processes/${c.threadId}/kill`)
      expect(k2.json.success).toBe(false)
    } finally {
      c.destroy()
    }
  })

  it('query statistics [p06-cac377]', async () => {
    const q = await get<QueryStatistics>('/status/queries')
    expect(q.queries.find((x) => x.key === 'Com_select')!.name).toBe('Select')
    expect(q.queries.some((x) => x.key === 'Com_admin_commands')).toBe(false)
    expect(q.chart.labels.length).toBe(q.chart.data.length)
  })

  it('status variables: categories, synthetic values, docs, FLUSH [p06-3399cc] [p06-90f755] [p06-fa0c8f]', async () => {
    const v = await get<StatusVariables>('/status/variables')
    expect(v.categories.map((c) => c.id)).toContain('innodb')
    const hit = v.variables.find((x) => x.name === 'Threads_cache_hitrate_%')!
    expect(hit.docUrl).toBeNull()
    expect(hit.formatted.text).toMatch(/ %$/)
    // Generator::linkToVarDocumentation: the MariaDB knowledge base on MariaDB
    expect(v.variables.find((x) => x.name === 'Uptime')!.docUrl).toBe(
      isMariaDb
        ? 'https://mariadb.com/kb/en/server-status-variables/#uptime'
        : 'https://dev.mysql.com/doc/refman/8.0/en/server-status-variables.html#statvar_Uptime',
    )
    const f = await t.req('POST', '/api/servers/1/status/variables', { flush: 'TABLES' })
    expect(f.json.flushed).toBe('FLUSH TABLES;')
    const ignored = await t.req('POST', '/api/servers/1/status/variables', { flush: 'HOSTS' })
    expect(ignored.json.flushed).toBeNull()
  })

  it('advisor [p06-44265d]', async () => {
    const a = await get<AdvisorResponse>('/status/advisor')
    expect(a.isDataLoaded).toBe(true)
    expect(a.errors).toEqual([])
    // the rules file has MariaDB-only and MySQL-only rules (IS_MARIADB in their conditions)
    expect(a.fired.length + a.notfired.length + a.unchecked.length).toBe(isMariaDb ? 55 : 48)
    expect(
      a.fired.find((r) => r.id === 'Long query time')?.issue ??
        '<a href="/s/1/variables?filter=long_query_time">',
    ).toContain('/s/1/variables?filter=long_query_time')
  })
})

describe('variables', () => {
  it('lists, gets and sets [p06-162a8d] [p06-d139b2]', async () => {
    const v = await get<ServerVariablesResponse>('/variables')
    // the knowledge base's first MySQL entry wins, like KBSearch::getByName (its MariaDB entry on MariaDB)
    expect(v.variables.find((x) => x.name === 'max_connections')!.docUrl).toBe(
      isMariaDb
        ? 'https://mariadb.com/kb/en/server-system-variables/#max_connections'
        : 'https://dev.mysql.com/doc/refman/8.0/en/replication-options-binary-log.html#sysvar_max_connections',
    )
    expect(v.variables.find((x) => x.name === 'sql_mode')!.docUrl).toBe(
      isMariaDb
        ? 'https://mariadb.com/kb/en/server-system-variables/#sql_mode'
        : 'https://dev.mysql.com/doc/refman/8.0/en/server-options.html#option_mysqld_sql-mode',
    )
    const [rows] = await root.query('SELECT @@GLOBAL.max_connect_errors AS v')
    const original = String((rows as Array<{ v: unknown }>)[0]!.v)
    try {
      const g = await get<{ message: string }>('/variables/max_connect_errors')
      expect(g.message).toBe(original)
      const s = await t.req('POST', '/api/servers/1/variables/max_connect_errors', { varValue: '4321' })
      expect(s.json).toEqual({ success: true, variable: { text: '4,321' } })
      const bad = await t.req('POST', '/api/servers/1/variables/max_connect_errors;x', { varValue: '1' })
      expect(bad.json).toEqual({ success: false, error: 'Setting variable failed' })
    } finally {
      await root.query(`SET GLOBAL max_connect_errors = ${Number(original)}`)
    }
  })
})

describe('charsets, engines, plugins, binlog', () => {
  it('collations grouped per charset [p06-b19775]', async () => {
    const c = await get<CollationsResponse>('/collations')
    const utf8mb4 = c.charsets.find((x) => x.name === 'utf8mb4')!
    expect(utf8mb4.collations.find((x) => x.isDefault)!.name).toBe(utf8mb4Default)
  })

  it('engines, InnoDB pages, unknown engine [p06-e1da5c]', async () => {
    const e = await get<EnginesResponse>('/engines')
    expect(e.engines.find((x) => x.engine === 'InnoDB')!.support).toBe('DEFAULT')
    const innodb = await get<EngineResponse>('/engines/InnoDB')
    expect(innodb.support).toBe('InnoDB is the default storage engine on this MySQL server.')
    expect(innodb.infoPages.map((p) => p.label)).toEqual(['Buffer Pool', 'InnoDB Status'])
    expect(innodb.variables.find((x) => x.name === 'innodb_buffer_pool_size')!.title).toBe('Buffer pool size')
    const status = await get<EngineResponse>('/engines/InnoDB/Status')
    expect(status.pageContent.kind).toBe('status')
    const unknown = await get<EngineResponse>('/engines/Nope')
    expect(unknown.isValid).toBe(false)
  })

  it('plugins grouped by sorted type [p06-e5aa2e]', async () => {
    const p = await get<PluginsResponse>('/plugins')
    const types = p.types.map((x) => x.type)
    expect(types).toEqual([...types].sort())
    expect(p.types.find((x) => x.type === 'STORAGE ENGINE')!.cleanType).toBe('storageengine')
  })

  it('binary log paging [p06-debfa6]', async () => {
    const b = await get<BinlogResponse>('/binlog?pos=25')
    expect(b.sqlMessage.sql).toBe('SHOW BINLOG EVENTS LIMIT 25, 25')
    expect(b.previous).toEqual({ pos: null })
    const bad = await t.req('GET', '/api/servers/1/binlog?log=nope%27')
    expect(bad.status).toBe(400)
    expect((bad.json.error as { sql: string }).sql).toBe("SHOW BINLOG EVENTS IN 'nope\\'' LIMIT 0, 25")
  })
})
