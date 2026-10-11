import type {
  AdvisorResponse,
  KillProcessResponse,
  ProcessList,
  QueryStatistics,
  StatusOverview,
  StatusVariables,
} from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatStatusValue } from '../../apps/server/src/server-admin/status.ts'
import { englishTranslator } from '../../packages/i18n/src/index.ts'
import { $, $$, type Node, classes, hasClass, linkTarget, pageHtml, parse, shape, text } from './lib/html.ts'
import { type Harness, ROOT, both, diff, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of the Status pages: overview, processes (list, filters, sorting, full texts,
 * auto-refresh, kill), query statistics, all status variables (+ FLUSH) and the advisor.
 *
 * Counters move between the two tools' requests (other sessions use the server too), so values are
 * compared by shape (`#` for numbers) unless they are stable; the formatting itself is checked
 * exactly by formatting phpMyAdmin's own raw values (the `.original` spans).
 */
let h: Harness
const SLEEP_USER = 'm3srv_sleep'
const SLEEP_DB = 'm3srv_proc'
let sleeper: mysql.Connection | undefined
const tr = englishTranslator()

async function sleeperConnection(): Promise<mysql.Connection> {
  const c = await mysql.createConnection({
    ...ROOT,
    user: SLEEP_USER,
    password: SLEEP_USER,
    database: SLEEP_DB,
  })
  void c.query('SELECT SLEEP(600) AS m3srv_sleeping').catch(() => {})
  return c
}

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness()
  await h.root.query(`DROP DATABASE IF EXISTS ${SLEEP_DB}; CREATE DATABASE ${SLEEP_DB};
    DROP USER IF EXISTS '${SLEEP_USER}'@'%'; CREATE USER '${SLEEP_USER}'@'%' IDENTIFIED BY '${SLEEP_USER}';
    GRANT ALL ON \`${SLEEP_DB}\`.* TO '${SLEEP_USER}'@'%'`)
  sleeper = await sleeperConnection()
  await new Promise((r) => setTimeout(r, 300))
})
afterAll(async () => {
  sleeper?.destroy()
  await h?.root.query(`DROP DATABASE IF EXISTS ${SLEEP_DB}; DROP USER IF EXISTS '${SLEEP_USER}'@'%'`)
  await h?.close()
})

async function page(pmaRoute: string, bmaPath: string, params: Record<string, string> = {}, post = false) {
  const r = await both(
    h,
    () => (post ? h.pma.post(pmaRoute, params, true) : h.pma.get(pmaRoute, params, true)),
    () => h.bma.req('GET', `/api/servers/1${bmaPath}`),
  )
  expect(r.b.status, JSON.stringify(r.b.json)).toBe(200)
  return { ...r, html: parse(pageHtml(r.p)) }
}

const pills = (html: Node) => $$(html, 'ul.nav-pills a').map((a) => [text(a), hasClass(a, 'active')])

