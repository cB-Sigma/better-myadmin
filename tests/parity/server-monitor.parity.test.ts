import type {
  MonitorChartResponse,
  MonitorLogResponse,
  MonitorLogVarsResponse,
  MonitorPage,
  MonitorQueryResponse,
} from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { $, $$, pageHtml, parse } from './lib/html.ts'
import { isPmaUp } from './lib/pma.ts'
import { type Harness, ROOT, both, diff, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of Server › Status › Monitor: the page facts, the chart readings (requiredData of
 * the default grid and a preset), the slow and general log statistics, the logging variables and
 * the query analyzer.
 *
 * The logging variables are server-wide and the parity harness needs the shared server's general
 * log: SET GLOBAL and the slow log are exercised on the dev replica (:3308, its own reference
 * phpMyAdmin on :8083), never on the shared primary. The general-log statistics read a window of the
 * shared log that lies in the past (its rows no longer change).
 */
const REPLICA_ROOT = {
  ...ROOT,
  host: process.env.BMA_PARITY_REPLICA_HOST ?? ROOT.host,
  port: Number(process.env.BMA_PARITY_REPLICA_PORT ?? 3308),
}
const REPLICA_PMA = process.env.BMA_PARITY_REPLICA_PMA_URL ?? 'http://127.0.0.1:8083'
const USERS = { pma: 'f06r_mon_pma', bma: 'f06r_mon_bma' }
const DB = 'f06r_mon'

const replicaReachable =
  pmaReachable &&
  (await isPmaUp(REPLICA_PMA)) &&
  (await mysql
    .createConnection(REPLICA_ROOT)
    .then(async (c) => {
      await c.end()
      return true
    })
    .catch(() => false))

let p: Harness
let r: Harness | undefined
let replicaVars: Record<string, string> = {}

beforeAll(async () => {
  if (!pmaReachable) return
  p = await startHarness({}, USERS)
  await p.root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, v VARCHAR(10), KEY v (v));
    INSERT INTO ${DB}.t VALUES (1,'a'),(2,'b'),(3,'c')`)
  if (replicaReachable) {
    r = await startHarness({}, USERS, {}, { root: REPLICA_ROOT, pmaUrl: REPLICA_PMA })
    const [rows] = (await r.root.query(
      "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('slow_query_log','long_query_time','log_output')",
    )) as unknown as [Array<{ Variable_name: string; Value: string }>]
    replicaVars = Object.fromEntries(rows.map((x) => [x.Variable_name, x.Value]))
  }
})
afterAll(async () => {
  if (r !== undefined) {
    await r.root.query(
      `SET GLOBAL slow_query_log = '${replicaVars.slow_query_log ?? 'OFF'}'; SET GLOBAL long_query_time = ${Number(replicaVars.long_query_time ?? 10)}`,
    )
  }
  await p?.root.query(`DROP DATABASE IF EXISTS ${DB}`)
  await r?.close()
  await p?.close()
})

const post = async <T>(h: Harness, path: string, body: unknown) => {
  const res = await h.bma.req('POST', `/api/servers/1${path}`, body)
  expect(res.status, JSON.stringify(res.json)).toBe(200)
  return res.json as unknown as T
}

/** monitor.ts defaultChartGrid (with the Linux cpu / memory / swap presets) as runtime.dataList */
const DEFAULT_GRID = {
  0: [[{ type: 'statusvar', name: 'Questions' }]],
  1: [[{ type: 'statusvar', name: 'Connections' }], [{ type: 'proc', name: 'processes' }]],
  2: [[{ type: 'statusvar', name: 'Bytes_sent' }], [{ type: 'statusvar', name: 'Bytes_received' }]],
  3: [[{ type: 'cpu', name: 'irrelevant' }]],
  4: [
    [{ type: 'memory', name: 'Buffers' }],
    [{ type: 'memory', name: 'MemUsed' }],
    [{ type: 'memory', name: 'Cached' }],
    [{ type: 'memory', name: 'MemFree' }],
  ],
  5: [
    [{ type: 'memory', name: 'SwapCached' }],
    [{ type: 'memory', name: 'SwapUsed' }],
    [{ type: 'memory', name: 'SwapFree' }],
  ],
  // the query cache presets (a server variable; MySQL 8 has no Qcache_* status: null) and a name
  // outside [a-zA-Z_] (not queried, null)
  6: [
    [
      { type: 'statusvar', name: 'Qcache_free_memory' },
      { type: 'servervar', name: 'query_cache_size' },
    ],
  ],
  7: [
    [
      { type: 'statusvar', name: 'Com_select;' },
      { type: 'servervar', name: 'max_connections' },
    ],
  ],
}

/** Value kinds of an answer: numbers move between the two requests (counters, clock, memory) */
const kinds = (m: Record<string, unknown>) =>
  JSON.parse(
    JSON.stringify(m, (k, v) =>
      k === 'x'
        ? 'ms'
        : typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v))
          ? '#'
          : v,
    ),
  )

describe.skipIf(!pmaReachable)('parity: status monitor', () => {
  it('page: server time, OS, superuser, local database, the numeric status variables', async () => {
    const res = await both(
      p,
      () => p.pma.getJson('/server/status/monitor'),
      () => p.bma.req('GET', '/api/servers/1/status/monitor'),
    )
    const cmp = diff(p, res.pmaLog, res.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    const html = pageHtml(res.p)
    const form = Object.fromEntries(
      $$(parse(html), 'form#js_data input').map((i) => [i.attrs.name ?? '', i.attrs.value ?? '']),
    )
    const b = res.b.json as unknown as MonitorPage
    expect(b.serverOs).toBe(form.server_os)
    expect(b.isSuperUser ? '1' : '').toBe(form.is_superuser)
    expect(b.serverDbIsLocal ? '1' : '').toBe(form.server_db_isLocal)
    expect(Math.abs(b.serverTime - Number(form.server_time))).toBeLessThan(60_000)
    // the template escapes with |e('js'): `%` is `\u0025`
    const names = [...html.matchAll(/^\s*"([^"]+)",$/gm)].map((m) => JSON.parse(`"${m[1]}"`) as string)
    expect(b.variableNames).toEqual(names)
    expect($(parse(html), 'h2')).toBeDefined()
  })

  it('chart data: one query per variable kind, processes, CPU and memory of the host, x', async () => {
    const requiredData = JSON.stringify(DEFAULT_GRID)
    const res = await both(
      p,
      () => p.pma.postJson('/server/status/monitor/chart', { requiredData }),
      () => post<MonitorChartResponse>(p, '/status/monitor/chart', { requiredData }),
    )
    const cmp = diff(p, res.pmaLog, res.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(cmp.bma).toContain(
      "SHOW GLOBAL STATUS WHERE Variable_name='Questions' OR Variable_name='Connections' OR Variable_name='Bytes_sent' OR Variable_name='Bytes_received' OR Variable_name='Qcache_free_memory'",
    )
    expect(kinds(res.b.message)).toEqual(kinds(res.p.message as unknown as Record<string, unknown>))
  })

  it('chart data: a list (the JSON of a grid with numeric keys) answers the same shape', async () => {
    const requiredData = JSON.stringify([[[{ type: 'statusvar', name: 'Threads_connected' }]]])
    const res = await both(
      p,
      () => p.pma.postJson('/server/status/monitor/chart', { requiredData }),
      () => post<MonitorChartResponse>(p, '/status/monitor/chart', { requiredData }),
    )
    const cmp = diff(p, res.pmaLog, res.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(kinds(res.b.message)).toEqual(kinds(res.p.message as unknown as Record<string, unknown>))
  })

  it('general log statistics of a past window (grouped, limited to DML, INSERTs grouped)', async () => {
    const [[now]] = (await p.root.query({
      sql: 'SELECT UNIX_TIMESTAMP()',
      rowsAsArray: true,
    })) as unknown as [[[number]]]
    const window = { time_start: String(Number(now) - 240), time_end: String(Number(now) - 180) }
    for (const flags of [
      { limitTypes: 'true', removeVariables: 'true' },
      // jQuery posts false as the string "false", which PHP casts to true (quirk reproduced)
      { limitTypes: 'false', removeVariables: 'false' },
      { limitTypes: '', removeVariables: '' },
    ]) {
      const res = await both(
        p,
        () =>
          p.pma
            .postJson('/server/status/monitor/general-log', { ...window, ...flags })
            .catch((e: unknown) => ({ crashed: String(e) })),
        () => post<MonitorLogResponse>(p, '/status/monitor/general-log', { ...window, ...flags }),
      )
      const bm = res.b.message!
      if ('crashed' in res.p) {
        // Q63: an argument that does not start with a word and a space (a comment, `(`) makes
        // mb_strtolower(null) throw; ours counts it under the empty type
        expect(res.p.crashed).toContain('TypeError')
        expect(res.b.success).toBe(true)
        expect(bm.rows.some((x) => !/^\w+\s/.test(x.argument ?? ''))).toBe(true)
        continue
      }
      const cmp = diff(p, res.pmaLog, res.bmaLog)
      expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
      const pm = res.p.message as unknown as NonNullable<MonitorLogResponse['message']>
      // phpMyAdmin's grouped counts are integers, the rows' own are strings
      const str = (m: typeof bm) => ({ ...m, rows: m.rows.map((row) => ({ ...row, '#': String(row['#']) })) })
      expect(str(bm)).toEqual(str(pm))
    }
  })

  it('slow log statistics: an empty window, and the failure of a missing log table', async () => {
    const res = await both(
      p,
      () => p.pma.postJson('/server/status/monitor/slow-log', { time_start: '0', time_end: '1' }),
      () => post<MonitorLogResponse>(p, '/status/monitor/slow-log', { time_start: '0', time_end: '1' }),
    )
    const cmp = diff(p, res.pmaLog, res.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(res.b.message).toEqual(res.p.message)
  })

  it('logging variables (read only on the shared server)', async () => {
    const res = await both(
      p,
      () => p.pma.postJson('/server/status/monitor/log-vars', {}),
      () => post<MonitorLogVarsResponse>(p, '/status/monitor/log-vars', {}),
    )
    const cmp = diff(p, res.pmaLog, res.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(res.b.message).toEqual(res.p.message)
    // a name outside [a-zA-Z0-9_] is not set
    const bad = await both(
      p,
      () => p.pma.postJson('/server/status/monitor/log-vars', { varName: 'general_log;', varValue: 'OFF' }),
      () =>
        post<MonitorLogVarsResponse>(p, '/status/monitor/log-vars', {
          varName: 'general_log;',
          varValue: 'OFF',
        }),
    )
    const c2 = diff(p, bad.pmaLog, bad.bmaLog)
    expect(c2.problems, c2.problems.join('\n')).toEqual([])
    expect(c2.bma.some((s) => s.startsWith('SET GLOBAL'))).toBe(false)
  })

  for (const [name, query] of [
    ['SELECT with an index range', 'SELECT * FROM t WHERE id > 1'],
    ['full scan', '  select v from t'],
    ['unknown table', 'SELECT * FROM f06r_missing'],
  ] as Array<[string, string]>) {
    it(`query analyzer: ${name}`, async () => {
      const res = await both(
        p,
        () => p.pma.postJson('/server/status/monitor/query', { database: DB, query }),
        () => post<MonitorQueryResponse>(p, '/status/monitor/query', { database: DB, query }),
      )
      const cmp = diff(p, res.pmaLog, res.bmaLog)
      expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
      const pm = res.p.message as unknown as MonitorQueryResponse['message']
      const bm = res.b.message
      expect(bm.affectedRows).toBe(pm.affectedRows)
      expect(bm.explain).toEqual(pm.explain)
      expect(bm.error).toBe(pm.error)
      const states = (x?: Array<Record<string, string | null>>) => x?.map((s) => [s.seq, s.state])
      expect(states(bm.profiling)).toEqual(states(pm.profiling))
    })
  }
})

describe.skipIf(!replicaReachable)('parity: status monitor, logging variables (dev replica)', () => {
  for (const [name, varName, varValue] of [
    ['long_query_time (numeric)', 'long_query_time', '1'],
    ['slow_query_log ON (quoted)', 'slow_query_log', 'ON'],
    ['long_query_time back', 'long_query_time', '5'],
    ['slow_query_log OFF', 'slow_query_log', 'OFF'],
  ] as Array<[string, string, string]>) {
    it(`SET GLOBAL ${name}`, async () => {
      const h = r!
      const res = await both(
        h,
        () => h.pma.postJson('/server/status/monitor/log-vars', { varName, varValue }),
        () => post<MonitorLogVarsResponse>(h, '/status/monitor/log-vars', { varName, varValue }),
      )
      const cmp = diff(h, res.pmaLog, res.bmaLog)
      expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
      expect(cmp.bma.filter((s) => s.startsWith('SET GLOBAL'))).toEqual([
        `SET GLOBAL ${varName} = ${/^\d+$/.test(varValue) ? varValue : `'${varValue}'`}`,
      ])
      expect(res.b.message).toEqual(res.p.message)
    })
  }

  it('slow log statistics of logged statements', async () => {
    const h = r!
    await h.root.query("SET GLOBAL long_query_time = 0; SET GLOBAL slow_query_log = 'ON'")
    const [[t0]] = (await h.root.query({ sql: 'SELECT UNIX_TIMESTAMP()', rowsAsArray: true })) as unknown as [
      [[number]],
    ]
    const c = await mysql.createConnection(REPLICA_ROOT)
    await c.query('SELECT 1 AS f06r_slow')
    await c.query('SELECT 1 AS f06r_slow')
    await c.query(`INSERT INTO mysql.slow_log_f06r_missing VALUES (${"'x',".repeat(80)}1)`).catch(() => {})
    await c.end()
    await h.root.query("SET GLOBAL slow_query_log = 'OFF'; SET GLOBAL long_query_time = 10")
    await new Promise((res) => setTimeout(res, 1100))
    const window = { time_start: String(Number(t0) - 1), time_end: String(Number(t0) + 2) }
    const res = await both(
      h,
      () => h.pma.postJson('/server/status/monitor/slow-log', window),
      () => post<MonitorLogResponse>(h, '/status/monitor/slow-log', window),
    )
    const cmp = diff(h, res.pmaLog, res.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(res.b.message).toEqual(res.p.message)
    expect(res.b.message!.rows.some((x) => (x.sql_text ?? '').includes('f06r_slow'))).toBe(true)
  })
})