describe.skipIf(!pmaReachable)('parity: status pages', () => {
  it('Server overview (/server/status)', async () => {
    const r = await page('/server/status', '/status')
    const cmp = diff(h, r.pmaLog, r.bmaLog, [], {})
    // SELECT UNIX_TIMESTAMP() - {Uptime}: the uptime moved on by a second or two
    const norm = (xs: string[]) =>
      xs
        .filter((s) => !s.startsWith('USE '))
        .map((s) => s.replace(/UNIX_TIMESTAMP\(\) - \d+/, 'UNIX_TIMESTAMP() - UPTIME'))
    expect(norm(cmp.bma)).toEqual(norm(cmp.pma))
    const o = r.b.json as unknown as StatusOverview
    const html = r.html
    expect(pills(html)).toEqual([
      ['Server', true],
      ['Processes', false],
      ['Query statistics', false],
      ['All status variables', false],
      ['Monitor', false],
      ['Advisor', false],
    ])
    expect(shape(text($(html, 'h3')!))).toBe(shape(`Network traffic since startup: ${o.networkTraffic}`))
    expect(shape(text($$(html, 'p')[0]!))).toBe(
      shape(`This MySQL server has been running for ${o.uptime}. It started up on ${o.startTime}.`),
    )
    const [traffic, connections] = $$(html, 'table.table')
    const rows = (t: Node) =>
      $$(t, 'tbody tr').map((tr) => [text($(tr, 'th')!), ...$$(tr, 'td').map((td) => shape(text(td)))])
    expect(o.traffic.map((t) => [t.name, shape(t.number), shape(t.perHour)])).toEqual(rows(traffic!))
    expect(
      o.connections.map((c) => [c.name, shape(c.number), shape(c.perHour), shape(c.percentage)]),
    ).toEqual(rows(connections!))
    expect(text($(traffic!, 'thead')!, true)).toBe('Traffic # ø per hour')
    expect($(traffic!, 'span.pma_hint span.hide')).toBeDefined()
    // replication summary
    if (o.isPrimary || o.isReplica) {
      expect(text($(html, 'p.alert')!)).toBe(
        o.isPrimary && o.isReplica
          ? 'This MySQL server works as primary and replica in replication process.'
          : o.isPrimary
            ? 'This MySQL server works as primary in replication process.'
            : 'This MySQL server works as replica in replication process.',
      )
      const tables = $$(html, 'div').filter((d) =>
        /^replication_(primary|replica)_section$/.test(d.attrs.id ?? ''),
      )
      expect(
        tables.map((d) => ({
          title: text($(d, 'h4')!),
          rows: $$(d, 'tbody tr').map((tr) => [text($$(tr, 'td')[0]!), shape(text($$(tr, 'td')[1]!))]),
        })),
      ).toEqual(
        o.replication.map((t) => ({
          title: t.type === 'primary' ? 'Primary status' : 'Replica status',
          rows: t.variables.map((v) => [v.name, shape(v.value)]),
        })),
      )
    }
  })

  const processRow = (tr: Node) => {
    const td = $$(tr, 'td')
    const userLink = $(td[2]!, 'a')
    const dbLink = $(td[4]!, 'a')
    return {
      kill: $(td[0]!, 'a.kill_process')?.attrs.href.replace(/^.*kill\//, '') ?? null,
      id: text(td[1]!),
      user: text(td[2]!),
      userLink: userLink?.attrs.href ?? null,
      host: text(td[3]!).replace(/:\d+$/, ':PORT'),
      db: text(td[4]!),
      dbLink: dbLink?.attrs.href ?? null,
      command: text(td[5]!),
      time: shape(text(td[6]!)),
      state: text(td[7]!),
      info: text(td[8]!),
    }
  }

  const ourRow = (p: ProcessList['rows'][number]) => ({
    kill: p.id,
    id: p.id,
    user: p.user,
    userLink: ['system user', 'event_scheduler', 'unauthenticated user'].includes(p.user)
      ? null
      : `index.php?route=/server/privileges&username=${encodeURIComponent(p.user)}&hostname=${encodeURIComponent(p.userHost)}&dbname=${encodeURIComponent(p.db)}&tablename=&routinename=`,
    host: p.host.replace(/:\d+$/, ':PORT'),
    db: p.db === '' ? 'None' : p.db,
    dbLink: p.db === '' ? null : `index.php?route=/database/structure&db=${encodeURIComponent(p.db)}`,
    command: p.command,
    time: shape(p.time),
    state: p.state,
    info: p.info ?? '---',
  })

  const headers = (html: Node) =>
    $$(html, 'table#tableprocesslist thead th').map((th) => {
      const links = $$(th, 'a')
      return {
        name: text(links[0] ?? th),
        post: links[0]?.attrs['data-post'] ?? null,
        arrows: $$(th, 'img.soimg').map((i) => i.attrs.style ?? ''),
        toggle:
          links[1] !== undefined ? [links[1].attrs['data-post'], $(links[1], 'img')!.attrs.title] : null,
      }
    })

  const ourHeaders = (l: ProcessList) => [
    { name: 'Processes', post: null, arrows: [], toggle: null },
    ...l.columns.map((c) => ({
      name: c.name,
      post: new URLSearchParams({
        column_name: c.name,
        order_by_field: c.orderByField,
        sort_order: c.sortOrder,
        ...(l.showExecuting ? { showExecuting: 'on' } : {}),
      }).toString(),
      arrows: c.isSorted
        ? [
            `display: ${c.sortOrder === 'DESC' ? 'none' : 'inline'}`,
            `display: ${c.sortOrder === 'DESC' ? 'inline' : 'none'}`,
          ]
        : [],
      toggle: c.hasFullQuery
        ? [
            new URLSearchParams({
              full: l.full ? '' : '1',
              ...(l.showExecuting || (l.orderByField !== '' && l.sortOrder !== '')
                ? {
                    order_by_field: l.orderByField,
                    sort_order: l.sortOrder,
                    showExecuting: l.showExecuting ? '1' : '0',
                  }
                : {}),
            }).toString(),
            c.isFull ? 'Truncate shown queries' : 'Show full queries',
          ]
        : null,
    })),
  ]

  const PROCESS_CASES: Array<[string, Record<string, string>, string]> = [
    ['default list (SHOW PROCESSLIST)', {}, ''],
    ['full texts (SHOW FULL PROCESSLIST)', { full: '1' }, '?full=1'],
    ['only active (INFORMATION_SCHEMA with filter)', { showExecuting: 'on' }, '?showExecuting=on'],
    [
      'sorted by Time DESC',
      { column_name: 'Time', order_by_field: 'Time', sort_order: 'DESC' },
      '?order_by_field=Time&sort_order=DESC',
    ],
    [
      'sorted by ID ASC, only active',
      { column_name: 'ID', order_by_field: 'Id', sort_order: 'ASC', showExecuting: 'on' },
      '?order_by_field=Id&sort_order=ASC&showExecuting=on',
    ],
  ]
  for (const [name, params, qs] of PROCESS_CASES) {
    it(`Processes: ${name}`, async () => {
      const r = await page('/server/status/processes', `/status/processes${qs}`, params, true)
      const cmp = diff(h, r.pmaLog, r.bmaLog)
      expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
      const l = r.b.json as unknown as ProcessList
      expect(ourHeaders(l)).toEqual(headers(r.html))
      const pmaRow = $$(r.html, 'table#tableprocesslist tbody tr')
        .map(processRow)
        .find((p) => p.user === SLEEP_USER)
      const bmaRow = l.rows.find((p) => p.user === SLEEP_USER)
      expect(pmaRow).toBeDefined()
      expect(ourRow(bmaRow!)).toEqual(pmaRow)
      expect($(r.html, 'input#showExecuting')!.attrs.checked !== undefined).toBe(l.showExecuting)
      expect(text($(r.html, 'div.alert-primary')!)).toBe(
        'Note: Enabling the auto refresh here might cause heavy traffic between the web server and the MySQL server.',
      )
      expect($$(r.html, 'select#id_refreshRate option').map((o) => [o.attrs.value, text(o)])).toEqual(
        [2, 3, 4, 5, 10, 20, 40, 60, 120, 300, 600, 1200].map((n) => [
          String(n),
          n < 60 ? `${n} seconds` : n === 60 ? '1 minute' : `${n / 60} minutes`,
        ]),
      )
    })
  }

  it('Processes: the auto-refresh request (always SHOW FULL PROCESSLIST, quirk reproduced)', async () => {
    const r = await both(
      h,
      () =>
        h.pma.post(
          '/server/status/processes/refresh',
          { refresh: 'true', full: '', order_by_field: '', column_name: '', sort_order: '' },
          true,
        ),
      () => h.bma.req('GET', '/api/servers/1/status/processes?full=1'),
    )
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(cmp.bma).toContain('SHOW FULL PROCESSLIST')
  })

  it('Kill: KILL {id}; removes the process, both messages', async () => {
    const a = await sleeperConnection()
    const b = await sleeperConnection()
    try {
      const r = await both(
        h,
        () => h.pma.postJson(`/server/status/processes/kill/${a.threadId}`, { kill: String(a.threadId) }),
        () => h.bma.req('POST', `/api/servers/1/status/processes/${b.threadId}/kill`),
      )
      const cmp = diff(h, r.pmaLog, r.bmaLog, [], {
        [`KILL ${a.threadId}`]: 'KILL ID',
        [`KILL ${b.threadId}`]: 'KILL ID',
      })
      expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
      expect(cmp.bma).toContain('KILL ID')
      const k = r.b.json as unknown as KillProcessResponse
      expect(k.success).toBe(true)
      expect(text(parse(String(r.p.message)))).toBe(
        k.message.text.replace(String(b.threadId), String(a.threadId)),
      )
      // killing it again fails with phpMyAdmin's message
      const again = await both(
        h,
        () => h.pma.postJson(`/server/status/processes/kill/${a.threadId}`, { kill: String(a.threadId) }),
        () => h.bma.req('POST', `/api/servers/1/status/processes/${b.threadId}/kill`),
      )
      const k2 = again.b.json as unknown as KillProcessResponse
      expect(k2.success).toBe(false)
      expect(text(parse(String(again.p.error)))).toBe(
        k2.message.text.replace(String(b.threadId), String(a.threadId)),
      )
    } finally {
      a.destroy()
      b.destroy()
    }
  })

  it('Query statistics (/server/status/queries)', async () => {
    const r = await page('/server/status/queries', '/status/queries')
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    const q = r.b.json as unknown as QueryStatistics
    const html = r.html
    expect(shape(text($(html, 'h3')!))).toBe(shape(`Questions since startup: ${q.total}`))
    expect(linkTarget($(html, 'h3 a')!.attrs.href ?? '')).toBe(q.questionsDocUrl)
    expect($$(html, 'div.container ul li').map((li) => shape(text(li)))).toEqual(
      [
        `ø per hour: ${q.perHour}`,
        `ø per minute: ${q.perMinute}`,
        ...(q.perSecond !== null ? [`ø per second: ${q.perSecond}`] : []),
      ].map(shape),
    )
    const pmaRows = $$(html, 'table#serverStatusQueriesDetails tbody tr').map((tr) => [
      text($(tr, 'th')!),
      ...$$(tr, 'td').map((td) => shape(text(td))),
    ])
    // the order follows the counters, which move: compare as sets of statement names
    const sortRows = (xs: string[][]) => [...xs].sort((a, b) => a[0]!.localeCompare(b[0]!))
    expect(
      sortRows(q.queries.map((x) => [x.name, shape(x.value), shape(x.perHour), shape(x.percentage)])),
    ).toEqual(sortRows(pmaRows))
    const chart = JSON.parse($(html, 'canvas#query-statistics-chart')!.attrs['data-chart-data']!) as {
      labels: string[]
    }
    expect(q.chart.labels.includes('Other statements')).toBe(chart.labels.includes('Other statements'))
    expect(Math.abs(q.chart.labels.length - chart.labels.length)).toBeLessThanOrEqual(1)
  })

  const statusRows = (html: Node) =>
    $$(html, 'table#serverStatusVariables tbody tr').map((tr) => {
      const th = $(tr, 'th')!
      const value = $(tr, 'td.value')!
      const formatted = $(value, 'span.formatted')!
      const original = $(value, 'span.original')!
      const alert = $(formatted, 'span')
      const desc = $$(tr, 'td')[1]!
      return {
        name: text(th),
        cls: classes(tr).find((c) => c.startsWith('s_')) ?? null,
        doc: $(th, 'a') !== undefined ? linkTarget($(th, 'a')!.attrs.href ?? '') : null,
        alert: alert !== undefined ? classes(alert)[0]! : null,
        formatted: text(formatted),
        abbr: $(formatted, 'abbr')?.attrs.title ?? null,
        original: text(original),
        description: text(desc),
        descriptionLinks: $$(desc, 'a').map((a) => linkTarget(a.attrs.href ?? '')),
      }
    })

  it('All status variables (/server/status/variables)', async () => {
    const r = await page('/server/status/variables', '/status/variables')
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    const v = r.b.json as unknown as StatusVariables
    const html = r.html
    expect($$(html, 'select#filterCategory option').map((o) => [o.attrs.value, text(o)])).toEqual([
      ['', 'Filter by category…'],
      ...v.categories.map((c) => [c.id, c.name]),
    ])
    // related links box
    const links = $$(html, 'div#linkSuggestions span').filter((s) => /^status_/.test(s.attrs.class ?? ''))
    expect(
      links.map((s) => [s.attrs.class, $$(s, 'a').map((a) => text(a) || linkTarget(a.attrs.href ?? ''))]),
    ).toEqual(
      v.links.map((l) => [`status_${l.section}`, l.links.map((x) => (x.kind === 'doc' ? x.url : x.label))]),
    )

    const pma = statusRows(html)
    const ours = new Map(v.variables.map((x) => [x.name.replaceAll('_', ' '), x]))
    expect(v.variables.map((x) => x.name.replaceAll('_', ' '))).toEqual(pma.map((p) => p.name))
    for (const p of pma) {
      const o = ours.get(p.name)!
      expect([p.name, `s_${o.section}`, o.docUrl, o.description.replace(/\s+/g, ' '), o.hasAlert]).toEqual([
        p.name,
        p.cls,
        p.doc,
        p.description,
        // quirk Q17 (fixed in ours): phpMyAdmin's alert key never matches Key_buffer_fraction_%
        p.alert !== null || o.name === 'Key_buffer_fraction_%',
      ])
      // phpMyAdmin's raw value, formatted by us, gives phpMyAdmin's formatted value
      const f = formatStatusValue(tr, o.name, p.original)
      // quirk Q17 (fixed): phpMyAdmin never colours Key_buffer_fraction_%
      const expected = { text: p.formatted, title: p.abbr ?? undefined }
      expect({ text: f.text, title: f.title }, p.name).toEqual(expected)
    }
    // the static values agree exactly
    for (const name of [
      'Innodb page size',
      'Ssl cipher',
      'Rpl semi sync source status',
      'Innodb buffer pool pages total',
    ]) {
      const p = pma.find((x) => x.name === name)
      if (p !== undefined) expect(ours.get(name)!.formatted.text).toBe(p.formatted)
    }
  })

  it('FLUSH TABLES from the related links (quirk Q15 fixed: the action reaches the page)', async () => {
    const r = await both(
      h,
      () => h.pma.post('/server/status/variables', { flush: 'TABLES' }, true),
      () => h.bma.req('POST', '/api/servers/1/status/variables', { flush: 'TABLES' }),
    )
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(cmp.bma).toContain('FLUSH TABLES')
    expect((r.b.json as unknown as StatusVariables).flushed).toBe('FLUSH TABLES;')
  })

  it('a flush value outside the list is ignored', async () => {
    const r = await both(
      h,
      () => h.pma.post('/server/status/variables', { flush: 'PRIVILEGES' }, true),
      () => h.bma.req('POST', '/api/servers/1/status/variables', { flush: 'PRIVILEGES' }),
    )
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(cmp.bma.some((s) => s.startsWith('FLUSH'))).toBe(false)
  })

  it('Advisor (/server/status/advisor)', async () => {
    const r = await page('/server/status/advisor', '/status/advisor')
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    const a = r.b.json as unknown as AdvisorResponse
    const html = r.html
    expect(text($(html, 'h2')!)).toBe('Advisor system')
    expect($$(html, 'div.modal-body p').map((p) => text(p))).toEqual([
      'The Advisor system can provide recommendations on server variables by analyzing the server status variables.',
      'Do note however that this system provides recommendations based on simple calculations and by rule of thumb which may not necessarily apply to your system.',
      'Prior to changing any of the configuration, be sure to know what you are changing (by reading the documentation) and how to undo the change. Wrong tuning can have a very negative effect on performance.',
      'The best way to tune your system would be to change only one setting at a time, observe or benchmark your database, and undo the change if there was no clearly measurable improvement.',
    ])
    expect(a.errors).toEqual($$(html, 'div.alert-danger li').map((li) => text(li)))
    const items = $$(html, 'div.accordion-item').map((item) => {
      const dd = $$(item, 'dd')
      return {
        header: text($(item, 'button')!),
        issue: text(dd[0]!),
        recommendation: text(dd[1]!),
        justification: shape(text(dd[2]!)),
        formula: text(dd[3]!),
        test: text(dd[4]!),
        links: $$(dd[1]!, 'a').map((x) => [text(x), x.attrs.target ?? null]),
      }
    })
    const stripTags = (s: string) => text(parse(s))
    expect(
      a.fired.map((f) => ({
        header: stripTags(f.issue),
        issue: stripTags(f.issue),
        recommendation: stripTags(f.recommendation),
        justification: shape(f.justification),
        formula: f.formula,
        test: f.test,
        links: $$(parse(f.recommendation), 'a').map((x) => [text(x), x.attrs.target ?? null]),
      })),
    ).toEqual(items)
    expect($(html, 'div.accordion-collapse.show')?.attrs.id).toBe('collapse1')
  })
})
